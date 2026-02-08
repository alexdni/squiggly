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
    if (!meta) return;

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

export default function EEGUnifiedChart({
  filteredSignals,
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
    () => selectedChannels.map((idx) => cleanChannelLabel(channelNames[idx])),
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
    const datasets = filteredSignals.map((signal, i) => ({
      label: cleanedLabels[i],
      data: signal.map((v, j) => ({
        x: timeLabels[j],
        y: v + offsets[i],
      })),
      borderColor: '#374151',
      backgroundColor: 'transparent',
      borderWidth: 1,
      pointRadius: 0,
      tension: 0,
    }));

    return { datasets };
  }, [filteredSignals, timeLabels, cleanedLabels, offsets]);

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
