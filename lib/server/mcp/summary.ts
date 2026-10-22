// Compact session summary for get_session_summary. A session is an EO + an EC analysis from
// separately uploaded files, or one BOTH analysis; each condition is read from the analysis that
// holds it. Built from allowlisted fields only: nothing is copied wholesale from results/config.

import {
  BAND_NAMES,
  CONNECTIVITY_BAND_NAMES,
  type AnalysisResults,
  type BandName,
  type Condition as Cond,
  type ConnectivityBandName,
  type EventCategory,
} from '@/lib/analysis-results';
import { REGIONAL_CHANNELS } from '@/lib/constants';
import { CLINICAL, analysisEvents, eventOrder, type EventOut } from './events';
import { isNum, mean, sig3 } from './num';
import { GUIDANCE_SHORT } from './guidance';
import { isLegacyResults, qualityBlock, worse, type Confidence, type QualityBlock } from './quality';
import { conditionOf, type Condition as RecCondition, type RecordingRow, type Session } from './sessions';

export interface AnalysisInput {
  analysisId: string;
  recording: RecordingRow;
  status: string;
  results: AnalysisResults | null;
  config: unknown;
}

type Source = 'eo' | 'ec' | 'both';
type Region = keyof typeof REGIONAL_CHANNELS;
type BySource<T> = Partial<Record<Source, T>>;

export interface RecordingMeta {
  id: string;
  uploaded_at: string;
  duration_s: number | null;
  sampling_rate: number | null;
  n_channels: number | null;
  montage: string | null;
  reference: string | null;
  condition: RecCondition;
  analysis: { id: string; status: string };
}

export interface PairOut {
  ch1: string;
  ch2: string;
  value: number;
}

export interface ConditionSummary {
  band_power: {
    by_region: Partial<Record<Region, Record<BandName, { abs: number; rel: number }>>>;
    /** [absolute µV², relative fraction] */
    by_channel: Record<string, Record<BandName, [number, number]>>;
  };
  alpha_peak: { mean_hz: number | null; by_channel: Record<string, number> };
  lzc: { mean_normalized: number | null; by_channel: Record<string, number> };
  connectivity: Partial<
    Record<
      ConnectivityBandName,
      {
        global_efficiency: number;
        clustering: number;
        small_worldness: number;
        interhemispheric: number;
        strongest: PairOut[];
        weakest: PairOut[];
      }
    >
  >;
}

export interface SessionSummary {
  session: { id: string; date: string; pairing: Session['pairing']; recordings: RecordingMeta[] };
  unavailable?: { analysisId: string; reason: 'pending' | 'processing' | 'failed' | 'legacy' }[];
  clinical_flags: EventOut[];
  quality: { eo?: QualityBlock; ec?: QualityBlock; confidence: Confidence };
  conditions: { eo?: ConditionSummary; ec?: ConditionSummary };
  eo_ec_reactivity?: { occipital_alpha_change_pct: number; posterior_alpha_change_pct: number };
  ratios?: BySource<{
    theta_beta_ratio: { frontal_avg: number; central_avg: number };
    alpha_theta_ratio: { occipital_avg: number; parietal_avg: number };
  }>;
  asymmetry?: BySource<Record<string, number>>;
  risk_patterns?: { label: 'heuristic screens, not diagnoses' } & BySource<Record<RiskKey, boolean>>;
  hrv?: BySource<{ reliable: boolean; coverage_pct: number; beats: number; summary: Record<string, number | null> }>;
  sloreta?: BySource<
    Partial<Record<Cond, Partial<Record<BandName, { max: number; mean: number; peak: { mni: number[]; region: string; value: number } | null }>>>>
  >;
  events?: {
    counts: Record<EventCategory, number>;
    items: EventOut[];
    dismissed: EventOut[];
    not_assessed: { detector: string; reason: string }[];
    /** set when clinical_flags/items/dismissed were capped: how many were left out */
    omitted?: { clinical_flags: number; items: number; dismissed: number };
  };
  interpretation_guidance: string;
}

const RISK_KEYS = ['adhd_like', 'anxiety_like', 'depression_like', 'sleep_dysregulation', 'hyper_arousal'] as const;
type RiskKey = (typeof RISK_KEYS)[number];
const HRV_KEYS = ['mean_hr_bpm', 'sdnn_ms', 'rmssd_ms', 'pnn50_pct', 'vlf_ms2', 'lf_ms2', 'hf_ms2', 'lf_nu', 'hf_nu', 'lf_hf'] as const;
const REGIONS = Object.keys(REGIONAL_CHANNELS) as Region[];
const SITES_1020: string[] = REGIONS.flatMap((r) => REGIONAL_CHANNELS[r]);
const UNAVAILABLE_STATUS = ['pending', 'processing', 'failed'] as const;
const MAX_CLINICAL_FLAGS = 20;
const MAX_EVENT_ITEMS = 40;
const MAX_DISMISSED_ITEMS = 20;
const TOP_PAIRS = 5;

