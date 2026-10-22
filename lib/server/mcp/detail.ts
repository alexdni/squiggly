import 'server-only';
// Bounded drill-down of one analysis for get_analysis_detail. Like the summary, every section is
// built from allowlisted fields: nothing is copied wholesale from results or config.

import {
  BAND_NAMES,
  CONNECTIVITY_BAND_NAMES,
  type AnalysisResults,
  type BandName,
  type Condition,
  type ConnectivityBandName,
  type TimeSeries,
} from '@/lib/analysis-results';
import { ANALYSIS_MAX_HZ, REGIONAL_CHANNELS } from '@/lib/constants';
import { McpUserError } from './errors';
import { analysisEvents, eventOrder, type EventSource } from './events';
import { isNum, mean, sig3 } from './num';
import { CHANNEL_LABEL_RE, engineText, isLegacyResults, qualityBlock } from './quality';
import { conditionOf } from './sessions';
import type { AnalysisInput } from './summary';

export const DETAIL_SECTIONS = ['band_power', 'connectivity', 'psd', 'events', 'sloreta', 'hrv', 'qc'] as const;
export type DetailSection = (typeof DETAIL_SECTIONS)[number];

export interface DetailFilter {
  condition?: Condition;
  band?: string;
  channel?: string;
  region?: string;
  page?: number;
}

const MAX_PAIRS = 200;
const EVENTS_PER_PAGE = 100;
const MAX_SERIES_POINTS = 120;
const MAX_SPANS = 200;
const CONNECTIVITY_DEFAULT_BAND: ConnectivityBandName = 'alpha';

export function buildDetail(input: AnalysisInput, section: DetailSection, filter: DetailFilter): object {
  if (!(DETAIL_SECTIONS as readonly string[]).includes(section)) {
    throw new McpUserError(`Unknown section "${String(section)}". Valid sections: ${DETAIL_SECTIONS.join(', ')}.`);
  }
  const results = readyResults(input);
  switch (section) {
    case 'band_power':
      return bandPower(results, filter);
    case 'connectivity':
      return connectivity(results, filter);
    case 'psd':
      return psd(results, filter);
    case 'events':
      return events(input, filter);
    case 'sloreta':
      return sloreta(results);
    case 'hrv':
      return hrv(results);
    case 'qc':
      return qc(results, filter);
  }
}

/** The analysis' results, or an explanation of why there are none. */
function readyResults(input: AnalysisInput): AnalysisResults {
  if (input.status === 'pending' || input.status === 'processing') {
    throw new McpUserError(`This analysis is still ${input.status}. Try again once it has completed.`);
  }
  if (input.status === 'failed') throw new McpUserError('This analysis failed, so there are no results to show.');
  if (input.status !== 'completed' || !input.results) {
    throw new McpUserError('This analysis has no results yet. Try again once it has completed.');
  }
  if (isLegacyResults(input.results)) {
    throw new McpUserError('This analysis was made by an older engine. Re-Analyze in Squiggly to make it available.');
  }
  return input.results;
}

/** The requested condition, else ec when this analysis has it, else eo. */
function pickCondition(has: (c: Condition) => boolean, wanted: Condition | undefined, what: string): Condition {
  if (wanted) {
    if (wanted !== 'eo' && wanted !== 'ec') throw new McpUserError(`Unknown condition "${String(wanted)}". Valid conditions: eo, ec.`);
    if (!has(wanted)) {
      const avail = (['eo', 'ec'] as const).filter(has);
      throw new McpUserError(`This analysis has no ${what} for ${wanted}. Available: ${avail.join(', ') || 'none'}.`);
    }
    return wanted;
  }
  const c = (['ec', 'eo'] as const).find(has);
  if (!c) throw new McpUserError(`This analysis has no ${what}.`);
  return c;
}

const REGION_NAMES = Object.keys(REGIONAL_CHANNELS);

/** The channels a region filter allows, or an explanation when the region is unknown. */
function regionChannels(region: string): string[] {
  const chs = (REGIONAL_CHANNELS as Record<string, string[]>)[region];
  if (!chs) throw new McpUserError(`Unknown region "${region}". Valid regions: ${REGION_NAMES.join(', ')}.`);
  return chs;
}

