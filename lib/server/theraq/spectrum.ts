/**
 * Mean amplitude spectrum per channel on the TheraQ integer-Hz domain.
 * Port of compute_amplitude_spectrum() in api/workers/theraq_metrics.py.
 */

import { RfftMagnitude } from './fft';
import { pairwiseSum } from './numeric';

/** Integer-Hz amplitude-spectrum grid (matches the Divergence low-resolution domain). */
export const SPECTRUM_DOMAIN: number[] = Array.from({ length: 45 }, (_, i) => i + 1); // 1..45 Hz

export interface PhaseEpochs {
  sfreq: number;
  channels: string[];
  /** [epoch][channel] µV */
  epochs: Float64Array[][];
  /** Channels flagged bad upstream; reported in the phase QC only. */
  badChannels?: string[];
}

/** numpy.fft.rfftfreq(n, 1/sfreq), computed with the same float operations. */
function rfftFreqs(n: number, sfreq: number): Float64Array {
  const d = 1.0 / sfreq;
  const val = 1.0 / (n * d);
  const out = new Float64Array((n >> 1) + 1);
  for (let k = 0; k < out.length; k++) out[k] = k * val;
  return out;
}

/**
 * Amplitude per epoch = |rfft(x)| / n_samples * 2, averaged across epochs, then
 * resampled onto the 1 Hz domain by averaging native FFT bins within ±0.5 Hz of
 * each integer frequency (nearest bin when none fall inside).
 *
 * Input is already in µV (the Python version converted from Volts).
 */
export function computeAmplitudeSpectrum(
  phase: Pick<PhaseEpochs, 'sfreq' | 'channels' | 'epochs'>,
  domain: number[] = SPECTRUM_DOMAIN,
): Record<string, number[]> {
  const { epochs, channels, sfreq } = phase;
  if (epochs.length === 0) throw new Error('No epochs available for amplitude spectrum');
  const nChannels = channels.length;
  const nTimes = epochs[0][0]?.length ?? 0;
  if (nTimes === 0) throw new Error('Epochs contain no samples');

  const fft = new RfftMagnitude(nTimes);
  const nFreqs = (nTimes >> 1) + 1;
  const ampMean = Array.from({ length: nChannels }, () => new Float64Array(nFreqs));
  const mag = new Float64Array(nFreqs);

  // numpy reduces axis 0 sequentially: a[0] + a[1] + ... then divides.
  for (const epoch of epochs) {
    if (epoch.length !== nChannels) {
      throw new Error(`Epoch has ${epoch.length} channels, expected ${nChannels}`);
    }
    for (let c = 0; c < nChannels; c++) {
      if (epoch[c].length !== nTimes) throw new Error('Epochs must all have the same length');
      fft.magnitudes(epoch[c], mag);
      const acc = ampMean[c];
      for (let k = 0; k < nFreqs; k++) acc[k] += (mag[k] / nTimes) * 2.0;
    }
  }
  for (const acc of ampMean) {
    for (let k = 0; k < nFreqs; k++) acc[k] /= epochs.length;
  }

  const freqs = rfftFreqs(nTimes, sfreq);
  const binsFor = domain.map((f0) => {
    const bins: number[] = [];
    for (let k = 0; k < nFreqs; k++) {
      if (freqs[k] >= f0 - 0.5 && freqs[k] < f0 + 0.5) bins.push(k);
    }
    if (bins.length > 0) return bins;
    let nearest = 0;
    for (let k = 1; k < nFreqs; k++) {
      if (Math.abs(freqs[k] - f0) < Math.abs(freqs[nearest] - f0)) nearest = k;
    }
    return [nearest];
  });

  const out: Record<string, number[]> = {};
  channels.forEach((ch, c) => {
    const acc = ampMean[c];
    out[ch] = binsFor.map((bins) => pairwiseSum(bins.map((k) => acc[k])) / bins.length);
  });
  return out;
}
