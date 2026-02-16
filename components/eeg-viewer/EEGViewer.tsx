'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useEEGData } from './useEEGData';
import { useEEGFilters } from './useEEGFilters';
import { useEEGAnnotations } from './useEEGAnnotations';
import EEGUnifiedChart from './EEGUnifiedChart';
import EEGToolbar from './EEGToolbar';
import EEGTimeSlider from './EEGTimeSlider';
import EEGAnnotationModal from './EEGAnnotationModal';
import { DEFAULT_FILTER_SETTINGS, type FilterSettings, type RejectedEpoch, type EEGAnnotation } from './types';

interface EEGViewerProps {
  recordingId: string;
  filePath: string;
  rejectedEpochs?: RejectedEpoch[];
}

export default function EEGViewer({ recordingId, filePath, rejectedEpochs }: EEGViewerProps) {
  const { signalData, isLoading, error } = useEEGData(recordingId, filePath);
  const [filterSettings, setFilterSettings] = useState<FilterSettings>(DEFAULT_FILTER_SETTINGS);
  const [selectedChannels, setSelectedChannels] = useState<number[]>([]);
  const [timeStart, setTimeStart] = useState(0);
  const [showRejectedEpochs, setShowRejectedEpochs] = useState(true);

  // Auto-select all channels on load
  useEffect(() => {
    if (signalData) {
      setSelectedChannels(
        Array.from({ length: signalData.channelNames.length }, (_, i) => i)
      );
    }
  }, [signalData]);

  // Clamp timeStart when window duration or recording changes
  useEffect(() => {
    if (signalData) {
      const maxStart = Math.max(
        0,
        signalData.duration - filterSettings.windowDurationSeconds
      );
      if (timeStart > maxStart) {
        setTimeStart(maxStart);
      }
    }
  }, [signalData, filterSettings.windowDurationSeconds, timeStart]);

  const { filteredSignals, timeLabels } = useEEGFilters(
    signalData,
    selectedChannels,
    timeStart,
    filterSettings
  );

  const {
    annotations,
    dragState,
    isAnnotateMode,
    setIsAnnotateMode,
    showModal,
    pendingAnnotation,
    startDrag,
    updateDrag,
    endDrag,
    cancelDrag,
    addAnnotation,
    removeAnnotation,
    cancelAnnotation,
  } = useEEGAnnotations(recordingId);

  // Convert rejected epochs to annotation objects
  const rejectedAnnotations = useMemo<EEGAnnotation[]>(() => {
    if (!rejectedEpochs || !showRejectedEpochs) return [];
    return rejectedEpochs.map((ep, i) => ({
      id: `rejected-${i}`,
      startTime: ep.start,
      endTime: ep.end,
      description: `${ep.reason} (${ep.condition})`,
      type: 'rejected' as const,
      readOnly: true,
    }));
  }, [rejectedEpochs, showRejectedEpochs]);

  // Merge manual annotations with rejected epoch annotations
  const allAnnotations = useMemo<EEGAnnotation[]>(
    () => [...annotations, ...rejectedAnnotations],
    [annotations, rejectedAnnotations]
  );

  const handleFilterChange = useCallback((settings: FilterSettings) => {
    setFilterSettings(settings);
  }, []);

  const handleAnnotateModeToggle = useCallback(() => {
    setIsAnnotateMode((prev) => !prev);
  }, [setIsAnnotateMode]);

  const handleChannelToggle = useCallback((channelIndex: number) => {
    setSelectedChannels((prev) => {
      if (prev.includes(channelIndex)) {
        return prev.filter((i) => i !== channelIndex);
      }
      return [...prev, channelIndex].sort((a, b) => a - b);
    });
  }, []);

  const cleanChannelLabel = (label: string): string => {
    return label
      .replace(/^EEG\s+/i, '')
      .replace(/-LE$/i, '')
      .replace(/-REF$/i, '')
      .replace(/-M1$/i, '')
      .replace(/-M2$/i, '')
      .trim();
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

  if (!signalData) return null;

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-2xl font-bold text-neuro-dark mb-4">
        Raw EEG Signals
      </h2>

      {/* Channel selector */}
      <div className="mb-3">
        <h3 className="text-sm font-semibold mb-2 text-gray-900">
          Select Channels to Display:
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {signalData.channelNames.map((channelName, index) => (
            <button
              key={index}
              onClick={() => handleChannelToggle(index)}
              className={`px-2.5 py-0.5 rounded text-xs font-medium transition-colors ${
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

      {/* Toolbar */}
      <div className="mb-3">
        <EEGToolbar
          filterSettings={filterSettings}
          onFilterChange={handleFilterChange}
          isAnnotateMode={isAnnotateMode}
          onAnnotateModeToggle={handleAnnotateModeToggle}
        />
      </div>

      {/* Rejected epochs toggle */}
      {rejectedEpochs && rejectedEpochs.length > 0 && (
        <div className="mb-2 flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={showRejectedEpochs}
              onChange={(e) => setShowRejectedEpochs(e.target.checked)}
              className="rounded"
            />
            <span className="text-gray-700">
              Show rejected epochs
            </span>
          </label>
          <span className="text-xs text-red-500">
            ({rejectedEpochs.length} epoch{rejectedEpochs.length !== 1 ? 's' : ''} rejected)
          </span>
        </div>
      )}

      {/* Chart */}
      {selectedChannels.length > 0 ? (
        <>
          <EEGUnifiedChart
            filteredSignals={filteredSignals}
            timeLabels={timeLabels}
            channelNames={signalData.channelNames}
            selectedChannels={selectedChannels}
            sensitivityMicrovolts={filterSettings.sensitivityMicrovolts}
            annotations={allAnnotations}
            dragState={dragState}
            isAnnotateMode={isAnnotateMode}
            onDragStart={startDrag}
            onDragUpdate={updateDrag}
            onDragEnd={endDrag}
            onDragCancel={cancelDrag}
          />

          {/* Time slider */}
          <EEGTimeSlider
            currentStart={timeStart}
            windowDuration={filterSettings.windowDurationSeconds}
            totalDuration={signalData.duration}
            onTimeChange={setTimeStart}
          />
        </>
      ) : (
        <div className="bg-gray-100 rounded-lg p-8 text-center">
          <p className="text-gray-800">Select at least one channel to display</p>
        </div>
      )}

      {/* Annotation modal */}
      {showModal && pendingAnnotation && (
        <EEGAnnotationModal
          startTime={pendingAnnotation.startTime}
          endTime={pendingAnnotation.endTime}
          onAdd={addAnnotation}
          onCancel={cancelAnnotation}
        />
      )}

      {/* Annotations list */}
      {allAnnotations.length > 0 && (
        <div className="mt-3 border border-gray-200 rounded-lg p-3">
          <h4 className="text-sm font-semibold text-gray-900 mb-2">
            Annotations ({allAnnotations.length})
          </h4>
          <div className="space-y-1">
            {allAnnotations.map((a) => (
              <div
                key={a.id}
                className={`flex items-center justify-between text-xs rounded px-2 py-1 ${
                  a.type === 'rejected'
                    ? 'bg-red-50 border border-red-200'
                    : 'bg-yellow-50 border border-yellow-200'
                }`}
              >
                <span className="text-gray-900">
                  <span className="font-medium capitalize">{a.type}</span>
                  {' '}{a.startTime.toFixed(2)}s - {a.endTime.toFixed(2)}s
                  {a.description && `: ${a.description}`}
                </span>
                {!a.readOnly && (
                  <button
                    onClick={() => removeAnnotation(a.id)}
                    className="ml-2 text-red-500 hover:text-red-700 text-xs font-medium"
                    title="Remove annotation"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
