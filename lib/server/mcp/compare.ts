// Condition-aware comparison of two session summaries (B minus A) for compare_sessions. Strictly
// like-for-like: EO against EO, EC against EC. Output is EEG numbers and caveats only; the single
// engine detail allowed is the bare version string (after '@') when the two versions differ.

import { BAND_NAMES, type BandName } from '@/lib/analysis-results';
import { isNum, sig3 } from './num';
import { stepDown, worse, type Confidence } from './quality';
import type { ConditionSummary, SessionSummary } from './summary';

type Cond = 'eo' | 'ec';
type Source = Cond | 'both';

export interface ConditionDelta {
  region_deltas: Record<string, Partial<Record<BandName, { abs_pct: number; rel_delta: number }>>>;
  top_channel_changes: { channel: string; band: BandName; abs_pct: number }[];
  alpha_peak_delta_hz?: number;
  lzc_delta?: number;
}

export interface SessionComparison {
  a: { id: string; date: string; conditions: Cond[]; quality: SessionSummary['quality'] };
  b: { id: string; date: string; conditions: Cond[]; quality: SessionSummary['quality'] };
  /** whole days between the session dates (absolute). B is expected to be the later session */
  days_between: number | null;
  confidence: Confidence;
  caveats: string[];
  engine_versions?: { a: string; b: string };
  conditions: Partial<Record<Cond, ConditionDelta>>;
  ratio_deltas: Partial<Record<Source, Record<string, number>>>;
  asymmetry_deltas: Partial<Record<Source, Record<string, number>>>;
  risk_pattern_flips: { pattern: string; from: boolean; to: boolean; condition: Source }[];
  reactivity_delta?: { occipital_alpha_change_pct: number; posterior_alpha_change_pct: number };
}

const TOP_CHANNEL_CHANGES = 10;
const DAY_MS = 86_400_000;
const CROSS_SOURCE_CAVEAT = 'ratios compared across a combined EO/EC file and a single-condition file';

/** Substring after the last '@', restricted to version characters; the whole string if no '@'. */
function bareVersion(engine: string): string {
  const at = engine.lastIndexOf('@');
  return (at >= 0 ? engine.slice(at + 1) : engine).replace(/[^0-9A-Za-z.+-]/g, '');
}

/** Distinct non-null values of a recording field across the session, as one comparable key. */
function recordingKey(s: SessionSummary, field: 'montage' | 'sampling_rate'): string {
  const vals = s.session.recordings.map((r) => r[field]).filter((v) => v !== null);
  return [...new Set(vals.map(String))].sort().join(',');
}

/** B/A percent change in a value; undefined when A is not positive. */
function pct(a: number, b: number): number | undefined {
  return isNum(a) && isNum(b) && a > 0 ? sig3(((b - a) / a) * 100) : undefined;
}

const delta = (a: number | null | undefined, b: number | null | undefined): number | undefined =>
  isNum(a) && isNum(b) ? sig3(b - a) : undefined;

function conditionDelta(a: ConditionSummary, b: ConditionSummary): ConditionDelta {
  const region_deltas: ConditionDelta['region_deltas'] = {};
  for (const [region, bandsA] of Object.entries(a.band_power.by_region)) {
    const bandsB = (b.band_power.by_region as Record<string, typeof bandsA | undefined>)[region];
    if (!bandsB) continue;
    const out: Partial<Record<BandName, { abs_pct: number; rel_delta: number }>> = {};
    for (const band of BAND_NAMES) {
      const abs_pct = pct(bandsA[band]?.abs, bandsB[band]?.abs);
      const rel_delta = delta(bandsA[band]?.rel, bandsB[band]?.rel);
      if (abs_pct !== undefined && rel_delta !== undefined) out[band] = { abs_pct, rel_delta };
    }
    if (Object.keys(out).length) region_deltas[region] = out;
  }

  const changes: ConditionDelta['top_channel_changes'] = [];
  for (const [channel, bandsA] of Object.entries(a.band_power.by_channel)) {
    const bandsB = b.band_power.by_channel[channel];
    if (!bandsB) continue;
    for (const band of BAND_NAMES) {
      const abs_pct = pct(bandsA[band]?.[0], bandsB[band]?.[0]);
      if (abs_pct !== undefined) changes.push({ channel, band, abs_pct });
    }
  }
  changes.sort((x, y) => Math.abs(y.abs_pct) - Math.abs(x.abs_pct));

  const out: ConditionDelta = { region_deltas, top_channel_changes: changes.slice(0, TOP_CHANNEL_CHANGES) };
  const peak = delta(a.alpha_peak.mean_hz, b.alpha_peak.mean_hz);
  if (peak !== undefined) out.alpha_peak_delta_hz = peak;
  const lzc = delta(a.lzc.mean_normalized, b.lzc.mean_normalized);
  if (lzc !== undefined) out.lzc_delta = lzc;
  return out;
}

/**
 * Which per-source entries to compare. Same-condition sources match directly. Only when none do,
 * a combined 'both' source stands in for the other side's condition (EC first), or two 'both'
 * sources match each other; `cross` is set when a combined file met a single-condition one.
 */
function matchSources(a: Partial<Record<Source, unknown>> | undefined, b: Partial<Record<Source, unknown>> | undefined) {
  const pairs: { key: Source; a: Source; b: Source }[] = [];
  let cross = false;
  if (!a || !b) return { pairs, cross };
  for (const c of ['eo', 'ec'] as const) if (a[c] && b[c]) pairs.push({ key: c, a: c, b: c });
  if (pairs.length) return { pairs, cross };
  if (a.both && b.both) {
    pairs.push({ key: 'both', a: 'both', b: 'both' });
  } else if (a.both) {
    const c = b.ec ? 'ec' : b.eo ? 'eo' : null;
    if (c) pairs.push({ key: c, a: 'both', b: c });
    cross = c !== null;
  } else if (b.both) {
    const c = a.ec ? 'ec' : a.eo ? 'eo' : null;
    if (c) pairs.push({ key: c, a: c, b: 'both' });
    cross = c !== null;
  }
  return { pairs, cross };
}

