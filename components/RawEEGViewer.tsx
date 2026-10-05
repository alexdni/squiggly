'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
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
  ChartOptions,
} from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import {
  parseEDFFile,
  extractTimeWindow as extractEDFTimeWindow,
  downsampleSignals as downsampleEDFSignals,
  type EDFData,
} from '@/lib/edf-reader-browser';
import {
  parseCSVFile,
  extractTimeWindow as extractCSVTimeWindow,
  downsampleSignals as downsampleCSVSignals,
  filterValidChannels,
  type CSVData,
} from '@/lib/csv-reader-browser';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  zoomPlugin
);

interface RawEEGViewerProps {
  recordingId: string;
  filePath: string;
}

// Unified interface for both data types
interface UnifiedSignalData {
  signals: number[][];
  sampleRate: number;
  duration: number;
  channelNames: string[];
  fileType: 'edf' | 'csv';
}

// Individual channel plot component
interface ChannelPlotProps {
  channelName: string;
  data: number[];
  labels: string[];
  color: string;
  minValue: number;
  maxValue: number;
}

function ChannelPlot({ channelName, data, labels, color, minValue, maxValue }: ChannelPlotProps) {
  const chartData = useMemo(() => ({
    labels,
    datasets: [
      {
        label: channelName,
        data: data,
        borderColor: color,
        backgroundColor: 'transparent',
        borderWidth: 1.2,
        pointRadius: 0,
        tension: 0,
      },
    ],
  }), [channelName, data, labels, color]);

  const options: ChartOptions<'line'> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    plugins: {
      legend: {
        display: false,
      },
      title: {
        display: false,
      },
      tooltip: {
        enabled: true,
        mode: 'index',
        intersect: false,
        callbacks: {
          label: (context) => {
            const value = context.parsed.y ?? 0;
            return `${value.toFixed(2)} μV`;
          },
        },
      },
      zoom: {
        pan: {
          enabled: true,
          mode: 'x',
        },
        zoom: {
          wheel: {
            enabled: true,
            speed: 0.05,
          },
          pinch: {
            enabled: true,
          },
          mode: 'x',
        },
      },
    },
    scales: {
      x: {
        display: false, // Hide x-axis for individual channels (shown only on last)
      },
      y: {
        type: 'linear' as const,
        display: true,
        min: minValue,
        max: maxValue,
        position: 'right' as const,
        ticks: {
          color: '#6B7280',
          font: {
            size: 9,
          },
          maxTicksLimit: 3,
          callback: function(value: any) {
            return Math.round(value);
          },
        },
        grid: {
          display: true,
          color: 'rgba(0, 0, 0, 0.05)',
        },
      },
    },
  }), [minValue, maxValue]);

  return (
    <div style={{ height: '100px' }}>
      <Line data={chartData} options={options} />
    </div>
  );
}

// Channel plot with x-axis (for the last channel)
function ChannelPlotWithXAxis({ channelName, data, labels, color, minValue, maxValue }: ChannelPlotProps) {
  const chartData = useMemo(() => ({
    labels,
    datasets: [
      {
        label: channelName,
        data: data,
        borderColor: color,
        backgroundColor: 'transparent',
        borderWidth: 1.2,
        pointRadius: 0,
        tension: 0,
      },
    ],
  }), [channelName, data, labels, color]);

  const options: ChartOptions<'line'> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    plugins: {
      legend: {
        display: false,
      },
      title: {
        display: false,
      },
      tooltip: {
        enabled: true,
        mode: 'index',
        intersect: false,
        callbacks: {
          label: (context) => {
            const value = context.parsed.y ?? 0;
            return `${value.toFixed(2)} μV`;
          },
        },
      },
      zoom: {
        pan: {
          enabled: true,
          mode: 'x',
        },
        zoom: {
          wheel: {
            enabled: true,
            speed: 0.05,
          },
          pinch: {
            enabled: true,
          },
          mode: 'x',
        },
      },
    },
    scales: {
      x: {
        display: true,
        title: {
          display: true,
          text: 'Time (s)',
          color: '#374151',
          font: {
            size: 12,
          },
        },
        ticks: {
          maxTicksLimit: 10,
          color: '#6B7280',
        },
        grid: {
          display: true,
          color: 'rgba(0, 0, 0, 0.1)',
        },
      },
      y: {
        type: 'linear' as const,
        display: true,
        min: minValue,
        max: maxValue,
        position: 'right' as const,
        ticks: {
          color: '#6B7280',
          font: {
            size: 9,
          },
          maxTicksLimit: 3,
          callback: function(value: any) {
            return Math.round(value);
          },
        },
        grid: {
          display: true,
          color: 'rgba(0, 0, 0, 0.05)',
        },
      },
    },
  }), [minValue, maxValue]);

  return (
    <div style={{ height: '120px' }}>
      <Line data={chartData} options={options} />
    </div>
  );
}

