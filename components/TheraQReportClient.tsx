'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  THERAQ_PHASES,
  THERAQ_PHASE_LABELS,
  THERAQ_INDEX_LABELS,
  THERAQ_COLOUR_HEX,
  detectTheraqPhase,
  type TheraqPhase,
  type ProjectAnalysis,
  type TheraqMetricResult,
  type TheraqIndexResult,
} from '@/lib/theraq';

interface TheraqRecording {
  id: string;
  filename: string;
  phase: TheraqPhase | null;
}

interface TheraQReportClientProps {
  projectId: string;
  recordings: TheraqRecording[];
  onRecordingsChanged: () => void;
}

const TAG_GROUPS: Array<{ key: string; label: string }> = [
  { key: 'posterior', label: 'Posterior (O1)' },
  { key: 'central', label: 'Central (Cz)' },
  { key: 'anterior', label: 'Anterior (F3 / F4)' },
  { key: 'symmetry', label: 'Frontal Symmetry' },
];

function formatValue(metric: TheraqMetricResult): string {
  if (metric.value === null || Number.isNaN(metric.value)) return '—';
  if (metric.display === 'percent') return `${metric.value.toFixed(1)}%`;
  return metric.value.toFixed(2);
}

function MetricRow({ metric }: { metric: TheraqMetricResult }) {
  const lows = metric.norms.map((n) => n.range[0]);
  const highs = metric.norms.map((n) => n.range[1]);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = max - min || 1;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - min) / span) * 100));
  const dot = metric.colour ? THERAQ_COLOUR_HEX[metric.colour] : '#9CA3AF';

  return (
    <div className="py-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-800">{metric.name}</span>
        <span className="flex items-center gap-2 font-medium text-gray-900">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: dot }} />
          {formatValue(metric)}
        </span>
      </div>
      <div className="relative mt-1 h-2 w-full overflow-hidden rounded bg-gray-100">
        {metric.norms.map((n, i) => {
          const colour = 'colour' in n ? n.colour : undefined;
          const left = pct(n.range[0]);
          const width = pct(n.range[1]) - left;
          return (
            <div
              key={i}
              className="absolute top-0 h-full opacity-70"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                backgroundColor: colour ? THERAQ_COLOUR_HEX[colour] : '#D1D5DB',
              }}
            />
          );
        })}
        {metric.value !== null && !Number.isNaN(metric.value) && (
          <div
            className="absolute top-[-2px] h-3 w-0.5 bg-gray-900"
            style={{ left: `${pct(metric.value)}%` }}
          />
        )}
      </div>
    </div>
  );
}

function IndexGauge({ id, index }: { id: string; index: TheraqIndexResult }) {
  const score = index.score ?? 0;
  const colour = index.colour ? THERAQ_COLOUR_HEX[index.colour] : '#9CA3AF';
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-900">
          {THERAQ_INDEX_LABELS[id] || id}
        </h4>
        <span className="text-lg font-bold" style={{ color: colour }}>
          {index.score === null ? '—' : score.toFixed(1)}
          <span className="text-xs font-normal text-gray-500">/10</span>
        </span>
      </div>
      <div className="relative mt-2 h-3 w-full overflow-hidden rounded bg-gray-100">
        {/* band thresholds at 3.33 and 6.66 */}
        <div className="absolute inset-y-0 left-0 bg-green-100" style={{ width: '33.3%' }} />
        <div className="absolute inset-y-0 bg-yellow-100" style={{ left: '33.3%', width: '33.3%' }} />
        <div className="absolute inset-y-0 bg-red-100" style={{ left: '66.6%', width: '33.4%' }} />
        <div
          className="absolute top-0 h-full"
          style={{ width: `${(score / 10) * 100}%`, backgroundColor: colour, opacity: 0.85 }}
        />
      </div>
      <p className="mt-1 text-xs text-gray-500">{index.metrics.length} metrics</p>
    </div>
  );
}

