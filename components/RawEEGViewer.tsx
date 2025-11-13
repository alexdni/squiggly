'use client';

import { useState, useEffect } from 'react';
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
import {
  parseEDFFile,
  extractTimeWindow,
  downsampleSignals,
  type EDFData,
} from '@/lib/edf-reader-browser';
import { createClient } from '@/lib/supabase-client';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

interface RawEEGViewerProps {
  recordingId: string;
  filePath: string;
}

export default function RawEEGViewer({
  recordingId,
  filePath,
}: RawEEGViewerProps) {
  const [edfData, setEdfData] = useState<EDFData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeWindow, setTimeWindow] = useState({ start: 0, duration: 10 }); // Show 10 seconds by default
  const [selectedChannels, setSelectedChannels] = useState<number[]>([]);

  useEffect(() => {
    loadEDFFile();
  }, [filePath]);

  const loadEDFFile = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const supabase = createClient();

      // Download the EDF file from Supabase storage
      const { data, error: downloadError } = await supabase.storage
        .from('recordings')
        .download(filePath);

      if (downloadError) throw downloadError;

      // Convert Blob to ArrayBuffer
      const arrayBuffer = await data.arrayBuffer();

      // Parse EDF file
      const parsedData = await parseEDFFile(arrayBuffer);
      setEdfData(parsedData);

      // Select first 4 channels by default
      setSelectedChannels([0, 1, 2, 3].filter((i) => i < parsedData.header.channelCount));
    } catch (err: any) {
      console.error('Error loading EDF file:', err);
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
    if (!edfData) return null;

    return (
      <div className="mb-4">
        <h3 className="text-sm font-semibold mb-2">Select Channels to Display:</h3>
        <div className="flex flex-wrap gap-2">
          {edfData.header.channels.map((channel, index) => (
            <button
              key={index}
              onClick={() => handleChannelToggle(index)}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                selectedChannels.includes(index)
                  ? 'bg-neuro-primary text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              {channel.label}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderTimeControls = () => {
    if (!edfData) return null;

    const maxTime = edfData.duration;

    return (
      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-4">
          <label className="text-sm font-semibold">Time Window:</label>
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
            className="border border-gray-300 rounded px-2 py-1 w-20"
          />
          <span className="text-sm">Start (s)</span>

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
            className="border border-gray-300 rounded px-2 py-1 w-20"
          />
          <span className="text-sm">Duration (s)</span>
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

  const renderChart = () => {
    if (!edfData || selectedChannels.length === 0) return null;

    // Extract time window
    const windowSignals = extractTimeWindow(
      edfData.signals,
      edfData.sampleRate,
      timeWindow.start,
      timeWindow.duration
    );

    // Downsample for visualization (max 1000 points per channel)
    const downsampled = downsampleSignals(windowSignals, 1000);

    // Prepare chart data
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

    const datasets = selectedChannels.map((channelIndex, i) => ({
      label: edfData.header.channels[channelIndex].label,
      data: selectedData[i],
      borderColor: colors[i % colors.length],
      backgroundColor: 'transparent',
      borderWidth: 1,
      pointRadius: 0,
      tension: 0,
    }));

    const chartData = {
      labels,
      datasets,
    };

    const options: ChartOptions<'line'> = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index' as const,
        intersect: false,
      },
      plugins: {
        legend: {
          position: 'top' as const,
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
          display: true,
          title: {
            display: true,
            text: 'Amplitude (μV)',
          },
        },
      },
    };

    return (
      <div style={{ height: '500px' }}>
        <Line data={chartData} options={options} />
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-neuro-primary"></div>
          <p className="ml-4 text-gray-600">Loading EEG data...</p>
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
          <p className="text-gray-600">Select at least one channel to display</p>
        </div>
      )}
    </div>
  );
}
