'use client';

import { useRef, useCallback, useMemo, useEffect } from 'react';
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

function cleanChannelLabel(label: string): string {
  return label
    .replace(/^EEG\s+/i, '')
    .replace(/-LE$/i, '')
    .replace(/-REF$/i, '')
    .replace(/-M1$/i, '')
    .replace(/-M2$/i, '')
    .trim();
}

interface EEGUnifiedChartProps {
  filteredSignals: number[][];
  /** Optional second trace per channel (e.g. the original signal behind the corrected one) */
  overlaySignals?: (number[] | null)[];
  timeLabels: number[];
  channelNames: string[];
  selectedChannels: number[];
  sensitivityMicrovolts: number;
  annotations: EEGAnnotation[];
  dragState: AnnotationDragState;
  isAnnotateMode: boolean;
  onDragStart: (x: number, time: number) => void;
  onDragUpdate: (x: number, time: number) => void;
  onDragEnd: (x: number, time: number) => void;
  onDragCancel: () => void;
}

const MAIN_COLOR = '#374151';
const MAIN_COLOR_OVER_OVERLAY = '#111827';
const OVERLAY_COLOR = 'rgba(220, 38, 38, 0.45)';

export default function EEGUnifiedChart({
  filteredSignals,
  overlaySignals,
  timeLabels,
  channelNames,
  selectedChannels,
  sensitivityMicrovolts,
  annotations,
  dragState,
  isAnnotateMode,
  onDragStart,
  onDragUpdate,
  onDragEnd,
  onDragCancel,
}: EEGUnifiedChartProps) {
  const chartRef = useRef<ChartJS<'line'> | null>(null);

  const cleanedLabels = useMemo(
    () => selectedChannels.map((idx) => cleanChannelLabel(channelNames[idx] ?? '')),
    [selectedChannels, channelNames]
  );

  // Calculate offsets for each channel
  const spacing = sensitivityMicrovolts * 2;
  const offsets = useMemo(
    () => selectedChannels.map((_, i) => -(i * spacing)),
    [selectedChannels.length, spacing]
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

    return { datasets };
  }, [filteredSignals, overlaySignals, timeLabels, cleanedLabels, offsets]);

  // Y-axis range
  const yMin = -(selectedChannels.length - 1) * spacing - sensitivityMicrovolts;
  const yMax = sensitivityMicrovolts;

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
    ]
  );

  // Chart height: ~28px per channel + 40px for axis
  const chartHeight = selectedChannels.length * 28 + 40;

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

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isAnnotateMode) return;
      const result = getTimeFromEvent(e);
      if (result) {
        onDragStart(result.x, result.time);
      }
    },
    [isAnnotateMode, getTimeFromEvent, onDragStart]
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
      style={{
        height: `${chartHeight}px`,
        cursor: isAnnotateMode ? 'crosshair' : 'default',
      }}
      onMouseDown={handleMouseDown as any}
      onMouseMove={handleMouseMove as any}
      onMouseUp={handleMouseUp as any}
      onMouseLeave={handleMouseLeave}
    >
      <Line ref={chartRef} data={chartData} options={options} />
    </div>
  );
}
