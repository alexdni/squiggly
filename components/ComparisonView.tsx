'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase-client';

interface Recording {
  id: string;
  filename: string;
  eo_start: number | null;
  eo_end: number | null;
  ec_start: number | null;
  ec_end: number | null;
}

interface Analysis {
  id: string;
  recording_id: string;
  status: string;
}

interface ComparisonResult {
  eo_recording_id: string;
  ec_recording_id: string;
  power_deltas: {
    absolute: Record<string, Record<string, number>>;
    percent: Record<string, Record<string, number>>;
  };
  coherence_deltas: Record<string, Record<string, number>>;
  asymmetry_deltas: {
    pai: Record<string, number>;
    faa: number;
    alpha_gradient: number;
  };
  summary_metrics: {
    mean_alpha_change_percent: number;
    alpha_blocking_eo: number;
    alpha_blocking_ec: number;
    faa_shift: number;
    theta_beta_change: number;
  };
}

interface ComparisonViewProps {
  projectId: string;
}

export default function ComparisonView({ projectId }: ComparisonViewProps) {
  const supabase = createClient();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [eoRecordings, setEoRecordings] = useState<Recording[]>([]);
  const [ecRecordings, setEcRecordings] = useState<Recording[]>([]);
  const [selectedEoId, setSelectedEoId] = useState<string>('');
  const [selectedEcId, setSelectedEcId] = useState<string>('');
  const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isComparing, setIsComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRecordingsAndAnalyses();
  }, []);

  const fetchRecordingsAndAnalyses = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Fetch all recordings for this project
      const { data: recordingsData, error: recordingsError } = await supabase
        .from('recordings')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (recordingsError) throw recordingsError;

      const allRecordings = recordingsData || [];
      setRecordings(allRecordings);

      // Fetch all analyses to check which recordings have completed analyses
      const recordingIds = allRecordings.map((r: Recording) => r.id);
      const { data: analysesData, error: analysesError } = await supabase
        .from('analyses')
        .select('id, recording_id, status')
        .in('recording_id', recordingIds)
        .eq('status', 'completed');

      if (analysesError) throw analysesError;

      const completedRecordingIds = new Set(
        (analysesData || []).map((a: Analysis) => a.recording_id)
      );

      // Filter recordings with completed analyses
      const recordingsWithAnalyses = allRecordings.filter((r: Recording) =>
        completedRecordingIds.has(r.id)
      );

      // Classify recordings as EO, EC, or BOTH based on segment labels
      const eoRecs: Recording[] = [];
      const ecRecs: Recording[] = [];

      recordingsWithAnalyses.forEach((rec: Recording) => {
        const hasEo = rec.eo_start !== null && rec.eo_end !== null;
        const hasEc = rec.ec_start !== null && rec.ec_end !== null;

        if (hasEo && !hasEc) {
          eoRecs.push(rec);
        } else if (hasEc && !hasEo) {
          ecRecs.push(rec);
        } else if (hasEo && hasEc) {
          // For BOTH recordings, add to both lists
          eoRecs.push(rec);
          ecRecs.push(rec);
        }
      });

      setEoRecordings(eoRecs);
      setEcRecordings(ecRecs);

      // Auto-select if only one of each
      if (eoRecs.length === 1 && ecRecs.length === 1) {
        setSelectedEoId(eoRecs[0].id);
        setSelectedEcId(ecRecs[0].id);
        // Auto-fetch comparison
        await fetchComparison(eoRecs[0].id, ecRecs[0].id);
      }
    } catch (err: any) {
      console.error('Error fetching recordings:', err);
      setError(err.message || 'Failed to load recordings');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchComparison = async (eoId?: string, ecId?: string) => {
    const eoRecId = eoId || selectedEoId;
    const ecRecId = ecId || selectedEcId;

    if (!eoRecId || !ecRecId) {
      setError('Please select both an EO and EC recording');
      return;
    }

    try {
      setIsComparing(true);
      setError(null);

      const response = await fetch(
        `/api/projects/${projectId}/compare?eo_id=${eoRecId}&ec_id=${ecRecId}`
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch comparison');
      }

      const data = await response.json();
      setComparisonResult(data.comparison);
    } catch (err: any) {
      console.error('Error fetching comparison:', err);
      setError(err.message || 'Failed to load comparison');
    } finally {
      setIsComparing(false);
    }
  };

  const handleCompare = () => {
    fetchComparison();
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-neuro-primary"></div>
          <p className="mt-4 text-gray-800">Loading recordings...</p>
        </div>
      </div>
    );
  }

  if (eoRecordings.length === 0 && ecRecordings.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="text-center py-12">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
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
          <h3 className="mt-4 text-lg font-medium text-gray-900">
            No recordings available for comparison
          </h3>
          <p className="mt-2 text-gray-800">
            You need at least one EO recording and one EC recording with completed analyses to compare.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Recording Selectors */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-2xl font-bold text-neuro-dark mb-4">
          Select Recordings to Compare
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* EO Recording Selector */}
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">
              Eyes Open (EO) Recording
            </label>
            <select
              value={selectedEoId}
              onChange={(e) => setSelectedEoId(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-neuro-primary focus:border-transparent text-gray-900"
            >
              <option value="">-- Select EO Recording --</option>
              {eoRecordings.map((rec) => (
                <option key={rec.id} value={rec.id}>
                  {rec.filename}
                </option>
              ))}
            </select>
          </div>

          {/* EC Recording Selector */}
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">
              Eyes Closed (EC) Recording
            </label>
            <select
              value={selectedEcId}
              onChange={(e) => setSelectedEcId(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-neuro-primary focus:border-transparent text-gray-900"
            >
              <option value="">-- Select EC Recording --</option>
              {ecRecordings.map((rec) => (
                <option key={rec.id} value={rec.id}>
                  {rec.filename}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-6">
          <button
            onClick={handleCompare}
            disabled={!selectedEoId || !selectedEcId || isComparing}
            className="bg-neuro-primary text-white px-6 py-3 rounded-lg hover:bg-neuro-accent transition-colors font-medium disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {isComparing ? 'Comparing...' : 'Compare Recordings'}
          </button>
        </div>

        {error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800">{error}</p>
          </div>
        )}
      </div>

      {/* Comparison Results */}
      {comparisonResult && (
        <div className="space-y-6">
          {/* Summary Metrics */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-2xl font-bold text-neuro-dark mb-4">
              Summary Metrics
            </h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Metric
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Value
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Description
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  <tr>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      Mean Alpha Change
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-800">
                      <span
                        className={
                          comparisonResult.summary_metrics.mean_alpha_change_percent > 0
                            ? 'text-green-600'
                            : 'text-red-600'
                        }
                      >
                        {comparisonResult.summary_metrics.mean_alpha_change_percent.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-800">
                      Average alpha power change (EC - EO)
                    </td>
                  </tr>
                  <tr>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      FAA Shift
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-800">
                      <span
                        className={
                          comparisonResult.summary_metrics.faa_shift > 0
                            ? 'text-green-600'
                            : 'text-red-600'
                        }
                      >
                        {comparisonResult.summary_metrics.faa_shift.toFixed(3)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-800">
                      Frontal alpha asymmetry change
                    </td>
                  </tr>
                  <tr>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      Theta/Beta Change
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-800">
                      <span
                        className={
                          comparisonResult.summary_metrics.theta_beta_change > 0
                            ? 'text-red-600'
                            : 'text-green-600'
                        }
                      >
                        {comparisonResult.summary_metrics.theta_beta_change.toFixed(3)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-800">
                      Theta/Beta ratio change (EC - EO)
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Power Deltas by Channel */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-2xl font-bold text-neuro-dark mb-4">
              Power Changes by Channel (EC - EO)
            </h2>
            <p className="text-sm text-gray-800 mb-4">
              Percent change in band power from Eyes Open to Eyes Closed
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Channel
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Delta
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Theta
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Alpha1
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Alpha2
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      SMR
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Beta2
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      HiBeta
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      LowGamma
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {Object.keys(comparisonResult.power_deltas.percent).map((channel) => (
                    <tr key={channel}>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                        {channel}
                      </td>
                      {['delta', 'theta', 'alpha1', 'alpha2', 'smr', 'beta2', 'hibeta', 'lowgamma'].map(
                        (band) => {
                          const value = comparisonResult.power_deltas.percent[channel]?.[band] || 0;
                          return (
                            <td key={band} className="px-4 py-3 whitespace-nowrap text-sm">
                              <span
                                className={
                                  value > 0
                                    ? 'text-green-600'
                                    : value < 0
                                    ? 'text-red-600'
                                    : 'text-gray-800'
                                }
                              >
                                {value > 0 ? '+' : ''}
                                {value.toFixed(1)}%
                              </span>
                            </td>
                          );
                        }
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Coherence Deltas */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-2xl font-bold text-neuro-dark mb-4">
              Coherence Changes (EC - EO)
            </h2>
            <p className="text-sm text-gray-800 mb-4">
              Change in coherence between channel pairs
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Channel Pair
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Delta
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Theta
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Alpha1
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Alpha2
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      SMR
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Beta2
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      HiBeta
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      LowGamma
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {Object.keys(comparisonResult.coherence_deltas).map((pairKey) => (
                    <tr key={pairKey}>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                        {pairKey}
                      </td>
                      {['delta', 'theta', 'alpha1', 'alpha2', 'smr', 'beta2', 'hibeta', 'lowgamma'].map(
                        (band) => {
                          const value = comparisonResult.coherence_deltas[pairKey]?.[band] || 0;
                          return (
                            <td key={band} className="px-4 py-3 whitespace-nowrap text-sm">
                              <span
                                className={
                                  value > 0
                                    ? 'text-green-600'
                                    : value < 0
                                    ? 'text-red-600'
                                    : 'text-gray-800'
                                }
                              >
                                {value > 0 ? '+' : ''}
                                {value.toFixed(3)}
                              </span>
                            </td>
                          );
                        }
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
