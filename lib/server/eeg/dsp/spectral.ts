// Welch PSD, cross-spectral density and spectrogram with scipy.signal semantics
// (scipy 1.13 _spectral_helper): periodic window, segments of nperseg with step nperseg-noverlap
// and no boundary padding, per-segment mean removal (detrend='constant'), density scaling
// 1/(fs·Σw²), one-sided doubling of every bin except DC (and Nyquist for even nfft), and mean
// averaging across segments.

import { getRealFft, rfftfreq } from './fft';
import { getWindow, type WindowSpec } from './windows';

export interface SegmentOptions {
  fs: number;
  nperseg: number;
  /** default nperseg // 2 */
  noverlap?: number;
  /** default 'hann' (welch/csd); scipy.signal.spectrogram uses { tukey: 0.25 } */
  window?: WindowSpec;
}

export interface SegmentPlan {
  fs: number;
  nperseg: number;
  noverlap: number;
  step: number;
  window: Float64Array;
  /** density scale 1/(fs·Σw²) */
  scale: number;
  freqs: Float64Array;
  nfreqs: number;
}

/**
 * Resolve segment parameters for a signal of `length` samples the way scipy does: when nperseg
 * exceeds the input it is clamped to the input length (scipy warns), and noverlap defaults to
 * nperseg // 2 after clamping.
 */
export function planSegments(length: number, opts: SegmentOptions): SegmentPlan {
  let nperseg = Math.trunc(opts.nperseg);
  if (nperseg < 1) throw new Error('nperseg must be a positive integer');
  if (nperseg > length) nperseg = length;
  const noverlap = opts.noverlap === undefined ? Math.floor(nperseg / 2) : Math.trunc(opts.noverlap);
  if (noverlap >= nperseg) throw new Error('noverlap must be less than nperseg.');
  const window = getWindow(opts.window ?? 'hann', nperseg);
  let wss = 0;
  for (let i = 0; i < nperseg; i++) wss += window[i] * window[i];
  const freqs = rfftfreq(nperseg, 1 / opts.fs);
  return {
    fs: opts.fs,
    nperseg,
    noverlap,
    step: nperseg - noverlap,
    window,
    scale: 1.0 / (opts.fs * wss),
    freqs,
    nfreqs: freqs.length,
  };
}

export function segmentCount(length: number, plan: SegmentPlan): number {
  if (length < plan.nperseg) return 0;
  return Math.floor((length - plan.nperseg) / plan.step) + 1;
}

/** Weight applied to |X|² / cross-products per bin: scale, doubled except DC (and even-n Nyquist). */
export function onesidedWeights(plan: SegmentPlan): Float64Array {
  const w = new Float64Array(plan.nfreqs).fill(plan.scale * 2);
  w[0] = plan.scale;
  if (plan.nperseg % 2 === 0) w[plan.nfreqs - 1] = plan.scale;
  return w;
}

/**
 * Detrended, windowed rfft of every segment of `x[offset .. offset+length)`.
 * Returns [segment][bin] spectra packed as re/im arrays of size nseg*nfreqs.
 */
export function segmentSpectra(
  x: ArrayLike<number>,
  plan: SegmentPlan,
  offset = 0,
  length = x.length - offset,
  out?: { re: Float64Array; im: Float64Array }
): { re: Float64Array; im: Float64Array; nseg: number } {
  const nseg = segmentCount(length, plan);
  const { nperseg, step, window, nfreqs } = plan;
  const re = out?.re ?? new Float64Array(nseg * nfreqs);
  const im = out?.im ?? new Float64Array(nseg * nfreqs);
  const rf = getRealFft(nperseg);
  const seg = new Float64Array(nperseg);
  const binRe = new Float64Array(nfreqs);
  const binIm = new Float64Array(nfreqs);
  for (let s = 0; s < nseg; s++) {
    const start = offset + s * step;
    let mean = 0;
    for (let t = 0; t < nperseg; t++) mean += x[start + t];
    mean /= nperseg;
    for (let t = 0; t < nperseg; t++) seg[t] = (x[start + t] - mean) * window[t];
    rf.transform(seg, binRe, binIm);
    re.set(binRe, s * nfreqs);
    im.set(binIm, s * nfreqs);
  }
  return { re, im, nseg };
}

