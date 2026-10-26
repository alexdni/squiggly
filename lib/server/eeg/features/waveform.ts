// What the waveform-label detectors (mu, slowing, alpha and beta variants, low voltage) read, and
// the signal helpers they share. The input is the cleaned, average-referenced recording with every
// mask the metrics honour, so a label never rests on data the analysis threw away.

import { createHash } from 'node:crypto';
import type { Condition } from '@/lib/analysis-results';
import { butter, FiltFilt, Hilbert, median, welch } from '../dsp';

export interface WaveformInput {
  labels: string[];
  data: ArrayLike<number>[];
  sampleRate: number;
  /** 1 where the sample survived cleaning (and no manual artifact covers it) */
  keep: Uint8Array;
  /** per channel (same order as labels): 1 where that channel's own epochs were kept */
  channelKeep?: Uint8Array[];
  /** seconds from recording start */
  segments: Partial<Record<Condition, { start: number; end: number }>>;
  /** artifact events (seconds) a detector may keep its labels off, by pattern */
  artifactSpans?: { pattern?: string; startSec: number; endSec: number }[];
}

const ALIASES: Record<string, string> = { T3: 'T7', T4: 'T8', T5: 'P7', T6: 'P8' };
export const STANDARD_SITES = [
  'Fp1', 'Fpz', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8', 'T7', 'C3', 'Cz', 'C4', 'T8',
  'P7', 'P3', 'Pz', 'P4', 'P8', 'O1', 'Oz', 'O2',
];
const BY_LOWER = new Map(STANDARD_SITES.map((k) => [k.toLowerCase(), k] as const));

/** Flattened 10-20 layout; sites one step apart (diagonals included) are neighbours. */
export const GRID: Record<string, [number, number]> = {
  Fp1: [-1, 2], Fpz: [0, 2], Fp2: [1, 2],
  F7: [-2, 1], F3: [-1, 1], Fz: [0, 1], F4: [1, 1], F8: [2, 1],
  T7: [-2, 0], C3: [-1, 0], Cz: [0, 0], C4: [1, 0], T8: [2, 0],
  P7: [-2, -1], P3: [-1, -1], Pz: [0, -1], P4: [1, -1], P8: [2, -1],
  O1: [-1, -2], Oz: [0, -2], O2: [1, -2],
};

/** Scalp neighbours on GRID, plus the Fp1–Fp2 and O1–O2 pairs. */
export function neighbours(x: string, y: string): boolean {
  if ((x === 'Fp1' && y === 'Fp2') || (x === 'Fp2' && y === 'Fp1') || (x === 'O1' && y === 'O2') || (x === 'O2' && y === 'O1')) return true;
  const a = GRID[x];
  const b = GRID[y];
  if (!a || !b) return false;
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) === 1;
}

/** `first` and the members of `rest` joined to it through neighbours. */
export function connectedTo<T>(first: T, rest: T[], site: (t: T) => string): T[] {
  const out = [first];
  const left = rest.slice();
  for (let grown = true; grown; ) {
    grown = false;
    for (let k = left.length - 1; k >= 0; k--) {
      if (out.some((x) => neighbours(site(x), site(left[k])))) {
        out.push(...left.splice(k, 1));
        grown = true;
      }
    }
  }
  return out;
}

/** 10-20 name for a label ('T3' → 'T7', 'FP1' → 'Fp1'); other labels unchanged. */
export function canonicalSite(label: string): string {
  const l = label.trim();
  return ALIASES[l] ?? ALIASES[l.toUpperCase()] ?? BY_LOWER.get(l.toLowerCase()) ?? l;
}

/** Zero-phase Butterworth band-pass (order 2); the top edge is held below 0.9 × Nyquist. */
export function bandpass(x: Float64Array, fs: number, [lo, hi]: readonly [number, number]): Float64Array {
  const nyq = fs / 2;
  const f = butter(2, [lo / nyq, Math.min(hi, nyq * 0.9) / nyq], 'bandpass');
  const out = new Float64Array(x.length);
  new FiltFilt(f.b, f.a).apply(x, out);
  return out;
}

/** Hilbert amplitude envelope. */
export function envelope(x: Float64Array): Float64Array {
  const re = new Float64Array(x.length);
  const im = new Float64Array(x.length);
  new Hilbert(x.length).transform(x, re, im);
  const env = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) env[i] = Math.hypot(re[i], im[i]);
  return env;
}

export function keptMedian(v: ArrayLike<number>, keep: Uint8Array): number {
  const kept: number[] = [];
  for (let i = 0; i < v.length; i++) if (keep[i]) kept.push(v[i]);
  return kept.length ? median(kept) : NaN;
}

