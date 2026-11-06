import {
  CONNECTIVITY_BANDS,
  CONNECTIVITY_BAND_NAMES,
  type Coherence,
  type ConnectivityBandName,
} from '@/lib/analysis-results';
import { planSegments, segmentSpectra } from '../dsp';
import { epochLength, type EpochSet } from './types';

// Below this a bin has no power to compare (a flat channel), in squared FFT units of µV
const MIN_POWER_PRODUCT = 1e-12;

/**
 * Classical magnitude-squared coherence per band and channel pair. Per frequency bin, over the
 * epochs k: |Σ X_k·conj(Y_k)|² / (Σ |X_k|² · Σ |Y_k|²), then the mean over the band's bins.
 * Each epoch gives one Hann-windowed, mean-removed spectrum. Unlike wPLI it keeps zero-lag
 * coupling, and each epoch counts in proportion to its amplitude. Null below two epochs, where
 * it is 1 for any signals.
 */
export function computeCoherence(set: EpochSet): Coherence | null {
  const nEp = set.epochs.length;
  if (nEp < 2) return null;
  const nTimes = epochLength(set);
  const nCh = set.channels.length;
  const plan = planSegments(nTimes, { fs: set.sfreq, nperseg: nTimes, noverlap: 0 });
  const { nfreqs } = plan;

  const specRe = Array.from({ length: nCh }, () => new Float64Array(nfreqs));
  const specIm = Array.from({ length: nCh }, () => new Float64Array(nfreqs));
  const power = Array.from({ length: nCh }, () => new Float64Array(nfreqs));
  // per pair (i < j, row-major) and bin
  const nPairs = (nCh * (nCh - 1)) / 2;
  const crossRe = new Float64Array(nPairs * nfreqs);
  const crossIm = new Float64Array(nPairs * nfreqs);

  for (const epoch of set.epochs) {
    for (let c = 0; c < nCh; c++) {
      segmentSpectra(epoch[c], plan, 0, nTimes, { re: specRe[c], im: specIm[c] });
      for (let f = 0; f < nfreqs; f++) power[c][f] += specRe[c][f] ** 2 + specIm[c][f] ** 2;
    }
    let p = 0;
    for (let i = 0; i < nCh; i++) {
      for (let j = i + 1; j < nCh; j++, p++) {
        const base = p * nfreqs;
        for (let f = 0; f < nfreqs; f++) {
          crossRe[base + f] += specRe[i][f] * specRe[j][f] + specIm[i][f] * specIm[j][f];
          crossIm[base + f] += specIm[i][f] * specRe[j][f] - specRe[i][f] * specIm[j][f];
        }
      }
    }
  }

  const matrices = {} as Coherence['matrices'];
  for (const band of CONNECTIVITY_BAND_NAMES as readonly ConnectivityBandName[]) {
    const [lo, hi] = CONNECTIVITY_BANDS[band];
    const bins: number[] = [];
    plan.freqs.forEach((f, k) => {
      if (f >= lo && f <= hi) bins.push(k);
    });
    const matrix: number[][] = Array.from({ length: nCh }, (_, i) =>
      Array.from({ length: nCh }, (_, j) => (i === j ? 1 : 0))
    );
    let p = 0;
    for (let i = 0; i < nCh; i++) {
      for (let j = i + 1; j < nCh; j++, p++) {
        let sum = 0;
        let count = 0;
        for (const f of bins) {
          const denom = power[i][f] * power[j][f];
          if (denom > MIN_POWER_PRODUCT) {
            const q = p * nfreqs + f;
            sum += (crossRe[q] ** 2 + crossIm[q] ** 2) / denom;
            count++;
          }
        }
        const value = count ? Math.min(1, sum / count) : 0;
        matrix[i][j] = value;
        matrix[j][i] = value;
      }
    }
    matrices[band] = { matrix, channels: [...set.channels] };
  }
  return { n_epochs: nEp, matrices };
}
