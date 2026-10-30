'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ARTIFACT_PROFILES } from '@/lib/constants';
import type { AnalysisResults, DetectedEventResult } from '@/lib/analysis-results';
import {
  LEGACY_ICA_METHOD_LABELS,
  MAX_POLL_MS,
  PHYSIOLOGICAL_PATH_LABELS,
  POLL_INTERVAL_MS,
  PROFILE_ASR_K,
  PROFILE_DESCRIPTIONS,
  SETTING_LIMITS,
  buildPreprocessingConfig,
  clampSetting,
  engineLabel,
  isProcessingStale,
  settingsFromConfig,
  type ArtifactSettings,
} from './analysis-settings';
import LegacyOrLive, { hasAnyLegacyVisual } from './visuals/LegacyOrLive';
import TopomapGrid from './visuals/TopomapGrid';
import LzcTopomaps from './visuals/LzcTopomaps';
import AlphaPeakTopomaps from './visuals/AlphaPeakTopomaps';
import ConnectivityHead from './visuals/ConnectivityHead';
import SpectrogramGrid from './visuals/Spectrogram';
import RejectionTimeline from './visuals/RejectionTimeline';
import PsdSection from './visuals/PsdSection';
import ConditionLabelEditor from './ConditionLabelEditor';
import { labelSummary, labelsOf, resultsMatchLabels } from '@/lib/eeg-condition';
import DetectedEvents, { amplitudeThresholdOf } from './visuals/DetectedEvents';
import { useEventReviews } from './visuals/detected-events/useEventReviews';
import { exportPdfReport, exportVisualizationsZip, type ReportMeta } from './export/analysisExport';
import SquigglyLogo from '@/components/SquigglyLogo';
import ConnectAiModal from './ConnectAiModal';

// chart.js renders client-side only
const NetworkMetricsBars = dynamic(() => import('./visuals/NetworkMetricsBars'), { ssr: false });
const HrvSection = dynamic(() => import('./visuals/HrvSection'), { ssr: false });
const SloretaSection = dynamic(() => import('./sloreta/SloretaSection'), { ssr: false });

// Dynamically import EEG Viewer to avoid SSR issues with Chart.js
const RawEEGViewer = dynamic(() => import('./eeg-viewer/EEGViewer'), {
  ssr: false,
  loading: () => (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-center justify-center py-12">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-neuro-primary"></div>
        <p className="ml-4 text-gray-800">Loading EEG viewer...</p>
      </div>
    </div>
  ),
});

interface Recording {
  id: string;
  filename: string;
  file_path: string;
  file_size: number;
  duration_seconds: number;
  sampling_rate: number;
  n_channels: number;
  montage: string;
  reference: string;
  eo_start: number | null;
  eo_end: number | null;
  ec_start: number | null;
  ec_end: number | null;
  project_id: string;
  created_at: string;
}

interface Analysis {
  id: string;
  recording_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  config: any;
  results: any;
  error_log: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at?: string | null;
  recording: Recording;
}

interface AnalysisDetailsClientProps {
  analysis: Analysis;
  user: { id: string; email: string };
  /** owner or collaborator of the project (may review detected events); viewers get false */
  canEdit?: boolean;
}

const PROCESSING_STEPS = [
  { label: 'Loading recording', threshold: 0 },
  { label: 'Channel checks & filtering', threshold: 3 },
  { label: 'Artifact removal (ASR / ICA)', threshold: 6 },
  { label: 'Band power, connectivity & complexity', threshold: 15 },
  { label: 'Saving results & cleaned file', threshold: 25 },
];

