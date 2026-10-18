import type { PsdData } from '@/lib/analysis-results';
import { planSegments, welchInto } from '../dsp';
import { epochLength, type EpochSet } from './types';

export const PSD_FMIN = 1;
export const PSD_FMAX = 45;

const round4 = (v: number) => (v === 0 || !Number.isFinite(v) ? 0 : Number(v.toPrecision(4)));

/**
 * Mean Welch PSD (µV²/Hz) per channel over the kept epochs, for the PSD head map. One Hann window
 * spans the whole epoch (0.5 Hz bins for 2 s epochs), averaged across epochs; limited to 1-45 Hz.
 */
export function computePsd(set: EpochSet): PsdData {
  const nTimes = epochLength(set);
  const plan = planSegments(nTimes, { fs: set.sfreq, nperseg: nTimes });
  const bins: number[] = [];
  plan.freqs.forEach((f, k) => {
    if (f >= PSD_FMIN && f <= PSD_FMAX) bins.push(k);
  });

  const tmp = new Float64Array(plan.nfreqs);
  const channels: Record<string, number[]> = {};
  set.channels.forEach((ch, c) => {
    const acc = new Float64Array(plan.nfreqs);
    for (const epoch of set.epochs) {
      welchInto(epoch[c], plan, tmp);
      for (let k = 0; k < acc.length; k++) acc[k] += tmp[k];
    }
    channels[ch] = bins.map((k) => round4(acc[k] / set.epochs.length));
  });

  return { freqs: bins.map((k) => Math.round(plan.freqs[k] * 1000) / 1000), channels };
}
