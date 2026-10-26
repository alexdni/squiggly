// Paroxysmal slowing from the cleaned, average-referenced EEG: bursts of delta or theta that stand
// out from the channel's own background, start and stop abruptly, and have a field (more than one
// electrode). Each burst is classed as rhythmic (regular cycles: FIRDA / OIRDA / TIRDA / IRDA, or
// rhythmic theta) or polymorphic (irregular waves), and placed by its peak channel and spread.
// A burst needs a physiological field: its channels are neighbours on the scalp. Mimics are kept
// out four ways: spans the artifact detectors flagged as eye, movement or pop (and each channel's
// own rejected epochs) are skipped; bursts confined to the frontal-pole / lateral-frontal sites, or
// with a steep Fp-to-F gradient, are eye movements; frontal or temporal homologous sites swinging
// in opposite directions are a horizontal eye-movement dipole.

import { createHash } from 'node:crypto';
import type { Condition, DetectedEventResult, SlowingSummary } from '@/lib/analysis-results';
import { butter, FiltFilt, Hilbert, median } from '../dsp';
import { connectedTo, neighbours } from './waveform';

export type SlowingBand = 'delta' | 'theta';
export type SlowingRegion = 'frontal' | 'temporal' | 'central' | 'parietal' | 'occipital';
export type SlowingSide = 'left' | 'right' | 'midline' | 'bilateral';

export interface SlowingBurst {
  condition: Condition;
  band: SlowingBand;
  pattern: string;
  startSec: number;
  endSec: number;
  /** involved channels, peak channel first */
  channels: string[];
  peakChannel: string;
  region: SlowingRegion;
  side: SlowingSide;
  generalized: boolean;
  rhythmic: boolean;
  cycles: number;
  freqHz: number;
  periodCv: number;
  /** peak channel: autocorrelation one period on (1 = perfectly rhythmic) */
  autocorr: number;
  /** peak channel: mean band envelope over the burst ÷ the channel's median band envelope */
  envelopeRatio: number;
  /** peak channel: band variance ÷ 1–30 Hz variance over the burst */
  bandShare: number;
  /** peak channel: 1–30 Hz RMS over the burst ÷ its median 1 s RMS */
  broadRatio: number;
  /** peak channel: median wave peak-to-trough amplitude, µV */
  amplitudeUv: number;
  /** O1/O2 alpha envelope during the burst ÷ its median; low = alpha dropped out (drowsiness) */
  posteriorAlphaRatio: number | null;
}

export interface SlowingInput {
  labels: string[];
  data: ArrayLike<number>[];
  sampleRate: number;
  /** 1 where the sample survived cleaning */
  keep: Uint8Array;
  /** per channel (same order as labels): 1 where that channel's own epochs were kept */
  channelKeep?: Uint8Array[];
  segments: Partial<Record<Condition, { start: number; end: number }>>;
  /** artifact spans (seconds) the bursts must not overlap: eye, movement, pops */
  artifactSpans?: { startSec: number; endSec: number }[];
}

export const SLOWING = {
  BANDS: { delta: [1.5, 4], theta: [4, 7.5] } as Record<SlowingBand, [number, number]>,
  BROAD_HZ: [1, 30] as [number, number],
  /** a channel is in a burst while its band envelope is over this × its median over kept samples */
  ENVELOPE_FACTOR: 3,
  /** on the peak channel the band carries at least this share of the 1–30 Hz variance */
  MIN_BAND_SHARE: 0.5,
  /** and its 1–30 Hz RMS is at least this × its median 1 s RMS: the burst stands out from the background */
  MIN_BROAD_RATIO: 2,
  /** homologous frontal/temporal sites correlated below this are an eye-movement dipole */
  MAX_HOMOLOGOUS_ANTICORR: -0.5,
  MIN_DURATION_SEC: 1,
  /** longer stretches are continuous, not paroxysmal, slowing */
  MAX_DURATION_SEC: 20,
  /** gaps shorter than this inside a burst are bridged */
  MERGE_GAP_SEC: 0.25,
  /** a channel is involved when over threshold for at least this share of the burst */
  CHANNEL_COVERAGE: 0.5,
  MIN_CHANNELS: 2,
  /** involved share of the usable channels, both hemispheres, for 'generalized' */
  GENERALIZED_FRACTION: 0.6,
  /** rhythmic = enough cycles, regular periods and heights, and a strong autocorrelation one period on */
  RHYTHMIC: { MIN_CYCLES: 3, MAX_PERIOD_CV: 0.2, MAX_AMPLITUDE_CV: 0.35, MIN_AUTOCORR: 0.6 },
  /** Fp1/Fp2 envelope ratio over F3/F4's above this is an eye-movement field, not cerebral slowing */
  MAX_FRONTOPOLAR_GRADIENT: 2,
  ARTIFACT_PAD_SEC: 0.25,
  SHAPE_MARGIN_HZ: 2,
  /** burst edges are trimmed to where the peak channel's envelope is at this share of its maximum */
  EDGE_FRACTION: 0.5,
  ALPHA_HZ: [8, 12] as [number, number],
  /** posterior alpha below this × its median during a burst counts as alpha dropout */
  ALPHA_DROPOUT: 0.5,
  MIN_SEGMENT_SEC: 10,
  /** fewer standard sites than this cannot show a field */
  MIN_SITES: 8,
} as const;

