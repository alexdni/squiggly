'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import type { User } from '@supabase/supabase-js';
import dynamic from 'next/dynamic';

// Dynamically import RawEEGViewer to avoid SSR issues with Chart.js
const RawEEGViewer = dynamic(() => import('./RawEEGViewer'), {
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

export default function AnalysisDetailsClient({
  analysis: initialAnalysis,
  user,
}: AnalysisDetailsClientProps) {
  const router = useRouter();
  const supabase = createClient();
  const [analysis, setAnalysis] = useState(initialAnalysis);
  const [isProcessing, setIsProcessing] = useState(false);

  // Auto-refresh when processing
  useEffect(() => {
    if (analysis.status === 'processing') {
      const interval = setInterval(async () => {
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
          }
        }
      }, 2000); // Poll every 2 seconds

      return () => clearInterval(interval);
    }
  }, [analysis.status, analysis.id, supabase]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  const handleStartAnalysis = async () => {
    setIsProcessing(true);
    try {
      const response = await fetch(`/api/analyses/${analysis.id}/process`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to start analysis');
      }

      // Update local state to show processing
      setAnalysis({ ...analysis, status: 'processing' });
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
            <div
              className={`px-4 py-2 rounded-lg font-medium ${getStatusColor(
                analysis.status
              )}`}
            >
              {getStatusText(analysis.status)}
            </div>
          </div>
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
            <div className="flex items-center justify-between">
              <div className="flex items-center">
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
                    Click the button to start analyzing your EEG recording.
                  </p>
                </div>
              </div>
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
              <div>
                <h3 className="text-lg font-semibold text-blue-900">
                  Processing EEG Data
                </h3>
                <p className="text-blue-700">
                  Analysis is currently running. This may take a few minutes.
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
                  Band Power Summary
                </h2>
                <p className="text-sm text-gray-800 mb-4">
                  Average absolute power across all channels (μV²/Hz)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {['eo', 'ec'].map((condition) => {
                    const bandPower = analysis.results.band_power[condition];
                    if (!bandPower) return null;

                    // Calculate average power for each band
                    const bands = ['delta', 'theta', 'alpha1', 'alpha2', 'smr', 'beta2', 'hibeta', 'lowgamma'];
                    const averages: Record<string, number> = {};

                    bands.forEach((band) => {
                      let sum = 0;
                      let count = 0;
                      Object.values(bandPower).forEach((channelData: any) => {
                        if (channelData[band]?.absolute) {
                          sum += channelData[band].absolute;
                          count++;
                        }
                      });
                      averages[band] = count > 0 ? sum / count : 0;
                    });

                    return (
                      <div key={condition} className="border border-gray-200 rounded-lg p-4">
                        <h3 className="text-lg font-semibold text-gray-900 mb-3">
                          {condition === 'eo' ? 'Eyes Open' : 'Eyes Closed'}
                        </h3>
                        <div className="space-y-2">
                          {bands.map((band) => (
                            <div key={band} className="flex justify-between items-center text-sm">
                              <span className="font-medium capitalize">
                                {band.replace(/([a-z])([0-9])/g, '$1 $2')}
                              </span>
                              <span className="text-gray-900 font-mono">
                                {averages[band].toFixed(2)} μV²/Hz
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
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

            {/* Coherence Matrix Grid */}
            {analysis.results.visuals?.coherence_grid && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                <h2 className="text-2xl font-bold text-neuro-dark mb-4">
                  Inter-Channel Coherence Matrices
                </h2>
                <p className="text-sm text-gray-800 mb-4">
                  Coherence (0-1) showing connectivity patterns between brain regions across all frequency bands
                </p>
                <div className="bg-white rounded border border-gray-200 overflow-hidden">
                  <img
                    src={analysis.results.visuals.coherence_grid as string}
                    alt="Coherence matrices"
                    className="w-full h-auto"
                  />
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
