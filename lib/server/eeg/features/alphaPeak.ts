import type { AlphaPeak } from '@/lib/analysis-results';
import { planSegments, welchInto } from '../dsp';
import { epochLength, type EpochSet } from './types';

export interface AlphaPeakOptions {
  /**
   * Reproduce the Python worker's channel mixing. compute_alpha_peak did
   * `data.reshape(n_channels, -1)` on an (epochs, channels, times) array, so "channel" i was
   * really the concatenation of flat (epoch, channel) rows i*E .. i*E+E-1, i.e. a mix of
   * several channels. The default (false) concatenates each channel's own epochs, which is what
   * the code intended. Kept for parity testing only.
   */
  legacyChannelMixing?: boolean;
}

/**
 * Individual alpha frequency per channel after removing a 1/f fit. Port of
 * FeatureExtractor.compute_alpha_peak:
 *  - epochs concatenated per channel, Welch with nperseg = max(min(10 s, total), 2 s), 50% overlap
 *  - least-squares line in log10-log10 space over 3-40 Hz (PSD + 1e-10)
 *  - peak of (PSD - fitted background) within 8-12 Hz; peak_power is the uncorrected PSD there
 *  - { 0, 0 } when no residual in 8-12 Hz is positive
 */
export function computeAlphaPeak(set: EpochSet, opts: AlphaPeakOptions = {}): AlphaPeak {
  const nTimes = epochLength(set);
  const nEp = set.epochs.length;
  const nCh = set.channels.length;
  const total = nEp * nTimes;

  let nperseg = Math.min(Math.trunc(set.sfreq / 0.1), total);
  nperseg = Math.max(nperseg, Math.trunc(2 * set.sfreq));
  // Python passed noverlap = nperseg // 2 explicitly, which made scipy raise when the recording
  // was shorter than 2 s. Clamp first instead so short inputs still produce a result.
  nperseg = Math.min(nperseg, total);
  const plan = planSegments(total, { fs: set.sfreq, nperseg, noverlap: Math.floor(nperseg / 2) });
  const freqs = plan.freqs;

  const fitIdx: number[] = [];
  const alphaIdx: number[] = [];
  for (let k = 0; k < freqs.length; k++) {
    if (freqs[k] >= 3 && freqs[k] <= 40) fitIdx.push(k);
    if (freqs[k] >= 8 && freqs[k] <= 12) alphaIdx.push(k);
  }
  const logFit = fitIdx.map((k) => Math.log10(freqs[k]));

  const concat = new Float64Array(total);
  const psd = new Float64Array(plan.nfreqs);
  const out: AlphaPeak = {};

  for (let c = 0; c < nCh; c++) {
    if (opts.legacyChannelMixing) {
      for (let j = 0; j < nEp; j++) {
        const flat = c * nEp + j;
        concat.set(set.epochs[Math.floor(flat / nCh)][flat % nCh], j * nTimes);
      }
    } else {
      for (let e = 0; e < nEp; e++) concat.set(set.epochs[e][c], e * nTimes);
    }
    welchInto(concat, plan, psd);

    const ch = set.channels[c];
    const fit = fitLine(
      logFit,
      fitIdx.map((k) => Math.log10(psd[k] + 1e-10))
    );
    if (!fit || alphaIdx.length === 0) {
      out[ch] = { peak_frequency: 0.0, peak_power: 0.0 };
      continue;
    }
    let best = -1;
    let bestVal = -Infinity;
    let anyPositive = false;
    for (let i = 0; i < alphaIdx.length; i++) {
      const k = alphaIdx[i];
      const background = 10 ** (fit.slope * Math.log10(freqs[k]) + fit.intercept);
      const residual = psd[k] - background;
      if (residual > 0) anyPositive = true;
      if (residual > bestVal) {
        bestVal = residual;
        best = i;
      }
    }
    if (!anyPositive) {
      out[ch] = { peak_frequency: 0.0, peak_power: 0.0 };
      continue;
    }
    out[ch] = { peak_frequency: freqs[alphaIdx[best]], peak_power: psd[alphaIdx[best]] };
  }
  return out;
}

/** Ordinary least squares y = slope*x + intercept (numpy.polyfit deg=1); null if degenerate. */
function fitLine(x: number[], y: number[]): { slope: number; intercept: number } | null {
  const n = x.length;
  if (n < 2) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) * (x[i] - mx);
    sxy += (x[i] - mx) * (y[i] - my);
  }
  if (!(sxx > 0) || !Number.isFinite(sxy)) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}