export default function TheraQReportClient({
  projectId,
  recordings,
  onRecordingsChanged,
}: TheraQReportClientProps) {
  const [analysis, setAnalysis] = useState<ProjectAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyPhase, setBusyPhase] = useState<string | null>(null);

  // Which recording is assigned to each phase
  const phaseAssignment = useMemo(() => {
    const map: Record<TheraqPhase, TheraqRecording | null> = {
      EO1: null, EC: null, EO2: null, TASK: null,
    };
    for (const rec of recordings) {
      if (rec.phase && (THERAQ_PHASES as readonly string[]).includes(rec.phase)) {
        map[rec.phase] = rec;
      }
    }
    return map;
  }, [recordings]);

  const allPhasesAssigned = THERAQ_PHASES.every((p) => phaseAssignment[p]);

  const fetchAnalyses = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/theraq-analysis`);
      if (!res.ok) throw new Error('Failed to load TheraQ analyses');
      const data = await res.json();
      const latest: ProjectAnalysis | undefined = (data.analyses || [])[0];
      setAnalysis(latest || null);
      if (latest && (latest.status === 'pending' || latest.status === 'processing')) {
        setRunning(true);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchAnalyses();
  }, [fetchAnalyses]);

  // Poll while an analysis is processing
  useEffect(() => {
    if (!analysis || (analysis.status !== 'pending' && analysis.status !== 'processing')) {
      setRunning(false);
      return;
    }
    const interval = setInterval(async () => {
      const res = await fetch(`/api/projects/${projectId}/theraq-analysis/${analysis.id}`);
      if (res.ok) {
        const data = await res.json();
        setAnalysis(data.analysis);
        if (data.analysis.status === 'completed' || data.analysis.status === 'failed') {
          setRunning(false);
          clearInterval(interval);
        }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [analysis, projectId]);

  const setPhase = async (recordingId: string, phase: TheraqPhase | null) => {
    setBusyPhase(recordingId);
    setError(null);
    try {
      const res = await fetch(`/api/recordings/${recordingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || 'Failed to set phase');
      }
      onRecordingsChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyPhase(null);
    }
  };

  const autoAssign = async () => {
    for (const rec of recordings) {
      if (!rec.phase) {
        const detected = detectTheraqPhase(rec.filename);
        if (detected && !phaseAssignment[detected]) {
          await setPhase(rec.id, detected);
        }
      }
    }
  };

  const runAnalysis = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/theraq-analysis`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Failed to start analysis');
      }
      await fetchAnalyses();
    } catch (e: any) {
      setError(e.message);
      setRunning(false);
    }
  };

  const results = analysis?.status === 'completed' ? analysis.results : null;
  const metricsByTag = useMemo(() => {
    const grouped: Record<string, TheraqMetricResult[]> = {};
    for (const m of results?.metrics || []) {
      for (const tag of m.tags.length ? m.tags : ['other']) {
        (grouped[tag] ||= []).push(m);
      }
    }
    return grouped;
  }, [results]);

  if (loading) {
    return <div className="py-8 text-center text-gray-600">Loading TheraQ…</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-neuro-dark">TheraQ Four-Phase Analysis</h2>
        <p className="mt-1 text-sm text-gray-600">
          Compares four within-subject phases (EO1, EC, EO2, TASK) to compute alpha
          reactivity, flexibility, theta/beta ratios, task shifts, symmetry, and four
          dysregulation indices.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Phase assignment */}
      <div className="rounded-lg border border-gray-200">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h3 className="font-semibold text-gray-900">Phase assignment</h3>
          <button
            onClick={autoAssign}
            className="text-sm font-medium text-neuro-primary hover:text-neuro-accent"
          >
            Auto-assign from filenames
          </button>
        </div>
        <table className="min-w-full divide-y divide-gray-200">
          <tbody className="divide-y divide-gray-100">
            {THERAQ_PHASES.map((phase) => {
              const assigned = phaseAssignment[phase];
              return (
                <tr key={phase}>
                  <td className="px-4 py-2 text-sm font-medium text-gray-900">
                    {phase}
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      {THERAQ_PHASE_LABELS[phase]}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <select
                      value={assigned?.id || ''}
                      disabled={busyPhase !== null}
                      onChange={(e) => {
                        const recId = e.target.value;
                        // Clear any current holder, then assign
                        if (assigned && assigned.id !== recId) {
                          setPhase(assigned.id, null).then(() => {
                            if (recId) setPhase(recId, phase);
                          });
                        } else if (recId) {
                          setPhase(recId, phase);
                        } else if (assigned) {
                          setPhase(assigned.id, null);
                        }
                      }}
                      className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    >
                      <option value="">— Unassigned —</option>
                      {recordings.map((rec) => (
                        <option key={rec.id} value={rec.id}>
                          {rec.filename}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {assigned ? (
                      <span className="text-green-600 text-sm">✓</span>
                    ) : (
                      <span className="text-yellow-600 text-sm">⚠ missing</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-500">
            {allPhasesAssigned
              ? 'All four phases assigned — ready to run.'
              : 'Assign a recording to each phase to enable the analysis.'}
          </p>
          <button
            onClick={runAnalysis}
            disabled={!allPhasesAssigned || running}
            className="rounded-lg bg-neuro-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neuro-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? 'Analyzing…' : 'Run TheraQ Analysis'}
          </button>
        </div>
      </div>

      {/* Status / results */}
      {analysis && analysis.status === 'processing' && (
        <div className="rounded-md bg-blue-50 p-4 text-sm text-blue-700">
          <div className="inline-block h-4 w-4 animate-spin rounded-full border-b-2 border-blue-600" />
          <span className="ml-2">Processing four phases… this can take a couple of minutes.</span>
        </div>
      )}

      {analysis && analysis.status === 'failed' && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          <p className="font-medium">Analysis failed</p>
          <p className="mt-1">{analysis.error_log}</p>
        </div>
      )}

      {results && (
        <div className="space-y-6">
          {/* Dysregulation indices */}
          <div>
            <h3 className="mb-3 font-semibold text-gray-900">Dysregulation Indices</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {Object.entries(results.indices).map(([id, index]) => (
                <IndexGauge key={id} id={id} index={index} />
              ))}
            </div>
          </div>

          {/* Metrics grouped by region */}
          <div>
            <h3 className="mb-3 font-semibold text-gray-900">Comparative Metrics</h3>
            <div className="space-y-5">
              {TAG_GROUPS.map(({ key, label }) => {
                const items = metricsByTag[key];
                if (!items || items.length === 0) return null;
                return (
                  <div key={key} className="rounded-lg border border-gray-200 p-4">
                    <h4 className="mb-2 text-sm font-semibold text-gray-700">{label}</h4>
                    <div className="divide-y divide-gray-100">
                      {items.map((m) => (
                        <MetricRow key={m.name} metric={m} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* QC per phase */}
          <div className="rounded-lg border border-gray-200 p-4">
            <h4 className="mb-2 text-sm font-semibold text-gray-700">Per-phase quality</h4>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {Object.entries(results.phases).map(([phase, qc]) => (
                <div key={phase} className="text-sm">
                  <div className="font-medium text-gray-900">{phase}</div>
                  <div className="text-gray-600">{qc.clean_epochs} clean epochs</div>
                  <div className="text-gray-500 text-xs">
                    {qc.artifact_rejection_rate.toFixed(0)}% rejected
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-800">{results.disclaimer}</p>
        </div>
      )}
    </div>
  );
}