/** scipy.signal.welch (average='mean'). */
export function welch(x: ArrayLike<number>, opts: SegmentOptions): { freqs: Float64Array; psd: Float64Array } {
  const plan = planSegments(x.length, opts);
  const psd = new Float64Array(plan.nfreqs);
  welchInto(x, plan, psd);
  return { freqs: plan.freqs, psd };
}

/**
 * Welch PSD of x[offset .. offset+length) written into `out` (length nfreqs).
 * Reuses `plan` so callers looping over many epochs avoid re-planning.
 */
export function welchInto(
  x: ArrayLike<number>,
  plan: SegmentPlan,
  out: Float64Array,
  offset = 0,
  length = x.length - offset
): void {
  const { re, im, nseg } = segmentSpectra(x, plan, offset, length);
  const nf = plan.nfreqs;
  const w = onesidedWeights(plan);
  out.fill(0);
  for (let s = 0; s < nseg; s++) {
    const base = s * nf;
    for (let k = 0; k < nf; k++) out[k] += (re[base + k] * re[base + k] + im[base + k] * im[base + k]) * w[k];
  }
  for (let k = 0; k < nf; k++) out[k] /= nseg;
}

/** scipy.signal.csd: Pxy = mean over segments of conj(X)·Y, density-scaled, one-sided. */
export function csd(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  opts: SegmentOptions
): { freqs: Float64Array; re: Float64Array; im: Float64Array } {
  if (x.length !== y.length) throw new Error('csd: x and y must have equal length');
  const plan = planSegments(x.length, opts);
  const X = segmentSpectra(x, plan);
  const Y = segmentSpectra(y, plan);
  const nf = plan.nfreqs;
  const w = onesidedWeights(plan);
  const re = new Float64Array(nf);
  const im = new Float64Array(nf);
  for (let s = 0; s < X.nseg; s++) {
    const base = s * nf;
    for (let k = 0; k < nf; k++) {
      const xr = X.re[base + k];
      const xi = X.im[base + k];
      const yr = Y.re[base + k];
      const yi = Y.im[base + k];
      re[k] += (xr * yr + xi * yi) * w[k];
      im[k] += (xr * yi - xi * yr) * w[k];
    }
  }
  for (let k = 0; k < nf; k++) {
    re[k] /= X.nseg;
    im[k] /= X.nseg;
  }
  return { freqs: plan.freqs, re, im };
}

/**
 * scipy.signal.spectrogram (mode='psd'). Defaults to scipy's Tukey(0.25) window.
 * Returns sxx as [freq][time] like scipy.
 */
export function spectrogram(
  x: ArrayLike<number>,
  opts: SegmentOptions
): { freqs: Float64Array; times: Float64Array; sxx: Float64Array[] } {
  const plan = planSegments(x.length, { window: { tukey: 0.25 }, ...opts });
  const { re, im, nseg } = segmentSpectra(x, plan);
  const nf = plan.nfreqs;
  const w = onesidedWeights(plan);
  const sxx: Float64Array[] = [];
  for (let k = 0; k < nf; k++) sxx.push(new Float64Array(nseg));
  for (let s = 0; s < nseg; s++) {
    const base = s * nf;
    for (let k = 0; k < nf; k++) sxx[k][s] = (re[base + k] * re[base + k] + im[base + k] * im[base + k]) * w[k];
  }
  // np.arange(nperseg/2, len - nperseg/2 + 1, step) / fs
  const times = new Float64Array(nseg);
  for (let s = 0; s < nseg; s++) times[s] = (plan.nperseg / 2 + s * plan.step) / plan.fs;
  return { freqs: plan.freqs, times, sxx };
}
