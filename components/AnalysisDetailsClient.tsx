'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import type { User } from '@supabase/supabase-js';
import dynamic from 'next/dynamic';

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
  recording: Recording;
}

interface AnalysisDetailsClientProps {
  analysis: Analysis;
  user: User;
}

interface AIInterpretationContent {
  summary: string;
  amplitude_patterns: string;
  frequency_ratios: string;
  peak_alpha_frequency: string;
  asymmetry_analysis: string;
  complexity_connectivity: string;
  observations: string;
}

interface AIInterpretation {
  generated_at: string;
  model: string;
  content: AIInterpretationContent;
}

export default function AnalysisDetailsClient({
  analysis: initialAnalysis,
  user,
}: AnalysisDetailsClientProps) {
  const router = useRouter();
  const supabase = createClient();
  const [analysis, setAnalysis] = useState(initialAnalysis);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pollingElapsed, setPollingElapsed] = useState(0);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const [reanalyzeError, setReanalyzeError] = useState<string | null>(null);
  const [artifactMode, setArtifactMode] = useState<'ica' | 'manual'>('ica');

  // Get timeout from env or default to 3 minutes (180 seconds)
  const ANALYSIS_TIMEOUT_SECONDS = 180;
  const POLL_INTERVAL_MS = 2000;

  // Auto-refresh when processing
  useEffect(() => {
    if (analysis.status === 'processing') {
      let pollCount = 0;
      const startTime = Date.now();

      const interval = setInterval(async () => {
        pollCount++;
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setPollingElapsed(elapsed);

        // Check if timeout exceeded
        if (elapsed >= ANALYSIS_TIMEOUT_SECONDS) {
          console.warn(`Analysis polling timeout exceeded after ${ANALYSIS_TIMEOUT_SECONDS} seconds`);
          clearInterval(interval);
          setPollingElapsed(0);
          return;
        }

        const { data } = await (supabase as any)
          .from('analyses')
          .select(`
            *,
            recording:recordings (
              id,
              filename,
              file_path,
              file_size,
              duration_seconds,
              sampling_rate,
              n_channels,
              montage,
              reference,
              eo_start,
              eo_end,
              ec_start,
              ec_end,
              project_id,
              created_at
            )
          `)
          .eq('id', analysis.id)
          .single();

        if (data) {
          setAnalysis(data);
          if (data.status !== 'processing') {
            clearInterval(interval);
            setPollingElapsed(0);
          }
        }
      }, POLL_INTERVAL_MS);

      return () => {
        clearInterval(interval);
        setPollingElapsed(0);
      };
    }
  }, [analysis.status, analysis.id, supabase]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  const handleStartAnalysis = async () => {
    setIsProcessing(true);
    try {
      // Update config with chosen artifact mode before starting
      const updatedConfig = {
        ...analysis.config,
        preprocessing: {
          ...analysis.config?.preprocessing,
          artifact_mode: artifactMode,
        },
      };

      const patchResponse = await fetch(`/api/analyses/${analysis.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: updatedConfig }),
      });

      if (!patchResponse.ok) {
        throw new Error('Failed to update analysis config');
      }

      const response = await fetch(`/api/analyses/${analysis.id}/process`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to start analysis');
      }

      // Update local state to show processing
      setAnalysis({ ...analysis, status: 'processing', config: updatedConfig });
    } catch (error) {
      console.error('Error starting analysis:', error);
      alert('Failed to start analysis. Please try again.');
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

  const handleGenerateAIInterpretation = async () => {
    setIsGeneratingAI(true);
    setAiError(null);
    try {
      const response = await fetch(`/api/analyses/${analysis.id}/ai-interpretation`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate AI interpretation');
      }

      // Update local state with the new interpretation
      setAnalysis({
        ...analysis,
        results: {
          ...analysis.results,
          ai_interpretation: data.interpretation,
        },
      });
    } catch (error: any) {
      console.error('Error generating AI interpretation:', error);
      setAiError(error.message || 'Failed to generate AI interpretation');
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const handleReanalyze = async () => {
    setIsReanalyzing(true);
    setReanalyzeError(null);
    try {
      // Preserve the AI interpretation before clearing results
      const preservedAiInterpretation = analysis.results?.ai_interpretation || null;

      // Reset the analysis status to pending via API
      const response = await fetch(`/api/analyses/${analysis.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'pending',
          results: preservedAiInterpretation ? { ai_interpretation: preservedAiInterpretation } : null,
          error_log: null,
          started_at: null,
          completed_at: null,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to reset analysis status');
      }

      // Update local state, preserving AI interpretation
      // Don't auto-start processing — let the user pick ICA vs Manual first
      setAnalysis({
        ...analysis,
        status: 'pending',
        results: preservedAiInterpretation ? { ai_interpretation: preservedAiInterpretation } : null,
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

  const aiInterpretation: AIInterpretation | null = analysis.results?.ai_interpretation || null;

  return (
    <main className="min-h-screen bg-neuro-light">
      {/* Navigation */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push('/dashboard')}
                className="text-2xl font-bold text-neuro-primary hover:text-neuro-accent transition-colors"
              >
                Squiggly
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
          {reanalyzeError && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-red-800 text-sm">{reanalyzeError}</p>
            </div>
          )}
        </div>

        {/* Recording Information */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-2xl font-bold text-neuro-dark mb-4">
            Recording Details
          </h2>
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
                {analysis.recording.eo_start !== null &&
                analysis.recording.eo_end !== null
                  ? `${formatDuration(
                      analysis.recording.eo_start
                    )} - ${formatDuration(analysis.recording.eo_end)}`
                  : 'Not labeled'}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-700">EC Segment</div>
              <div className="text-lg font-semibold text-gray-900">
                {analysis.recording.ec_start !== null &&
                analysis.recording.ec_end !== null
                  ? `${formatDuration(
                      analysis.recording.ec_start
                    )} - ${formatDuration(analysis.recording.ec_end)}`
                  : 'Not labeled'}
              </div>
            </div>
          </div>
        </div>

        {/* Raw EEG Visualization */}
        <RawEEGViewer
          recordingId={analysis.recording.id}
          filePath={analysis.recording.file_path}
        />

        {/* Analysis Results or Status Message */}
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

            {/* De-Artifacting Mode Selector */}
            <div className="bg-white border border-yellow-200 rounded-lg p-4 mb-4">
              <h4 className="text-sm font-semibold text-gray-900 mb-3">
                De-Artifacting Method
              </h4>
              <div className="space-y-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="artifactMode"
                    value="ica"
                    checked={artifactMode === 'ica'}
                    onChange={() => setArtifactMode('ica')}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium text-gray-900">ICA (Automatic)</div>
                    <div className="text-sm text-gray-600">
                      Automatically detects and removes artifacts using Independent Component Analysis
                    </div>
                  </div>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="artifactMode"
                    value="manual"
                    checked={artifactMode === 'manual'}
                    onChange={() => setArtifactMode('manual')}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium text-gray-900">Manual</div>
                    <div className="text-sm text-gray-600">
                      Mark artifact epochs by hand in the EEG viewer above, then analyze
                    </div>
                  </div>
                </label>
              </div>
              {artifactMode === 'manual' && (
                <div className="mt-3 bg-blue-50 border border-blue-200 rounded p-3">
                  <p className="text-sm text-blue-800">
                    Use the annotation tool in the EEG viewer above to mark artifact regions before starting analysis. Select &ldquo;Annotate&rdquo; mode, then drag across artifact regions.
                  </p>
                </div>
              )}
            </div>

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

        {analysis.status === 'processing' && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
            <div className="flex items-center">
              <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-3"></div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-blue-900">
                  Analysis in progress...
                </h3>
                <p className="text-blue-700">
                  This may take up to 3 minutes. Please do not close this page.
                  {pollingElapsed > 0 && (
                    <span className="ml-2">
                      ({pollingElapsed}s elapsed)
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>
        )}

        {analysis.status === 'failed' && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-6">
            <div>
              <h3 className="text-lg font-semibold text-red-900 mb-2">
                Analysis Failed
              </h3>
              <p className="text-red-700 mb-2">
                An error occurred while processing your EEG data.
              </p>
              {analysis.error_log && (
                <div className="bg-white border border-red-300 rounded p-3 mt-3">
                  <div className="text-sm text-gray-700 mb-1">Error Details:</div>
                  <pre className="text-sm text-red-800 whitespace-pre-wrap">
                    {analysis.error_log}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}

        {analysis.status === 'completed' && analysis.results && (
          <>
            {/* QC Report */}
            {analysis.results.qc_report && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                <h2 className="text-2xl font-bold text-neuro-dark mb-4">
                  Quality Control Report
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-sm text-gray-700">
                      Artifact Rejection
                    </div>
                    <div className="text-lg font-semibold text-gray-900">
                      {analysis.results.qc_report.artifact_rejection_rate}%
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-700">Bad Channels</div>
                    <div className="text-lg font-semibold text-gray-900">
                      {analysis.results.qc_report.bad_channels?.length || 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-700">
                      ICA Components Removed
                    </div>
                    <div className="text-lg font-semibold text-gray-900">
                      {analysis.results.qc_report.ica_components_removed}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-700">
                      Final Epochs (EO/EC)
                    </div>
                    <div className="text-lg font-semibold text-gray-900">
                      {analysis.results.qc_report.final_epochs_eo} /{' '}
                      {analysis.results.qc_report.final_epochs_ec}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Raw Band Power Values */}
            {analysis.results.band_power && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
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
            {analysis.results.visuals?.topomap_grid && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                <h2 className="text-2xl font-bold text-neuro-dark mb-4">
                  Band Power Topographic Maps
                </h2>
                <p className="text-sm text-gray-800 mb-4">
                  Spatial distribution of EEG band power across the scalp for all frequency bands (blue = low, red = high)
                </p>
                <div className="bg-white rounded border border-gray-200 overflow-hidden">
                  <img
                    src={analysis.results.visuals.topomap_grid as string}
                    alt="Band power topographic maps"
                    className="w-full h-auto"
                  />
                </div>
              </div>
            )}

            {/* Complexity & Connectivity Analysis */}
            {(analysis.results.visuals?.lzc_topomap_EO || analysis.results.visuals?.lzc_topomap_EC) && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                <h2 className="text-2xl font-bold text-neuro-dark mb-4">
                  Signal Complexity (Lempel-Ziv Complexity)
                </h2>
                <p className="text-sm text-gray-800 mb-4">
                  Higher LZC (red) indicates more complex, less predictable signals. Lower LZC (blue) indicates simpler, more regular patterns.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {analysis.results.visuals.lzc_topomap_EO && (
                    <div className="border border-gray-200 rounded-lg p-4">
                      <h3 className="text-lg font-semibold text-gray-900 mb-3 text-center">
                        Eyes Open
                      </h3>
                      <div className="bg-white rounded border border-gray-200 overflow-hidden">
                        <img
                          src={analysis.results.visuals.lzc_topomap_EO as string}
                          alt="LZC Eyes Open"
                          className="w-full h-auto"
                        />
                      </div>
                    </div>
                  )}
                  {analysis.results.visuals.lzc_topomap_EC && (
                    <div className="border border-gray-200 rounded-lg p-4">
                      <h3 className="text-lg font-semibold text-gray-900 mb-3 text-center">
                        Eyes Closed
                      </h3>
                      <div className="bg-white rounded border border-gray-200 overflow-hidden">
                        <img
                          src={analysis.results.visuals.lzc_topomap_EC as string}
                          alt="LZC Eyes Closed"
                          className="w-full h-auto"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Brain Connectivity Graph (wPLI) */}
            {analysis.results.visuals?.connectivity_grid && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                <h2 className="text-2xl font-bold text-neuro-dark mb-4">
                  Brain Connectivity (wPLI)
                </h2>
                <p className="text-sm text-gray-800 mb-4">
                  Weighted Phase Lag Index (wPLI) connectivity between electrode sites. Line color and thickness indicate connection strength.
                  wPLI is robust to volume conduction and measures true phase-lagged interactions.
                </p>
                <div className="bg-white rounded border border-gray-200 overflow-hidden">
                  <img
                    src={analysis.results.visuals.connectivity_grid as string}
                    alt="Brain connectivity graphs"
                    className="w-full h-auto"
                  />
                </div>
              </div>
            )}

            {/* Network Metrics Summary */}
            {analysis.results.visuals?.network_metrics && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                <h2 className="text-2xl font-bold text-neuro-dark mb-4">
                  Network Metrics Comparison
                </h2>
                <p className="text-sm text-gray-800 mb-4">
                  Graph-theoretic network metrics comparing Eyes Open vs Eyes Closed conditions.
                  Global efficiency measures network integration, clustering coefficient measures local connectivity,
                  small-worldness indicates optimal balance of segregation and integration.
                </p>
                <div className="bg-white rounded border border-gray-200 overflow-hidden">
                  <img
                    src={analysis.results.visuals.network_metrics as string}
                    alt="Network metrics comparison"
                    className="w-full h-auto"
                  />
                </div>
              </div>
            )}

            {/* Network Metrics Table (if connectivity data available) */}
            {analysis.results.connectivity && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
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
            {(analysis.results.visuals?.alpha_peak_topomap_EO || analysis.results.visuals?.alpha_peak_topomap_EC) && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                <h2 className="text-2xl font-bold text-neuro-dark mb-4">
                  Individual Alpha Frequency (IAF)
                </h2>
                <p className="text-sm text-gray-800 mb-4">
                  The dominant frequency within the alpha band (8-12 Hz) varies by individual and brain region.
                  Higher IAF is associated with better cognitive performance and neural efficiency.
                </p>
                <div className="grid grid-cols-1 gap-6">
                  {analysis.results.visuals.alpha_peak_topomap_EO && (
                    <div className="border border-gray-200 rounded-lg p-4">
                      <h3 className="text-lg font-semibold text-gray-900 mb-3">
                        Eyes Open
                      </h3>
                      <div className="bg-white rounded border border-gray-200 overflow-hidden">
                        <img
                          src={analysis.results.visuals.alpha_peak_topomap_EO as string}
                          alt="Alpha Peak Frequency Eyes Open"
                          className="w-full h-auto"
                        />
                      </div>
                    </div>
                  )}
                  {analysis.results.visuals.alpha_peak_topomap_EC && (
                    <div className="border border-gray-200 rounded-lg p-4">
                      <h3 className="text-lg font-semibold text-gray-900 mb-3">
                        Eyes Closed
                      </h3>
                      <div className="bg-white rounded border border-gray-200 overflow-hidden">
                        <img
                          src={analysis.results.visuals.alpha_peak_topomap_EC as string}
                          alt="Alpha Peak Frequency Eyes Closed"
                          className="w-full h-auto"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Spectrograms */}
            {(analysis.results.visuals?.spectrogram_EO || analysis.results.visuals?.spectrogram_EC) && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                <h2 className="text-2xl font-bold text-neuro-dark mb-4">
                  Spectrograms
                </h2>
                <p className="text-sm text-gray-800 mb-4">
                  Time-frequency analysis showing how signal power changes over time for key electrode sites
                </p>
                <div className="grid grid-cols-1 gap-6">
                  {analysis.results.visuals.spectrogram_EO && (
                    <div className="border border-gray-200 rounded-lg p-4">
                      <h3 className="text-lg font-semibold text-gray-900 mb-3">
                        Eyes Open
                      </h3>
                      <div className="bg-white rounded border border-gray-200 overflow-hidden">
                        <img
                          src={analysis.results.visuals.spectrogram_EO as string}
                          alt="Spectrogram Eyes Open"
                          className="w-full h-auto"
                        />
                      </div>
                    </div>
                  )}
                  {analysis.results.visuals.spectrogram_EC && (
                    <div className="border border-gray-200 rounded-lg p-4">
                      <h3 className="text-lg font-semibold text-gray-900 mb-3">
                        Eyes Closed
                      </h3>
                      <div className="bg-white rounded border border-gray-200 overflow-hidden">
                        <img
                          src={analysis.results.visuals.spectrogram_EC as string}
                          alt="Spectrogram Eyes Closed"
                          className="w-full h-auto"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Band Ratios */}
            {analysis.results.band_ratios && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
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
              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
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
              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
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

            {/* AI-Powered Interpretation */}
            <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg shadow-md p-6 mb-6 border border-purple-200">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="bg-purple-100 p-2 rounded-lg">
                    <svg className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold text-neuro-dark">
                    AI-Powered Interpretation
                  </h2>
                </div>
                {!aiInterpretation && !isGeneratingAI && (
                  <button
                    onClick={handleGenerateAIInterpretation}
                    disabled={isGeneratingAI}
                    className="bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 transition-colors font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Generate AI Analysis
                  </button>
                )}
                {aiInterpretation && !isGeneratingAI && (
                  <button
                    onClick={handleGenerateAIInterpretation}
                    disabled={isGeneratingAI}
                    className="bg-white text-purple-600 border-2 border-purple-600 px-4 py-2 rounded-lg hover:bg-purple-50 transition-colors font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Regenerate
                  </button>
                )}
              </div>

              {/* Loading State */}
              {isGeneratingAI && (
                <div className="bg-white rounded-lg p-6 border border-purple-200">
                  <div className="flex items-center justify-center">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mr-4"></div>
                    <div>
                      <p className="text-lg font-medium text-gray-900">Generating AI Interpretation...</p>
                      <p className="text-sm text-gray-600">This may take up to 60 seconds. Please wait.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Error State */}
              {aiError && !isGeneratingAI && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                  <div className="flex items-center">
                    <svg className="h-5 w-5 text-red-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                    <span className="text-red-800">{aiError}</span>
                  </div>
                </div>
              )}

              {/* Interpretation Content */}
              {aiInterpretation && !isGeneratingAI && (
                <div className="space-y-4">
                  {/* Disclaimer Banner */}
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <div className="flex items-start">
                      <svg className="h-5 w-5 text-amber-600 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      <p className="text-sm text-amber-800">
                        <strong>Educational Use Only:</strong> This AI-generated interpretation is for educational purposes only and does not constitute medical diagnosis or advice. Consult a qualified healthcare professional for clinical interpretation of EEG findings.
                      </p>
                    </div>
                  </div>

                  {/* Generated timestamp */}
                  <div className="text-sm text-gray-500">
                    Generated on {new Date(aiInterpretation.generated_at).toLocaleString()} using {aiInterpretation.model}
                  </div>

                  {/* Interpretation Sections */}
                  <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
                    {aiInterpretation.content.summary && (
                      <div className="p-4">
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">Summary</h3>
                        <p className="text-gray-700 whitespace-pre-wrap">{aiInterpretation.content.summary}</p>
                      </div>
                    )}
                    {aiInterpretation.content.amplitude_patterns && (
                      <div className="p-4">
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">Amplitude Patterns</h3>
                        <p className="text-gray-700 whitespace-pre-wrap">{aiInterpretation.content.amplitude_patterns}</p>
                      </div>
                    )}
                    {aiInterpretation.content.frequency_ratios && (
                      <div className="p-4">
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">Frequency Ratios</h3>
                        <p className="text-gray-700 whitespace-pre-wrap">{aiInterpretation.content.frequency_ratios}</p>
                      </div>
                    )}
                    {aiInterpretation.content.peak_alpha_frequency && (
                      <div className="p-4">
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">Peak Alpha Frequency</h3>
                        <p className="text-gray-700 whitespace-pre-wrap">{aiInterpretation.content.peak_alpha_frequency}</p>
                      </div>
                    )}
                    {aiInterpretation.content.asymmetry_analysis && (
                      <div className="p-4">
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">Asymmetry Analysis</h3>
                        <p className="text-gray-700 whitespace-pre-wrap">{aiInterpretation.content.asymmetry_analysis}</p>
                      </div>
                    )}
                    {aiInterpretation.content.complexity_connectivity && (
                      <div className="p-4">
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">Complexity & Connectivity</h3>
                        <p className="text-gray-700 whitespace-pre-wrap">{aiInterpretation.content.complexity_connectivity}</p>
                      </div>
                    )}
                    {aiInterpretation.content.observations && (
                      <div className="p-4">
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">Clinical Observations</h3>
                        <p className="text-gray-700 whitespace-pre-wrap">{aiInterpretation.content.observations}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Empty State */}
              {!aiInterpretation && !isGeneratingAI && !aiError && (
                <div className="bg-white rounded-lg p-6 border border-purple-200 text-center">
                  <p className="text-gray-600 mb-2">
                    Get an AI-powered expert interpretation of your EEG analysis results.
                  </p>
                  <p className="text-sm text-gray-500">
                    The AI will analyze band power patterns, frequency ratios, asymmetry metrics, and complexity measures to provide educational insights.
                  </p>
                </div>
              )}
            </div>

            {/* Export Options */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-2xl font-bold text-neuro-dark mb-4">
                Export Options
              </h2>
              <div className="flex gap-4">
                <button className="bg-neuro-primary text-white px-6 py-3 rounded-lg hover:bg-neuro-accent transition-colors font-medium">
                  Export PDF Report
                </button>
                <button className="bg-white text-neuro-primary border-2 border-neuro-primary px-6 py-3 rounded-lg hover:bg-neuro-light transition-colors font-medium">
                  Export JSON Data
                </button>
                <button className="bg-white text-neuro-primary border-2 border-neuro-primary px-6 py-3 rounded-lg hover:bg-neuro-light transition-colors font-medium">
                  Export Visualizations
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
