// Normal-variant patterns read the way an EEGer reads them, from the cleaned, average-referenced
// recording (see waveform.ts for the input and masks):
// - beta spindles: recurring waxing-and-waning frontocentral beta bursts at the recording's own
//   beta peak (typical of benzodiazepines/barbiturates, drowsiness, or a normal fast background);
// - fast alpha variant: a posterior rhythm at twice the alpha frequency that replaces alpha and is
//   posterior like it (a harmonic of alpha, not beta);
// - low-voltage fast EEG: the whole condition low in amplitude, alpha poorly developed, beta at
//   least equal to alpha.
// Spectral peaks are measured with narrow lines (device noise) removed and must be at least 1 Hz
// wide. Every label is noted only; none changes a metric.

import type { Condition, DetectedEventResult, VariantScreen } from '@/lib/analysis-results';
import { median } from '../dsp';
import {
  aperiodicResidual,
  bandPowerOf,
  bandpass,
  canonicalSite,
  channelKeeps,
  eventIdFor,
  groupAcrossChannels,
  keptPsd,
  logAverage,
  narrowbandBursts,
  residualPeak,
  round2,
  segmentRange,
  STANDARD_SITES,
  variance,
  withoutLines,
  zeroCrossingHz,
  cv,
  envelope,
  keptPercentile,
  mean,
  runsOf,
  type NarrowBurst,
  type Spectrum,
  type WaveformInput,
} from './waveform';

export const VARIANTS = {
  MIN_SEGMENT_SEC: 30,
  /** artifact events whose spans the variant labels stay off */
  ARTIFACT_PATTERNS: new Set(['eye-blink', 'eye-flutter', 'lateral-eye', 'movement', 'electrode-pop', 'jump', 'muscle', 'chewing']),
  /** a spectral peak must stand this far above the 1/f fit and be at least this wide */
  MIN_PEAK_DB: 3,
  MIN_PEAK_WIDTH_HZ: 1,
  BETA: {
    RANGE_HZ: [14, 30] as [number, number],
    HALF_BAND_HZ: 3,
    ENVELOPE_FACTOR: 2,
    MIN_SEC: 0.5,
    MAX_SEC: 3,
    MAX_PERIOD_CV: 0.2,
    /** envelope peak between these fractions of the burst: waxing and waning */
    PEAK_AT: [0.15, 0.85] as [number, number],
    /** 30–45 Hz variance ÷ band variance above this is muscle */
    MAX_MUSCLE_RATIO: 0.5,
    MIN_CHANNELS: 2,
    /** a condition yields spindle events only when they recur at least this often */
    MIN_PER_MIN: 1,
    /** the band stays this far above the alpha peak */
    ALPHA_CLEARANCE_HZ: 2.5,
    /**
     * a burst riding on a large alpha/mu train (alpha-band variance ≥ this × the band's) at twice
     * its frequency (± HARMONIC_TOLERANCE_HZ) is the alpha's harmonic, not beta
     */
    HARMONIC_ALPHA_RATIO: 2,
    HARMONIC_TOLERANCE_HZ: 1.5,
  },
  FAST_ALPHA: {
    RANGE_HZ: [14, 21] as [number, number],
    /** |fast peak − 2 × alpha peak| at most this */
    HARMONIC_TOLERANCE_HZ: 1,
    /**
     * posterior fast-band ÷ alpha-band power (±1.5 Hz) over the condition at least this (the
     * harmonic of an ordinary sharp alpha stays well below), and inside each burst at least
     * BURST_DOMINANCE (there the fast rhythm replaces alpha)
     */
    MIN_DOMINANCE: 0.6,
    BURST_DOMINANCE: 1,
    /** posterior ÷ frontal fast-band power at least this */
    MIN_POSTERIOR_RATIO: 1.5,
    /** EO ÷ EC posterior fast-band power at most this, when the file has both */
    MAX_REACTIVITY: 0.6,
    /**
     * a burst is where the fast envelope exceeds the alpha envelope (it stands in for alpha) and is
     * at least this × its own 20th percentile (clear of the quiet background); it can last the
     * whole condition, so it is not measured against the median
     */
    BACKGROUND_FACTOR: 2,
    MIN_SEC: 1,
    MAX_PERIOD_CV: 0.2,
    MIN_CHANNELS: 2,
  },
  LOW_VOLTAGE: {
    /** median over channels of the 95th percentile 1 s peak-to-peak (1–30 Hz), µV */
    MAX_AMPLITUDE_UV: 20,
    /** below this the units are suspect, not the brain */
    MIN_PLAUSIBLE_UV: 2,
    /** eyes closed: posterior 8–12 Hz share of 1–30 Hz at most this, and no clear alpha peak */
    MAX_ALPHA_SHARE: 0.15,
    MAX_ALPHA_PEAK_DB: 4,
    MIN_SITES: 8,
  },
} as const;