export default function RawEEGViewer({
  recordingId,
  filePath,
}: RawEEGViewerProps) {
  const [signalData, setSignalData] = useState<UnifiedSignalData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeWindow, setTimeWindow] = useState({ start: 0, duration: 10 }); // Show 10 seconds by default
  const [selectedChannels, setSelectedChannels] = useState<number[]>([]);
  const [autoscale, setAutoscale] = useState(false);
  const [displayGraph, setDisplayGraph] = useState(true);

  useEffect(() => {
    loadFile();
  }, [filePath]);

  const loadFile = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Detect file type from extension
      const fileExtension = filePath.toLowerCase().split('.').pop();

      // Download the file via API (works for both Supabase and local storage)
      // First get a signed URL, then download
      const signedUrlResponse = await fetch(`/api/recordings/${recordingId || 'unknown'}/download?path=${encodeURIComponent(filePath)}`);

      let data: Blob;
      if (signedUrlResponse.ok) {
        const { signedUrl } = await signedUrlResponse.json();
        const downloadResponse = await fetch(signedUrl);
        if (!downloadResponse.ok) throw new Error('Failed to download file');
        data = await downloadResponse.blob();
      } else {
        // Fallback: try direct download through storage API
        const token = btoa(JSON.stringify({ bucket: 'recordings', path: filePath, expires: Date.now() + 60000 }));
        const downloadResponse = await fetch(`/api/storage/download?token=${token}`);
        if (!downloadResponse.ok) throw new Error('Failed to download file');
        data = await downloadResponse.blob();
      }

      if (fileExtension === 'csv') {
        // Parse CSV file - convert Blob to text first
        const text = await data.text();
        const parsedData = await parseCSVFile(text);
        const filteredData = filterValidChannels(parsedData);

        const unifiedData: UnifiedSignalData = {
          signals: filteredData.signals,
          sampleRate: filteredData.sampleRate,
          duration: filteredData.duration,
          channelNames: filteredData.channelNames,
          fileType: 'csv',
        };

        setSignalData(unifiedData);

        // Select all channels by default
        setSelectedChannels(Array.from({ length: filteredData.channelNames.length }, (_, i) => i));
      } else {
        // Parse EDF file
        const arrayBuffer = await data.arrayBuffer();
        const parsedData = await parseEDFFile(arrayBuffer);

        const unifiedData: UnifiedSignalData = {
          signals: parsedData.signals,
          sampleRate: parsedData.sampleRate,
          duration: parsedData.duration,
          channelNames: parsedData.header.channels.map(ch => ch.label),
          fileType: 'edf',
        };

        setSignalData(unifiedData);

        // Select all channels by default
        setSelectedChannels(Array.from({ length: parsedData.header.channelCount }, (_, i) => i));
      }
    } catch (err: any) {
      console.error('Error loading file:', err);
      setError(err.message || 'Failed to load EEG data');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChannelToggle = (channelIndex: number) => {
    setSelectedChannels((prev) => {
      if (prev.includes(channelIndex)) {
        return prev.filter((i) => i !== channelIndex);
      } else {
        return [...prev, channelIndex].sort((a, b) => a - b);
      }
    });
  };

  const renderChannelSelector = () => {
    if (!signalData) return null;

    return (
      <div className="mb-4">
        <h3 className="text-sm font-semibold mb-2 text-gray-900">Select Channels to Display:</h3>
        <div className="flex flex-wrap gap-2">
          {signalData.channelNames.map((channelName, index) => (
            <button
              key={index}
              onClick={() => handleChannelToggle(index)}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                selectedChannels.includes(index)
                  ? 'bg-neuro-primary text-white'
                  : 'bg-gray-200 text-gray-900 hover:bg-gray-300'
              }`}
            >
              {cleanChannelLabel(channelName)}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderTimeControls = () => {
    if (!signalData) return null;

    const maxTime = signalData.duration;

    return (
      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-4 flex-wrap">
          <label className="text-sm font-semibold text-gray-900">Time Window:</label>
          <input
            type="number"
            min={0}
            max={maxTime - timeWindow.duration}
            step={1}
            value={timeWindow.start}
            onChange={(e) =>
              setTimeWindow((prev) => ({
                ...prev,
                start: parseFloat(e.target.value),
              }))
            }
            className="border border-gray-300 rounded px-2 py-1 w-20 text-gray-900 bg-white"
          />
          <span className="text-sm text-gray-900 font-medium">Start (s)</span>

          <input
            type="number"
            min={1}
            max={30}
            step={1}
            value={timeWindow.duration}
            onChange={(e) =>
              setTimeWindow((prev) => ({
                ...prev,
                duration: parseFloat(e.target.value),
              }))
            }
            className="border border-gray-300 rounded px-2 py-1 w-20 text-gray-900 bg-white"
          />
          <span className="text-sm text-gray-900 font-medium">Duration (s)</span>
        </div>

        <div className="flex gap-2 flex-wrap items-center">
          <button
            onClick={() =>
              setTimeWindow((prev) => ({
                ...prev,
                start: Math.max(0, prev.start - prev.duration),
              }))
            }
            disabled={timeWindow.start === 0}
            className="px-3 py-1 bg-neuro-primary text-white rounded text-sm disabled:opacity-50"
          >
            ← Previous
          </button>
          <button
            onClick={() =>
              setTimeWindow((prev) => ({
                ...prev,
                start: Math.min(
                  maxTime - prev.duration,
                  prev.start + prev.duration
                ),
              }))
            }
            disabled={timeWindow.start + timeWindow.duration >= maxTime}
            className="px-3 py-1 bg-neuro-primary text-white rounded text-sm disabled:opacity-50"
          >
            Next →
          </button>

          <div className="ml-4 flex items-center gap-2">
            <label className="text-sm font-semibold text-gray-900">Scaling:</label>
            <button
              onClick={() => setAutoscale(false)}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                !autoscale
                  ? 'bg-neuro-primary text-white'
                  : 'bg-gray-200 text-gray-900 hover:bg-gray-300'
              }`}
            >
              100 μV
            </button>
            <button
              onClick={() => setAutoscale(true)}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                autoscale
                  ? 'bg-neuro-primary text-white'
                  : 'bg-gray-200 text-gray-900 hover:bg-gray-300'
              }`}
            >
              Autoscale
            </button>
          </div>

          <button
            onClick={() => setDisplayGraph(!displayGraph)}
            className="ml-4 px-3 py-1 bg-neuro-primary text-white rounded text-sm"
          >
            {displayGraph ? 'Hide Graph' : 'Show Graph'}
          </button>
        </div>
      </div>
    );
  };

  // Helper function to clean channel labels
  const cleanChannelLabel = (label: string): string => {
    // Remove common prefixes like "EEG " and suffixes like "-LE", "-REF", etc.
    return label
      .replace(/^EEG\s+/i, '')  // Remove "EEG " prefix
      .replace(/-LE$/i, '')      // Remove "-LE" suffix
      .replace(/-REF$/i, '')     // Remove "-REF" suffix
      .replace(/-M1$/i, '')      // Remove "-M1" suffix
      .replace(/-M2$/i, '')      // Remove "-M2" suffix
      .trim();
  };

  const colors = [
    '#3B82F6', // blue
    '#10B981', // green
    '#F59E0B', // orange
    '#EF4444', // red
    '#8B5CF6', // purple
    '#EC4899', // pink
    '#14B8A6', // teal
    '#F97316', // orange-red
  ];

  const renderChart = () => {
    if (!signalData || selectedChannels.length === 0 || !displayGraph) return null;

    // Extract time window (use appropriate function based on file type)
    const extractTimeWindow = signalData.fileType === 'csv' ? extractCSVTimeWindow : extractEDFTimeWindow;
    const downsampleSignals = signalData.fileType === 'csv' ? downsampleCSVSignals : downsampleEDFSignals;

    const windowSignals = extractTimeWindow(
      signalData.signals,
      signalData.sampleRate,
      timeWindow.start,
      timeWindow.duration
    );

    // Downsample for visualization (max 2000 points per channel for smoother display)
    const downsampled = downsampleSignals(windowSignals, 2000);

    // Generate time labels
    const labels = Array.from(
      { length: downsampled[0]?.length || 0 },
      (_, i) =>
        (
          timeWindow.start +
          (i / (downsampled[0]?.length || 1)) * timeWindow.duration
        ).toFixed(2)
    );

    // Calculate Y-axis range
    let minValue = -100;
    let maxValue = 100;

    if (autoscale) {
      // Calculate range from all selected channels
      let dataMin = Infinity;
      let dataMax = -Infinity;
      selectedChannels.forEach((channelIndex) => {
        const channelData = downsampled[channelIndex];
        if (channelData) {
          channelData.forEach((value) => {
            if (isFinite(value)) {
              dataMin = Math.min(dataMin, value);
              dataMax = Math.max(dataMax, value);
            }
          });
        }
      });

      // Add 10% padding
      const range = dataMax - dataMin;
      const padding = range * 0.1;
      minValue = dataMin - padding;
      maxValue = dataMax + padding;
    }

    return (
      <div>
        <div className="mb-2 text-sm text-gray-500">
          Time: {timeWindow.start.toFixed(1)}s - {(timeWindow.start + timeWindow.duration).toFixed(1)}s
        </div>
        <div className="flex flex-col">
          {selectedChannels.map((channelIndex, i) => {
            const channelData = downsampled[channelIndex];
            const channelName = cleanChannelLabel(signalData.channelNames[channelIndex]);
            const color = colors[i % colors.length];
            const isLast = i === selectedChannels.length - 1;

            return (
              <div key={channelIndex} className="flex w-full border-b border-gray-100 last:border-b-0">
                {/* Channel label */}
                <div className="w-16 flex items-center justify-end pr-2 text-sm font-medium text-gray-700">
                  {channelName}
                </div>
                {/* Chart */}
                <div className="flex-1">
                  {isLast ? (
                    <ChannelPlotWithXAxis
                      channelName={channelName}
                      data={channelData}
                      labels={labels}
                      color={color}
                      minValue={minValue}
                      maxValue={maxValue}
                    />
                  ) : (
                    <ChannelPlot
                      channelName={channelName}
                      data={channelData}
                      labels={labels}
                      color={color}
                      minValue={minValue}
                      maxValue={maxValue}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-neuro-primary"></div>
          <p className="ml-4 text-gray-800">Loading EEG data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-red-900 font-semibold mb-2">Error Loading EEG Data</h3>
          <p className="text-red-700">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-2xl font-bold text-neuro-dark mb-4">Raw EEG Signals</h2>
      {renderChannelSelector()}
      {renderTimeControls()}
      {selectedChannels.length > 0 ? (
        renderChart()
      ) : (
        <div className="bg-gray-100 rounded-lg p-8 text-center">
          <p className="text-gray-800">Select at least one channel to display</p>
        </div>
      )}
    </div>
  );
}