const ALIASES: Record<string, string> = { T3: 'T7', T4: 'T8', T5: 'P7', T6: 'P8' };
const REGION: Record<string, SlowingRegion> = {
  Fp1: 'frontal', Fp2: 'frontal', Fpz: 'frontal', F3: 'frontal', F4: 'frontal', F7: 'frontal', F8: 'frontal', Fz: 'frontal',
  T7: 'temporal', T8: 'temporal', P7: 'temporal', P8: 'temporal',
  C3: 'central', C4: 'central', Cz: 'central',
  P3: 'parietal', P4: 'parietal', Pz: 'parietal',
  O1: 'occipital', O2: 'occipital', Oz: 'occipital',
};
/** bursts on these sites alone look like eye movements */
const OCULAR_SITES = new Set(['Fp1', 'Fp2', 'Fpz', 'F7', 'F8']);
const HOMOLOGOUS: Record<string, string> = { Fp1: 'Fp2', F7: 'F8', F3: 'F4', T7: 'T8', P7: 'P8' };
for (const [l, rt] of Object.entries(HOMOLOGOUS)) HOMOLOGOUS[rt] = l;

const BY_LOWER = new Map(Object.keys(REGION).map((k) => [k.toLowerCase(), k] as const));
const canonical = (label: string) => {
  const l = label.trim();
  return ALIASES[l] ?? BY_LOWER.get(l.toLowerCase()) ?? l;
};

function sideOf(label: string): 'left' | 'right' | 'midline' {
  const d = /(\d+)$/.exec(label);
  if (!d) return 'midline';
  return Number(d[1]) % 2 ? 'left' : 'right';
}

function bandpass(x: Float64Array, fs: number, [lo, hi]: readonly [number, number]): Float64Array {
  const nyq = fs / 2;
  const f = butter(2, [lo / nyq, Math.min(hi, nyq * 0.9) / nyq], 'bandpass');
  const out = new Float64Array(x.length);
  new FiltFilt(f.b, f.a).apply(x, out);
  return out;
}

function envelope(x: Float64Array): Float64Array {
  const re = new Float64Array(x.length);
  const im = new Float64Array(x.length);
  new Hilbert(x.length).transform(x, re, im);
  const env = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) env[i] = Math.hypot(re[i], im[i]);
  return env;
}

function keptMedian(v: Float64Array, keep: Uint8Array): number {
  const kept: number[] = [];
  for (let i = 0; i < v.length; i++) if (keep[i]) kept.push(v[i]);
  return kept.length ? median(kept) : NaN;
}

interface Channel {
  label: string;
  keep: Uint8Array;
  band: Float64Array;
  /** signal the waves are measured on: 1 Hz to SHAPE_MARGIN_HZ above the band, so alpha stays out */
  shape: Float64Array;
  broad: Float64Array;
  env: Float64Array;
  medEnv: number;
  /** median 1–30 Hz RMS over kept 1 s windows */
  broadRms: number;
}