/** The q-quantile (0–1) of v over kept samples; NaN when none are kept. */
export function keptPercentile(v: ArrayLike<number>, keep: Uint8Array, q: number): number {
  const kept: number[] = [];
  for (let i = 0; i < v.length; i++) if (keep[i]) kept.push(v[i]);
  if (!kept.length) return NaN;
  kept.sort((a, b) => a - b);
  return kept[Math.floor(q * (kept.length - 1))];
}

export const mean = (v: ArrayLike<number>, a: number, b: number) => {
  let s = 0;
  for (let i = a; i < b; i++) s += v[i];
  return s / Math.max(1, b - a);
};

export const variance = (v: ArrayLike<number>, a: number, b: number) => {
  const m = mean(v, a, b);
  let s = 0;
  for (let i = a; i < b; i++) s += (v[i] - m) ** 2;
  return s / Math.max(1, b - a);
};

export const cv = (v: number[]) => {
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  if (!(m > 0)) return Infinity;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) / m;
};

export const round2 = (x: number) => Math.round(x * 100) / 100;

/** Sample range of a condition segment, or null when it is missing or shorter than `minSec`. */
export function segmentRange(input: WaveformInput, cond: Condition, minSec: number): [number, number] | null {
  const seg = input.segments[cond];
  if (!seg) return null;
  const fs = input.sampleRate;
  const n = input.data[0]?.length ?? 0;
  const s = Math.max(0, Math.round(seg.start * fs));
  const e = Math.min(n, Math.round(seg.end * fs));
  return e - s >= minSec * fs ? [s, e] : null;
}

/**
 * Per-channel keep masks over [s, e): cleaning keep AND the channel's own epochs AND outside the
 * artifact spans of `patterns` (± padSec).
 */
export function channelKeeps(
  input: WaveformInput,
  s: number,
  e: number,
  patterns: ReadonlySet<string>,
  padSec = 0.25
): Uint8Array[] {
  const fs = input.sampleRate;
  const base = input.keep.slice(s, e);
  for (const sp of input.artifactSpans ?? []) {
    if (!sp.pattern || !patterns.has(sp.pattern)) continue;
    const a = Math.max(s, Math.floor((sp.startSec - padSec) * fs)) - s;
    const b = Math.min(e, Math.ceil((sp.endSec + padSec) * fs)) - s;
    if (b > a) base.fill(0, a, b);
  }
  return input.labels.map((_, i) => {
    const own = input.channelKeep?.[i];
    if (!own) return base;
    return Uint8Array.from({ length: e - s }, (_, k) => (base[k] && own[s + k] ? 1 : 0));
  });
}

/** Runs of 1 in a mask as [start, end) sample pairs, bridging gaps up to `gap` samples. */
export function runsOf(mask: Uint8Array, gap = 0): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  let last = -1;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    if (start >= 0 && i - last - 1 > gap) {
      out.push([start, last + 1]);
      start = i;
    } else if (start < 0) start = i;
    last = i;
  }
  if (start >= 0) out.push([start, last + 1]);
  return out;
}

/**
 * Peak frequency of x[a, b) between lo and hi Hz from a Hann-windowed periodogram, zero-padded to
 * 0.1 Hz resolution; null when the span is shorter than 1 s.
 */
export function peakFrequency(x: ArrayLike<number>, a: number, b: number, fs: number, lo: number, hi: number): number | null {
  const n = b - a;
  if (n < fs) return null;
  const m = mean(x, a, b);
  let best = -1;
  let bestF: number | null = null;
  for (let f = lo; f <= hi + 1e-9; f += 0.1) {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * f) / fs;
    for (let i = 0; i < n; i++) {
      const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      const v = (x[a + i] - m) * h;
      re += v * Math.cos(w * i);
      im -= v * Math.sin(w * i);
    }
    const p = re * re + im * im;
    if (p > best) {
      best = p;
      bestF = f;
    }
  }
  return bestF === null ? null : round2(bestF);
}

