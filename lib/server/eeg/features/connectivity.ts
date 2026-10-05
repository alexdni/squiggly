import {
  CONNECTIVITY_BANDS,
  CONNECTIVITY_BAND_NAMES,
  type Connectivity,
  type ConnectivityBandName,
  type NetworkMetrics,
} from '@/lib/analysis-results';
import { butter, FiltFilt, Hilbert, onesidedWeights, planSegments, segmentCount, segmentSpectra } from '../dsp';
import { computeNetworkMetrics } from './network';
import {
  CHANNEL_GROUPS,
  CSD_WPLI_EPS,
  epochLength,
  HILBERT_WPLI_EPS,
  INTERHEMISPHERIC_PAIRS,
  type EpochSet,
} from './types';

export interface WpliByMethod {
  /** upper-triangle pair order (i < j, row-major), one value per pair */
  csd: Float64Array;
  hilbert: Float64Array;
}

/**
 * wPLI per band and channel pair, computed two ways (as FeatureExtractor.compute_connectivity):
 *  - CSD: per epoch scipy.signal.csd on raw data (nperseg = max(min(fs, n/2), 64), 50% overlap);
 *    per frequency bin in [low, high], |Σ_epochs Im| / Σ_epochs |Im|, then averaged over bins
 *  - Hilbert: 4th-order Butterworth bandpass (ba, filtfilt) per epoch, analytic signal,
 *    |Σ Im(z1·conj(z2))| / Σ |Im(z1·conj(z2))| over all samples of all epochs
 * Channels are transformed once per epoch and reused for every pair; Python recomputed them per
 * pair with identical results.
 */
export function computeWpliByMethod(set: EpochSet): Record<ConnectivityBandName, WpliByMethod> {
  const sfreq = set.sfreq;
  const nTimes = epochLength(set);
  const nCh = set.channels.length;
  const nEp = set.epochs.length;
  const nPairs = (nCh * (nCh - 1)) / 2;
  const bands = CONNECTIVITY_BAND_NAMES;

  // --- CSD setup ---
  let npersegCsd = Math.min(Math.trunc(sfreq), Math.floor(nTimes / 2));
  npersegCsd = Math.max(npersegCsd, 64);
  const plan = planSegments(nTimes, { fs: sfreq, nperseg: npersegCsd, noverlap: Math.floor(npersegCsd / 2) });
  const nseg = segmentCount(nTimes, plan);
  const weights = onesidedWeights(plan);
  // union of bins used by any band, and each band's bins as indices into that union
  const binSet = new Set<number>();
  const bandBins = bands.map((band) => {
    const [lo, hi] = CONNECTIVITY_BANDS[band];
    const bins: number[] = [];
    plan.freqs.forEach((f, k) => {
      if (f >= lo && f <= hi) {
        bins.push(k);
        binSet.add(k);
      }
    });
    return bins;
  });
  const unionBins = Array.from(binSet).sort((a, b) => a - b);
  const unionPos = new Map(unionBins.map((k, i) => [k, i]));
  const nb = unionBins.length;
  const specRe = new Float64Array(nseg * plan.nfreqs);
  const specIm = new Float64Array(nseg * plan.nfreqs);
  // per channel: [segment][union bin]
  const chRe = Array.from({ length: nCh }, () => new Float64Array(nseg * nb));
  const chIm = Array.from({ length: nCh }, () => new Float64Array(nseg * nb));
  // per pair and union bin: Σ_epochs Im(Pxy), Σ_epochs |Im(Pxy)|
  const csdNum = new Float64Array(nPairs * nb);
  const csdDen = new Float64Array(nPairs * nb);

  // --- Hilbert setup ---
  const nyq = sfreq / 2;
  const filters = bands.map((band) => {
    const [lo, hi] = CONNECTIVITY_BANDS[band];
    const lowNorm = Math.max(0.001, Math.min(lo / nyq, 0.99));
    const highNorm = Math.max(lowNorm + 0.01, Math.min(hi / nyq, 0.99));
    const { b, a } = butter(4, [lowNorm, highNorm], 'bandpass');
    return new FiltFilt(b, a);
  });
  const hilbert = new Hilbert(nTimes);
  const filtered = new Float64Array(nTimes);
  const aRe = Array.from({ length: nCh }, () => new Float64Array(nTimes));
  const aIm = Array.from({ length: nCh }, () => new Float64Array(nTimes));
  const hilNum = bands.map(() => new Float64Array(nPairs));
  const hilDen = bands.map(() => new Float64Array(nPairs));

  for (let e = 0; e < nEp; e++) {
    const epoch = set.epochs[e];

    // CSD spectra for every channel
    for (let c = 0; c < nCh; c++) {
      segmentSpectra(epoch[c], plan, 0, nTimes, { re: specRe, im: specIm });
      const r = chRe[c];
      const im = chIm[c];
      for (let s = 0; s < nseg; s++) {
        for (let u = 0; u < nb; u++) {
          r[s * nb + u] = specRe[s * plan.nfreqs + unionBins[u]];
          im[s * nb + u] = specIm[s * plan.nfreqs + unionBins[u]];
        }
      }
    }
    let p = 0;
    for (let i = 0; i < nCh; i++) {
      const xr = chRe[i];
      const xi = chIm[i];
      for (let j = i + 1; j < nCh; j++, p++) {
        const yr = chRe[j];
        const yi = chIm[j];
        const base = p * nb;
        for (let u = 0; u < nb; u++) {
          // Im(conj(X)·Y) averaged over segments, density-scaled
          let acc = 0;
          for (let s = 0; s < nseg; s++) {
            const q = s * nb + u;
            acc += xr[q] * yi[q] - xi[q] * yr[q];
          }
          const imag = (acc * weights[unionBins[u]]) / nseg;
          csdNum[base + u] += imag;
          csdDen[base + u] += Math.abs(imag);
        }
      }
    }

    // Hilbert per band
    for (let bi = 0; bi < bands.length; bi++) {
      const filt = filters[bi];
      for (let c = 0; c < nCh; c++) {
        filt.apply(epoch[c], filtered, 0, nTimes);
        hilbert.transform(filtered, aRe[c], aIm[c]);
      }
      const num = hilNum[bi];
      const den = hilDen[bi];
      let q = 0;
      for (let i = 0; i < nCh; i++) {
        const r1 = aRe[i];
        const m1 = aIm[i];
        for (let j = i + 1; j < nCh; j++, q++) {
          const r2 = aRe[j];
          const m2 = aIm[j];
          let s = 0;
          let sa = 0;
          for (let t = 0; t < nTimes; t++) {
            const v = m1[t] * r2[t] - r1[t] * m2[t];
            s += v;
            sa += Math.abs(v);
          }
          num[q] += s;
          den[q] += sa;
        }
      }
    }
  }

  const result = {} as Record<ConnectivityBandName, WpliByMethod>;
  bands.forEach((band, bi) => {
    const csdVals = new Float64Array(nPairs);
    const hilVals = new Float64Array(nPairs);
    const binsInUnion = bandBins[bi].map((k) => unionPos.get(k)!);
    for (let p = 0; p < nPairs; p++) {
      if (nEp > 0 && binsInUnion.length > 0) {
        let sum = 0;
        let count = 0;
        for (const u of binsInUnion) {
          const den = csdDen[p * nb + u];
          if (den > CSD_WPLI_EPS) {
            sum += Math.abs(csdNum[p * nb + u]) / den;
            count++;
          }
        }
        csdVals[p] = count ? clip01(sum / count) : 0;
      }
      const den = hilDen[bi][p];
      hilVals[p] = nEp > 0 && den >= HILBERT_WPLI_EPS ? clip01(Math.abs(hilNum[bi][p]) / den) : 0;
    }
    result[band] = { csd: csdVals, hilbert: hilVals };
  });
  return result;
}