const POSTERIOR = ['P3', 'Pz', 'P4', 'O1', 'Oz', 'O2', 'P7', 'P8'];
const FRONTAL = ['Fp1', 'Fpz', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8'];
const FRONTOCENTRAL = [...FRONTAL, 'C3', 'Cz', 'C4'];

export const BETA_SPINDLE_PATTERN = 'beta-spindles';
export const FAST_ALPHA_PATTERN = 'fast-alpha-variant';
export const LOW_VOLTAGE_PATTERN = 'low-voltage-fast';
export const VARIANT_DETECTORS = [BETA_SPINDLE_PATTERN, FAST_ALPHA_PATTERN, LOW_VOLTAGE_PATTERN] as const;

interface Prepared {
  cond: Condition;
  s: number;
  e: number;
  keptSec: number;
  sites: string[];
  keeps: Uint8Array[];
  specs: (Spectrum | null)[];
}

function prepare(input: WaveformInput, cond: Condition): Prepared | null {
  const r = segmentRange(input, cond, VARIANTS.MIN_SEGMENT_SEC);
  if (!r) return null;
  const [s, e] = r;
  const keeps = channelKeeps(input, s, e, VARIANTS.ARTIFACT_PATTERNS);
  let kept = 0;
  for (let i = 0; i < keeps[0].length; i++) kept += input.keep[s + i];
  const keptSec = kept / input.sampleRate;
  if (keptSec < VARIANTS.MIN_SEGMENT_SEC) return null;
  const specs = input.data.map((d, i) => {
    const sp = keptPsd(d, keeps[i], s, e, input.sampleRate);
    return sp ? withoutLines(sp) : null;
  });
  return { cond, s, e, keptSec, sites: input.labels.map(canonicalSite), keeps, specs };
}

const groupSpectrum = (p: Prepared, group: string[]) =>
  logAverage(p.sites.map((site, i) => (group.includes(site) ? p.specs[i] : null)));

const segment = (input: WaveformInput, p: Prepared, i: number) =>
  Float64Array.from({ length: p.e - p.s }, (_, k) => input.data[i][p.s + k]);

function alphaPeakHz(post: Spectrum): number {
  let best = -1;
  let f0 = 0;
  post.freqs.forEach((f, k) => {
    if (f >= 7 && f <= 13 && post.psd[k] > best) {
      best = post.psd[k];
      f0 = f;
    }
  });
  return f0;
}

// ---------- beta spindles ----------

export interface BetaSpindle {
  condition: Condition;
  startSec: number;
  endSec: number;
  channels: string[];
  freqHz: number;
  cycles: number;
  amplitudeUv: number;
  envelopeRatio: number;
  betaPeakHz: number;
  betaPeakDb: number;
}

function betaSpindles(input: WaveformInput, p: Prepared, screen: VariantScreen): BetaSpindle[] {
  const B = VARIANTS.BETA;
  const fs = input.sampleRate;
  const front = groupSpectrum(p, FRONTAL);
  if (!front) return [];
  const peak = residualPeak(front, aperiodicResidual(front), B.RANGE_HZ[0], B.RANGE_HZ[1]);
  const out: VariantScreen['beta_spindles'] = { beta_peak_hz: peak?.freqHz ?? null, beta_peak_db: peak?.db ?? null, spindles: 0, per_min: 0 };
  screen.beta_spindles = out;
  // a peak at the edge of the range is the shoulder of alpha (or of muscle), not a beta rhythm
  if (
    !peak ||
    peak.db < VARIANTS.MIN_PEAK_DB ||
    peak.widthHz < VARIANTS.MIN_PEAK_WIDTH_HZ ||
    peak.freqHz <= B.RANGE_HZ[0] + 0.5 ||
    peak.freqHz >= B.RANGE_HZ[1] - 0.5
  ) {
    return [];
  }
  // a harmonic of the posterior alpha rhythm, stronger posteriorly, is the alpha's (fast alpha variant)
  const post = groupSpectrum(p, POSTERIOR);
  const iaf = post ? alphaPeakHz(post) : 10;
  if (post) {
    const postPeak = residualPeak(post, aperiodicResidual(post), peak.freqHz - 0.5, peak.freqHz + 0.5);
    if (Math.abs(peak.freqHz - 2 * iaf) <= 1 && postPeak && postPeak.db > peak.db) return [];
  }
  const band: [number, number] = [Math.max(iaf + B.ALPHA_CLEARANCE_HZ, peak.freqHz - B.HALF_BAND_HZ), peak.freqHz + B.HALF_BAND_HZ];
  if (band[1] - band[0] < 2) return [];
  const perChannel: { site: string; bursts: NarrowBurst[] }[] = [];
  p.sites.forEach((site, i) => {
    if (!FRONTOCENTRAL.includes(site)) return;
    const x = segment(input, p, i);
    const { bursts, band: b } = narrowbandBursts(x, p.keeps[i], fs, band, {
      factor: B.ENVELOPE_FACTOR,
      minSec: B.MIN_SEC,
      maxSec: B.MAX_SEC,
    });
    const muscle = fs > 95 ? bandpass(x, fs, [30, 45]) : null;
    const alphaSig = bandpass(x, fs, [7, 13]);
    const harmonic = (q: NarrowBurst) =>
      variance(alphaSig, q.start, q.end) >= B.HARMONIC_ALPHA_RATIO * variance(b, q.start, q.end) &&
      Math.abs(q.freqHz - 2 * zeroCrossingHz(alphaSig, q.start, q.end, fs)) <= B.HARMONIC_TOLERANCE_HZ;
    const ok = bursts.filter(
      (q) =>
        !harmonic(q) &&
        q.periodCv <= B.MAX_PERIOD_CV &&
        q.peakAt >= B.PEAK_AT[0] &&
        q.peakAt <= B.PEAK_AT[1] &&
        Math.abs(q.freqHz - peak.freqHz) <= B.HALF_BAND_HZ &&
        (!muscle || variance(muscle, q.start, q.end) / Math.max(1e-12, variance(b, q.start, q.end)) <= B.MAX_MUSCLE_RATIO)
    );
    perChannel.push({ site, bursts: ok });
  });
  const groups = groupAcrossChannels(perChannel, B.MIN_CHANNELS);
  out.spindles = groups.length;
  out.per_min = round2((groups.length / p.keptSec) * 60);
  if (out.per_min < B.MIN_PER_MIN) return [];
  return groups.map((g) => ({
    condition: p.cond,
    startSec: round2((p.s + g.start) / fs),
    endSec: round2((p.s + g.end) / fs),
    channels: g.members.map((m) => m.site),
    freqHz: round2(median(g.members.map((m) => m.burst.freqHz))),
    cycles: Math.max(...g.members.map((m) => m.burst.cycles)),
    amplitudeUv: round2(Math.max(...g.members.map((m) => m.burst.amplitudeUv))),
    envelopeRatio: g.members[0].burst.envelopeRatio,
    betaPeakHz: peak.freqHz,
    betaPeakDb: peak.db,
  }));
}

// ---------- fast alpha variant ----------

export interface FastAlphaBurst {
  condition: Condition;
  startSec: number;
  endSec: number;
  channels: string[];
  freqHz: number;
  alphaHz: number;
  cycles: number;
  dominance: number;
  reactivity: number | null;
}

function fastAlpha(input: WaveformInput, p: Prepared, eo: Prepared | null, screen: VariantScreen): FastAlphaBurst[] {
  const F = VARIANTS.FAST_ALPHA;
  const fs = input.sampleRate;
  const post = groupSpectrum(p, POSTERIOR);
  if (!post) return [];
  const iaf = alphaPeakHz(post);
  const peak = residualPeak(post, aperiodicResidual(post), F.RANGE_HZ[0], F.RANGE_HZ[1]);
  const fastBand = (sp: Spectrum, f: number) => bandPowerOf(sp, f - 1.5, f + 1.5);
  const dominance = peak ? round2(fastBand(post, peak.freqHz) / Math.max(1e-12, fastBand(post, iaf))) : null;
  const front = groupSpectrum(p, FRONTAL);
  const posteriorRatio = peak && front ? round2(fastBand(post, peak.freqHz) / Math.max(1e-12, fastBand(front, peak.freqHz))) : null;
  const eoPost = eo ? groupSpectrum(eo, POSTERIOR) : null;
  const reactivity = peak && eoPost ? round2(fastBand(eoPost, peak.freqHz) / Math.max(1e-12, fastBand(post, peak.freqHz))) : null;
  screen.fast_alpha = { alpha_hz: iaf, fast_peak_hz: peak?.freqHz ?? null, fast_peak_db: peak?.db ?? null, dominance, posterior_ratio: posteriorRatio, reactivity, bursts: 0 };
  if (
    !peak ||
    peak.db < VARIANTS.MIN_PEAK_DB ||
    peak.widthHz < VARIANTS.MIN_PEAK_WIDTH_HZ ||
    Math.abs(peak.freqHz - 2 * iaf) > F.HARMONIC_TOLERANCE_HZ ||
    (dominance ?? 0) < F.MIN_DOMINANCE ||
    (posteriorRatio !== null && posteriorRatio < F.MIN_POSTERIOR_RATIO) ||
    (reactivity !== null && reactivity > F.MAX_REACTIVITY)
  ) {
    return [];
  }
  const perChannel: { site: string; bursts: NarrowBurst[] }[] = [];
  p.sites.forEach((site, i) => {
    if (!POSTERIOR.includes(site)) return;
    const x = segment(input, p, i);
    const fastSig = bandpass(x, fs, [peak.freqHz - 1.5, peak.freqHz + 1.5]);
    const fastEnv = envelope(fastSig);
    const alphaEnv = envelope(bandpass(x, fs, [Math.max(1, iaf - 1.5), iaf + 1.5]));
    const floor = F.BACKGROUND_FACTOR * keptPercentile(fastEnv, p.keeps[i], 0.2);
    const mask = new Uint8Array(x.length);
    for (let k = 0; k < x.length; k++) mask[k] = p.keeps[i][k] && fastEnv[k] > alphaEnv[k] && fastEnv[k] > floor ? 1 : 0;
    const bursts: NarrowBurst[] = [];
    for (const [a, b] of runsOf(mask, Math.round(0.2 * fs))) {
      if ((b - a) / fs < F.MIN_SEC) continue;
      let kept = true;
      for (let k = a; kept && k < b; k++) if (!p.keeps[i][k]) kept = false;
      if (!kept) continue;
      const rising: number[] = [];
      for (let k = a + 1; k < b; k++) if (fastSig[k - 1] < 0 && fastSig[k] >= 0) rising.push(k);
      const periods = rising.slice(1).map((v, k) => v - rising[k]);
      if (periods.length < 2 || cv(periods) > F.MAX_PERIOD_CV) continue;
      bursts.push({
        start: a,
        end: b,
        cycles: periods.length,
        freqHz: zeroCrossingHz(fastSig, a, b, fs),
        periodCv: round2(cv(periods)),
        envelopeRatio: round2(mean(fastEnv, a, b) / Math.max(1e-12, mean(alphaEnv, a, b))),
        peakAt: 0.5,
        amplitudeUv: 0,
      });
    }
    perChannel.push({ site, bursts });
  });
  const groups = groupAcrossChannels(perChannel, F.MIN_CHANNELS);
  screen.fast_alpha.bursts = groups.length;
  return groups.map((g) => ({
    condition: p.cond,
    startSec: round2((p.s + g.start) / fs),
    endSec: round2((p.s + g.end) / fs),
    channels: g.members.map((m) => m.site),
    freqHz: round2(median(g.members.map((m) => m.burst.freqHz))),
    alphaHz: iaf,
    cycles: Math.max(...g.members.map((m) => m.burst.cycles)),
    dominance: dominance!,
    reactivity,
  }));
}

// ---------- low-voltage fast ----------

export interface LowVoltage {
  condition: Condition;
  startSec: number;
  endSec: number;
  amplitudeUv: number;
  alphaShare: number;
  betaShare: number;
  alphaPeakDb: number;
  eyesClosed: boolean;
}

function lowVoltage(input: WaveformInput, p: Prepared, screen: VariantScreen): LowVoltage | null {
  const L = VARIANTS.LOW_VOLTAGE;
  const fs = input.sampleRate;
  if (p.sites.filter((s) => STANDARD_SITES.includes(s)).length < L.MIN_SITES) return null;
  const win = Math.round(fs);
  const p95: number[] = [];
  input.data.forEach((_, i) => {
    const x = bandpass(segment(input, p, i), fs, [1, 30]);
    const pp: number[] = [];
    for (let a = 0; a + win <= x.length; a += win) {
      let ok = true;
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = a; ok && k < a + win; k++) {
        if (!p.keeps[i][k]) ok = false;
        lo = Math.min(lo, x[k]);
        hi = Math.max(hi, x[k]);
      }
      if (ok) pp.push(hi - lo);
    }
    if (pp.length >= 10) {
      pp.sort((a, b) => a - b);
      p95.push(pp[Math.floor(0.95 * (pp.length - 1))]);
    }
  });
  const post = groupSpectrum(p, POSTERIOR);
  if (p95.length < L.MIN_SITES || !post) return null;
  const amplitudeUv = round2(median(p95));
  const total = bandPowerOf(post, 1, 30);
  const alphaShare = round2(bandPowerOf(post, 8, 12) / total);
  const betaShare = round2(bandPowerOf(post, 13, 30) / total);
  const alphaPeakDb = residualPeak(post, aperiodicResidual(post), 7, 13)?.db ?? 0;
  const eyesClosed = p.cond === 'ec';
  screen.low_voltage = { amplitude_uv: amplitudeUv, alpha_share: alphaShare, beta_share: betaShare, alpha_peak_db: alphaPeakDb, flagged: false };
  if (amplitudeUv < L.MIN_PLAUSIBLE_UV || amplitudeUv > L.MAX_AMPLITUDE_UV || betaShare < alphaShare) return null;
  if (eyesClosed && (alphaShare > L.MAX_ALPHA_SHARE || alphaPeakDb >= L.MAX_ALPHA_PEAK_DB)) return null;
  screen.low_voltage.flagged = true;
  return {
    condition: p.cond,
    startSec: round2(p.s / fs),
    endSec: round2(p.e / fs),
    amplitudeUv,
    alphaShare,
    betaShare,
    alphaPeakDb,
    eyesClosed,
  };
}