function bandPower(results: AnalysisResults, f: DetailFilter) {
  const condition = pickCondition((c) => !!results.band_power?.[c], f.condition, 'band power');
  const bp = results.band_power[condition]!;
  const names = Object.keys(bp);
  if (f.band && !(BAND_NAMES as readonly string[]).includes(f.band)) {
    throw new McpUserError(`Unknown band "${f.band}". Valid bands: ${BAND_NAMES.join(', ')}.`);
  }
  if (f.channel && !bp[f.channel]) throw new McpUserError(`Unknown channel "${f.channel}". Valid channels: ${names.join(', ')}.`);
  let selected = f.channel ? [f.channel] : names;
  if (f.region) {
    const inRegion = regionChannels(f.region);
    if (f.channel && !inRegion.includes(f.channel)) {
      throw new McpUserError(`Channel "${f.channel}" is not in the ${f.region} region (${inRegion.join(', ')}).`);
    }
    selected = selected.filter((ch) => inRegion.includes(ch));
    if (!selected.length) throw new McpUserError(`No ${f.region} channels in this analysis. Valid channels: ${names.join(', ')}.`);
  }
  const bands = f.band ? [f.band as BandName] : BAND_NAMES;
  const channels: Record<string, Partial<Record<BandName, { abs: number; rel: number }>>> = {};
  for (const ch of selected) {
    channels[ch] = Object.fromEntries(bands.map((b) => [b, { abs: sig3(bp[ch][b]?.absolute), rel: sig3(bp[ch][b]?.relative) }]));
  }
  return {
    condition,
    ...(f.region ? { region: f.region } : {}),
    ...(f.band ? { band: f.band } : {}),
    units: { abs: 'µV²', rel: 'fraction of 1-45 Hz total' },
    channels,
  };
}

function connectivity(results: AnalysisResults, f: DetailFilter) {
  const condition = pickCondition((c) => !!results.connectivity?.[c], f.condition, 'connectivity');
  const band = (f.band ?? CONNECTIVITY_DEFAULT_BAND) as ConnectivityBandName;
  if (!(CONNECTIVITY_BAND_NAMES as readonly string[]).includes(band)) {
    throw new McpUserError(`Unknown band "${f.band}". Valid bands: ${CONNECTIVITY_BAND_NAMES.join(', ')}.`);
  }
  const all = (results.connectivity[condition]?.pair_data ?? [])
    .filter((p) => isNum(p[band]) && CHANNEL_LABEL_RE.test(String(p.ch1)) && CHANNEL_LABEL_RE.test(String(p.ch2)))
    .map((p) => ({ ch1: p.ch1, ch2: p.ch2, value: p[band] as number }))
    .sort((a, b) => b.value - a.value);
  return {
    condition,
    band,
    total_pairs: all.length,
    pairs: all.slice(0, MAX_PAIRS).map((p) => ({ ch1: p.ch1, ch2: p.ch2, value: sig3(p.value) })),
  };
}

/**
 * One channel (or the mean over a region's channels) averaged into 1 Hz bins. Bin k covers
 * [k, k+1) Hz for k = 1..45, so the first bin is 1-2 Hz and the last holds 45 Hz itself (the
 * analysis ceiling; nothing above it is used). Power is µV²/Hz.
 */
function psd(results: AnalysisResults, f: DetailFilter) {
  const condition = pickCondition((c) => !!results.psd?.[c], f.condition, 'PSD');
  const data = results.psd![condition]!;
  const known = Object.keys(data.channels);

  let target: { channel: string } | { region: string };
  let rows: number[][];
  if (f.region) {
    const chs = regionChannels(f.region);
    rows = chs.filter((c) => data.channels[c]).map((c) => data.channels[c]);
    if (!rows.length) throw new McpUserError(`No ${f.region} channels in this PSD. Valid channels: ${known.join(', ')}.`);
    target = { region: f.region };
  } else if (f.channel) {
    if (!data.channels[f.channel]) throw new McpUserError(`Unknown channel "${f.channel}". Valid channels: ${known.join(', ')}.`);
    rows = [data.channels[f.channel]];
    target = { channel: f.channel };
  } else {
    throw new McpUserError(`Give a channel or a region. Valid channels: ${known.join(', ')}. Valid regions: ${REGION_NAMES.join(', ')}.`);
  }

  const bins = Array.from({ length: ANALYSIS_MAX_HZ }, (_, i) => {
    const lo = i + 1;
    const vals: number[] = [];
    data.freqs.forEach((hz, k) => {
      if (hz < lo || hz >= lo + 1 || hz > ANALYSIS_MAX_HZ) return;
      for (const row of rows) if (isNum(row[k])) vals.push(row[k]);
    });
    const m = mean(vals);
    return { hz_lo: lo, hz_hi: lo + 1, power: m === null ? null : sig3(m) };
  });
  return { condition, ...target, units: 'µV²/Hz', bins };
}

function events(input: AnalysisInput, f: DetailFilter) {
  const source = conditionOf(input.recording).toLowerCase() as EventSource;
  const all = analysisEvents(input, source).sort(eventOrder);
  // 1-based: page 1 is the first EVENTS_PER_PAGE events
  const page = Number.isInteger(f.page) && (f.page as number) >= 1 ? (f.page as number) : 1;
  const start = (page - 1) * EVENTS_PER_PAGE;
  return {
    total: all.length,
    page,
    items: all.slice(start, start + EVENTS_PER_PAGE),
    next_page: start + EVENTS_PER_PAGE < all.length ? page + 1 : null,
  };
}