function clip01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Port of FeatureExtractor.compute_connectivity: wPLI = max(CSD, Hilbert) per pair. */
export function computeConnectivity(set: EpochSet): Connectivity {
  const ch = set.channels;
  const n = ch.length;
  const byMethod = computeWpliByMethod(set);
  const matrices = {} as Record<ConnectivityBandName, number[][]>;
  for (const band of CONNECTIVITY_BAND_NAMES) {
    const m = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const { csd, hilbert } = byMethod[band];
    let p = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++, p++) {
        const w = Math.max(csd[p], hilbert[p]);
        m[i][j] = w;
        m[j][i] = w;
      }
    }
    matrices[band] = m;
  }

  const network_metrics = {} as Record<ConnectivityBandName, NetworkMetrics>;
  for (const band of CONNECTIVITY_BAND_NAMES) network_metrics[band] = computeNetworkMetrics(matrices[band], ch);

  const connectivity_matrices = {} as Connectivity['connectivity_matrices'];
  for (const band of CONNECTIVITY_BAND_NAMES) connectivity_matrices[band] = { matrix: matrices[band], channels: [...ch] };

  return {
    connectivity_matrices,
    network_metrics,
    pair_data: generatePairData(matrices, ch),
  };
}

function isInterhemispheric(a: string, b: string): boolean {
  return INTERHEMISPHERIC_PAIRS.some(([l, r]) => (l === a && r === b) || (l === b && r === a));
}

function generatePairData(matrices: Record<ConnectivityBandName, number[][]>, ch: string[]): Connectivity['pair_data'] {
  const left: readonly string[] = CHANNEL_GROUPS.left;
  const right: readonly string[] = CHANNEL_GROUPS.right;
  const out: Connectivity['pair_data'] = [];
  for (let i = 0; i < ch.length; i++) {
    for (let j = i + 1; j < ch.length; j++) {
      const ch1 = ch[i];
      const ch2 = ch[j];
      let type = 'other';
      let region = 'mixed';
      if (isInterhemispheric(ch1, ch2)) {
        type = 'interhemispheric';
        const either = (prefix: string) => ch1.startsWith(prefix) || ch2.startsWith(prefix);
        if (either('F')) region = 'frontal';
        else if (either('C')) region = 'central';
        else if (either('P')) region = 'parietal';
        else if (either('O')) region = 'occipital';
        else if (either('T')) region = 'temporal';
      } else if (left.includes(ch1) && left.includes(ch2)) {
        type = 'intrahemispheric';
        region = 'left';
      } else if (right.includes(ch1) && right.includes(ch2)) {
        type = 'intrahemispheric';
        region = 'right';
      }
      const entry: Connectivity['pair_data'][number] = { ch1, ch2, type, region };
      for (const band of CONNECTIVITY_BAND_NAMES) entry[band] = matrices[band][i][j];
      out.push(entry);
    }
  }
  return out;
}
