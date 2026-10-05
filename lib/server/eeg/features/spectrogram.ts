import { SPECTROGRAM_CHANNELS, type SpectrogramData } from '@/lib/analysis-results';
import { spectrogram } from '../dsp';

export const SPECTROGRAM_FMIN = 0.5;
export const SPECTROGRAM_FMAX = 45;
/** Upper bound on time columns per channel after downsampling. */
export const SPECTROGRAM_MAX_COLUMNS = 600;

export interface FullSpectrogram {
  freqs: Float64Array;
  times: Float64Array;
  /** µV²/Hz, [freq][time], restricted to 0.5-45 Hz */
  power: Float64Array[];
}

/**
 * The STFT that generate_visuals.generate_spectrogram_grid plotted: scipy.signal.spectrogram with
 * 2 s Tukey(0.25) windows, 1.5 s overlap, density scaling, limited to 0.5-45 Hz.
 * Returns null when the signal is shorter than one window (Python raised in that case).
 */
export function fullSpectrogram(x: ArrayLike<number>, sfreq: number): FullSpectrogram | null {
  const nperseg = Math.trunc(2 * sfreq);
  const noverlap = Math.trunc(1.5 * sfreq);
  if (x.length < nperseg) return null;
  const { freqs, times, sxx } = spectrogram(x, { fs: sfreq, nperseg, noverlap });
  const keep: number[] = [];
  freqs.forEach((f, k) => {
    if (f >= SPECTROGRAM_FMIN && f <= SPECTROGRAM_FMAX) keep.push(k);
  });
  return {
    freqs: Float64Array.from(keep, (k) => freqs[k]),
    times,
    power: keep.map((k) => sxx[k]),
  };
}

function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

/** Group sizes so bins are ~`target` wide (at least 1 bin per group). */
function groupSize(step: number, target: number): number {
  return step > 0 ? Math.max(1, Math.round(target / step)) : 1;
}

/**
 * Average linear power over blocks of ~1 Hz x ~1 s (more seconds per block when needed to stay
 * within SPECTROGRAM_MAX_COLUMNS), then convert to dB re 1 µV²/Hz: 10·log10(P + 1e-12).
 * Frequencies and times are the block means. Values are rounded (dB to 0.01, axes to 0.001) to
 * keep the results JSON small.
 *
 * The Python worker computed this on volts and plotted 10·log10(Sxx_V² + 1e-12), where the 1e-12
 * floor (= 1 µV²/Hz) swamped most of the signal; this returns the unfloored µV² scale instead.
 */
export function downsampleSpectrogram(full: FullSpectrogram): SpectrogramData {
  const nf = full.freqs.length;
  const nt = full.times.length;
  const fGroup = groupSize(nf > 1 ? full.freqs[1] - full.freqs[0] : 0, 1);
  let tGroup = groupSize(nt > 1 ? full.times[1] - full.times[0] : 0, 1);
  tGroup = Math.max(tGroup, Math.ceil(nt / SPECTROGRAM_MAX_COLUMNS));

  const freqs: number[] = [];
  for (let f0 = 0; f0 < nf; f0 += fGroup) {
    const f1 = Math.min(nf, f0 + fGroup);
    let s = 0;
    for (let k = f0; k < f1; k++) s += full.freqs[k];
    freqs.push(round(s / (f1 - f0), 3));
  }
  const times: number[] = [];
  const power_db: number[][] = [];
  for (let t0 = 0; t0 < nt; t0 += tGroup) {
    const t1 = Math.min(nt, t0 + tGroup);
    let ts = 0;
    for (let t = t0; t < t1; t++) ts += full.times[t];
    times.push(round(ts / (t1 - t0), 3));
    const col: number[] = [];
    for (let f0 = 0; f0 < nf; f0 += fGroup) {
      const f1 = Math.min(nf, f0 + fGroup);
      let s = 0;
      for (let k = f0; k < f1; k++) for (let t = t0; t < t1; t++) s += full.power[k][t];
      col.push(round(10 * Math.log10(s / ((f1 - f0) * (t1 - t0)) + 1e-12), 2));
    }
    power_db.push(col);
  }
  return { times, freqs, power_db };
}

/**
 * Downsampled spectrograms for the SPECTROGRAM_CHANNELS present in `channels`.
 * `data[i]` is the continuous µV signal of `channels[i]` (e.g. the condition's kept epochs
 * concatenated, as the Python worker did). Channels shorter than one 2 s window are omitted.
 */
export function computeSpectrograms(
  data: Float64Array[],
  channels: string[],
  sfreq: number
): Record<string, SpectrogramData> {
  const out: Record<string, SpectrogramData> = {};
  for (const ch of SPECTROGRAM_CHANNELS) {
    const i = channels.indexOf(ch);
    if (i < 0) continue;
    const full = fullSpectrogram(data[i], sfreq);
    if (full) out[ch] = downsampleSpectrogram(full);
  }
  return out;
}
