'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useEEGData } from './useEEGData';
import { computeOriginalOverlay, type PipelineFilterSettings } from './originalOverlay';
import { useEEGFilters } from './useEEGFilters';
import { useEEGAnnotations } from './useEEGAnnotations';
import EEGUnifiedChart from './EEGUnifiedChart';
import EEGToolbar from './EEGToolbar';
import EEGTimeSlider from './EEGTimeSlider';
import EEGAnnotationModal from './EEGAnnotationModal';
import DetectedEventDetails from './DetectedEventDetails';
import { bandsAt, visibleBandAnnotations } from './detectedBands';
import { detectedLaneAt } from './annotationPlugin';
import {
  buildMontage,
  cleanChannelLabel,
  MONTAGE_GROUPS,
  MONTAGE_LABELS,
  montageAvailability,
  montageAvailable,
  referenceElectrodes,
  type Montage,
} from './montage';
import { panStart } from './pan';
import { DEFAULT_FILTER_SETTINGS, type FilterSettings, type RejectedEpoch, type EEGAnnotation } from './types';
import type { DetectedEventResult } from '@/lib/analysis-results';
import { categoryColor, mergeEventBands, traceHighlights } from '@/components/visuals/detected-events/format';
import type { EventReviewState } from '@/components/visuals/detected-events/useEventReviews';

interface EEGViewerProps {
  recordingId: string;
  filePath: string;
  rejectedEpochs?: RejectedEpoch[];
  /** Cleaned recording written by the analysis (results.cleaned_file_url), if any */
  cleanedFileUrl?: string | null;
  /** results.cleaned_file_format, e.g. '.edf' */
  cleanedFileFormat?: string | null;
  /**
   * Filter band and mains frequency the analysis used, so the original-signal overlay is
   * prepared like the pipeline's input (defaults: 1–45 Hz, 60 Hz).
   */
  pipelineFilters?: Partial<PipelineFilterSettings>;
  /** results.events: drawn as read-only bands, merged per pattern where they overlap */
  detectedEvents?: DetectedEventResult[];
  /** shared review state (same instance as the Detected Events card) */
  eventReview?: EventReviewState;
  /** amplitude ceiling the analysis used, for naming amplitude-ceiling events */
  amplitudeThresholdUv?: number;
  /** move the window to an event and open its band; a new nonce re-applies the same event */
  focusEvent?: { eventId: string; t: number; nonce: number } | null;
  /** the recording's own reference (a ReferenceKind), stated by the analyst or read from the labels */
  recordedReference?: string | null;
  /** reference of the cleaned file (results.reference.applied); average when absent */
  appliedReference?: 'average' | 'linked_ears' | 'as_recorded';
}

const READ_ONLY_REVIEW: EventReviewState = {
  reviews: {},
  canEdit: false,
  pending: new Set(),
  error: null,
  setDecision: async () => {},
  clearError: () => {},
};

type SignalSource = 'raw' | 'cleaned';

/** The cleaned file is already filtered by the pipeline; display filters would filter it twice. */
const NO_FILTERS = { highpassHz: 0, lowpassHz: 0, notchHz: 0 };
/** Annotations listed before "Expand to see all annotations". */
const ANNOTATIONS_SHOWN = 5;

