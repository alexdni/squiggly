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

interface EOECInterpretationContent {
  summary: string;
  alpha_reactivity: string;
  arousal_shift: string;
  theta_beta_dynamics: string;
  complexity_shift: string;
  network_connectivity: string;
  alpha_topography: string;
  individual_alpha_frequency: string;
  possible_clinical_correlations: string;
  observations: string;
}

interface EOECInterpretation {
  generated_at: string;
  model: string;
  eo_recording_id: string;
  ec_recording_id: string;
  content: EOECInterpretationContent;
}

interface AnalysisVisuals {
  topomap_grid?: string;
  lzc_topomap_EO?: string;
  lzc_topomap_EC?: string;
  connectivity_grid?: string;
  network_metrics?: string;
  spectrogram_EO?: string;
  spectrogram_EC?: string;
  alpha_peak_topomap_EO?: string;
  alpha_peak_topomap_EC?: string;
}

interface ComparisonVisuals {
  eo: AnalysisVisuals;
  ec: AnalysisVisuals;
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

  // AI Interpretation state
  const [aiInterpretation, setAiInterpretation] = useState<EOECInterpretation | null>(null);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Visual comparisons state
  const [comparisonVisuals, setComparisonVisuals] = useState<ComparisonVisuals | null>(null);

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

      // Set visual comparisons if available
      if (data.visuals) {
        setComparisonVisuals(data.visuals);
      }

      // Try to fetch cached AI interpretation
      fetchCachedAIInterpretation(eoRecId, ecRecId);
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

  const fetchCachedAIInterpretation = async (eoId: string, ecId: string) => {
    try {
      const response = await fetch(
        `/api/projects/${projectId}/compare/ai-interpretation?eo_id=${eoId}&ec_id=${ecId}`
      );
      if (response.ok) {
        const data = await response.json();
        setAiInterpretation(data.interpretation);
      }
    } catch (err) {
      // Silently fail - no cached interpretation available
    }
  };