// ---------- all three ----------

export interface VariantDetection {
  betaSpindles: BetaSpindle[];
  fastAlpha: FastAlphaBurst[];
  lowVoltage: LowVoltage[];
  summary: Partial<Record<Condition, VariantScreen>>;
  skipped?: string;
}

export function detectVariants(input: WaveformInput): VariantDetection {
  const out: VariantDetection = { betaSpindles: [], fastAlpha: [], lowVoltage: [], summary: {} };
  if (input.labels.map(canonicalSite).filter((s) => STANDARD_SITES.includes(s)).length < 4) {
    out.skipped = 'needs at least 4 standard 10-20 electrodes';
    return out;
  }
  const eo = prepare(input, 'eo');
  const ec = prepare(input, 'ec');
  for (const p of [eo, ec]) {
    if (!p) continue;
    const screen: VariantScreen = { analyzed_sec: round2(p.keptSec) };
    out.betaSpindles.push(...betaSpindles(input, p, screen));
    // the fast alpha variant replaces the eyes-closed alpha rhythm
    if (p.cond === 'ec') out.fastAlpha.push(...fastAlpha(input, p, eo, screen));
    const lv = lowVoltage(input, p, screen);
    if (lv) out.lowVoltage.push(lv);
    out.summary[p.cond] = screen;
  }
  return out;
}

