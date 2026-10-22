// Metric trend across sessions for get_metric_trend: one value per session and metric, ascending
// by date. A metric a session does not have is null, never omitted, so gaps stay visible.

import { isNum, sig3 } from './num';
import type { Confidence } from './quality';
import { unavailableText, type SessionSummary } from './summary';

export const TREND_METRICS = [
  'theta_beta_frontal',
  'theta_beta_central',
  'faa',
  'alpha_peak_eo',
  'alpha_peak_ec',
  'alpha_reactivity',
  'rel_alpha_occipital_ec',
  'rel_theta_frontal_eo',
  'lzc_mean_eo',
  'lzc_mean_ec',
  'rejection_pct',
] as const;
export type TrendMetric = (typeof TREND_METRICS)[number];

export interface TrendPoint {
  session_id: string;
  date: string;
  value: number | null;
  confidence: Confidence;
  /** set when the value is null because part of the session is unavailable (older engine, pending, ...) */
  unavailable?: true;
  reason?: string;
}

const MAX_SESSIONS = 20;

/** Ratios and asymmetry are per source: the EC analysis if present, else EO, else a combined one. */
function preferred<T>(by: Partial<Record<'eo' | 'ec' | 'both', T>> | undefined): T | undefined {
  return by?.ec ?? by?.eo ?? by?.both;
}

function valueOf(s: SessionSummary, metric: TrendMetric): number | null {
  const num = (v: unknown) => (isNum(v) ? sig3(v) : null);
  const { eo, ec } = s.conditions;
  switch (metric) {
    case 'theta_beta_frontal':
      return num(preferred(s.ratios)?.theta_beta_ratio.frontal_avg);
    case 'theta_beta_central':
      return num(preferred(s.ratios)?.theta_beta_ratio.central_avg);
    case 'faa':
      return num(preferred(s.asymmetry)?.frontal_alpha);
    case 'alpha_peak_eo':
      return num(eo?.alpha_peak.mean_hz);
    case 'alpha_peak_ec':
      return num(ec?.alpha_peak.mean_hz);
    case 'alpha_reactivity':
      return num(s.eo_ec_reactivity?.occipital_alpha_change_pct);
    case 'rel_alpha_occipital_ec': {
      const o = ec?.band_power.by_region.occipital;
      return o ? num(o.alpha1.rel + o.alpha2.rel) : null;
    }
    case 'rel_theta_frontal_eo':
      return num(eo?.band_power.by_region.frontal?.theta.rel);
    case 'lzc_mean_eo':
      return num(eo?.lzc.mean_normalized);
    case 'lzc_mean_ec':
      return num(ec?.lzc.mean_normalized);
    case 'rejection_pct': {
      const r = [s.quality.eo?.rejection_pct, s.quality.ec?.rejection_pct].filter(isNum);
      return r.length ? num(Math.max(...r)) : null;
    }
  }
}

export function buildTrend(
  summaries: SessionSummary[],
  metrics: TrendMetric[],
  lastN: number,
): { metric: TrendMetric; points: TrendPoint[] }[] {
  const n = Math.min(Math.max(Math.trunc(Number.isFinite(lastN) ? lastN : MAX_SESSIONS), 1), MAX_SESSIONS);
  const picked = [...summaries]
    .sort((x, y) => Date.parse(x.session.date) - Date.parse(y.session.date))
    .slice(-n);
  return metrics.map((metric) => ({
    metric,
    points: picked.map((s) => {
      const value = valueOf(s, metric);
      const point: TrendPoint = { session_id: s.session.id, date: s.session.date, value, confidence: s.quality.confidence };
      if (value === null && s.unavailable?.length) {
        point.unavailable = true;
        point.reason = [...new Set(s.unavailable.map((u) => unavailableText(u.reason)))].join('; ');
      }
      return point;
    }),
  }));
}