  const handleGenerateAIInterpretation = async () => {
    if (!selectedEoId || !selectedEcId) return;

    setIsGeneratingAI(true);
    setAiError(null);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/compare/ai-interpretation`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            eo_id: selectedEoId,
            ec_id: selectedEcId,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate AI interpretation');
      }

      const data = await response.json();
      setAiInterpretation(data.interpretation);
    } catch (err: any) {
      console.error('Error generating AI interpretation:', err);
      setAiError(err.message || 'Failed to generate AI interpretation');
    } finally {
      setIsGeneratingAI(false);
    }
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

          {/* Visual Comparisons Section */}
          {comparisonVisuals && (comparisonVisuals.eo.topomap_grid || comparisonVisuals.ec.topomap_grid ||
            comparisonVisuals.eo.connectivity_grid || comparisonVisuals.ec.connectivity_grid ||
            comparisonVisuals.eo.lzc_topomap_EO || comparisonVisuals.ec.lzc_topomap_EC) && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-2xl font-bold text-neuro-dark mb-4">
                Visual Comparisons: EO vs EC
              </h2>
              <p className="text-sm text-gray-800 mb-6">
                Side-by-side visualizations showing differences between Eyes Open (EO) and Eyes Closed (EC) conditions.
              </p>

              {/* Topographic Maps Comparison */}
              {(comparisonVisuals.eo.topomap_grid || comparisonVisuals.ec.topomap_grid) && (
                <div className="mb-8">
                  <h3 className="text-xl font-semibold text-gray-900 mb-4 border-b pb-2">
                    Band Power Topographic Maps
                  </h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Spatial distribution of power across frequency bands for each recording.
                  </p>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {comparisonVisuals.eo.topomap_grid && (
                      <div className="border border-blue-200 rounded-lg p-4 bg-blue-50">
                        <h4 className="text-lg font-semibold text-blue-900 mb-3 text-center">
                          EO Recording
                        </h4>
                        <div className="bg-white rounded border border-gray-200 overflow-hidden">
                          <img
                            src={comparisonVisuals.eo.topomap_grid}
                            alt="EO Band Power Topographic Maps"
                            className="w-full h-auto"
                          />
                        </div>
                      </div>
                    )}
                    {comparisonVisuals.ec.topomap_grid && (
                      <div className="border border-green-200 rounded-lg p-4 bg-green-50">
                        <h4 className="text-lg font-semibold text-green-900 mb-3 text-center">
                          EC Recording
                        </h4>
                        <div className="bg-white rounded border border-gray-200 overflow-hidden">
                          <img
                            src={comparisonVisuals.ec.topomap_grid}
                            alt="EC Band Power Topographic Maps"
                            className="w-full h-auto"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* LZC Complexity Comparison */}
              {((comparisonVisuals.eo.lzc_topomap_EO || comparisonVisuals.eo.lzc_topomap_EC) ||
                (comparisonVisuals.ec.lzc_topomap_EO || comparisonVisuals.ec.lzc_topomap_EC)) && (
                <div className="mb-8">
                  <h3 className="text-xl font-semibold text-gray-900 mb-4 border-b pb-2">
                    Signal Complexity (Lempel-Ziv)
                  </h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Higher LZC (red) indicates more complex signals. Lower LZC (blue) indicates more regular patterns.
                    Complexity typically decreases in EC as alpha rhythms become more dominant.
                  </p>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* EO Recording LZC */}
                    {(comparisonVisuals.eo.lzc_topomap_EO || comparisonVisuals.eo.lzc_topomap_EC) && (
                      <div className="border border-blue-200 rounded-lg p-4 bg-blue-50">
                        <h4 className="text-lg font-semibold text-blue-900 mb-3 text-center">
                          EO Recording
                        </h4>
                        <div className="grid grid-cols-2 gap-4">
                          {comparisonVisuals.eo.lzc_topomap_EO && (
                            <div>
                              <p className="text-sm text-gray-600 mb-2 text-center">Eyes Open</p>
                              <div className="bg-white rounded border border-gray-200 overflow-hidden">
                                <img
                                  src={comparisonVisuals.eo.lzc_topomap_EO}
                                  alt="EO Recording - LZC Eyes Open"
                                  className="w-full h-auto"
                                />
                              </div>
                            </div>
                          )}
                          {comparisonVisuals.eo.lzc_topomap_EC && (
                            <div>
                              <p className="text-sm text-gray-600 mb-2 text-center">Eyes Closed</p>
                              <div className="bg-white rounded border border-gray-200 overflow-hidden">
                                <img
                                  src={comparisonVisuals.eo.lzc_topomap_EC}
                                  alt="EO Recording - LZC Eyes Closed"
                                  className="w-full h-auto"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {/* EC Recording LZC */}
                    {(comparisonVisuals.ec.lzc_topomap_EO || comparisonVisuals.ec.lzc_topomap_EC) && (
                      <div className="border border-green-200 rounded-lg p-4 bg-green-50">
                        <h4 className="text-lg font-semibold text-green-900 mb-3 text-center">
                          EC Recording
                        </h4>
                        <div className="grid grid-cols-2 gap-4">
                          {comparisonVisuals.ec.lzc_topomap_EO && (
                            <div>
                              <p className="text-sm text-gray-600 mb-2 text-center">Eyes Open</p>
                              <div className="bg-white rounded border border-gray-200 overflow-hidden">
                                <img
                                  src={comparisonVisuals.ec.lzc_topomap_EO}
                                  alt="EC Recording - LZC Eyes Open"
                                  className="w-full h-auto"
                                />
                              </div>
                            </div>
                          )}
                          {comparisonVisuals.ec.lzc_topomap_EC && (
                            <div>
                              <p className="text-sm text-gray-600 mb-2 text-center">Eyes Closed</p>
                              <div className="bg-white rounded border border-gray-200 overflow-hidden">
                                <img
                                  src={comparisonVisuals.ec.lzc_topomap_EC}
                                  alt="EC Recording - LZC Eyes Closed"
                                  className="w-full h-auto"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Brain Connectivity Comparison */}
              {(comparisonVisuals.eo.connectivity_grid || comparisonVisuals.ec.connectivity_grid) && (
                <div className="mb-8">
                  <h3 className="text-xl font-semibold text-gray-900 mb-4 border-b pb-2">
                    Brain Connectivity (wPLI)
                  </h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Weighted Phase Lag Index connectivity between electrode sites. Line color and thickness indicate connection strength.
                    Alpha connectivity typically increases in EC (relaxed, synchronized state).
                  </p>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {comparisonVisuals.eo.connectivity_grid && (
                      <div className="border border-blue-200 rounded-lg p-4 bg-blue-50">
                        <h4 className="text-lg font-semibold text-blue-900 mb-3 text-center">
                          EO Recording
                        </h4>
                        <div className="bg-white rounded border border-gray-200 overflow-hidden">
                          <img
                            src={comparisonVisuals.eo.connectivity_grid}
                            alt="EO Brain Connectivity"
                            className="w-full h-auto"
                          />
                        </div>
                      </div>
                    )}
                    {comparisonVisuals.ec.connectivity_grid && (
                      <div className="border border-green-200 rounded-lg p-4 bg-green-50">
                        <h4 className="text-lg font-semibold text-green-900 mb-3 text-center">
                          EC Recording
                        </h4>
                        <div className="bg-white rounded border border-gray-200 overflow-hidden">
                          <img
                            src={comparisonVisuals.ec.connectivity_grid}
                            alt="EC Brain Connectivity"
                            className="w-full h-auto"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Network Metrics Comparison */}
              {(comparisonVisuals.eo.network_metrics || comparisonVisuals.ec.network_metrics) && (
                <div className="mb-8">
                  <h3 className="text-xl font-semibold text-gray-900 mb-4 border-b pb-2">
                    Network Metrics
                  </h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Graph-theoretic metrics comparing EO vs EC. Global efficiency measures integration,
                    clustering coefficient measures local processing, small-worldness indicates optimal network organization.
                  </p>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {comparisonVisuals.eo.network_metrics && (
                      <div className="border border-blue-200 rounded-lg p-4 bg-blue-50">
                        <h4 className="text-lg font-semibold text-blue-900 mb-3 text-center">
                          EO Recording
                        </h4>
                        <div className="bg-white rounded border border-gray-200 overflow-hidden">
                          <img
                            src={comparisonVisuals.eo.network_metrics}
                            alt="EO Network Metrics"
                            className="w-full h-auto"
                          />
                        </div>
                      </div>
                    )}
                    {comparisonVisuals.ec.network_metrics && (
                      <div className="border border-green-200 rounded-lg p-4 bg-green-50">
                        <h4 className="text-lg font-semibold text-green-900 mb-3 text-center">
                          EC Recording
                        </h4>
                        <div className="bg-white rounded border border-gray-200 overflow-hidden">
                          <img
                            src={comparisonVisuals.ec.network_metrics}
                            alt="EC Network Metrics"
                            className="w-full h-auto"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Individual Alpha Frequency Comparison */}
              {((comparisonVisuals.eo.alpha_peak_topomap_EO || comparisonVisuals.eo.alpha_peak_topomap_EC) ||
                (comparisonVisuals.ec.alpha_peak_topomap_EO || comparisonVisuals.ec.alpha_peak_topomap_EC)) && (
                <div className="mb-8">
                  <h3 className="text-xl font-semibold text-gray-900 mb-4 border-b pb-2">
                    Individual Alpha Frequency (IAF)
                  </h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Peak alpha frequency (8-12 Hz) at each electrode site. Higher IAF is associated with
                    better cognitive performance and neural efficiency.
                  </p>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* EO Recording IAF */}
                    {(comparisonVisuals.eo.alpha_peak_topomap_EO || comparisonVisuals.eo.alpha_peak_topomap_EC) && (
                      <div className="border border-blue-200 rounded-lg p-4 bg-blue-50">
                        <h4 className="text-lg font-semibold text-blue-900 mb-3 text-center">
                          EO Recording
                        </h4>
                        <div className="space-y-4">
                          {comparisonVisuals.eo.alpha_peak_topomap_EO && (
                            <div>
                              <p className="text-sm text-gray-600 mb-2 text-center">Eyes Open</p>
                              <div className="bg-white rounded border border-gray-200 overflow-hidden">
                                <img
                                  src={comparisonVisuals.eo.alpha_peak_topomap_EO}
                                  alt="EO Recording - IAF Eyes Open"
                                  className="w-full h-auto"
                                />
                              </div>
                            </div>
                          )}
                          {comparisonVisuals.eo.alpha_peak_topomap_EC && (
                            <div>
                              <p className="text-sm text-gray-600 mb-2 text-center">Eyes Closed</p>
                              <div className="bg-white rounded border border-gray-200 overflow-hidden">
                                <img
                                  src={comparisonVisuals.eo.alpha_peak_topomap_EC}
                                  alt="EO Recording - IAF Eyes Closed"
                                  className="w-full h-auto"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {/* EC Recording IAF */}
                    {(comparisonVisuals.ec.alpha_peak_topomap_EO || comparisonVisuals.ec.alpha_peak_topomap_EC) && (
                      <div className="border border-green-200 rounded-lg p-4 bg-green-50">
                        <h4 className="text-lg font-semibold text-green-900 mb-3 text-center">
                          EC Recording
                        </h4>
                        <div className="space-y-4">
                          {comparisonVisuals.ec.alpha_peak_topomap_EO && (
                            <div>
                              <p className="text-sm text-gray-600 mb-2 text-center">Eyes Open</p>
                              <div className="bg-white rounded border border-gray-200 overflow-hidden">
                                <img
                                  src={comparisonVisuals.ec.alpha_peak_topomap_EO}
                                  alt="EC Recording - IAF Eyes Open"
                                  className="w-full h-auto"
                                />
                              </div>
                            </div>
                          )}
                          {comparisonVisuals.ec.alpha_peak_topomap_EC && (
                            <div>
                              <p className="text-sm text-gray-600 mb-2 text-center">Eyes Closed</p>
                              <div className="bg-white rounded border border-gray-200 overflow-hidden">
                                <img
                                  src={comparisonVisuals.ec.alpha_peak_topomap_EC}
                                  alt="EC Recording - IAF Eyes Closed"
                                  className="w-full h-auto"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* AI Analysis Section */}
          <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-lg shadow-md p-6 border border-purple-200">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <svg
                    className="w-6 h-6 text-purple-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                    />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-purple-900">
                  AI Analysis - EO to EC Transition
                </h2>
              </div>
              <div className="flex gap-2">
                {aiInterpretation && (
                  <button
                    onClick={handleGenerateAIInterpretation}
                    disabled={isGeneratingAI}
                    className="bg-white text-purple-700 px-4 py-2 rounded-lg hover:bg-purple-50 transition-colors font-medium border border-purple-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Regenerate
                  </button>
                )}
                {!aiInterpretation && (
                  <button
                    onClick={handleGenerateAIInterpretation}
                    disabled={isGeneratingAI}
                    className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {isGeneratingAI ? (
                      <>
                        <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        Generating...
                      </>
                    ) : (
                      'Generate AI Analysis'
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Disclaimer */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
              <p className="text-amber-800 text-sm">
                <strong>Disclaimer:</strong> This AI-generated interpretation is for educational purposes only and should not be used for clinical diagnosis or treatment decisions. Always consult a qualified healthcare professional for medical advice.
              </p>
            </div>

            {/* Loading State */}
            {isGeneratingAI && (
              <div className="text-center py-8">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
                <p className="mt-4 text-purple-800">
                  Analyzing EO to EC transition patterns...
                </p>
              </div>
            )}

            {/* Error State */}
            {aiError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <p className="text-red-800">{aiError}</p>
              </div>
            )}

            {/* AI Interpretation Content */}
            {aiInterpretation && !isGeneratingAI && (
              <div className="space-y-6">
                <p className="text-xs text-purple-600">
                  Generated: {new Date(aiInterpretation.generated_at).toLocaleString()} | Model: {aiInterpretation.model}
                </p>

                {/* Summary */}
                {aiInterpretation.content.summary && (
                  <div className="bg-white rounded-lg p-4 border border-purple-100">
                    <h3 className="text-lg font-semibold text-purple-900 mb-2">Summary</h3>
                    <p className="text-gray-800 whitespace-pre-wrap">{aiInterpretation.content.summary}</p>
                  </div>
                )}

                {/* Alpha Reactivity */}
                {aiInterpretation.content.alpha_reactivity && (
                  <div className="bg-white rounded-lg p-4 border border-purple-100">
                    <h3 className="text-lg font-semibold text-purple-900 mb-2">Alpha Reactivity</h3>
                    <p className="text-gray-800 whitespace-pre-wrap">{aiInterpretation.content.alpha_reactivity}</p>
                  </div>
                )}

                {/* Arousal Shift */}
                {aiInterpretation.content.arousal_shift && (
                  <div className="bg-white rounded-lg p-4 border border-purple-100">
                    <h3 className="text-lg font-semibold text-purple-900 mb-2">Arousal Shift</h3>
                    <p className="text-gray-800 whitespace-pre-wrap">{aiInterpretation.content.arousal_shift}</p>
                  </div>
                )}

                {/* Theta/Beta Dynamics */}
                {aiInterpretation.content.theta_beta_dynamics && (
                  <div className="bg-white rounded-lg p-4 border border-purple-100">
                    <h3 className="text-lg font-semibold text-purple-900 mb-2">Theta/Beta Dynamics</h3>
                    <p className="text-gray-800 whitespace-pre-wrap">{aiInterpretation.content.theta_beta_dynamics}</p>
                  </div>
                )}

                {/* Complexity Shift */}
                {aiInterpretation.content.complexity_shift && (
                  <div className="bg-white rounded-lg p-4 border border-purple-100">
                    <h3 className="text-lg font-semibold text-purple-900 mb-2">Complexity Shift</h3>
                    <p className="text-gray-800 whitespace-pre-wrap">{aiInterpretation.content.complexity_shift}</p>
                  </div>
                )}

                {/* Network Connectivity */}
                {aiInterpretation.content.network_connectivity && (
                  <div className="bg-white rounded-lg p-4 border border-purple-100">
                    <h3 className="text-lg font-semibold text-purple-900 mb-2">Network Connectivity</h3>
                    <p className="text-gray-800 whitespace-pre-wrap">{aiInterpretation.content.network_connectivity}</p>
                  </div>
                )}

                {/* Alpha Topography */}
                {aiInterpretation.content.alpha_topography && (
                  <div className="bg-white rounded-lg p-4 border border-purple-100">
                    <h3 className="text-lg font-semibold text-purple-900 mb-2">Alpha Topography</h3>
                    <p className="text-gray-800 whitespace-pre-wrap">{aiInterpretation.content.alpha_topography}</p>
                  </div>
                )}

                {/* Individual Alpha Frequency */}
                {aiInterpretation.content.individual_alpha_frequency && (
                  <div className="bg-white rounded-lg p-4 border border-purple-100">
                    <h3 className="text-lg font-semibold text-purple-900 mb-2">Individual Alpha Frequency</h3>
                    <p className="text-gray-800 whitespace-pre-wrap">{aiInterpretation.content.individual_alpha_frequency}</p>
                  </div>
                )}

                {/* Possible Clinical Correlations */}
                {aiInterpretation.content.possible_clinical_correlations && (
                  <div className="bg-white rounded-lg p-4 border border-blue-200 bg-blue-50">
                    <h3 className="text-lg font-semibold text-blue-900 mb-2">Possible Clinical Correlations</h3>
                    <p className="text-gray-800 whitespace-pre-wrap">{aiInterpretation.content.possible_clinical_correlations}</p>
                    <p className="text-xs text-blue-600 mt-3 italic">Note: These are research-based associations, not diagnoses. Professional evaluation is recommended.</p>
                  </div>
                )}

                {/* Observations */}
                {aiInterpretation.content.observations && (
                  <div className="bg-white rounded-lg p-4 border border-purple-100">
                    <h3 className="text-lg font-semibold text-purple-900 mb-2">Observations</h3>
                    <p className="text-gray-800 whitespace-pre-wrap">{aiInterpretation.content.observations}</p>
                  </div>
                )}
              </div>
            )}

            {/* No interpretation yet */}
            {!aiInterpretation && !isGeneratingAI && (
              <div className="text-center py-8 text-purple-700">
                <p>Click &quot;Generate AI Analysis&quot; to get an expert interpretation of the EO to EC transition patterns.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
