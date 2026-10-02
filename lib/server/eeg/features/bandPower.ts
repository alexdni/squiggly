import { BANDS, BAND_NAMES, type BandName, type BandPower } from '@/lib/analysis-results';
import { planSegments, trapz, welchInto } from '../dsp';
import { epochLength, type EpochSet } from './types';

/**
 * Absolute (µV², trapezoid over the Welch PSD for low <= f < high) and relative (fraction of
 * the summed band powers) power per channel. Welch: 1 s Hann windows, 50% overlap, per epoch,
 * then averaged across epochs. Port of FeatureExtractor.compute_band_power.
 */
export function computeBandPower(set: EpochSet): BandPower {
  const nTimes = epochLength(set);
  const nperseg = Math.min(Math.trunc(set.sfreq), nTimes);
  const plan = planSegments(nTimes, { fs: set.sfreq, nperseg });
  const freqs = plan.freqs;
  const nCh = set.channels.length;
  const nEp = set.epochs.length;

  const psdMean: Float64Array[] = set.channels.map(() => new Float64Array(plan.nfreqs));
  const tmp = new Float64Array(plan.nfreqs);
  for (let e = 0; e < nEp; e++) {
    for (let c = 0; c < nCh; c++) {
      welchInto(set.epochs[e][c], plan, tmp);
      const acc = psdMean[c];
      for (let k = 0; k < tmp.length; k++) acc[k] += tmp[k];
    }
  }
  for (const acc of psdMean) for (let k = 0; k < acc.length; k++) acc[k] /= nEp;

  const bandIdx = BAND_NAMES.map((band) => {
    const [lo, hi] = BANDS[band];
    const idx: number[] = [];
    for (let k = 0; k < freqs.length; k++) if (freqs[k] >= lo && freqs[k] < hi) idx.push(k);
    return { band, f: idx.map((k) => freqs[k]), idx };
  });

  const out: BandPower = {};
  set.channels.forEach((ch, c) => {
    const entry = {} as Record<BandName, { absolute: number; relative: number }>;
    let total = 0;
    for (const { band, f, idx } of bandIdx) {
      const absolute = trapz(
        idx.map((k) => psdMean[c][k]),
        f
      );
      entry[band] = { absolute, relative: 0 };
      total += absolute;
    }
    for (const band of BAND_NAMES) entry[band].relative = total > 0 ? entry[band].absolute / total : 0;
    out[ch] = entry;
  });
  return out;
}
