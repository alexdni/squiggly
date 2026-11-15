'use client';

import { useRef, useCallback, useMemo, useEffect, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  type ChartOptions,
  type Plugin,
} from 'chart.js';
import { annotationPlugin } from './annotationPlugin';
import { DRAG_THRESHOLD_PX, keyPanSeconds, wheelPanPixels } from './pan';
import type { EEGAnnotation, AnnotationDragState } from './types';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  annotationPlugin
);

// Channel label plugin: draws channel names at correct Y positions on left margin
const channelLabelPlugin: Plugin<'line'> = {
  id: 'eegChannelLabels',
  afterDraw(chart: ChartJS<'line'>) {
    const meta = (chart.options.plugins as any)?.eegChannelLabels as
      | { labels: string[]; offsets: number[] }
      | undefined;
    // Registered globally, so it also runs on other charts, which get an empty options object.
    if (!meta || !Array.isArray(meta.labels) || !Array.isArray(meta.offsets)) return;

    const { ctx } = chart;
    const yScale = chart.scales.y;
    const chartArea = chart.chartArea;

    if (!yScale || !chartArea) return;

    ctx.save();
    ctx.fillStyle = '#374151';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < meta.labels.length; i++) {
      const yPixel = yScale.getPixelForValue(meta.offsets[i]);
      if (yPixel >= chartArea.top && yPixel <= chartArea.bottom) {
        ctx.fillText(meta.labels[i], chartArea.left - 6, yPixel);
      }
    }

    ctx.restore();
  },
};

ChartJS.register(channelLabelPlugin);

interface EEGUnifiedChartProps {
  filteredSignals: number[][];
  /** Optional second trace per channel (e.g. the original signal behind the corrected one) */
  overlaySignals?: (number[] | null)[];
  timeLabels: number[];
  /** one label per trace, in display order */
  rowLabels: string[];
  /** [start, end] of the window in seconds, so the time axis spans exactly the window */
  timeRange?: [number, number];
  sensitivityMicrovolts: number;
  /** move the window by this many seconds (±Infinity: start / end of the recording) */
  onPan?: (deltaSeconds: number) => void;
  annotations: EEGAnnotation[];
  dragState: AnnotationDragState;
  isAnnotateMode: boolean;
  onDragStart: (x: number, time: number) => void;
  onDragUpdate: (x: number, time: number) => void;
  onDragEnd: (x: number, time: number) => void;
  onDragCancel: () => void;
  /**
   * Click on the chart outside annotate mode: the time under the pointer (seconds) and its height
   * above the bottom of the plot area (pixels)
   */
  onChartClick?: (time: number, pxAboveBottom: number) => void;
  /** trace segments to draw in colour on top of their channel: `row` indexes rowLabels */
  traceHighlights?: { row: number; startSec: number; endSec: number; color: string }[];
}

const MAIN_COLOR = '#374151';
const MAIN_COLOR_OVER_OVERLAY = '#111827';
const OVERLAY_COLOR = 'rgba(220, 38, 38, 0.45)';