/** Deterministic 16-hex event id, so review decisions carry over Re-Analyze. */
export function eventIdFor(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

/**
 * Welch PSD (2 s Hann windows, no overlap) over the fully kept 2 s chunks of x[s, e); `keep` is
 * relative to s. Null with fewer than `minChunks` kept chunks.
 */
export function keptPsd(
  x: ArrayLike<number>,
  keep: Uint8Array,
  s: number,
  e: number,
  fs: number,
  minChunks = 5
): { freqs: Float64Array; psd: Float64Array } | null {
  const w = Math.round(2 * fs);
  const chunks: number[] = [];
  for (let a = s; a + w <= e; a += w) {
    let ok = true;
    for (let i = a; ok && i < a + w; i++) if (!keep[i - s]) ok = false;
    if (ok) chunks.push(a);
  }
  if (chunks.length < minChunks) return null;
  const cat = new Float64Array(chunks.length * w);
  chunks.forEach((a, k) => {
    for (let i = 0; i < w; i++) cat[k * w + i] = x[a + i];
  });
  return welch(cat, { fs, nperseg: w, noverlap: 0 });
}

/** Sum of psd over [lo, hi) Hz (bin width × values). */
export function bandPowerOf(spec: { freqs: Float64Array; psd: Float64Array }, lo: number, hi: number): number {
  const df = spec.freqs[1] - spec.freqs[0];
  let s = 0;
  for (let k = 0; k < spec.freqs.length; k++) if (spec.freqs[k] >= lo && spec.freqs[k] < hi) s += spec.psd[k];
  return s * df;
}

export interface Spectrum {
  freqs: Float64Array;
  psd: Float64Array;
}

/** Geometric mean of several spectra on the same grid; null when none. */
export function logAverage(specs: (Spectrum | null | undefined)[]): Spectrum | null {
  const ss = specs.filter((s): s is Spectrum => !!s);
  if (!ss.length) return null;
  const psd = new Float64Array(ss[0].psd.length);
  for (const sp of ss) for (let k = 0; k < psd.length; k++) psd[k] += Math.log(Math.max(sp.psd[k], 1e-30)) / ss.length;
  return { freqs: ss[0].freqs, psd: psd.map(Math.exp) };
}

/**
 * dB above a 1/f fit (log-log line over 3–40 Hz, leaving out `exclude` ranges), per bin.
 */
export function aperiodicResidual(spec: Spectrum, exclude: [number, number][] = [[6.5, 32]]): Float64Array {
  const xs: number[] = [];
  const ys: number[] = [];
  spec.freqs.forEach((f, k) => {
    if (f >= 3 && f <= 40 && !exclude.some(([a, b]) => f >= a && f <= b)) {
      xs.push(Math.log10(f));
      ys.push(Math.log10(spec.psd[k]));
    }
  });
  const out = new Float64Array(spec.freqs.length);
  if (xs.length < 3) return out;
  const mx = xs.reduce((a, b) => a + b) / xs.length;
  const my = ys.reduce((a, b) => a + b) / ys.length;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  spec.freqs.forEach((f, k) => {
    out[k] = f > 0 ? 10 * (Math.log10(spec.psd[k]) - (my + slope * (Math.log10(f) - mx))) : 0;
  });
  return out;
}

export interface SpectralPeak {
  freqHz: number;
  /** dB above the 1/f fit */
  db: number;
  /** width (Hz) of the run of bins within 3 dB of the peak; a line (device noise) is one bin */
  widthHz: number;
}

/** Highest residual between lo and hi Hz, with its width. */
export function residualPeak(spec: Spectrum, residual: Float64Array, lo: number, hi: number): SpectralPeak | null {
  let k0 = -1;
  spec.freqs.forEach((f, k) => {
    if (f >= lo && f <= hi && (k0 < 0 || residual[k] > residual[k0])) k0 = k;
  });
  if (k0 < 0) return null;
  let a = k0;
  let b = k0;
  while (a > 0 && residual[a - 1] >= residual[k0] - 3) a--;
  while (b < residual.length - 1 && residual[b + 1] >= residual[k0] - 3) b++;
  const df = spec.freqs[1] - spec.freqs[0];
  return { freqHz: round2(spec.freqs[k0]), db: round2(residual[k0]), widthHz: round2((b - a + 1) * df) };
}

/**
 * The spectrum with narrow lines (device or mains noise) replaced by the mean of their neighbours.
 * A line is a bin whose immediate neighbours are both under 35% of it, or a two-bin run whose
 * outer neighbours are under 20%: narrower than any physiological rhythm (alpha jitters in
 * frequency and spreads over 1–2 Hz).
 */
export function withoutLines(spec: Spectrum): Spectrum {
  const p = spec.psd;
  const psd = p.slice();
  for (let k = 1; k < p.length - 1; k++) {
    if (p[k - 1] < 0.35 * p[k] && p[k + 1] < 0.35 * p[k]) psd[k] = (p[k - 1] + p[k + 1]) / 2;
  }
  // a line between two bins splits over both: a two-bin run whose outer neighbours are under 20%
  for (let k = 1; k + 2 < p.length; k++) {
    const top = Math.min(p[k], p[k + 1]);
    if (p[k - 1] < 0.2 * top && p[k + 2] < 0.2 * top) {
      psd[k] = psd[k + 1] = (p[k - 1] + p[k + 2]) / 2;
    }
  }
  return { freqs: spec.freqs, psd };
}

export interface NarrowBurst {
  /** samples, relative to the segment start */
  start: number;
  end: number;
  cycles: number;
  freqHz: number;
  periodCv: number;
  /** mean envelope over the burst ÷ the channel's median envelope */
  envelopeRatio: number;
  /** where the envelope peaks, as a fraction of the burst (0.5 = middle: waxing and waning) */
  peakAt: number;
  /** median peak-to-trough of the band signal, µV */
  amplitudeUv: number;
}

/**
 * Stretches where the band envelope of x stays above `factor` × its kept median for minSec–maxSec,
 * through kept samples only, with their cycle statistics (rising zero-crossings of the band signal).
 */
export function narrowbandBursts(
  x: Float64Array,
  keep: Uint8Array,
  fs: number,
  band: readonly [number, number],
  opts: { factor: number; minSec: number; maxSec: number; mergeGapSec?: number }
): { bursts: NarrowBurst[]; band: Float64Array; env: Float64Array } {
  const b = bandpass(x, fs, band);
  const env = envelope(b);
  const med = keptMedian(env, keep);
  const bursts: NarrowBurst[] = [];
  if (!(med > 0)) return { bursts, band: b, env };
  const thr = opts.factor * med;
  const over = new Uint8Array(x.length);
  for (let i = 0; i < x.length; i++) over[i] = keep[i] && env[i] > thr ? 1 : 0;
  const gap = Math.round((opts.mergeGapSec ?? 0.1) * fs);
  for (const [a, e] of runsOf(over, gap)) {
    let kept = true;
    for (let i = a; kept && i < e; i++) if (!keep[i]) kept = false;
    const dur = (e - a) / fs;
    if (!kept || dur < opts.minSec || dur > opts.maxSec) continue;
    const rising: number[] = [];
    for (let i = a + 1; i < e; i++) if (b[i - 1] < 0 && b[i] >= 0) rising.push(i);
    const periods = rising.slice(1).map((r, k) => r - rising[k]);
    const amps: number[] = [];
    for (let k = 0; k + 1 < rising.length; k++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = rising[k]; i < rising[k + 1]; i++) {
        lo = Math.min(lo, b[i]);
        hi = Math.max(hi, b[i]);
      }
      amps.push(hi - lo);
    }
    let pk = a;
    for (let i = a; i < e; i++) if (env[i] > env[pk]) pk = i;
    const meanPeriod = periods.length ? periods.reduce((p, q) => p + q, 0) / periods.length : 0;
    bursts.push({
      start: a,
      end: e,
      cycles: Math.max(0, rising.length - 1),
      freqHz: meanPeriod > 0 ? round2(fs / meanPeriod) : 0,
      periodCv: periods.length > 1 ? round2(cv(periods)) : Infinity,
      envelopeRatio: round2(mean(env, a, e) / med),
      peakAt: round2((pk - a) / Math.max(1, e - a)),
      amplitudeUv: amps.length ? round2(median(amps)) : 0,
    });
  }
  return { bursts, band: b, env };
}