export { sig3 };
export type { EventOut, EventReview } from './events';

export function buildSessionSummary(
  session: Session,
  parts: { eo?: AnalysisInput; ec?: AnalysisInput; both?: AnalysisInput },
): SessionSummary {
  const sources = (['eo', 'ec', 'both'] as const).filter((s) => parts[s]);
  const unavailable: NonNullable<SessionSummary['unavailable']> = [];
  const ready: { source: Source; input: AnalysisInput; results: AnalysisResults }[] = [];

  for (const source of sources) {
    const input = parts[source]!;
    const status = (UNAVAILABLE_STATUS as readonly string[]).includes(input.status) ? input.status : null;
    if (status || input.status !== 'completed' || !input.results) {
      unavailable.push({ analysisId: input.analysisId, reason: (status ?? 'pending') as 'pending' });
    } else if (isLegacyResults(input.results)) {
      unavailable.push({ analysisId: input.analysisId, reason: 'legacy' });
    } else {
      ready.push({ source, input, results: input.results });
    }
  }

  // Which analysis holds each condition
  const holder: Partial<Record<Cond, AnalysisResults>> = {};
  for (const cond of ['eo', 'ec'] as const) {
    const r = ready.find((p) => p.source === cond) ?? ready.find((p) => p.source === 'both');
    if (r?.results.band_power?.[cond]) holder[cond] = r.results;
  }

  const quality: SessionSummary['quality'] = { confidence: 'high' };
  const conditions: SessionSummary['conditions'] = {};
  let confidence: Confidence | null = null;
  for (const cond of ['eo', 'ec'] as const) {
    const r = holder[cond];
    if (!r) continue;
    const q = qualityBlock(r.qc_report, cond);
    quality[cond] = q;
    confidence = confidence ? worse(confidence, q.confidence) : q.confidence;
    conditions[cond] = conditionSummary(r, cond);
  }
  // No usable condition at all: nothing to be confident about
  quality.confidence = confidence ?? 'low';

  const summary: Omit<SessionSummary, 'interpretation_guidance'> = {
    session: {
      id: session.id,
      date: session.date,
      pairing: session.pairing,
      recordings: sources.map((s) => recordingMeta(parts[s]!)),
    },
    ...(unavailable.length ? { unavailable } : {}),
    clinical_flags: [],
    quality,
    conditions,
  };

  if (holder.eo && holder.ec) {
    summary.eo_ec_reactivity = {
      occipital_alpha_change_pct: alphaChange(holder.eo, holder.ec, REGIONAL_CHANNELS.occipital),
      posterior_alpha_change_pct: alphaChange(holder.eo, holder.ec, [...REGIONAL_CHANNELS.parietal, ...REGIONAL_CHANNELS.occipital]),
    };
  }

  const bySource = <T>(pick: (r: AnalysisResults, source: Source) => T | undefined): BySource<T> | undefined => {
    const out: BySource<T> = {};
    for (const { source, results } of ready) {
      const v = pick(results, source);
      if (v !== undefined) out[source] = v;
    }
    return Object.keys(out).length ? out : undefined;
  };

  const ratios = bySource((r) => ratiosOut(r.band_ratios));
  if (ratios) summary.ratios = ratios;
  const asymmetry = bySource((r) => asymmetryOut(r.asymmetry));
  if (asymmetry) summary.asymmetry = asymmetry;
  const risks = bySource((r) => risksOut(r.risk_patterns));
  if (risks) summary.risk_patterns = { label: 'heuristic screens, not diagnoses', ...risks };
  const hrv = bySource((r) => hrvOut(r.hrv));
  if (hrv) summary.hrv = hrv;
  const sloreta = bySource((r, source) => sloretaOut(r, source));
  if (sloreta) summary.sloreta = sloreta;

  const events = eventsOut(ready);
  if (events) {
    summary.clinical_flags = events.clinical;
    summary.events = events.block;
  }

  return { ...summary, interpretation_guidance: GUIDANCE_SHORT };
}

function recordingMeta(input: AnalysisInput): RecordingMeta {
  const r = input.recording;
  return {
    id: r.id,
    uploaded_at: r.created_at,
    duration_s: isNum(r.duration_seconds) ? Math.round(r.duration_seconds * 10) / 10 : null,
    sampling_rate: isNum(r.sampling_rate) ? r.sampling_rate : null,
    n_channels: isNum(r.n_channels) ? r.n_channels : null,
    montage: typeof r.montage === 'string' ? r.montage : null,
    reference: typeof r.reference === 'string' ? r.reference : null,
    condition: conditionOf(r),
    analysis: { id: input.analysisId, status: input.status },
  };
}

