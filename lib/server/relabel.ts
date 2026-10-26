import 'server-only';
// A recording with no EO/EC labels is analyzed as one whole-recording segment, which the engine
// files under `eo`. When the recording's own condition (its labels, or its filename token) is EC,
// the results are relabelled here on read, so the analysis view, comparisons and the MCP tools all
// show them under the right condition until the analysis is re-run with the label.

import type { AnalysisResults, Condition } from '@/lib/analysis-results';
import { recordingCondition } from '@/lib/eeg-condition';

type Keyed<T> = Partial<Record<Condition, T>> | null | undefined;

const PER_CONDITION = ['band_power', 'connectivity', 'lzc', 'alpha_peak', 'psd', 'spectrograms', 'mu_morphology', 'paroxysmal_slowing', 'variant_screens', 'segments'] as const;

const has = (v: unknown) => v != null && !(typeof v === 'object' && Object.keys(v as object).length === 0);

function swapKeys<T>(rec: Keyed<T>, from: Condition, to: Condition): Keyed<T> {
  if (!rec) return rec;
  return { ...rec, [from]: null, [to]: rec[from] } as Keyed<T>;
}

/**
 * Results relabelled to `condition` when they hold data only under the other condition; otherwise
 * the same object. `condition` 'BOTH' (or anything else) leaves results untouched.
 */
export function relabelToCondition(results: AnalysisResults | null, condition: string): AnalysisResults | null {
  if (!results || (condition !== 'EO' && condition !== 'EC')) return results;
  const to: Condition = condition === 'EO' ? 'eo' : 'ec';
  const from: Condition = to === 'eo' ? 'ec' : 'eo';
  const bp = results.band_power as Keyed<unknown>;
  if (!bp || has(bp[to]) || !has(bp[from])) return results;

  const out = { ...results } as AnalysisResults & Record<string, unknown>;
  for (const k of PER_CONDITION) {
    if (out[k]) (out as Record<string, unknown>)[k] = swapKeys(out[k] as Keyed<unknown>, from, to);
  }
  if (out.segments) delete (out.segments as Record<string, unknown>)[from];

  const qc = results.qc_report as (AnalysisResults['qc_report'] & Record<string, unknown>) | undefined;
  if (qc) {
    const fixed: Record<string, unknown> = { ...qc, [`final_epochs_${to}`]: qc[`final_epochs_${from}`], [`final_epochs_${from}`]: 0 };
    delete fixed[`${from}_rejection_rate`];
    if (qc[`${from}_rejection_rate`] !== undefined) fixed[`${to}_rejection_rate`] = qc[`${from}_rejection_rate`];
    out.qc_report = fixed as unknown as AnalysisResults['qc_report'];
  }

  if (Array.isArray(results.rejected_epochs)) {
    out.rejected_epochs = results.rejected_epochs.map((e) => (e.condition === from ? { ...e, condition: to } : e));
  }

  const sl = results.sloreta;
  if (sl) {
    out.sloreta = {
      ...sl,
      conditions: (sl.conditions ?? []).map((c) => (c === from ? to : c)),
      epochs_used: swapKeys(sl.epochs_used, from, to) ?? {},
      stats: swapKeys(sl.stats, from, to) ?? {},
      ...(sl.timeline ? { timeline: { ...sl.timeline, segments: swapKeys(sl.timeline.segments, from, to) ?? {} } } : {}),
    } as typeof sl;
    // swapKeys leaves an explicit null under `from`; these two maps are Partial, so drop it
    delete (out.sloreta.epochs_used as Record<string, unknown>)[from];
    delete (out.sloreta.stats as Record<string, unknown>)[from];
    if (out.sloreta.timeline) delete (out.sloreta.timeline.segments as Record<string, unknown>)[from];
  }

  return out;
}

/** An analysis row with its results relabelled to its recording's condition (see above). */
export function withRecordingCondition<A extends { results?: unknown }>(
  analysis: A,
  recording: Parameters<typeof recordingCondition>[0] | null | undefined
): A {
  if (!recording || !analysis.results) return analysis;
  const results = relabelToCondition(analysis.results as AnalysisResults, recordingCondition(recording));
  return results === analysis.results ? analysis : { ...analysis, results };
}