/**
 * Bursts on several channels that overlap in time (by at least half the shorter one), grouped into
 * one event per moment, keeping only channels joined to the strongest through scalp neighbours.
 */
export function groupAcrossChannels<T extends { start: number; end: number; envelopeRatio: number }>(
  perChannel: { site: string; bursts: T[] }[],
  minChannels: number
): { start: number; end: number; members: { site: string; burst: T }[] }[] {
  const all = perChannel.flatMap(({ site, bursts }) => bursts.map((burst) => ({ site, burst })));
  all.sort((p, q) => p.burst.start - q.burst.start);
  const used = new Set<number>();
  const out: { start: number; end: number; members: { site: string; burst: T }[] }[] = [];
  all.forEach((seed, i) => {
    if (used.has(i)) return;
    const group = [seed];
    used.add(i);
    all.forEach((o, j) => {
      if (used.has(j) || group.some((g) => g.site === o.site)) return;
      const ov = Math.min(seed.burst.end, o.burst.end) - Math.max(seed.burst.start, o.burst.start);
      if (ov >= 0.5 * Math.min(seed.burst.end - seed.burst.start, o.burst.end - o.burst.start)) {
        group.push(o);
        used.add(j);
      }
    });
    group.sort((p, q) => q.burst.envelopeRatio - p.burst.envelopeRatio);
    const members = connectedTo(group[0], group.slice(1), (g) => g.site);
    if (members.length < minChannels) return;
    out.push({
      start: Math.min(...members.map((m) => m.burst.start)),
      end: Math.max(...members.map((m) => m.burst.end)),
      members,
    });
  });
  return out;
}

/** Mean frequency from rising zero-crossings of x[a, b); 0 with fewer than two. */
export function zeroCrossingHz(x: ArrayLike<number>, a: number, b: number, fs: number): number {
  let first = -1;
  let last = -1;
  let n = 0;
  for (let i = a + 1; i < b; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) {
      if (first < 0) first = i;
      last = i;
      n++;
    }
  }
  return n >= 2 ? round2(((n - 1) * fs) / (last - first)) : 0;
}