const mean = (v: ArrayLike<number>, a: number, b: number) => {
  let s = 0;
  for (let i = a; i < b; i++) s += v[i];
  return s / Math.max(1, b - a);
};
const variance = (v: ArrayLike<number>, a: number, b: number) => {
  const m = mean(v, a, b);
  let s = 0;
  for (let i = a; i < b; i++) s += (v[i] - m) ** 2;
  return s / Math.max(1, b - a);
};
const corr = (x: ArrayLike<number>, y: ArrayLike<number>, a: number, b: number) => {
  const mx = mean(x, a, b);
  const my = mean(y, a, b);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = a; i < b; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
};
function windowRms(x: Float64Array, keep: Uint8Array, fs: number): number {
  const w = Math.round(fs);
  const out: number[] = [];
  for (let a = 0; a + w <= x.length; a += w) {
    let ok = true;
    for (let i = a; ok && i < a + w; i++) if (!keep[i]) ok = false;
    if (ok) out.push(Math.sqrt(variance(x, a, a + w)));
  }
  return out.length ? median(out) : NaN;
}
/** The peak channel and the involved channels joined to it through neighbours. */
function field<T extends { c: Channel }>(involved: T[]): T[] {
  return connectedTo(involved[0], involved.slice(1), (x) => x.c.label);
}
const cv = (v: number[]) => {
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  if (!(m > 0)) return Infinity;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) / m;
};

/** Waves of the peak channel between rising zero-crossings of its band signal, measured on `shape`. */
function waves(ch: Channel, a: number, b: number): { periods: number[]; amps: number[] } {
  const rising: number[] = [];
  for (let i = a + 1; i < b; i++) if (ch.band[i - 1] < 0 && ch.band[i] >= 0) rising.push(i);
  const troughs: number[] = [];
  const amps: number[] = [];
  for (let c = 0; c + 1 < rising.length; c++) {
    let lo = rising[c];
    let hi = rising[c];
    for (let i = rising[c]; i < rising[c + 1]; i++) {
      if (ch.shape[i] < ch.shape[lo]) lo = i;
      if (ch.shape[i] > ch.shape[hi]) hi = i;
    }
    troughs.push(lo);
    amps.push(ch.shape[hi] - ch.shape[lo]);
  }
  const periods = troughs.slice(1).map((t, i) => t - troughs[i]);
  return { periods, amps };
}

/** Peak normalized autocorrelation of x[a, b) over lags of one period of the band (1/hi to 1/lo s). */
function rhythmicity(x: Float64Array, a: number, b: number, fs: number, [lo, hi]: readonly [number, number]): number {
  const m = mean(x, a, b);
  let e0 = 0;
  for (let i = a; i < b; i++) e0 += (x[i] - m) ** 2;
  if (!(e0 > 0)) return 0;
  let best = 0;
  for (let lag = Math.floor(fs / hi); lag <= Math.ceil(fs / lo) && lag < b - a; lag++) {
    let acc = 0;
    for (let i = a; i + lag < b; i++) acc += (x[i] - m) * (x[i + lag] - m);
    // unbiased: rescale for the shorter overlap
    best = Math.max(best, (acc / e0) * ((b - a) / (b - a - lag)));
  }
  return Math.min(1, best);
}

function patternFor(band: SlowingBand, rhythmic: boolean, region: SlowingRegion, generalized: boolean): string {
  if (band === 'theta') return rhythmic ? 'rhythmic-theta' : 'intermittent-theta';
  if (!rhythmic) return 'polymorphic-delta';
  if (region === 'frontal' || (generalized && region !== 'occipital' && region !== 'temporal')) return 'firda';
  if (region === 'occipital') return 'oirda';
  if (region === 'temporal' && !generalized) return 'tirda';
  return 'irda';
}

/**
 * Paroxysmal slowing bursts per condition segment, and a per-condition summary. Needs at least
 * MIN_CHANNELS 10-20 sites; `skipped` says why when it cannot run.
 */