export default function AnalysisDetailsClient({
  analysis: initialAnalysis,
  user,
  canEdit = false,
}: AnalysisDetailsClientProps) {
  const router = useRouter();
  const [analysis, setAnalysis] = useState(initialAnalysis);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pollingElapsed, setPollingElapsed] = useState(0);
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const [showConnectAi, setShowConnectAi] = useState(false);
  const [reanalyzeError, setReanalyzeError] = useState<string | null>(null);
  const [settings, setSettings] = useState<ArtifactSettings>(() =>
    settingsFromConfig(initialAnalysis.config?.preprocessing)
  );
  const [startError, setStartError] = useState<string | null>(null);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const resultsRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState<{ kind: 'pdf' | 'zip'; done: number; total: number } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const eventReview = useEventReviews(initialAnalysis.id, analysis.config?.event_reviews, canEdit);
  const viewerRef = useRef<HTMLDivElement>(null);
  const [focusEvent, setFocusEvent] = useState<{ eventId: string; t: number; nonce: number } | null>(null);
  const handleSelectEvent = useCallback((event: DetectedEventResult) => {
    setFocusEvent((prev) => ({ eventId: event.id, t: event.startSec, nonce: (prev?.nonce ?? 0) + 1 }));
    viewerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const updateSetting = <K extends keyof ArtifactSettings>(key: K, value: ArtifactSettings[K]) =>
    setSettings((prev) => ({ ...prev, [key]: value }));

  // Poll while processing. The job runs server-side after /process returns 202; stop after
  // MAX_POLL_MS and treat the job as stalled.
  useEffect(() => {
    if (analysis.status !== 'processing') return;
    setPollTimedOut(false);
    const startTime = Date.now();

    const interval = setInterval(async () => {
      const elapsedMs = Date.now() - startTime;
      setPollingElapsed(Math.floor(elapsedMs / 1000));
      setNow(Date.now());

      if (elapsedMs >= MAX_POLL_MS) {
        console.warn(`Analysis polling stopped after ${MAX_POLL_MS / 1000} seconds`);
        clearInterval(interval);
        setPollTimedOut(true);
        return;
      }

      try {
        const response = await fetch(`/api/analyses/${analysis.id}`);
        if (response.ok) {
          const data = await response.json();
          if (data) {
            setAnalysis((prev) => ({ ...prev, ...data, recording: data.recording ?? prev.recording }));
            if (data.status !== 'processing') {
              clearInterval(interval);
              setPollingElapsed(0);
            }
          }
        }
      } catch (err) {
        console.error('Error polling analysis:', err);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      setPollingElapsed(0);
    };
  }, [analysis.status, analysis.id]);

  const isStalled =
    analysis.status === 'processing' && (pollTimedOut || isProcessingStale(analysis, now));

  const handleSignOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
    router.refresh();
  };

  // Saves the artifact settings and starts the job. /process answers 202 right away; the job
  // writes completed/failed itself and the polling effect picks it up.
  const handleStartAnalysis = async () => {
    setIsProcessing(true);
    setStartError(null);
    try {
      const updatedConfig = {
        ...analysis.config,
        preprocessing: buildPreprocessingConfig(analysis.config?.preprocessing, settings),
      };

      // A retry also clears a failed or stalled run
      const isRetry = analysis.status !== 'pending';
      const patchResponse = await fetch(`/api/analyses/${analysis.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isRetry
            ? { config: updatedConfig, status: 'pending', error_log: null, started_at: null, completed_at: null }
            : { config: updatedConfig }
        ),
      });

      if (!patchResponse.ok) {
        const body = await patchResponse.json().catch(() => null);
        throw new Error(body?.error || 'Failed to update analysis config');
      }

      const response = await fetch(`/api/analyses/${analysis.id}/process`, {
        method: 'POST',
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'Failed to start analysis');
      }

      setPollTimedOut(false);
      setNow(Date.now());
      setAnalysis({
        ...analysis,
        status: 'processing',
        config: updatedConfig,
        error_log: null,
        started_at: new Date().toISOString(),
        completed_at: null,
      });
    } catch (error: any) {
      console.error('Error starting analysis:', error);
      setStartError(error.message || 'Failed to start analysis. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'text-green-600 bg-green-100';
      case 'processing':
        return 'text-blue-600 bg-blue-100';
      case 'failed':
        return 'text-red-600 bg-red-100';
      default:
        return 'text-yellow-600 bg-yellow-100';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed':
        return 'Analysis Complete';
      case 'processing':
        return 'Processing...';
      case 'failed':
        return 'Analysis Failed';
      default:
        return 'Pending Analysis';
    }
  };

  const handleExport = async (kind: 'pdf' | 'zip') => {
    const root = resultsRef.current;
    if (!root) return;
    const rec = analysis.recording;
    const segment = (start: number | null, end: number | null) =>
      start !== null && end !== null ? `${formatDuration(start)} - ${formatDuration(end)}` : 'Not labeled';
    const meta: ReportMeta = {
      filename: rec.filename,
      completedAt: analysis.completed_at,
      details: [
        ['Duration', formatDuration(rec.duration_seconds)],
        ['Channels', String(rec.n_channels)],
        ['Sampling Rate', `${rec.sampling_rate} Hz`],
        ['Montage', rec.montage],
        ['Reference', rec.reference],
        ['EO Segment', segment(rec.eo_start, rec.eo_end)],
        ['EC Segment', segment(rec.ec_start, rec.ec_end)],
        ['File Size', formatFileSize(rec.file_size)],
      ],
    };
    setExportError(null);
    setExporting({ kind, done: 0, total: 0 });
    try {
      const onProgress = (done: number, total: number) => setExporting({ kind, done, total });
      await (kind === 'pdf' ? exportPdfReport(root, meta, onProgress) : exportVisualizationsZip(root, meta, onProgress));
    } catch (error: any) {
      console.error(`Error exporting ${kind}:`, error);
      setExportError(error?.message || 'Export failed. Please try again.');
    } finally {
      setExporting(null);
    }
  };

  // New EO/EC labels: store them (the editor does) and re-run with the current settings, so every
  // graph is filed under the right condition. A pending analysis just picks them up when started.
  const [editingLabels, setEditingLabels] = useState(false);
  const [relabelError, setRelabelError] = useState<string | null>(null);
  const rerunForLabels = async (recordingUpdate?: Record<string, unknown>) => {
    setRelabelError(null);
    if (recordingUpdate) setAnalysis((prev) => ({ ...prev, recording: { ...prev.recording, ...recordingUpdate } }));
    if (analysis.status !== 'completed' && analysis.status !== 'failed') return;
    const res = await fetch(`/api/analyses/${analysis.id}/process`, { method: 'POST' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setRelabelError(body.error || 'The labels are saved, but the re-analysis did not start. Use Re-Analyze.');
      return;
    }
    setPollTimedOut(false);
    setNow(Date.now());
    setAnalysis((prev) => ({ ...prev, status: 'processing', error_log: null, started_at: new Date().toISOString(), completed_at: null }));
  };

  const handleReanalyze = async () => {
    setIsReanalyzing(true);
    setReanalyzeError(null);
    try {
      // Reset the analysis status to pending via API
      const response = await fetch(`/api/analyses/${analysis.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'pending',
          results: null,
          error_log: null,
          started_at: null,
          completed_at: null,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to reset analysis status');
      }

      // Don't auto-start processing — let the user pick ICA vs Manual first
      setAnalysis({
        ...analysis,
        status: 'pending',
        results: null,
        error_log: null,
        started_at: null,
        completed_at: null,
      });
    } catch (error: any) {
      console.error('Error re-analyzing:', error);
      setReanalyzeError(error.message || 'Failed to reset analysis. Please try again.');
    } finally {
      setIsReanalyzing(false);
    }
  };

  const results = analysis.results as Partial<AnalysisResults> | null;
  const labelsStale = analysis.status === 'completed' && Boolean(results) && !resultsMatchLabels(results as never, analysis.recording);
  const labelText = (start: number | null, end: number | null) =>
    start !== null && end !== null ? `${formatDuration(Number(start))} - ${formatDuration(Number(end))}` : 'Not labeled';

  return (
    <main className="min-h-screen bg-neuro-light">
      {/* Navigation */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push('/dashboard')}
                className="flex items-center hover:opacity-80 transition-opacity"
                aria-label="Squiggly dashboard"
              >
                <SquigglyLogo />
              </button>
              <span className="text-gray-400">/</span>
              <button
                onClick={() => router.push('/projects')}
                className="text-gray-800 hover:text-neuro-primary transition-colors"
              >
                Projects
              </button>
              <span className="text-gray-400">/</span>
              <button
                onClick={() =>
                  router.push(`/projects/${analysis.recording.project_id}`)
                }
                className="text-gray-800 hover:text-neuro-primary transition-colors"
              >
                Project
              </button>
              <span className="text-gray-400">/</span>
              <span className="text-gray-900">Analysis</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-sm text-gray-800">{user.email}</div>
              <button
                onClick={handleSignOut}
                className="bg-neuro-primary text-white px-4 py-2 rounded-lg hover:bg-neuro-accent transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header with Status */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-neuro-dark mb-2">
                EEG Analysis
              </h1>
              <p className="text-gray-800">{analysis.recording.filename}</p>
            </div>
            <div className="flex items-center gap-3">
              {analysis.status === 'completed' && process.env.NEXT_PUBLIC_AUTH_MODE !== 'local' && (
                <button
                  onClick={() => setShowConnectAi(true)}
                  className="border border-neuro-primary text-neuro-primary px-4 py-2 rounded-lg hover:bg-neuro-light transition-colors font-medium flex items-center gap-2"
                  title="Connect Claude or ChatGPT to walk through this analysis"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                  Ask Claude / ChatGPT
                </button>
              )}
              {analysis.status === 'completed' && (
                <button
                  onClick={handleReanalyze}
                  disabled={isReanalyzing}
                  className="bg-neuro-primary text-white px-4 py-2 rounded-lg hover:bg-neuro-accent transition-colors font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Re-run analysis with the latest features"
                >
                  {isReanalyzing ? (
                    <>
                      <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Starting...
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Re-Analyze
                    </>
                  )}
                </button>
              )}
              <div
                className={`px-4 py-2 rounded-lg font-medium ${getStatusColor(
                  analysis.status
                )}`}
              >
                {getStatusText(analysis.status)}
              </div>
            </div>
          </div>
          <ConnectAiModal
            isOpen={showConnectAi}
            onClose={() => setShowConnectAi(false)}
            analysisUrl={typeof window !== 'undefined' ? `${window.location.origin}/analyses/${analysis.id}` : ''}
          />
          {reanalyzeError && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-red-800 text-sm">{reanalyzeError}</p>
            </div>
          )}
        </div>

        {/* Analysis status and start settings, next to the header */}
        {analysis.status === 'pending' && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 mb-6">
            <div className="flex items-center mb-4">
              <svg
                className="h-6 w-6 text-yellow-600 mr-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div>
                <h3 className="text-lg font-semibold text-yellow-900">
                  Analysis Ready to Process
                </h3>
                <p className="text-yellow-700">
                  Choose a de-artifacting method, then click Start Analysis.
                </p>
              </div>
            </div>

            {/* De-Artifacting Settings */}
            <div className="bg-white border border-yellow-200 rounded-lg p-4 mb-4">
              <fieldset>
                <legend className="text-sm font-semibold text-gray-900 mb-3">
                  De-Artifacting Method
                </legend>
                <div className="space-y-3">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="artifactMode"
                      value="pipeline"
                      checked={settings.artifact_mode === 'pipeline'}
                      onChange={() => updateSetting('artifact_mode', 'pipeline')}
                      className="mt-1"
                    />
                    <div>
                      <div className="font-medium text-gray-900">Automatic pipeline</div>
                      <div className="text-sm text-gray-600">
                        Channel quality checks, artifact subspace reconstruction, ICA and adaptive epoch rejection.
                        Artifacts you mark in the EEG viewer are excluded too.
                      </div>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="artifactMode"
                      value="manual"
                      checked={settings.artifact_mode === 'manual'}
                      onChange={() => updateSetting('artifact_mode', 'manual')}
                      className="mt-1"
                    />
                    <div>
                      <div className="font-medium text-gray-900">Manual</div>
                      <div className="text-sm text-gray-600">
                        Mark artifact epochs by hand in the EEG viewer below, then analyze
                      </div>
                    </div>
                  </label>
                </div>
              </fieldset>
              {settings.artifact_mode === 'manual' && (
                <div className="mt-3 bg-blue-50 border border-blue-200 rounded p-3">
                  <p className="text-sm text-blue-800">
                    Use the annotation tool in the EEG viewer below to mark artifact regions before starting analysis. Select &ldquo;Annotate&rdquo; mode, then drag across artifact regions.
                  </p>
                </div>
              )}

              {/* Pipeline profile and knobs */}
              {settings.artifact_mode === 'pipeline' && (
                <div className="mt-4 pt-3 border-t border-gray-200 space-y-4">
                  <div>
                    <label htmlFor="artifact-profile" className="block text-sm font-semibold text-gray-900 mb-2">
                      Artifact Profile
                    </label>
                    <select
                      id="artifact-profile"
                      value={settings.profile}
                      onChange={(e) => updateSetting('profile', e.target.value as ArtifactSettings['profile'])}
                      aria-describedby="artifact-profile-description"
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white text-gray-900"
                    >
                      {ARTIFACT_PROFILES.map((p) => (
                        <option key={p} value={p}>
                          {PROFILE_DESCRIPTIONS[p].label}
                          {p === 'full' ? ' (Recommended)' : ''}
                        </option>
                      ))}
                    </select>
                    <p id="artifact-profile-description" className="text-xs text-gray-600 mt-1">
                      {PROFILE_DESCRIPTIONS[settings.profile].description}
                    </p>
                  </div>
                </div>
              )}

              <div className="mt-4 pt-3 border-t border-gray-200">
                <h4 className="text-sm font-semibold text-gray-900 mb-2">Advanced Settings</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="rejection-threshold" className="block text-xs text-gray-700 mb-1">
                      Rejection threshold (µV)
                    </label>
                    <input
                      id="rejection-threshold"
                      type="number"
                      min={SETTING_LIMITS.rejection_threshold_uv.min}
                      max={SETTING_LIMITS.rejection_threshold_uv.max}
                      step={10}
                      value={Number.isFinite(settings.rejection_threshold_uv) ? settings.rejection_threshold_uv : ''}
                      onChange={(e) => updateSetting('rejection_threshold_uv', e.target.valueAsNumber)}
                      onBlur={(e) =>
                        updateSetting('rejection_threshold_uv', clampSetting('rejection_threshold_uv', e.target.valueAsNumber))
                      }
                      aria-describedby="rejection-threshold-help"
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm bg-white text-gray-900"
                    />
                    <p id="rejection-threshold-help" className="text-[11px] text-gray-500 mt-0.5">
                      Peak-to-peak ceiling per epoch after cleaning ({SETTING_LIMITS.rejection_threshold_uv.min}–{SETTING_LIMITS.rejection_threshold_uv.max})
                    </p>
                  </div>
                  <div>
                    <label htmlFor="asr-k" className="block text-xs text-gray-700 mb-1">
                      ASR cutoff k (SD)
                    </label>
                    <input
                      id="asr-k"
                      type="number"
                      min={SETTING_LIMITS.asr_k.min}
                      max={SETTING_LIMITS.asr_k.max}
                      step={1}
                      value={settings.asr_k ?? ''}
                      placeholder={
                        PROFILE_ASR_K[settings.profile] !== null
                          ? `profile default (${PROFILE_ASR_K[settings.profile]})`
                          : 'not used'
                      }
                      disabled={settings.artifact_mode !== 'pipeline' || settings.profile === 'rejectionOnly' || settings.profile === 'legacy'}
                      onChange={(e) => updateSetting('asr_k', Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : null)}
                      onBlur={(e) => updateSetting('asr_k', clampSetting('asr_k', e.target.valueAsNumber))}
                      aria-describedby="asr-k-help"
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm bg-white text-gray-900 disabled:bg-gray-100 disabled:text-gray-500"
                    />
                    <p id="asr-k-help" className="text-[11px] text-gray-500 mt-0.5">
                      Blank uses the profile default; lower is more aggressive ({SETTING_LIMITS.asr_k.min}–{SETTING_LIMITS.asr_k.max})
                    </p>
                  </div>
                  <div>
                    <label htmlFor="line-freq" className="block text-xs text-gray-700 mb-1">
                      Line frequency
                    </label>
                    <select
                      id="line-freq"
                      value={settings.line_freq}
                      onChange={(e) => updateSetting('line_freq', Number(e.target.value) === 50 ? 50 : 60)}
                      aria-describedby="line-freq-help"
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm bg-white text-gray-900"
                    >
                      <option value={60}>60 Hz (Americas)</option>
                      <option value={50}>50 Hz (Europe, Asia)</option>
                    </select>
                    <p id="line-freq-help" className="text-[11px] text-gray-500 mt-0.5">
                      Mains interference to notch out
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {startError && (
              <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
                <p className="text-red-800 text-sm">{startError}</p>
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={handleStartAnalysis}
                disabled={isProcessing}
                className="bg-neuro-primary text-white px-6 py-3 rounded-lg hover:bg-neuro-accent transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessing ? 'Starting...' : 'Start Analysis'}
              </button>
            </div>
          </div>
        )}

        {analysis.status === 'processing' && !isStalled && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6" role="status" aria-live="polite">
            <div className="flex items-center">
              <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-3"></div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-blue-900">
                  Analysis in progress...
                </h3>
                <p className="text-blue-700">
                  This usually takes under a minute. You can leave this page; processing continues on the server.
                  {pollingElapsed > 0 && (
                    <span className="ml-2">
                      ({pollingElapsed}s elapsed)
                    </span>
                  )}
                </p>

                {/* Processing steps */}
                <div className="mt-4 space-y-2">
                  {/* Approximate timeline of the server pipeline; the job reports only done/failed. */}
                  {PROCESSING_STEPS.map((step, i) => {
                    const next = PROCESSING_STEPS[i + 1]?.threshold ?? Infinity;
                    const isActive = pollingElapsed >= step.threshold && pollingElapsed < next;
                    const isDone = pollingElapsed >= next;
                    return (
                      <div key={step.label} className={`flex items-center gap-2 text-sm transition-opacity duration-500 ${pollingElapsed >= step.threshold ? 'opacity-100' : 'opacity-0'}`}>
                        {isDone ? (
                          <svg className="h-4 w-4 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : isActive ? (
                          <div className="h-4 w-4 flex-shrink-0">
                            <div className="h-3 w-3 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                          </div>
                        ) : (
                          <div className="h-4 w-4 flex-shrink-0" />
                        )}
                        <span className={isDone ? 'text-green-700' : isActive ? 'text-blue-800 font-medium' : 'text-blue-600'}>
                          {step.label}
                        </span>
                      </div>
                    );
                  })}
                </div>

              </div>
            </div>
          </div>
        )}

        {(analysis.status === 'failed' || isStalled) && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-6" role="alert">
            <div>
              <h3 className="text-lg font-semibold text-red-900 mb-2">
                {isStalled ? 'Analysis Stalled' : 'Analysis Failed'}
              </h3>
              <p className="text-red-700 mb-2">
                {isStalled
                  ? 'Processing has not finished after 10 minutes and has most likely stopped. You can retry it.'
                  : 'An error occurred while processing your EEG data.'}
              </p>
              {analysis.status === 'failed' && analysis.error_log && (
                <div className="bg-white border border-red-300 rounded p-3 mt-3">
                  <div className="text-sm text-gray-700 mb-1">Error Details:</div>
                  <pre className="text-sm text-red-800 whitespace-pre-wrap">
                    {analysis.error_log}
                  </pre>
                </div>
              )}
              {startError && (
                <p className="text-sm text-red-800 mt-3">{startError}</p>
              )}
              <div className="flex flex-wrap gap-3 mt-4">
                <button
                  onClick={handleStartAnalysis}
                  disabled={isProcessing}
                  className="bg-neuro-primary text-white px-4 py-2 rounded-lg hover:bg-neuro-accent transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isProcessing ? 'Retrying...' : 'Retry'}
                </button>
                <button
                  onClick={handleReanalyze}
                  disabled={isReanalyzing || isProcessing}
                  className="bg-white text-neuro-primary border-2 border-neuro-primary px-4 py-2 rounded-lg hover:bg-neuro-light transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Change Settings
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Recording Information */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-neuro-dark">Recording Details</h2>
            {canEdit && (
              <button
                onClick={() => setEditingLabels(true)}
                disabled={analysis.status === 'processing'}
                className="text-sm font-medium text-neuro-primary hover:text-neuro-accent disabled:opacity-50"
              >
                Edit EO/EC labels
              </button>
            )}
          </div>
          {editingLabels && (
            <ConditionLabelEditor
              recording={analysis.recording}
              onSaved={async (updated) => {
                setEditingLabels(false);
                await rerunForLabels(updated);
              }}
              onCancel={() => setEditingLabels(false)}
            />
          )}
          {labelsStale && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4" role="alert">
              <p className="text-sm text-amber-900">
                <strong>Labels changed since this analysis ran.</strong> The recording is now labelled{' '}
                {labelSummary(labelsOf(analysis.recording)) ?? 'unlabelled (analyzed as eyes open)'}, so the graphs
                below may sit under the wrong condition.
              </p>
              {canEdit && (
                <button
                  onClick={() => rerunForLabels()}
                  className="mt-2 rounded-md bg-neuro-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-neuro-accent"
                >
                  Re-run with the current labels
                </button>
              )}
            </div>
          )}
          {relabelError && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-red-800 text-sm">{relabelError}</p>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-sm text-gray-700">Duration</div>
              <div className="text-lg font-semibold text-gray-900">
                {formatDuration(analysis.recording.duration_seconds)}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-700">File Size</div>
              <div className="text-lg font-semibold text-gray-900">
                {formatFileSize(analysis.recording.file_size)}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-700">Channels</div>
              <div className="text-lg font-semibold text-gray-900">
                {analysis.recording.n_channels}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-700">Sampling Rate</div>
              <div className="text-lg font-semibold text-gray-900">
                {analysis.recording.sampling_rate} Hz
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-700">Montage</div>
              <div className="text-lg font-semibold text-gray-900">
                {analysis.recording.montage}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-700">Reference</div>
              <div className="text-lg font-semibold text-gray-900">
                {analysis.recording.reference}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-700">EO Segment</div>
              <div className="text-lg font-semibold text-gray-900">
                {labelText(analysis.recording.eo_start, analysis.recording.eo_end)}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-700">EC Segment</div>
              <div className="text-lg font-semibold text-gray-900">
                {labelText(analysis.recording.ec_start, analysis.recording.ec_end)}
              </div>
            </div>
          </div>
        </div>

        {/* Raw EEG Visualization */}
        <div ref={viewerRef} className="scroll-mt-4">
        <RawEEGViewer
          recordingId={analysis.recording.id}
          filePath={analysis.recording.file_path}
          rejectedEpochs={analysis.results?.rejected_epochs}
          cleanedFileUrl={analysis.results?.cleaned_file_url}
          cleanedFileFormat={analysis.results?.cleaned_file_format}
          pipelineFilters={{
            highpassHz: analysis.results?.processing_metadata?.config?.high_pass_hz as number | undefined,
            lowpassHz: analysis.results?.processing_metadata?.config?.low_pass_hz as number | undefined,
            notchHz: analysis.results?.processing_metadata?.config?.line_freq as number | undefined,
          }}
          detectedEvents={results?.events}
          eventReview={eventReview}
          amplitudeThresholdUv={amplitudeThresholdOf(results)}
          focusEvent={focusEvent}
        />
        </div>

        {analysis.status === 'completed' && analysis.results && (
          <div ref={resultsRef}>
            {/* QC Report */}
            {results?.qc_report && (() => {
              const r = results!;
              const qc = r.qc_report!;
              const isLegacyIca = qc.artifact_mode === 'ica' || Boolean(qc.ica_method);
              const engine = r.processing_metadata?.engine;
              const listOrNone = (items: string[] | undefined) =>
                items && items.length > 0 ? items.join(', ') : 'None';
              return (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6" data-report-section="Quality Control Report">
                <h2 className="text-2xl font-bold text-neuro-dark mb-4">
                  Quality Control Report
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-sm text-gray-700">
                      Artifact Rejection
                    </div>
                    <div className="text-lg font-semibold text-gray-900">
                      {qc.artifact_rejection_rate}%
                    </div>
                    {(qc.eo_rejection_rate !== undefined || qc.ec_rejection_rate !== undefined) && (
                      <div className="text-xs text-gray-500 mt-0.5">
                        EO {qc.eo_rejection_rate ?? '–'}% / EC {qc.ec_rejection_rate ?? '–'}%
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-sm text-gray-700">Bad Channels</div>
                    <div className="text-lg font-semibold text-gray-900">
                      {qc.bad_channels?.length || 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-700">
                      ICA Components Removed
                    </div>
                    <div className="text-lg font-semibold text-gray-900">
                      {qc.ica_components_removed}
                    </div>
                    {isLegacyIca && qc.ica_method && (
                      <div className="text-xs text-gray-500 mt-0.5">
                        via {LEGACY_ICA_METHOD_LABELS[qc.ica_method] ?? qc.ica_method}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-sm text-gray-700">
                      Final Epochs (EO/EC)
                    </div>
                    <div className="text-lg font-semibold text-gray-900">
                      {qc.final_epochs_eo} /{' '}
                      {qc.final_epochs_ec}
                    </div>
                  </div>
                </div>

                {/* Pipeline details */}
                <dl className="mt-4 pt-4 border-t border-gray-200 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-gray-700">Method:</dt>
                    <dd className="text-gray-900 font-medium">
                      {qc.artifact_mode === 'manual'
                        ? 'Manual annotations'
                        : isLegacyIca
                          ? `ICA (legacy${qc.ica_method ? `, ${LEGACY_ICA_METHOD_LABELS[qc.ica_method] ?? qc.ica_method}` : ''})`
                          : `Automatic pipeline${qc.profile ? ` – ${PROFILE_DESCRIPTIONS[qc.profile]?.label ?? qc.profile} profile` : ''}`}
                    </dd>
                  </div>
                  {qc.physiological_path && (
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="text-gray-700">Eye/muscle correction:</dt>
                      <dd className="text-gray-900 font-medium">
                        {PHYSIOLOGICAL_PATH_LABELS[qc.physiological_path] ?? qc.physiological_path}
                      </dd>
                    </div>
                  )}
                  {qc.ica_removed_labels && qc.ica_removed_labels.length > 0 && (
                    <div className="flex flex-wrap gap-x-2 sm:col-span-2">
                      <dt className="text-gray-700">Removed components:</dt>
                      <dd className="flex flex-wrap gap-1">
                        {qc.ica_removed_labels.map((label, i) => (
                          <span key={`${label}-${i}`} className="px-2 py-0.5 rounded bg-gray-100 text-gray-800 text-xs">
                            {label}
                          </span>
                        ))}
                      </dd>
                    </div>
                  )}
                  {qc.asr && (
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="text-gray-700">ASR:</dt>
                      <dd className="text-gray-900 font-medium">
                        {qc.asr.ran
                          ? `k = ${qc.asr.k}, ${(qc.asr.fraction_windows_modified * 100).toFixed(1)}% of windows corrected`
                          : `Not applied${qc.asr.skipped_reason ? ` (${qc.asr.skipped_reason})` : ''}`}
                      </dd>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-gray-700">Bad channels:</dt>
                    <dd className="text-gray-900 font-medium">{listOrNone(qc.bad_channels)}</dd>
                  </div>
                  {qc.interpolated_channels !== undefined && (
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="text-gray-700">Interpolated:</dt>
                      <dd className="text-gray-900 font-medium">{listOrNone(qc.interpolated_channels)}</dd>
                    </div>
                  )}
                  {qc.manual_artifact_epochs_count !== undefined && (
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="text-gray-700">Manual artifact regions:</dt>
                      <dd className="text-gray-900 font-medium">{qc.manual_artifact_epochs_count}</dd>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-gray-700">Engine:</dt>
                    <dd className="text-gray-900 font-medium break-all">{engineLabel(engine)}</dd>
                  </div>
                </dl>
                {qc.physiological_path === 'ica' && !isLegacyIca && (
                  <p className="text-xs text-gray-500 mt-2">
                    Component labels come from a heuristic classifier (not ICLabel).
                  </p>
                )}

                {qc.warnings && qc.warnings.length > 0 && (
                  <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <h3 className="text-sm font-semibold text-amber-900 mb-1">Warnings</h3>
                    <ul className="list-disc pl-5 text-sm text-amber-800 space-y-0.5">
                      {qc.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Where data was rejected, per channel (Hybrid pipeline analyses only) */}
                {qc.timeline && <RejectionTimeline timeline={qc.timeline} />}

                {/* Download cleaned file */}
                {r.cleaned_file_url && (
                  <div className="mt-4 pt-4 border-t border-gray-200" data-export-ignore>
                    {(() => {
                      const fmt = r.cleaned_file_format || '.edf';
                      const fmtLabel = fmt === '.bdf' ? 'BDF' : fmt === '.csv' ? 'CSV' : 'EDF';
                      return (
                        <>
                          <a
                            href={r.cleaned_file_url}
                            download={`cleaned_raw${fmt}`}
                            className="inline-flex items-center gap-2 text-sm text-neuro-primary hover:text-neuro-accent font-medium"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Download Cleaned Raw File ({fmtLabel})
                          </a>
                          <span className="text-xs text-gray-500 ml-2">
                            Artifact-cleaned data in the original format
                          </span>
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
              );
            })()}

            {/* Detected events (labels only), next to the QC report */}
            <DetectedEvents results={results} review={eventReview} onSelectEvent={handleSelectEvent} />

            {/* Raw Band Power Values */}
            {analysis.results.band_power && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6" data-report-section="Band Power by Channel">
                <h2 className="text-2xl font-bold text-neuro-dark mb-4">
                  Band Power by Channel
                </h2>
                <p className="text-sm text-gray-800 mb-4">
                  Absolute power (μV²/Hz) for each channel across frequency bands
                </p>

                {['eo', 'ec'].map((condition) => {
                  const bandPower = analysis.results.band_power[condition];
                  if (!bandPower) return null;

                  const bands = ['delta', 'theta', 'alpha1', 'alpha2', 'smr', 'beta2', 'hibeta', 'lowgamma'];
                  const channels = Object.keys(bandPower).sort();

                  console.log(`Band power for ${condition}:`, bandPower);

                  return (
                    <div key={condition} className="mb-6 last:mb-0">
                      <h3 className="text-base font-semibold text-gray-900 mb-3">
                        {condition === 'eo' ? 'Eyes Open' : 'Eyes Closed'}
                      </h3>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 border border-gray-200 text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-2 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider border-r border-gray-200 sticky left-0 bg-gray-50 z-10">
                                Ch
                              </th>
                              {bands.map((band) => {
                                const bandDisplayNames: { [key: string]: string } = {
                                  delta: 'Delta', theta: 'Theta', alpha1: 'A1', alpha2: 'A2',
                                  smr: 'SMR', beta2: 'B2', hibeta: 'HiB', lowgamma: 'LowG'
                                };
                                return (
                                  <th key={band} className="px-2 py-2 text-center text-xs font-medium text-gray-700 uppercase">
                                    {bandDisplayNames[band] || band}
                                  </th>
                                );
                              })}
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {channels.map((channelName) => {
                              const channelData = bandPower[channelName];
                              return (
                                <tr key={channelName} className="hover:bg-gray-50">
                                  <td className="px-2 py-1.5 whitespace-nowrap text-xs font-medium text-gray-900 border-r border-gray-200 sticky left-0 bg-white hover:bg-gray-50">
                                    {channelName}
                                  </td>
                                  {bands.map((band) => {
                                    let value = 0;
                                    if (channelData && typeof channelData === 'object' && band in channelData) {
                                      const bandData = channelData[band];
                                      value = typeof bandData === 'number'
                                        ? bandData
                                        : (bandData?.absolute || 0);
                                    }
                                    return (
                                      <td key={band} className="px-2 py-1.5 whitespace-nowrap text-xs text-gray-900 text-center font-mono">
                                        {value > 0 ? value.toFixed(1) : '0.0'}
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Topographic Brain Maps Grid */}
            {(hasAnyLegacyVisual(results, ['topomap_grid']) || results?.band_power) && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6" data-report-section="Band Power Topographic Maps" data-visual>
                <h2 className="text-2xl font-bold text-neuro-dark mb-4">
                  Band Power Topographic Maps
                </h2>
                <p className="text-sm text-gray-800 mb-4">
                  Spatial distribution of EEG band power across the scalp for all frequency bands (blue = low, red = high)
                </p>
                <LegacyOrLive results={results} visual={{ key: 'topomap_grid', alt: 'Band power topographic maps' }}>
                  <TopomapGrid bandPower={results?.band_power} />
                </LegacyOrLive>
              </div>
            )}

            {/* Power spectral density per channel on the head */}
            {(results?.psd?.eo || results?.psd?.ec) && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6" data-report-section="Power Spectral Density" data-visual>
                <h2 className="text-2xl font-bold text-neuro-dark mb-4">
                  Power Spectral Density
                </h2>
                <p className="text-sm text-gray-800 mb-4">
                  Power spectrum (1–45 Hz) of each channel, averaged over the kept epochs: laid out at each
                  channel&apos;s scalp position, or on one chart with the channels you select
                </p>
                <PsdSection
                  psd={results.psd}
                  alphaPeak={results.alpha_peak}
                  fileStem={analysis.recording.filename.replace(/\.[^.]+$/, '')}
                />
              </div>
            )}

            {/* Complexity & Connectivity Analysis */}
            {(hasAnyLegacyVisual(results, ['lzc_topomap_EO', 'lzc_topomap_EC']) || results?.lzc?.eo || results?.lzc?.ec) && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6" data-report-section="Signal Complexity (Lempel-Ziv Complexity)" data-visual>
                <h2 className="text-2xl font-bold text-neuro-dark mb-4">
                  Signal Complexity (Lempel-Ziv Complexity)
                </h2>
                <p className="text-sm text-gray-800 mb-4">
                  Higher LZC (red) indicates more complex, less predictable signals. Lower LZC (blue) indicates simpler, more regular patterns.
                </p>
                <LegacyOrLive
                  results={results}
                  layout="pair"
                  visual={[
                    { key: 'lzc_topomap_EO', title: 'Eyes Open', alt: 'LZC Eyes Open' },
                    { key: 'lzc_topomap_EC', title: 'Eyes Closed', alt: 'LZC Eyes Closed' },
                  ]}
                >
                  <LzcTopomaps lzc={results?.lzc} />
                </LegacyOrLive>
              </div>
            )}

            {/* Brain Connectivity Graph (wPLI) */}
            {(hasAnyLegacyVisual(results, ['connectivity_grid']) || results?.connectivity?.eo || results?.connectivity?.ec) && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6" data-report-section="Brain Connectivity (wPLI)" data-visual>
                <h2 className="text-2xl font-bold text-neuro-dark mb-4">
                  Brain Connectivity (wPLI)
                </h2>
                <p className="text-sm text-gray-800 mb-4">
                  Weighted Phase Lag Index (wPLI) connectivity between electrode sites. Line color and thickness indicate connection strength.
                  wPLI is robust to volume conduction and measures true phase-lagged interactions.
                </p>
                <LegacyOrLive results={results} visual={{ key: 'connectivity_grid', alt: 'Brain connectivity graphs' }}>
                  <ConnectivityHead connectivity={results?.connectivity} />
                </LegacyOrLive>
              </div>
            )}

            {/* Network Metrics Summary */}
            {(hasAnyLegacyVisual(results, ['network_metrics']) || results?.connectivity?.eo || results?.connectivity?.ec) && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6" data-report-section="Network Metrics Comparison" data-visual>
                <h2 className="text-2xl font-bold text-neuro-dark mb-4">
                  Network Metrics Comparison
                </h2>
                <p className="text-sm text-gray-800 mb-4">
                  Graph-theoretic network metrics comparing Eyes Open vs Eyes Closed conditions.
                  Global efficiency measures network integration, clustering coefficient measures local connectivity,
                  small-worldness indicates optimal balance of segregation and integration.
                </p>
                <LegacyOrLive results={results} visual={{ key: 'network_metrics', alt: 'Network metrics comparison' }}>
                  <NetworkMetricsBars connectivity={results?.connectivity} />
                </LegacyOrLive>
              </div>
            )}

            {/* Network Metrics Table (if connectivity data available) */}
            {analysis.results.connectivity && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6" data-report-section="Network Metrics by Band">
                <h2 className="text-2xl font-bold text-neuro-dark mb-4">
                  Network Metrics by Band
                </h2>
                <p className="text-sm text-gray-800 mb-4">
                  Key graph-theoretic metrics for each frequency band. Lower global efficiency post-injury may indicate network disruption.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {['eo', 'ec'].map((condition) => {
                    const connectivity = analysis.results.connectivity[condition];
                    if (!connectivity?.network_metrics) return null;

                    return (
                      <div key={condition} className="border border-gray-200 rounded-lg p-4">
                        <h3 className="text-lg font-semibold text-gray-900 mb-3">
                          {condition === 'eo' ? 'Eyes Open' : 'Eyes Closed'}
                        </h3>
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-gray-200 text-sm">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase">Band</th>
                                <th className="px-3 py-2 text-center text-xs font-medium text-gray-700 uppercase">Global Eff.</th>
                                <th className="px-3 py-2 text-center text-xs font-medium text-gray-700 uppercase">Clustering</th>
                                <th className="px-3 py-2 text-center text-xs font-medium text-gray-700 uppercase">Small-world</th>
                                <th className="px-3 py-2 text-center text-xs font-medium text-gray-700 uppercase">Interhemi.</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {['delta', 'theta', 'alpha', 'beta'].map((band) => {
                                const metrics = connectivity.network_metrics[band];
                                if (!metrics) return null;
                                return (
                                  <tr key={band} className="hover:bg-gray-50">
                                    <td className="px-3 py-2 whitespace-nowrap text-sm font-medium text-gray-900 capitalize">{band}</td>
                                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900 text-center font-mono">
                                      {metrics.global_efficiency?.toFixed(3) || 'N/A'}
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900 text-center font-mono">
                                      {metrics.mean_clustering_coefficient?.toFixed(3) || 'N/A'}
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900 text-center font-mono">
                                      {metrics.small_worldness?.toFixed(2) || 'N/A'}
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900 text-center font-mono">
                                      {metrics.interhemispheric_connectivity?.toFixed(3) || 'N/A'}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Individual Alpha Frequency (IAF) */}
            {(hasAnyLegacyVisual(results, ['alpha_peak_topomap_EO', 'alpha_peak_topomap_EC']) ||
              results?.alpha_peak?.eo || results?.alpha_peak?.ec) && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6" data-report-section="Individual Alpha Frequency (IAF)" data-visual>
                <h2 className="text-2xl font-bold text-neuro-dark mb-4">
                  Individual Alpha Frequency (IAF)
                </h2>
                <p className="text-sm text-gray-800 mb-4">
                  The dominant frequency within the alpha band (8-12 Hz) varies by individual and brain region.
                  Higher IAF is associated with better cognitive performance and neural efficiency.
                </p>
                <LegacyOrLive
                  results={results}
                  visual={[
                    { key: 'alpha_peak_topomap_EO', title: 'Eyes Open', alt: 'Alpha Peak Frequency Eyes Open' },
                    { key: 'alpha_peak_topomap_EC', title: 'Eyes Closed', alt: 'Alpha Peak Frequency Eyes Closed' },
                  ]}
                >
                  <AlphaPeakTopomaps alphaPeak={results?.alpha_peak} />
                </LegacyOrLive>
              </div>
            )}

            {/* Spectrograms */}
            {(hasAnyLegacyVisual(results, ['spectrogram_EO', 'spectrogram_EC']) ||
              results?.spectrograms?.eo || results?.spectrograms?.ec) && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6" data-report-section="Spectrograms" data-visual>
                <h2 className="text-2xl font-bold text-neuro-dark mb-4">
                  Spectrograms
                </h2>
                <p className="text-sm text-gray-800 mb-4">
                  How signal power changes over time and frequency. Starts with the first channel; add more one at a time.
                </p>
                <LegacyOrLive
                  results={results}
                  visual={[
                    { key: 'spectrogram_EO', title: 'Eyes Open', alt: 'Spectrogram Eyes Open' },
                    { key: 'spectrogram_EC', title: 'Eyes Closed', alt: 'Spectrogram Eyes Closed' },
                  ]}
                >
                  <SpectrogramGrid
                    spectrograms={results?.spectrograms}
                    channels={results?.spectrograms_path ? results?.spectrogram_channels : undefined}
                    analysisId={analysis.id}
                  />
                </LegacyOrLive>
              </div>
            )}

            {/* Heart rate variability (recordings with an ECG lead) */}
            {results?.hrv && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6" data-report-section="Heart Rate Variability (ECG)" data-visual>
                <h2 className="text-2xl font-bold text-neuro-dark mb-2">Heart Rate Variability (ECG)</h2>
                <HrvSection hrv={results.hrv} />
              </div>
            )}

            {/* sLORETA source localization (full 19-channel 10-20 recordings) */}
            {results?.sloreta?.values_path && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6" data-report-section="Source Localization (sLORETA)" data-visual>
                <h2 className="text-2xl font-bold text-neuro-dark mb-2">Source Localization (sLORETA)</h2>
                <p className="text-sm text-gray-600 mb-4">
                  Estimated cortical sources of each frequency band, from the cleaned EEG
                </p>
                <SloretaSection analysisId={analysis.id} sloreta={results.sloreta} />
              </div>
            )}

            {/* Band Ratios */}
            {analysis.results.band_ratios && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6" data-report-section="Band Ratios">
                <h2 className="text-2xl font-bold text-neuro-dark mb-4">
                  Band Ratios
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="border border-gray-200 rounded-lg p-4">
                    <h3 className="font-semibold text-lg mb-3 text-gray-900">
                      Theta/Beta Ratio
                    </h3>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-800">Frontal Average:</span>
                        <span className="font-semibold text-gray-900">
                          {analysis.results.band_ratios.theta_beta_ratio.frontal_avg.toFixed(
                            2
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-800">Central Average:</span>
                        <span className="font-semibold text-gray-900">
                          {analysis.results.band_ratios.theta_beta_ratio.central_avg.toFixed(
                            2
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="border border-gray-200 rounded-lg p-4">
                    <h3 className="font-semibold text-lg mb-3 text-gray-900">
                      Alpha/Theta Ratio
                    </h3>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-800">
                          Occipital Average:
                        </span>
                        <span className="font-semibold text-gray-900">
                          {analysis.results.band_ratios.alpha_theta_ratio.occipital_avg.toFixed(
                            2
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-800">Parietal Average:</span>
                        <span className="font-semibold text-gray-900">
                          {analysis.results.band_ratios.alpha_theta_ratio.parietal_avg.toFixed(
                            2
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Asymmetry */}
            {analysis.results.asymmetry && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6" data-report-section="Hemispheric Asymmetry">
                <h2 className="text-2xl font-bold text-neuro-dark mb-4">
                  Hemispheric Asymmetry
                </h2>
                <p className="text-sm text-gray-800 mb-4">
                  Negative values indicate left hemisphere dominance, positive
                  values indicate right hemisphere dominance
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="border border-gray-200 rounded-lg p-4">
                    <div className="text-sm text-gray-700 mb-1">
                      Frontal Alpha
                    </div>
                    <div className="text-2xl font-bold text-gray-900">
                      {analysis.results.asymmetry.frontal_alpha.toFixed(3)}
                    </div>
                  </div>
                  <div className="border border-gray-200 rounded-lg p-4">
                    <div className="text-sm text-gray-700 mb-1">
                      Parietal Alpha
                    </div>
                    <div className="text-2xl font-bold text-gray-900">
                      {analysis.results.asymmetry.parietal_alpha.toFixed(3)}
                    </div>
                  </div>
                  <div className="border border-gray-200 rounded-lg p-4">
                    <div className="text-sm text-gray-700 mb-1">
                      Frontal Theta
                    </div>
                    <div className="text-2xl font-bold text-gray-900">
                      {analysis.results.asymmetry.frontal_theta.toFixed(3)}
                    </div>
                  </div>
                </div>
              </div>
            )}


            {/* Risk Patterns */}
            {analysis.results.risk_patterns && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6" data-report-section="Risk Pattern Detection">
                <h2 className="text-2xl font-bold text-neuro-dark mb-4">
                  Risk Pattern Detection
                </h2>
                <div className="space-y-3">
                  {Object.entries(analysis.results.risk_patterns).map(
                    ([pattern, detected]: [string, any]) => (
                      <div
                        key={pattern}
                        className={`flex items-center justify-between p-4 rounded-lg border ${
                          detected
                            ? 'bg-yellow-50 border-yellow-300'
                            : 'bg-green-50 border-green-300'
                        }`}
                      >
                        <div className="flex items-center">
                          {detected ? (
                            <svg
                              className="h-5 w-5 text-yellow-600 mr-3"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                                clipRule="evenodd"
                              />
                            </svg>
                          ) : (
                            <svg
                              className="h-5 w-5 text-green-600 mr-3"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                clipRule="evenodd"
                              />
                            </svg>
                          )}
                          <span className="font-medium capitalize text-gray-900">
                            {pattern.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <span
                          className={`text-sm font-medium ${
                            detected ? 'text-yellow-800' : 'text-green-800'
                          }`}
                        >
                          {detected ? 'Detected' : 'Not Detected'}
                        </span>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}

            {/* Export Options */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-2xl font-bold text-neuro-dark mb-4">
                Export Options
              </h2>
              <div className="flex flex-wrap gap-4">
                {analysis.results.cleaned_file_url && (
                  <a
                    href={analysis.results.cleaned_file_url}
                    download={`cleaned_raw${analysis.results.cleaned_file_format || '.edf'}`}
                    className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition-colors font-medium inline-flex items-center gap-2"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download Cleaned EEG ({analysis.results.cleaned_file_format || '.edf'})
                  </a>
                )}
                <button
                  onClick={() => handleExport('pdf')}
                  disabled={exporting !== null}
                  className="bg-neuro-primary text-white px-6 py-3 rounded-lg hover:bg-neuro-accent transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {exporting?.kind === 'pdf' ? `Building PDF… ${exporting.done}/${exporting.total}` : 'Export PDF Report'}
                </button>
                <button
                  onClick={() => handleExport('zip')}
                  disabled={exporting !== null}
                  className="bg-white text-neuro-primary border-2 border-neuro-primary px-6 py-3 rounded-lg hover:bg-neuro-light transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {exporting?.kind === 'zip' ? `Capturing images… ${exporting.done}/${exporting.total}` : 'Export Visualizations'}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-3">
                Exports capture the results as currently shown, including the selected scales and views.
              </p>
              {exportError && (
                <p className="text-sm text-red-700 mt-2" role="alert">
                  {exportError}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