export default function EEGViewer({
  recordingId,
  filePath,
  rejectedEpochs,
  cleanedFileUrl,
  cleanedFileFormat,
  pipelineFilters,
  detectedEvents,
  eventReview,
  amplitudeThresholdUv,
  focusEvent,
  recordedReference,
  appliedReference = 'average',
}: EEGViewerProps) {
  const [montageChoice, setMontage] = useState<Montage>('recorded');
  const [showOriginal, setShowOriginal] = useState(true);
  const [source, setSource] = useState<SignalSource>('raw');
  const [cleanedRequested, setCleanedRequested] = useState(false);
  const raw = useEEGData(recordingId, filePath);
  // Fetched on first switch to "Cleaned", then kept for toggling back and forth
  const cleaned = useEEGData(recordingId, filePath, {
    url: cleanedFileUrl,
    format: cleanedFileFormat,
    enabled: Boolean(cleanedFileUrl) && cleanedRequested,
  });
  const active = source === 'cleaned' ? cleaned : raw;
  const { signalData, isLoading, error } = active;
  const [filterSettings, setFilterSettings] = useState<FilterSettings>(DEFAULT_FILTER_SETTINGS);
  const [channelSelection, setSelectedChannels] = useState<number[]>([]);
  // Raw and corrected recordings can have different channel lists (the pipeline drops
  // references and extras), so a selection made on one may not fit the other until the
  // auto-select effect runs: only ever use indices valid for the data on screen.
  const selectedChannels = useMemo(() => {
    const n = signalData?.channelNames.length ?? 0;
    return channelSelection.filter((i) => i >= 0 && i < n);
  }, [channelSelection, signalData]);
  const [timeStart, setTimeStart] = useState(0);
  const [showRejectedEpochs, setShowRejectedEpochs] = useState(true);
  const [showDetectedEvents, setShowDetectedEvents] = useState(true);
  const [selectedBandId, setSelectedBandId] = useState<string | null>(null);

  const eventBands = useMemo(() => mergeEventBands(detectedEvents ?? []), [detectedEvents]);
  const eventsById = useMemo(
    () => new Map((detectedEvents ?? []).map((e) => [e.id, e] as const)),
    [detectedEvents]
  );
  const selectedBand = useMemo(
    () => (selectedBandId ? eventBands.find((b) => b.id === selectedBandId) ?? null : null),
    [eventBands, selectedBandId]
  );

  // Linked from the Detected Events card: show the event near the left of the window, open its band.
  const windowSeconds = filterSettings.windowDurationSeconds;
  useEffect(() => {
    if (!focusEvent) return;
    setShowDetectedEvents(true);
    setTimeStart(Math.max(0, focusEvent.t - Math.min(1, windowSeconds * 0.1)));
    const band = eventBands.find((b) => b.eventIds.includes(focusEvent.eventId));
    setSelectedBandId(band?.id ?? null);
    // Re-run only for a new focus request, not when the window length or bands change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusEvent?.nonce]);

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

  const effectiveFilters = useMemo(
    () => (source === 'cleaned' ? { ...filterSettings, ...NO_FILTERS } : filterSettings),
    [source, filterSettings]
  );

  // The cleaned file is on the reference the analysis applied, with plain labels
  const sourceReference =
    source !== 'cleaned'
      ? recordedReference
      : appliedReference === 'linked_ears'
        ? 'LE'
        : appliedReference === 'as_recorded'
          ? recordedReference
          : 'AVG';
  const channelNames = signalData?.channelNames;
  const montageBlocked = useMemo(
    () => (channelNames ? montageAvailability(channelNames, sourceReference) : null),
    [channelNames, sourceReference]
  );
  const electrodes = useMemo(() => (channelNames ? referenceElectrodes(channelNames) : []), [channelNames]);
  const montage: Montage =
    channelNames && montageAvailable(montageChoice, channelNames, sourceReference) ? montageChoice : 'recorded';
  const rows = useMemo(
    () => (channelNames ? buildMontage(montage, channelNames, selectedChannels, sourceReference) : []),
    [montage, channelNames, selectedChannels, sourceReference]
  );
  const rowLabels = useMemo(() => rows.map((r) => r.label), [rows]);

  const { filteredSignals, timeLabels } = useEEGFilters(signalData, rows, timeStart, effectiveFilters);

  // Scrolling: wheel and drag arrive many times per frame, so they are summed and applied once per frame
  const duration = signalData?.duration ?? 0;
  const pendingPan = useRef(0);
  const panFrame = useRef<number | null>(null);
  const panWindow = useRef({ windowSeconds: filterSettings.windowDurationSeconds, duration });
  panWindow.current = { windowSeconds: filterSettings.windowDurationSeconds, duration };
  const handlePan = useCallback((deltaSeconds: number) => {
    pendingPan.current += deltaSeconds;
    if (panFrame.current !== null) return;
    panFrame.current = requestAnimationFrame(() => {
      panFrame.current = null;
      const delta = pendingPan.current;
      pendingPan.current = 0;
      const { windowSeconds: w, duration: d } = panWindow.current;
      setTimeStart((t) => panStart(t, delta, w, d));
    });
  }, []);
  useEffect(
    () => () => {
      if (panFrame.current !== null) cancelAnimationFrame(panFrame.current);
    },
    []
  );

  const pipelineBand = useMemo(
    () => ({
      highpassHz: pipelineFilters?.highpassHz ?? 1,
      lowpassHz: pipelineFilters?.lowpassHz ?? 45,
      notchHz: pipelineFilters?.notchHz ?? 60,
    }),
    [pipelineFilters?.highpassHz, pipelineFilters?.lowpassHz, pipelineFilters?.notchHz]
  );

  // Corrected mode: the original recording's matching window, prepared like the pipeline input,
  // drawn behind the corrected traces.
  const overlaySignals = useMemo(() => {
    if (source !== 'cleaned' || !showOriginal || !raw.signalData || !cleaned.signalData) return undefined;
    return computeOriginalOverlay({
      raw: raw.signalData,
      cleanedNames: cleaned.signalData.channelNames,
      selected: selectedChannels,
      rows: rows.map((r) => r.terms),
      subtractAverage: appliedReference === 'average',
      timeStart,
      windowSeconds: filterSettings.windowDurationSeconds,
      filters: pipelineBand,
      targetTimes: timeLabels,
    });
  }, [
    source,
    showOriginal,
    raw.signalData,
    cleaned.signalData,
    selectedChannels,
    rows,
    appliedReference,
    timeStart,
    filterSettings.windowDurationSeconds,
    pipelineBand,
    timeLabels,
  ]);

  // In Correct noise mode the filter boxes show the band the pipeline applied (read-only), and
  // only non-filter settings (sensitivity, window) pass through to the display settings.
  const toolbarSettings = useMemo(
    () => (source === 'cleaned' ? { ...filterSettings, ...pipelineBand } : filterSettings),
    [source, filterSettings, pipelineBand]
  );
  const handleCleanedSettingsChange = useCallback((next: FilterSettings) => {
    setFilterSettings((prev) => ({
      ...prev,
      sensitivityMicrovolts: next.sensitivityMicrovolts,
      windowDurationSeconds: next.windowDurationSeconds,
    }));
  }, []);

  const handleSourceChange = useCallback((next: SignalSource) => {
    if (next === 'cleaned') setCleanedRequested(true);
    setSource(next);
  }, []);

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
  const [showAllAnnotations, setShowAllAnnotations] = useState(false);
  const allAnnotations = useMemo<EEGAnnotation[]>(
    () => [...annotations, ...rejectedAnnotations],
    [annotations, rejectedAnnotations]
  );

  // Detected-event bands are drawn on the chart but kept out of the annotations list below
  // (there can be hundreds); only the ones in the visible window are handed to the plugin.
  const bandAnnotations = useMemo<EEGAnnotation[]>(
    () =>
      showDetectedEvents && eventBands.length > 0
        ? visibleBandAnnotations(eventBands, timeStart, timeStart + windowSeconds, {
            amplitudeThresholdUv,
            selectedId: selectedBandId,
          })
        : [],
    [showDetectedEvents, eventBands, timeStart, windowSeconds, amplitudeThresholdUv, selectedBandId]
  );
  const chartAnnotations = useMemo<EEGAnnotation[]>(
    () => (bandAnnotations.length > 0 ? [...allAnnotations, ...bandAnnotations] : allAnnotations),
    [allAnnotations, bandAnnotations]
  );

  // Mu (and other waveform) events also colour the stretch of their own channel's trace.
  const chartTraceHighlights = useMemo(() => {
    if (!showDetectedEvents || !detectedEvents?.length || !signalData) return undefined;
    // the first row of an electrode: in a bipolar montage, the pair it leads
    const rowOf = new Map<string, number>();
    rows.forEach((r, row) => {
      if (r.channel && !rowOf.has(r.channel)) rowOf.set(r.channel, row);
    });
    const out = traceHighlights(
      detectedEvents,
      eventReview?.reviews ?? {},
      timeStart,
      timeStart + windowSeconds
    ).flatMap((h) => {
      const row = rowOf.get(h.channel);
      return row === undefined ? [] : [{ row, startSec: h.startSec, endSec: h.endSec, color: categoryColor(h.category, 0.9) }];
    });
    return out.length ? out : undefined;
  }, [showDetectedEvents, detectedEvents, eventReview?.reviews, signalData, rows, timeStart, windowSeconds]);

  // A click on the event track picks the band in that lane; elsewhere, the shortest band there.
  const handleChartClick = useCallback(
    (time: number, pxAboveBottom: number) => {
      if (bandAnnotations.length === 0) return;
      const nLanes = 1 + Math.max(...bandAnnotations.map((a) => a.lane ?? 0));
      const lane = detectedLaneAt(pxAboveBottom, nLanes);
      const inLane =
        lane === null
          ? undefined
          : bandAnnotations.find((a) => a.lane === lane && time >= a.startTime && time <= a.endTime);
      const hit = inLane ? inLane.id : bandsAt(eventBands, time)[0]?.id;
      setSelectedBandId(hit ?? null);
    },
    [bandAnnotations, eventBands]
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
          {source === 'cleaned' && (
            <button
              onClick={() => setSource('raw')}
              className="mt-3 text-sm font-medium text-neuro-primary hover:underline"
            >
              Back to raw signals
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!signalData) return null;

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="text-2xl font-bold text-neuro-dark">
          {source === 'cleaned' ? 'Noise-Corrected EEG Signals' : 'Raw EEG Signals'}
        </h2>
        {cleanedFileUrl && (
          <SourceToggle source={source} onChange={handleSourceChange} />
        )}
      </div>
      {source === 'cleaned' && (
        <div className="mb-3 space-y-2">
          <p className="text-xs text-gray-600">
            Output of the analysis pipeline: filtered, re-referenced and artifact-corrected (ASR/ICA)
            on the server. Display filters are off; shaded regions are epochs the analysis rejected.
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer text-gray-700">
              <input
                type="checkbox"
                checked={showOriginal}
                onChange={(e) => setShowOriginal(e.target.checked)}
                className="rounded"
              />
              Show original (noisy) signal
            </label>
            {showOriginal && (
              <span className="flex items-center gap-3 text-gray-600" aria-hidden="true">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-5 h-0.5 bg-gray-900" /> Corrected
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-5 h-0.5" style={{ background: 'rgba(220, 38, 38, 0.6)' }} />
                  Original (same filters &amp; reference)
                </span>
              </span>
            )}
            {showOriginal && raw.isLoading && <span className="text-gray-500">Loading original…</span>}
          </div>
        </div>
      )}

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

      {/* Montage */}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <label htmlFor="eeg-montage" className="text-sm font-semibold text-gray-900">
          Montage:
        </label>
        <select
          id="eeg-montage"
          value={montage}
          onChange={(e) => setMontage(e.target.value as Montage)}
          aria-describedby="eeg-montage-help"
          className="border border-gray-300 rounded px-2 py-1 text-sm bg-white text-gray-900"
        >
          {MONTAGE_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.montages.map((m) => (
                <option key={m} value={m} disabled={Boolean(montageBlocked?.[m])} title={montageBlocked?.[m] ?? undefined}>
                  {m === 'recorded' && source === 'cleaned' ? 'As analysed' : MONTAGE_LABELS[m]}
                  {montageBlocked?.[m] ? ' (not available)' : ''}
                </option>
              ))}
            </optgroup>
          ))}
          {electrodes.length >= 2 && (
            <optgroup label="One electrode">
              {electrodes.map((label) => (
                <option key={label} value={`ch:${label}`}>
                  {label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <span id="eeg-montage-help" className="text-xs text-gray-600">
          {montage === 'recorded'
            ? montageBlocked?.linked_ears
              ? `Display only. Linked ears: ${montageBlocked.linked_ears}`
              : 'Display only: the analysis is not changed.'
            : 'Display only: the analysis is not changed.'}
        </span>
      </div>

      {/* Toolbar */}
      <div className="mb-3">
        <EEGToolbar
          filterSettings={toolbarSettings}
          onFilterChange={source === 'cleaned' ? handleCleanedSettingsChange : handleFilterChange}
          filtersDisabled={source === 'cleaned'}
          isAnnotateMode={isAnnotateMode}
          onAnnotateModeToggle={handleAnnotateModeToggle}
        />
      </div>

      {/* Rejected epochs / detected events toggles */}
      {((rejectedEpochs && rejectedEpochs.length > 0) || eventBands.length > 0) && (
        <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1">
          {rejectedEpochs && rejectedEpochs.length > 0 && (
            <div className="flex items-center gap-2">
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
          {eventBands.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={showDetectedEvents}
                  onChange={(e) => {
                    setShowDetectedEvents(e.target.checked);
                    if (!e.target.checked) setSelectedBandId(null);
                  }}
                  className="rounded"
                />
                <span className="text-gray-700">Show detected events</span>
              </label>
              <span className="text-xs text-violet-700">
                (labels only; click a band for details)
              </span>
            </div>
          )}
        </div>
      )}

      {/* Chart */}
      {rows.length > 0 ? (
        <>
          <EEGUnifiedChart
            filteredSignals={filteredSignals}
            overlaySignals={overlaySignals}
            timeLabels={timeLabels}
            rowLabels={rowLabels}
            timeRange={[timeStart, timeStart + filterSettings.windowDurationSeconds]}
            sensitivityMicrovolts={filterSettings.sensitivityMicrovolts}
            onPan={handlePan}
            annotations={chartAnnotations}
            dragState={dragState}
            isAnnotateMode={isAnnotateMode}
            onDragStart={startDrag}
            onDragUpdate={updateDrag}
            onDragEnd={endDrag}
            onDragCancel={cancelDrag}
            onChartClick={handleChartClick}
            traceHighlights={chartTraceHighlights}
          />

          {/* Time slider */}
          <EEGTimeSlider
            currentStart={timeStart}
            windowDuration={filterSettings.windowDurationSeconds}
            totalDuration={signalData.duration}
            onTimeChange={setTimeStart}
          />
          <p className="mt-1 text-xs text-gray-500">
            Scroll sideways, hold Shift and scroll, or drag the traces to move through time. With the traces focused:
            arrow keys, Page Up/Down, Home, End.
          </p>
        </>
      ) : (
        <div className="bg-gray-100 rounded-lg p-8 text-center">
          <p className="text-gray-800">
            {selectedChannels.length > 0
              ? 'Select neighbouring channels to display this montage'
              : 'Select at least one channel to display'}
          </p>
        </div>
      )}

      {selectedBand && showDetectedEvents && (
        <DetectedEventDetails
          band={selectedBand}
          events={selectedBand.eventIds
            .map((id) => eventsById.get(id))
            .filter((e): e is DetectedEventResult => Boolean(e))}
          review={eventReview ?? READ_ONLY_REVIEW}
          amplitudeThresholdUv={amplitudeThresholdUv}
          onClose={() => setSelectedBandId(null)}
        />
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
            {(showAllAnnotations ? allAnnotations : allAnnotations.slice(0, ANNOTATIONS_SHOWN)).map((a) => (
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
          {allAnnotations.length > ANNOTATIONS_SHOWN && (
            <button
              onClick={() => setShowAllAnnotations((v) => !v)}
              aria-expanded={showAllAnnotations}
              className="mt-2 text-xs font-medium text-neuro-primary hover:text-neuro-accent"
            >
              {showAllAnnotations
                ? 'Show fewer annotations'
                : `Expand to see all annotations (${allAnnotations.length - ANNOTATIONS_SHOWN} more)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SourceToggle({
  source,
  onChange,
}: {
  source: SignalSource;
  onChange: (source: SignalSource) => void;
}) {
  const options: { value: SignalSource; label: string }[] = [
    { value: 'raw', label: 'Original' },
    { value: 'cleaned', label: 'Correct noise' },
  ];
  return (
    <div role="radiogroup" aria-label="Signal source" className="inline-flex rounded-md border border-gray-300 overflow-hidden">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={source === o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1 text-xs font-medium transition-colors ${
            source === o.value ? 'bg-neuro-primary text-white' : 'bg-white text-gray-700 hover:bg-gray-100'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