export function detectSlowing(input: SlowingInput): { bursts: SlowingBurst[]; summary: SlowingSummary; skipped?: string } {
  const fs = input.sampleRate;
  const idx = input.labels
    .map((l, i) => ({ label: canonical(l), i }))
    .filter((c) => REGION[c.label]);
  const summary: SlowingSummary = {};
  if (idx.length < SLOWING.MIN_SITES) {
    return { bursts: [], summary, skipped: `needs at least ${SLOWING.MIN_SITES} standard 10-20 electrodes` };
  }
  const n = input.data[0]?.length ?? 0;

  // artifact spans count as not kept
  const keepAll = input.keep.slice();
  for (const sp of input.artifactSpans ?? []) {
    const a = Math.max(0, Math.floor((sp.startSec - SLOWING.ARTIFACT_PAD_SEC) * fs));
    const b = Math.min(keepAll.length, Math.ceil((sp.endSec + SLOWING.ARTIFACT_PAD_SEC) * fs));
    if (b > a) keepAll.fill(0, a, b);
  }

  const bursts: SlowingBurst[] = [];
  for (const cond of ['eo', 'ec'] as Condition[]) {
    const seg = input.segments[cond];
    if (!seg) continue;
    const s = Math.max(0, Math.round(seg.start * fs));
    const e = Math.min(n, Math.round(seg.end * fs));
    if (e - s < SLOWING.MIN_SEGMENT_SEC * fs) continue;
    const keep = keepAll.subarray(s, e);
    let keptN = 0;
    for (let i = 0; i < keep.length; i++) keptN += keep[i];
    const keptSec = keptN / fs;
    if (keptSec < SLOWING.MIN_SEGMENT_SEC) continue;

    const raw = idx.map(({ label, i }) => {
      const own = input.channelKeep?.[i];
      const ck = own ? Uint8Array.from({ length: e - s }, (_, k) => (keep[k] && own[s + k] ? 1 : 0)) : keep;
      return { label, keep: ck, x: Float64Array.from({ length: e - s }, (_, k) => input.data[i][s + k]) };
    });
    const broadBy = raw.map(({ x }) => bandpass(x, fs, SLOWING.BROAD_HZ));
    const broadRms = raw.map((r, k) => windowRms(broadBy[k], r.keep, fs));

    // posterior alpha, for the drowsiness hint
    const alpha = raw
      .filter((r) => r.label === 'O1' || r.label === 'O2')
      .map((r) => {
        const env = envelope(bandpass(r.x, fs, SLOWING.ALPHA_HZ));
        return { env, med: keptMedian(env, keep) };
      })
      .filter((a) => a.med > 0);

    const found: SlowingBurst[] = [];
    for (const band of ['delta', 'theta'] as SlowingBand[]) {
      const [, hi] = SLOWING.BANDS[band];
      const chans: Channel[] = raw.map(({ label, keep: ck, x }, k) => {
        const b = bandpass(x, fs, SLOWING.BANDS[band]);
        const env = envelope(b);
        const shape = bandpass(x, fs, [1, hi + SLOWING.SHAPE_MARGIN_HZ]);
        return { label, keep: ck, band: b, shape, broad: broadBy[k], env, medEnv: keptMedian(env, ck), broadRms: broadRms[k] };
      });
      const usable = chans.filter((c) => c.medEnv > 0);
      if (usable.length < SLOWING.MIN_CHANNELS) continue;
      const over = usable.map((c) => {
        const thr = SLOWING.ENVELOPE_FACTOR * c.medEnv;
        const m = new Uint8Array(e - s);
        for (let i = 0; i < m.length; i++) m[i] = c.keep[i] && c.env[i] > thr ? 1 : 0;
        return m;
      });

      // spans where any channel is over threshold; short gaps bridged only through kept samples
      const gap = Math.round(SLOWING.MERGE_GAP_SEC * fs);
      const spans: [number, number][] = [];
      let start = -1;
      let lastOn = -1;
      for (let i = 0; i <= e - s; i++) {
        const on = i < e - s && over.some((m) => m[i]);
        if (on) {
          if (start < 0) start = i;
          else if (i - lastOn > 1) {
            let bridged = i - lastOn - 1 <= gap;
            for (let k = lastOn + 1; bridged && k < i; k++) if (!keep[k]) bridged = false;
            if (!bridged) {
              spans.push([start, lastOn + 1]);
              start = i;
            }
          }
          lastOn = i;
        } else if (start >= 0 && (i === e - s || i - lastOn > gap || !keep[i])) {
          spans.push([start, lastOn + 1]);
          start = -1;
        }
      }

      for (const [a0, b0] of spans) {
        // the band filter rings for a few hundred ms either side: trim to the strongest channel's burst
        let best = 0;
        let bestOn = -1;
        over.forEach((m, k) => {
          let on = 0;
          for (let i = a0; i < b0; i++) on += m[i];
          if (on > bestOn) {
            bestOn = on;
            best = k;
          }
        });
        let peakEnv = 0;
        for (let i = a0; i < b0; i++) peakEnv = Math.max(peakEnv, usable[best].env[i]);
        let a = a0;
        let b = b0;
        while (a < b && usable[best].env[a] < SLOWING.EDGE_FRACTION * peakEnv) a++;
        while (b > a && usable[best].env[b - 1] < SLOWING.EDGE_FRACTION * peakEnv) b--;
        const dur = (b - a) / fs;
        if (dur < SLOWING.MIN_DURATION_SEC || dur > SLOWING.MAX_DURATION_SEC) continue;
        const candidates = usable
          .map((c, k) => {
            let on = 0;
            for (let i = a; i < b; i++) on += over[k][i];
            return { c, coverage: on / (b - a), ratio: mean(c.env, a, b) / c.medEnv };
          })
          .filter((x) => x.coverage >= SLOWING.CHANNEL_COVERAGE)
          .sort((x, y) => y.ratio - x.ratio);
        if (!candidates.length) continue;
        const involved = field(candidates);
        if (involved.length < SLOWING.MIN_CHANNELS) continue;
        if (involved.every((x) => OCULAR_SITES.has(x.c.label))) continue;

        const peak = involved[0].c;
        // eye-movement field: frontal-pole maximum falling off steeply to F3/F4
        if (peak.label.startsWith('Fp')) {
          const f = usable.filter((c) => c.label === 'F3' || c.label === 'F4' || c.label === 'Fz');
          const fRatio = f.length ? f.reduce((t, c) => t + mean(c.env, a, b) / c.medEnv, 0) / f.length : 0;
          if (!(fRatio > 0) || involved[0].ratio / fRatio > SLOWING.MAX_FRONTOPOLAR_GRADIENT) continue;
        }
        // horizontal eye movements: homologous frontal/temporal sites in opposite phase
        const ocularDipole = candidates.some((x) => {
          const h = HOMOLOGOUS[x.c.label];
          const y = h && candidates.find((z) => z.c.label === h);
          return !!y && corr(x.c.band, y.c.band, a, b) < SLOWING.MAX_HOMOLOGOUS_ANTICORR;
        });
        if (ocularDipole) continue;
        const bandShare = variance(peak.band, a, b) / Math.max(1e-12, variance(peak.broad, a, b));
        if (bandShare < SLOWING.MIN_BAND_SHARE) continue;
        const broadRatio = Math.sqrt(variance(peak.broad, a, b)) / peak.broadRms;
        if (!(broadRatio >= SLOWING.MIN_BROAD_RATIO)) continue;

        const { periods, amps } = waves(peak, a, b);
        const autocorr = rhythmicity(peak.shape, a, b, fs, SLOWING.BANDS[band]);
        const rhythmic =
          periods.length + 1 >= SLOWING.RHYTHMIC.MIN_CYCLES &&
          cv(periods) <= SLOWING.RHYTHMIC.MAX_PERIOD_CV &&
          cv(amps) <= SLOWING.RHYTHMIC.MAX_AMPLITUDE_CV &&
          autocorr >= SLOWING.RHYTHMIC.MIN_AUTOCORR;
        const meanPeriod = periods.length ? periods.reduce((x, y) => x + y, 0) / periods.length : 0;

        const sides = new Set(involved.map((x) => sideOf(x.c.label)).filter((sd) => sd !== 'midline'));
        const generalized = involved.length >= SLOWING.GENERALIZED_FRACTION * usable.length && sides.size === 2;
        const side: SlowingSide = sides.size === 2 ? 'bilateral' : sides.size === 1 ? [...sides][0] : 'midline';
        const region = REGION[peak.label];
        let posteriorAlphaRatio: number | null = null;
        if (alpha.length) posteriorAlphaRatio = round2(alpha.reduce((t, x) => t + mean(x.env, a, b) / x.med, 0) / alpha.length);

        found.push({
          condition: cond,
          band,
          pattern: patternFor(band, rhythmic, region, generalized),
          startSec: round2((s + a) / fs),
          endSec: round2((s + b) / fs),
          channels: involved.map((x) => x.c.label),
          peakChannel: peak.label,
          region,
          side,
          generalized,
          rhythmic,
          cycles: periods.length + 1,
          freqHz: meanPeriod > 0 ? round2(fs / meanPeriod) : 0,
          periodCv: periods.length > 1 ? round2(cv(periods)) : 0,
          autocorr: round2(autocorr),
          envelopeRatio: round2(involved[0].ratio),
          bandShare: round2(bandShare),
          broadRatio: round2(broadRatio),
          amplitudeUv: amps.length ? round2(median(amps)) : 0,
          posteriorAlphaRatio,
        });
      }
    }

    // a wave near 4 Hz can trip both bands: keep the delta reading
    const delta = found.filter((x) => x.band === 'delta');
    const kept = found.filter(
      (x) =>
        x.band === 'delta' ||
        !delta.some((d) => {
          const ov = Math.min(d.endSec, x.endSec) - Math.max(d.startSec, x.startSec);
          return ov > 0.5 * (x.endSec - x.startSec) && d.channels.some((c) => x.channels.includes(c));
        })
    );
    bursts.push(...kept);

    const dur = kept.map((x) => x.endSec - x.startSec);
    const patterns: Record<string, number> = {};
    for (const x of kept) patterns[x.pattern] = (patterns[x.pattern] ?? 0) + 1;
    summary[cond] = {
      analyzed_sec: round2(keptSec),
      bursts: kept.length,
      bursts_per_min: round2((kept.length / keptSec) * 60),
      burst_time_pct: round2((dur.reduce((x, y) => x + y, 0) / keptSec) * 100),
      patterns,
    };
  }
  return { bursts: bursts.sort((x, y) => x.startSec - y.startSec), summary };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export const SLOWING_DETECTOR = 'paroxysmal-slowing';
export const SLOWING_PATTERNS = [
  'firda',
  'oirda',
  'tirda',
  'irda',
  'polymorphic-delta',
  'rhythmic-theta',
  'intermittent-theta',
] as const;

/** Artifact patterns whose spans the slowing detector skips (they make slow waves of their own). */
export const SLOWING_ARTIFACT_PATTERNS = new Set(['eye-blink', 'eye-flutter', 'lateral-eye', 'movement', 'electrode-pop', 'jump']);

/** Bursts → detected events (category 'slowing', noted; they change no metric). */
export function slowingEventResults(bursts: SlowingBurst[], dismissedIds: ReadonlySet<string> = new Set()): DetectedEventResult[] {
  return bursts.map((b) => {
    const id = createHash('sha256')
      .update(`${b.pattern}|${b.peakChannel}|${b.startSec.toFixed(2)}|${b.endSec.toFixed(2)}`)
      .digest('hex')
      .slice(0, 16);
    // stronger, wider, more regular bursts are more certain; alpha dropout hints at drowsiness
    let confidence = 0.4 + Math.min(0.25, (b.envelopeRatio - SLOWING.ENVELOPE_FACTOR) * 0.05) + Math.min(0.15, b.channels.length * 0.02);
    if (b.rhythmic) confidence += 0.1;
    if (b.posteriorAlphaRatio !== null && b.posteriorAlphaRatio < SLOWING.ALPHA_DROPOUT) confidence -= 0.15;
    const evidence: DetectedEventResult['evidence'] = {
      band: b.band,
      freqHz: b.freqHz,
      cycles: b.cycles,
      rhythmic: b.rhythmic,
      location: b.generalized ? 'generalized' : b.region,
      side: b.side,
      peakChannel: b.peakChannel,
      envelopeRatio: b.envelopeRatio,
      bandShare: b.bandShare,
      broadRatio: b.broadRatio,
      amplitudeUv: b.amplitudeUv,
      periodCv: b.periodCv,
      rhythmicity: b.autocorr,
    };
    if (b.posteriorAlphaRatio !== null) {
      evidence.posteriorAlphaRatio = b.posteriorAlphaRatio;
      evidence.alphaDropout = b.posteriorAlphaRatio < SLOWING.ALPHA_DROPOUT;
    }
    return {
      id,
      category: 'slowing',
      pattern: b.pattern,
      startSec: b.startSec,
      endSec: b.endSec,
      channels: b.channels,
      confidence: round2(Math.max(0.2, Math.min(0.9, confidence))),
      evidence,
      handling: 'noted',
      source: 'detector',
      ...(dismissedIds.has(id) ? { dismissed: true } : {}),
    };
  });
}