function conditionSummary(r: AnalysisResults, cond: Cond): ConditionSummary {
  const bp = r.band_power[cond]!;
  const sites = SITES_1020.filter((ch) => bp[ch]);

  const by_channel: ConditionSummary['band_power']['by_channel'] = {};
  for (const ch of sites) {
    by_channel[ch] = Object.fromEntries(
      BAND_NAMES.map((b) => [b, [sig3(bp[ch][b]?.absolute), sig3(bp[ch][b]?.relative)]]),
    ) as Record<BandName, [number, number]>;
  }

  const by_region: ConditionSummary['band_power']['by_region'] = {};
  for (const region of REGIONS) {
    const chs = REGIONAL_CHANNELS[region].filter((ch) => bp[ch]);
    if (!chs.length) continue;
    by_region[region] = Object.fromEntries(
      BAND_NAMES.map((b) => [
        b,
        {
          abs: sig3(mean(chs.map((ch) => bp[ch][b]?.absolute).filter(isNum)) ?? NaN),
          rel: sig3(mean(chs.map((ch) => bp[ch][b]?.relative).filter(isNum)) ?? NaN),
        },
      ]),
    ) as Record<BandName, { abs: number; rel: number }>;
  }

  const peaks = r.alpha_peak?.[cond] ?? {};
  const alphaByChannel: Record<string, number> = {};
  for (const ch of SITES_1020) if (isNum(peaks[ch]?.peak_frequency)) alphaByChannel[ch] = sig3(peaks[ch].peak_frequency);

  const lzc = r.lzc?.[cond] ?? {};
  const lzcByChannel: Record<string, number> = {};
  for (const ch of SITES_1020) if (isNum(lzc[ch]?.normalized_lzc)) lzcByChannel[ch] = sig3(lzc[ch].normalized_lzc);

  const conn = r.connectivity?.[cond];
  const connectivity: ConditionSummary['connectivity'] = {};
  for (const band of CONNECTIVITY_BAND_NAMES) {
    const m = conn?.network_metrics?.[band];
    if (!m) continue;
    const pairs: PairOut[] = (conn?.pair_data ?? [])
      .filter((p) => isNum(p[band]) && typeof p.ch1 === 'string' && typeof p.ch2 === 'string')
      .map((p) => ({ ch1: p.ch1, ch2: p.ch2, value: p[band] as number }))
      .sort((a, b) => b.value - a.value);
    const out = (p: PairOut) => ({ ch1: p.ch1, ch2: p.ch2, value: sig3(p.value) });
    connectivity[band] = {
      global_efficiency: sig3(m.global_efficiency),
      clustering: sig3(m.mean_clustering_coefficient),
      small_worldness: sig3(m.small_worldness),
      interhemispheric: sig3(m.interhemispheric_connectivity),
      strongest: pairs.slice(0, TOP_PAIRS).map(out),
      weakest: pairs.slice(-TOP_PAIRS).reverse().map(out),
    };
  }

  const meanOf = (o: Record<string, number>) => {
    const m = mean(Object.values(o));
    return m === null ? null : sig3(m);
  };
  return {
    band_power: { by_region, by_channel },
    alpha_peak: { mean_hz: meanOf(alphaByChannel), by_channel: alphaByChannel },
    lzc: { mean_normalized: meanOf(lzcByChannel), by_channel: lzcByChannel },
    connectivity,
  };
}

/** (EC − EO) / EO × 100 of mean alpha1 + alpha2 absolute power over the channels both conditions have. */
function alphaChange(eo: AnalysisResults, ec: AnalysisResults, channels: readonly string[]): number {
  const a = eo.band_power.eo!;
  const b = ec.band_power.ec!;
  const alpha = (bp: typeof a, ch: string) => (bp[ch]?.alpha1?.absolute ?? NaN) + (bp[ch]?.alpha2?.absolute ?? NaN);
  const chs = channels.filter((ch) => isNum(alpha(a, ch)) && isNum(alpha(b, ch)));
  const eoMean = mean(chs.map((ch) => alpha(a, ch)));
  const ecMean = mean(chs.map((ch) => alpha(b, ch)));
  if (eoMean === null || ecMean === null || eoMean <= 0) return NaN;
  return sig3(((ecMean - eoMean) / eoMean) * 100);
}

function ratiosOut(r: AnalysisResults['band_ratios'] | undefined): NonNullable<SessionSummary['ratios']>[Source] {
  const tb = r?.theta_beta_ratio;
  const at = r?.alpha_theta_ratio;
  if (!tb || !at) return undefined;
  return {
    theta_beta_ratio: { frontal_avg: sig3(tb.frontal_avg), central_avg: sig3(tb.central_avg) },
    alpha_theta_ratio: { occipital_avg: sig3(at.occipital_avg), parietal_avg: sig3(at.parietal_avg) },
  };
}