function sloreta(results: AnalysisResults) {
  const stats = results.sloreta?.stats;
  if (!stats) throw new McpUserError('This analysis has no sLORETA results.');
  const conditions: Partial<Record<Condition, Partial<Record<BandName, unknown>>>> = {};
  for (const cond of ['eo', 'ec'] as const) {
    const byBand = stats[cond];
    if (!byBand) continue;
    const bands: Partial<Record<BandName, unknown>> = {};
    for (const band of BAND_NAMES) {
      const s = byBand[band];
      if (!s || !isNum(s.max) || !isNum(s.mean)) continue;
      const p = s.peak;
      bands[band] = {
        max: sig3(s.max),
        mean: sig3(s.mean),
        peak:
          p && Array.isArray(p.mni) && isNum(p.value)
            ? { mni: p.mni.slice(0, 3).map((v) => Math.round(Number(v) * 10) / 10), region: engineText(p.region), value: sig3(p.value) }
            : null,
      };
    }
    if (Object.keys(bands).length) conditions[cond] = bands;
  }
  const epochs = results.sloreta?.epochs_used ?? {};
  return {
    epochs_used: Object.fromEntries(Object.entries(epochs).filter(([, n]) => isNum(n))),
    conditions,
  };
}

const HRV_KEYS = ['mean_hr_bpm', 'sdnn_ms', 'rmssd_ms', 'pnn50_pct', 'vlf_ms2', 'lf_ms2', 'hf_ms2', 'lf_nu', 'hf_nu', 'lf_hf'] as const;
const HRV_SERIES = ['nn_ms', 'heart_rate_bpm', 'rmssd_ms', 'sdnn_ms', 'pnn50_pct', 'lf_ms2', 'hf_ms2', 'lf_nu', 'hf_nu', 'lf_hf'] as const;

function hrv(results: AnalysisResults) {
  const h = results.hrv;
  if (!h || typeof h !== 'object') throw new McpUserError('This analysis has no HRV results.');
  const summary: Record<string, number | null> = {};
  for (const k of HRV_KEYS) summary[k] = isNum(h.summary?.[k]) ? sig3(h.summary[k] as number) : null;
  const series: Record<string, TimeSeries> = {};
  for (const k of HRV_SERIES) {
    const s = h.series?.[k];
    if (s && Array.isArray(s.t) && Array.isArray(s.v)) series[k] = downsample(s);
  }
  return {
    reliable: h.reliable === true,
    coverage_pct: isNum(h.coverage_pct) ? sig3(h.coverage_pct) : 0,
    beats: isNum(h.beats) ? h.beats : 0,
    duration_s: isNum(h.duration_sec) ? Math.round(h.duration_sec) : null,
    summary,
    series,
  };
}

/** At most MAX_SERIES_POINTS points: near-equal buckets, each averaged (t and v), not strided. */
function downsample(s: TimeSeries): TimeSeries {
  const n = Math.min(s.t.length, s.v.length);
  const pairs = Array.from({ length: n }, (_, i) => [s.t[i], s.v[i]]).filter(([t, v]) => isNum(t) && isNum(v));
  const buckets = Math.min(pairs.length, MAX_SERIES_POINTS);
  const t: number[] = [];
  const v: number[] = [];
  for (let i = 0; i < buckets; i++) {
    const bucket = pairs.slice(Math.floor((i * pairs.length) / buckets), Math.floor(((i + 1) * pairs.length) / buckets));
    t.push(Math.round(mean(bucket.map((p) => p[0]))! * 10) / 10); // seconds: keep 0.1 s, sig3 would blur late times
    v.push(sig3(mean(bucket.map((p) => p[1]))!));
  }
  return { t, v };
}

const MAX_BAD_CHANNELS = 64;
const MAX_REASONS = 10;

/** Engine-supplied text: labels must look like electrode names, reasons are sanitized and capped. */
function badChannels(list: NonNullable<AnalysisResults['qc_report']['timeline']>['bad_channels'] | undefined) {
  return (Array.isArray(list) ? list : [])
    .filter((b) => b && typeof b.label === 'string' && CHANNEL_LABEL_RE.test(b.label))
    .slice(0, MAX_BAD_CHANNELS)
    .map((b) => ({
      label: b.label,
      reasons: (Array.isArray(b.reasons) ? b.reasons : [])
        .map(engineText)
        .filter((r) => r.length > 0)
        .slice(0, MAX_REASONS),
      interpolated: b.interpolated === true,
    }));
}

function qc(results: AnalysisResults, f: DetailFilter) {
  const condition = f.condition === 'eo' || f.condition === 'ec' ? f.condition : undefined;
  const tl = results.qc_report.timeline;
  const spans = Array.isArray(tl?.spans) ? tl.spans.filter((s) => Array.isArray(s) && isNum(s[0]) && isNum(s[1])) : [];
  return {
    quality: qualityBlock(results.qc_report, condition),
    rejected_spans_total: spans.length,
    rejected_spans: spans.slice(0, MAX_SPANS).map(([a, b]) => [Math.round(a * 100) / 100, Math.round(b * 100) / 100]),
    bad_channels: badChannels(tl?.bad_channels),
  };
}