function numericDeltas(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(a)) {
    const d = delta(v, b[k]);
    if (d !== undefined) out[k] = d;
  }
  return out;
}

function flatRatios(r: NonNullable<SessionSummary['ratios']>[Source]): Record<string, number> {
  if (!r) return {};
  return {
    theta_beta_frontal: r.theta_beta_ratio.frontal_avg,
    theta_beta_central: r.theta_beta_ratio.central_avg,
    alpha_theta_occipital: r.alpha_theta_ratio.occipital_avg,
    alpha_theta_parietal: r.alpha_theta_ratio.parietal_avg,
  };
}

export function compareSessions(
  a: SessionSummary,
  b: SessionSummary,
  engines: { a?: string; b?: string },
): SessionComparison {
  const caveats: string[] = [];
  let mismatch = false;

  const condsOf = (s: SessionSummary) => (['eo', 'ec'] as const).filter((c) => s.conditions[c]);

  // Convention: B minus A, B expected to be the later session. days_between is the absolute whole days.
  const ta = Date.parse(a.session.date);
  const tb = Date.parse(b.session.date);
  const days_between = Number.isFinite(ta) && Number.isFinite(tb) ? Math.floor(Math.abs(tb - ta) / DAY_MS) : null;
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta > tb) caveats.push('A is more recent than B');

  let engine_versions: SessionComparison['engine_versions'];
  if (engines.a && engines.b && engines.a !== engines.b) {
    engine_versions = { a: bareVersion(engines.a), b: bareVersion(engines.b) };
    caveats.push(`engine version differs (${engine_versions.a} vs ${engine_versions.b})`);
    mismatch = true;
  }
  if (recordingKey(a, 'montage') !== recordingKey(b, 'montage')) {
    caveats.push('montage differs');
    mismatch = true;
  }
  if (recordingKey(a, 'sampling_rate') !== recordingKey(b, 'sampling_rate')) {
    caveats.push('sampling rate differs');
    mismatch = true;
  }
  for (const c of ['eo', 'ec'] as const) {
    const inA = !!a.conditions[c];
    const inB = !!b.conditions[c];
    if (inA === inB) continue;
    const label = c.toUpperCase();
    caveats.push(`${label} missing in ${inA ? 'B' : 'A'}, ${label} deltas omitted`);
    mismatch = true;
  }

  let confidence = worse(a.quality.confidence, b.quality.confidence);
  if (mismatch) confidence = stepDown(confidence);

  const conditions: SessionComparison['conditions'] = {};
  for (const c of ['eo', 'ec'] as const) {
    const ca = a.conditions[c];
    const cb = b.conditions[c];
    if (ca && cb) conditions[c] = conditionDelta(ca, cb);
  }

  let cross = false;
  const ratio_deltas: SessionComparison['ratio_deltas'] = {};
  const ratioMatch = matchSources(a.ratios, b.ratios);
  for (const p of ratioMatch.pairs) {
    ratio_deltas[p.key] = numericDeltas(flatRatios(a.ratios![p.a]), flatRatios(b.ratios![p.b]));
  }
  cross ||= ratioMatch.cross;

  const asymmetry_deltas: SessionComparison['asymmetry_deltas'] = {};
  const asymMatch = matchSources(a.asymmetry, b.asymmetry);
  for (const p of asymMatch.pairs) {
    asymmetry_deltas[p.key] = numericDeltas(a.asymmetry![p.a]!, b.asymmetry![p.b]!);
  }
  cross ||= asymMatch.cross;

  const risk_pattern_flips: SessionComparison['risk_pattern_flips'] = [];
  const riskMatch = matchSources(a.risk_patterns, b.risk_patterns);
  for (const p of riskMatch.pairs) {
    const ra = a.risk_patterns![p.a] as Record<string, boolean>;
    const rb = b.risk_patterns![p.b] as Record<string, boolean>;
    for (const [pattern, from] of Object.entries(ra)) {
      const to = rb[pattern];
      if (typeof to === 'boolean' && to !== from) risk_pattern_flips.push({ pattern, from, to, condition: p.key });
    }
  }
  cross ||= riskMatch.cross;
  if (cross) caveats.push(CROSS_SOURCE_CAVEAT);

  const out: SessionComparison = {
    a: sideOut(a),
    b: sideOut(b),
    days_between,
    confidence,
    caveats,
    ...(engine_versions ? { engine_versions } : {}),
    conditions,
    ratio_deltas,
    asymmetry_deltas,
    risk_pattern_flips,
  };
  const ra = a.eo_ec_reactivity;
  const rb = b.eo_ec_reactivity;
  const occ = delta(ra?.occipital_alpha_change_pct, rb?.occipital_alpha_change_pct);
  const post = delta(ra?.posterior_alpha_change_pct, rb?.posterior_alpha_change_pct);
  if (occ !== undefined && post !== undefined) out.reactivity_delta = { occipital_alpha_change_pct: occ, posterior_alpha_change_pct: post };
  return out;

  function sideOut(s: SessionSummary): SessionComparison['a'] {
    return { id: s.session.id, date: s.session.date, conditions: condsOf(s), quality: s.quality };
  }
}