export default function EEGUnifiedChart({
  filteredSignals,
  overlaySignals,
  timeLabels,
  rowLabels,
  timeRange,
  sensitivityMicrovolts,
  onPan,
  annotations,
  dragState,
  isAnnotateMode,
  onDragStart,
  onDragUpdate,
  onDragEnd,
  onDragCancel,
  onChartClick,
  traceHighlights,
}: EEGUnifiedChartProps) {
  const chartRef = useRef<ChartJS<'line'> | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const cleanedLabels = rowLabels;
  const nRows = rowLabels.length;

  // Calculate offsets for each channel
  const spacing = sensitivityMicrovolts * 2;
  const offsets = useMemo(
    () => Array.from({ length: nRows }, (_, i) => -(i * spacing)),
    [nRows, spacing]
  );

  // Build chart data: each channel as a separate dataset, offset vertically
  const chartData = useMemo(() => {
    const hasOverlay = Boolean(overlaySignals?.some(Boolean));
    // Main traces first so dataset index i maps to channel i (tooltips, labels); `order` puts
    // them in front of the overlay, which Chart.js draws first.
    const datasets: any[] = filteredSignals.map((signal, i) => ({
      label: cleanedLabels[i],
      data: signal.map((v, j) => ({
        x: timeLabels[j],
        y: v + offsets[i],
      })),
      borderColor: hasOverlay ? MAIN_COLOR_OVER_OVERLAY : MAIN_COLOR,
      backgroundColor: 'transparent',
      borderWidth: 1,
      pointRadius: 0,
      tension: 0,
      order: 0,
    }));
    if (hasOverlay) {
      overlaySignals!.forEach((signal, i) => {
        if (!signal) return;
        datasets.push({
          label: `${cleanedLabels[i]} (original)`,
          data: signal.map((v, j) => ({ x: timeLabels[j], y: v + offsets[i] })),
          borderColor: OVERLAY_COLOR,
          backgroundColor: 'transparent',
          borderWidth: 1.25,
          pointRadius: 0,
          tension: 0,
          order: 1,
        });
      });
    }

    // Highlighted stretches of a channel's own trace, drawn over it (lowest `order` is on top).
    // Appended after every other dataset, so the tooltip filter below leaves them out.
    for (const h of traceHighlights ?? []) {
      const signal = filteredSignals[h.row];
      if (!signal) continue;
      const data: { x: number; y: number }[] = [];
      for (let j = 0; j < signal.length; j++) {
        const t = timeLabels[j];
        if (t >= h.startSec && t <= h.endSec) data.push({ x: t, y: signal[j] + offsets[h.row] });
      }
      if (data.length < 2) continue;
      datasets.push({
        label: `${cleanedLabels[h.row]} (highlight)`,
        data,
        borderColor: h.color,
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0,
        order: -1,
      });
    }

    return { datasets };
  }, [filteredSignals, overlaySignals, timeLabels, cleanedLabels, offsets, traceHighlights]);

  // Y-axis range
  const yMin = -(nRows - 1) * spacing - sensitivityMicrovolts;
  const yMax = sensitivityMicrovolts;

  const timeMin = timeRange?.[0];
  const timeMax = timeRange?.[1];
  const options: ChartOptions<'line'> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {
        mode: 'nearest' as const,
        intersect: false,
      },
      layout: {
        padding: { left: 60 },
      },
      plugins: {
        legend: { display: false },
        title: { display: false },
        tooltip: {
          enabled: !isAnnotateMode,
          mode: 'nearest',
          intersect: false,
          filter: (item) => item.datasetIndex < filteredSignals.length,
          callbacks: {
            label: (context) => {
              const raw = context.parsed.y ?? 0;
              const datasetIndex = context.datasetIndex;
              const actual = raw - offsets[datasetIndex];
              return `${cleanedLabels[datasetIndex]}: ${actual.toFixed(1)} uV`;
            },
          },
        },
        eegAnnotations: {
          annotations,
          dragState,
        } as any,
        eegChannelLabels: {
          labels: cleanedLabels,
          offsets,
        } as any,
      },
      scales: {
        x: {
          type: 'linear' as const,
          display: true,
          min: timeMin,
          max: timeMax,
          title: {
            display: true,
            text: 'Time (s)',
            color: '#374151',
            font: { size: 11 },
          },
          ticks: {
            color: '#6B7280',
            maxTicksLimit: 20,
            callback: function (value: any) {
              return Number(value).toFixed(1);
            },
          },
          grid: {
            display: true,
            color: 'rgba(0, 0, 0, 0.08)',
          },
        },
        y: {
          type: 'linear' as const,
          display: false,
          min: yMin,
          max: yMax,
        },
      },
    }),
    [
      isAnnotateMode,
      annotations,
      dragState,
      cleanedLabels,
      offsets,
      yMin,
      yMax,
      filteredSignals.length,
      timeMin,
      timeMax,
    ]
  );

  // Chart height: ~28px per channel + 40px for axis
  const chartHeight = nRows * 28 + 40;

  // Mouse event handling for annotations
  const getTimeFromEvent = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const chart = chartRef.current;
      if (!chart) return null;
      const rect = chart.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const xScale = chart.scales.x;
      if (!xScale) return null;
      const time = xScale.getValueForPixel(x);
      return time !== undefined ? { x, time } : null;
    },
    []
  );

  // ── scrolling through time ──
  const secondsPerPixel = useCallback(() => {
    const chart = chartRef.current;
    const x = chart?.scales.x;
    const width = chart?.chartArea?.width ?? 0;
    return x && width > 0 ? (x.max - x.min) / width : 0;
  }, []);

  // Wheel: sideways movement (or Shift+wheel) scrolls time; plain vertical wheel is left to the page.
  // Registered by hand because React's wheel listeners are passive and cannot preventDefault.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !onPan) return;
    const onWheel = (e: WheelEvent) => {
      const px = wheelPanPixels(e);
      if (px === 0) return;
      e.preventDefault();
      onPan(px * secondsPerPixel());
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onPan, secondsPerPixel]);

  // Drag: the trace follows the pointer. A press that barely moves stays a click.
  const pan = useRef<{ x: number; lastX: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [isPanning, setIsPanning] = useState(false);
  useEffect(() => {
    if (!isPanning) return;
    const onMove = (e: MouseEvent) => {
      const p = pan.current;
      if (!p) return;
      if (!p.moved && Math.abs(e.clientX - p.x) < DRAG_THRESHOLD_PX) return;
      p.moved = true;
      onPan?.((p.lastX - e.clientX) * secondsPerPixel());
      p.lastX = e.clientX;
    };
    const onUp = () => {
      suppressClick.current = Boolean(pan.current?.moved);
      pan.current = null;
      setIsPanning(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isPanning, onPan, secondsPerPixel]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const chart = chartRef.current;
      const x = chart?.scales.x;
      if (!onPan || !x || e.altKey || e.ctrlKey || e.metaKey) return;
      const delta = keyPanSeconds(e.key, e.shiftKey, x.max - x.min);
      if (delta === null) return;
      e.preventDefault();
      onPan(delta);
    },
    [onPan]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isAnnotateMode && onPan && e.button === 0) {
        suppressClick.current = false;
        pan.current = { x: e.clientX, lastX: e.clientX, moved: false };
        setIsPanning(true);
      }
      if (!isAnnotateMode) return;
      const result = getTimeFromEvent(e);
      if (result) {
        onDragStart(result.x, result.time);
      }
    },
    [isAnnotateMode, getTimeFromEvent, onDragStart, onPan]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isAnnotateMode || !dragState.isDragging) return;
      const result = getTimeFromEvent(e);
      if (result) {
        onDragUpdate(result.x, result.time);
      }
    },
    [isAnnotateMode, dragState.isDragging, getTimeFromEvent, onDragUpdate]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isAnnotateMode || !dragState.isDragging) return;
      const result = getTimeFromEvent(e);
      if (result) {
        onDragEnd(result.x, result.time);
      }
    },
    [isAnnotateMode, dragState.isDragging, getTimeFromEvent, onDragEnd]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      if (isAnnotateMode || !onChartClick) return;
      const result = getTimeFromEvent(e);
      const chart = chartRef.current;
      if (!result || !chart) return;
      const y = e.clientY - chart.canvas.getBoundingClientRect().top;
      onChartClick(result.time, chart.chartArea.bottom - y);
    },
    [isAnnotateMode, onChartClick, getTimeFromEvent]
  );

  const handleMouseLeave = useCallback(() => {
    if (dragState.isDragging) {
      onDragCancel();
    }
  }, [dragState.isDragging, onDragCancel]);

  if (filteredSignals.length === 0 || timeLabels.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      tabIndex={onPan ? 0 : undefined}
      role={onPan ? 'group' : undefined}
      aria-label={onPan ? 'EEG traces. Arrow keys, Page Up/Down, Home and End scroll through time.' : undefined}
      onKeyDown={handleKeyDown}
      className="focus:outline-none focus-visible:ring-2 focus-visible:ring-neuro-primary rounded"
      style={{
        height: `${chartHeight}px`,
        cursor: isAnnotateMode ? 'crosshair' : !onPan ? 'default' : isPanning ? 'grabbing' : 'grab',
        userSelect: 'none',
      }}
      onMouseDown={handleMouseDown as any}
      onMouseMove={handleMouseMove as any}
      onMouseUp={handleMouseUp as any}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick as any}
    >
      <Line ref={chartRef} data={chartData} options={options} />
    </div>
  );
}
