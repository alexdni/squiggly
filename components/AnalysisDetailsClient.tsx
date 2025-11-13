'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import type { User } from '@supabase/supabase-js';

interface Recording {
  id: string;
  filename: string;
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
  analysis,
  user,
}: AnalysisDetailsClientProps) {
  const router = useRouter();
  const supabase = createClient();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/');
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
                className="text-gray-600 hover:text-neuro-primary transition-colors"
              >
                Projects
              </button>
              <span className="text-gray-400">/</span>
              <button
                onClick={() =>
                  router.push(`/projects/${analysis.recording.project_id}`)
                }
                className="text-gray-600 hover:text-neuro-primary transition-colors"
              >
                Project
              </button>
              <span className="text-gray-400">/</span>
              <span className="text-gray-900">Analysis</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-sm text-gray-600">{user.email}</div>
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
              <p className="text-gray-600">{analysis.recording.filename}</p>
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
              <div className="text-sm text-gray-500">Duration</div>
              <div className="text-lg font-semibold">
                {formatDuration(analysis.recording.duration_seconds)}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-500">File Size</div>
              <div className="text-lg font-semibold">
                {formatFileSize(analysis.recording.file_size)}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Channels</div>
              <div className="text-lg font-semibold">
                {analysis.recording.n_channels}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Sampling Rate</div>
              <div className="text-lg font-semibold">
                {analysis.recording.sampling_rate} Hz
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Montage</div>
              <div className="text-lg font-semibold">
                {analysis.recording.montage}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Reference</div>
              <div className="text-lg font-semibold">
                {analysis.recording.reference}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-500">EO Segment</div>
              <div className="text-lg font-semibold">
                {analysis.recording.eo_start !== null &&
                analysis.recording.eo_end !== null
                  ? `${formatDuration(
                      analysis.recording.eo_start
                    )} - ${formatDuration(analysis.recording.eo_end)}`
                  : 'Not labeled'}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-500">EC Segment</div>
              <div className="text-lg font-semibold">
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

        {/* Analysis Results or Status Message */}
        {analysis.status === 'pending' && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 mb-6">
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
                  Analysis Queued
                </h3>
                <p className="text-yellow-700">
                  Your analysis is in the queue and will be processed shortly.
                </p>
              </div>
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
                  <div className="text-sm text-gray-500 mb-1">Error Details:</div>
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
                    <div className="text-sm text-gray-500">
                      Artifact Rejection
                    </div>
                    <div className="text-lg font-semibold">
                      {analysis.results.qc_report.artifact_rejection_rate}%
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">Bad Channels</div>
                    <div className="text-lg font-semibold">
                      {analysis.results.qc_report.bad_channels?.length || 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">
                      ICA Components Removed
                    </div>
                    <div className="text-lg font-semibold">
                      {analysis.results.qc_report.ica_components_removed}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">
                      Final Epochs (EO/EC)
                    </div>
                    <div className="text-lg font-semibold">
                      {analysis.results.qc_report.final_epochs_eo} /{' '}
                      {analysis.results.qc_report.final_epochs_ec}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Power Spectral Density */}
            {analysis.results.band_power && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                <h2 className="text-2xl font-bold text-neuro-dark mb-4">
                  Band Power Analysis
                </h2>
                <p className="text-gray-600 mb-4">
                  Absolute and relative power across different frequency bands
                </p>
                {/* Placeholder for visualization */}
                <div className="bg-gray-100 rounded-lg p-8 text-center">
                  <svg
                    className="mx-auto h-16 w-16 text-gray-400 mb-2"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                    />
                  </svg>
                  <p className="text-gray-600">
                    Power spectral density visualizations available in full
                    report
                  </p>
                </div>
              </div>
            )}

            {/* Coherence Analysis */}
            {analysis.results.coherence && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                <h2 className="text-2xl font-bold text-neuro-dark mb-4">
                  Coherence Analysis
                </h2>
                <p className="text-gray-600 mb-4">
                  Interhemispheric and long-range connectivity patterns
                </p>
                <div className="bg-gray-100 rounded-lg p-8 text-center">
                  <svg
                    className="mx-auto h-16 w-16 text-gray-400 mb-2"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
                    />
                  </svg>
                  <p className="text-gray-600">
                    Coherence matrix visualizations available in full report
                  </p>
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
                          <span className="font-medium capitalize">
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