function asymmetryOut(a: AnalysisResults['asymmetry'] | undefined): Record<string, number> | undefined {
  if (!a || typeof a !== 'object') return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(a)) if (/^[a-z][a-z0-9_]{0,40}$/.test(k) && isNum(v)) out[k] = sig3(v);
  return Object.keys(out).length ? out : undefined;
}

function risksOut(r: AnalysisResults['risk_patterns'] | undefined): Record<RiskKey, boolean> | undefined {
  if (!r || typeof r !== 'object') return undefined;
  return Object.fromEntries(RISK_KEYS.map((k) => [k, r[k] === true])) as Record<RiskKey, boolean>;
}

function hrvOut(h: AnalysisResults['hrv']): NonNullable<SessionSummary['hrv']>[Source] {
  if (!h || typeof h !== 'object') return undefined;
  const summary: Record<string, number | null> = {};
  for (const k of HRV_KEYS) {
    const v = h.summary?.[k];
    summary[k] = isNum(v) ? sig3(v) : null;
  }
  return {
    reliable: h.reliable === true,
    coverage_pct: isNum(h.coverage_pct) ? sig3(h.coverage_pct) : 0,
    beats: isNum(h.beats) ? h.beats : 0,
    summary,
  };
}

function sloretaOut(r: AnalysisResults, source: Source): NonNullable<SessionSummary['sloreta']>[Source] {
  const stats = r.sloreta?.stats;
  if (!stats) return undefined;
  const conds: Cond[] = source === 'both' ? ['eo', 'ec'] : [source];
  const out: NonNullable<NonNullable<SessionSummary['sloreta']>[Source]> = {};
  for (const cond of conds) {
    const byBand = stats[cond];
    if (!byBand) continue;
    const bands: NonNullable<typeof out[Cond]> = {};
    for (const band of BAND_NAMES) {
      const s = byBand[band];
      if (!s || !isNum(s.max) || !isNum(s.mean)) continue;
      const p = s.peak;
      bands[band] = {
        max: sig3(s.max),
        mean: sig3(s.mean),
        peak:
          p && Array.isArray(p.mni) && isNum(p.value)
            ? { mni: p.mni.slice(0, 3).map((v) => Math.round(Number(v) * 10) / 10), region: String(p.region ?? ''), value: sig3(p.value) }
            : null,
      };
    }
    if (Object.keys(bands).length) out[cond] = bands;
  }
  return Object.keys(out).length ? out : undefined;
}

function eventsOut(ready: { source: Source; input: AnalysisInput; results: AnalysisResults }[]) {
  const withEvents = ready.filter((p) => Array.isArray(p.results.events) || p.results.event_detection);
  if (!withEvents.length) return null;

  const all: EventOut[] = [];
  const notAssessed = new Map<string, { detector: string; reason: string }>();
  for (const { source, input, results } of withEvents) {
    all.push(...analysisEvents(input, source));
    for (const d of results.event_detection?.coverage?.detectors ?? []) {
      if (d?.ran !== false) continue;
      const entry = { detector: String(d.name), reason: String(d.skippedReason ?? 'not run') };
      notAssessed.set(`${entry.detector}\u0000${entry.reason}`, entry);
    }
  }

  const counts = { artifact: 0, variant: 0, epileptiform: 0, 'rhythmic-periodic': 0 } as Record<EventCategory, number>;
  const kept = all.filter((e) => e.review !== 'dismissed').sort(eventOrder);
  const dismissed = all.filter((e) => e.review === 'dismissed').sort(eventOrder);
  for (const e of kept) counts[e.category] += 1;

  // Clinical events are listed once, in clinical_flags (confirmed first); counts still include them
  const clinical = kept
    .filter((e) => CLINICAL.includes(e.category))
    .sort((a, b) => Number(b.review === 'confirmed') - Number(a.review === 'confirmed') || eventOrder(a, b));
  const rest = kept.filter((e) => !CLINICAL.includes(e.category));

  const block: NonNullable<SessionSummary['events']> = {
    counts,
    items: rest.slice(0, MAX_EVENT_ITEMS),
    dismissed: dismissed.slice(0, MAX_DISMISSED_ITEMS),
    not_assessed: [...notAssessed.values()],
  };
  const over = (n: number, max: number) => Math.max(n - max, 0);
  const omitted = {
    clinical_flags: over(clinical.length, MAX_CLINICAL_FLAGS),
    items: over(rest.length, MAX_EVENT_ITEMS),
    dismissed: over(dismissed.length, MAX_DISMISSED_ITEMS),
  };
  if (omitted.clinical_flags || omitted.items || omitted.dismissed) block.omitted = omitted;

  return { clinical: clinical.slice(0, MAX_CLINICAL_FLAGS), block };
}