const confidence = (x: number) => round2(Math.max(0.2, Math.min(0.9, x)));

/** Detections → noted 'variant' events with deterministic ids. */
export function variantEventResults(v: VariantDetection, dismissed: ReadonlySet<string> = new Set()): DetectedEventResult[] {
  const make = (pattern: string, startSec: number, endSec: number, channels: string[], conf: number, evidence: DetectedEventResult['evidence']): DetectedEventResult => {
    const id = eventIdFor([pattern, channels[0] ?? 'all', startSec.toFixed(2), endSec.toFixed(2)]);
    return {
      id,
      category: 'variant',
      pattern,
      startSec,
      endSec,
      channels,
      confidence: confidence(conf),
      evidence,
      handling: 'noted',
      source: 'detector',
      ...(dismissed.has(id) ? { dismissed: true } : {}),
    };
  };
  return [
    ...v.betaSpindles.map((b) =>
      make(BETA_SPINDLE_PATTERN, b.startSec, b.endSec, b.channels, 0.4 + Math.min(0.3, (b.envelopeRatio - 2.5) * 0.1) + Math.min(0.2, b.channels.length * 0.03), {
        freqHz: b.freqHz,
        cycles: b.cycles,
        amplitudeUv: b.amplitudeUv,
        envelopeRatio: b.envelopeRatio,
        betaPeakHz: b.betaPeakHz,
        betaPeakDb: b.betaPeakDb,
      })
    ),
    ...v.fastAlpha.map((f) =>
      make(FAST_ALPHA_PATTERN, f.startSec, f.endSec, f.channels, f.reactivity !== null ? 0.75 : 0.55, {
        freqHz: f.freqHz,
        alphaHz: f.alphaHz,
        cycles: f.cycles,
        dominance: f.dominance,
        ...(f.reactivity !== null ? { eoEcRatio: f.reactivity } : { reactivity: 'not assessed (no eyes-open segment in this file)' }),
      })
    ),
    ...v.lowVoltage.map((l) =>
      make(LOW_VOLTAGE_PATTERN, l.startSec, l.endSec, [], l.eyesClosed ? 0.75 : 0.45, {
        amplitudeUv: l.amplitudeUv,
        alphaShare: l.alphaShare,
        betaShare: l.betaShare,
        alphaPeakDb: l.alphaPeakDb,
        eyesClosed: l.eyesClosed,
      })
    ),
  ];
}
