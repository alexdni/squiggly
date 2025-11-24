'use client';

import { useState, useEffect, useRef } from 'react';
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
  readCSVFile,
  extractTimeWindow as extractCSVTimeWindow,
  downsampleSignals as downsampleCSVSignals,
  filterValidChannels,
  type CSVData,
} from '@/lib/csv-reader-browser';
import { createClient } from '@/lib/supabase-client';

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

export default function RawEEGViewer({
  recordingId,
  filePath,
}: RawEEGViewerProps) {
  const [signalData, setSignalData] = useState<UnifiedSignalData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeWindow, setTimeWindow] = useState({ start: 0, duration: 10 }); // Show 10 seconds by default
  const [selectedChannels, setSelectedChannels] = useState<number[]>([]);

  useEffect(() => {
    loadFile();
  }, [filePath]);

  const loadFile = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const supabase = createClient();

      // Detect file type from extension
      const fileExtension = filePath.toLowerCase().split('.').pop();

      // Download the file from Supabase storage
      const { data, error: downloadError } = await supabase.storage
        .from('recordings')
        .download(filePath);

      if (downloadError) throw downloadError;

      if (fileExtension === 'csv') {
        // Parse CSV file
        const parsedData = await readCSVFile(data);
        const filteredData = filterValidChannels(parsedData);

        const unifiedData: UnifiedSignalData = {
          signals: filteredData.signals,
          sampleRate: filteredData.sampleRate,
          duration: filteredData.duration,
          channelNames: filteredData.channelNames,
          fileType: 'csv',
        };

        setSignalData(unifiedData);

        // Select first 4 channels by default
        setSelectedChannels([0, 1, 2, 3].filter((i) => i < filteredData.channelNames.length));
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

        // Select first 4 channels by default
        setSelectedChannels([0, 1, 2, 3].filter((i) => i < parsedData.header.channelCount));
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
        <div className="flex items-center gap-4">
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

        <div className="flex gap-2">
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

  const renderChart = () => {
    if (!signalData || selectedChannels.length === 0) return null;

    // Extract time window (use appropriate function based on file type)
    const extractTimeWindow = signalData.fileType === 'csv' ? extractCSVTimeWindow : extractEDFTimeWindow;
    const downsampleSignals = signalData.fileType === 'csv' ? downsampleCSVSignals : downsampleEDFSignals;

    const windowSignals = extractTimeWindow(
      signalData.signals,
      signalData.sampleRate,
      timeWindow.start,
      timeWindow.duration
    );

    // Downsample for visualization (max 1000 points per channel)
    const downsampled = downsampleSignals(windowSignals, 1000);

    // Prepare chart data with stacked montage display
    const amplitudePerChannel = 100; // μV (±100μV range per channel)
    const selectedData = selectedChannels.map((channelIndex) => downsampled[channelIndex]);
    const labels = Array.from(
      { length: selectedData[0].length },
      (_, i) =>
        (
          timeWindow.start +
          (i / selectedData[0].length) * timeWindow.duration
        ).toFixed(2)
    );

    const colors = [
      '#3B82F6',
      '#10B981',
      '#F59E0B',
      '#EF4444',
      '#8B5CF6',
      '#EC4899',
      '#14B8A6',
      '#F97316',
    ];

    // Stack channels vertically with fixed amplitude range
    const datasets = selectedChannels.map((channelIndex, i) => {
      // Calculate baseline (center) for this channel (inverted so first channel is at top)
      // Each channel gets 200μV of space (±100μV from baseline)
      const channelSpacing = 200; // Space between channel centers
      const baseline = (selectedChannels.length - 1 - i) * channelSpacing;

      // Clamp signal to ±100μV and add baseline offset
      const offsetData = selectedData[i].map((value) => {
        const clampedValue = Math.max(-100, Math.min(100, value));
        return clampedValue + baseline;
      });

      return {
        label: cleanChannelLabel(signalData.channelNames[channelIndex]),
        data: offsetData,
        borderColor: colors[i % colors.length],
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0,
      };
    });

    const chartData = {
      labels,
      datasets,
    };

    // Create Y-axis tick labels at each channel baseline
    const channelSpacing = 200;
    const yTicks = selectedChannels.map((channelIndex, i) => ({
      value: (selectedChannels.length - 1 - i) * channelSpacing,
      label: cleanChannelLabel(signalData.channelNames[channelIndex]),
    }));

    const options: ChartOptions<'line'> = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index' as const,
        intersect: false,
      },
      plugins: {
        legend: {
          display: false, // Hide legend since we show labels on Y-axis
        },
        title: {
          display: true,
          text: `EEG Signals (${timeWindow.start}s - ${(
            timeWindow.start + timeWindow.duration
          ).toFixed(1)}s)`,
        },
        tooltip: {
          enabled: true,
          mode: 'index',
          intersect: false,
          callbacks: {
            label: (context) => {
              const datasetIndex = context.datasetIndex;
              const channelIndex = selectedChannels[datasetIndex];
              const channelLabel = cleanChannelLabel(signalData.channelNames[channelIndex]);
              const baseline = (selectedChannels.length - 1 - datasetIndex) * channelSpacing;
              const actualValue = (context.parsed.y ?? 0) - baseline;
              return `${channelLabel}: ${actualValue.toFixed(2)} μV`;
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
          limits: {
            x: {
              min: 'original',
              max: 'original',
            },
          },
        },
      },
      scales: {
        x: {
          display: true,
          title: {
            display: true,
            text: 'Time (s)',
          },
          ticks: {
            maxTicksLimit: 10,
          },
        },
        y: {
          type: 'linear' as const,
          display: true,
          min: -channelSpacing / 2,
          max: (selectedChannels.length - 0.5) * channelSpacing,
          position: 'left' as const,
          ticks: {
            color: '#000000', // pure black for maximum visibility
            font: {
              size: 10,
              weight: 'bold' as const,
              family: 'system-ui, -apple-system, sans-serif',
            },
            autoSkip: false,
            maxRotation: 0,
            minRotation: 0,
            padding: 5,
            callback: function(value: any, index: number) {
              // Show only channel labels at baseline positions
              const tick = yTicks.find(t => Math.abs(t.value - value) < 0.1);
              return tick ? tick.label : '';
            },
          },
          grid: {
            display: true,
            drawOnChartArea: true,
            color: (context) => {
              // Highlight grid lines at channel baselines
              const value = context.tick.value;
              const isBaseline = yTicks.some(t => Math.abs(t.value - value) < 0.1);
              return isBaseline ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.1)';
            },
            lineWidth: (context) => {
              const value = context.tick.value;
              const isBaseline = yTicks.some(t => Math.abs(t.value - value) < 0.1);
              return isBaseline ? 2 : 1;
            },
          },
          title: {
            display: true,
            text: 'Channels',
            color: '#000000',
            font: {
              size: 14,
              weight: 'bold' as const,
            },
            padding: 10,
          },
        },
      },
    };

    return (
      <div>
        <div className="mb-2 text-sm text-gray-900 font-medium">
          💡 Tip: Use mouse wheel to zoom, click and drag to pan horizontally
        </div>
        <div style={{ height: '750px' }}>
          <Line data={chartData} options={options} />
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
