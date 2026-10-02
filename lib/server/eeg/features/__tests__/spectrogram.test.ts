import { describe, expect, it } from 'vitest';
import { SPECTROGRAM_CHANNELS } from '@/lib/analysis-results';
import py from '../../__fixtures__/features/python_spectrogram.json';
import { computeSpectrograms } from '../index';
import { downsampleSpectrogram, fullSpectrogram, SPECTROGRAM_MAX_COLUMNS } from '../spectrogram';
import { loadEpochs } from './fixtures';

type Cond = 'eo' | 'ec';

/** Concatenate a channel's epochs, as generate_spectrogram_grid did with epochs_data.ravel(). */
function continuous(cond: Cond) {
  const set = loadEpochs(cond);
  const nT = set.epochs[0][0].length;
  const data = set.channels.map((_, c) => {
    const out = new Float64Array(set.epochs.length * nT);
    set.epochs.forEach((ep, e) => out.set(ep[c], e * nT));
    return out;
  });
  return { set, data };
}

describe.each(['eo', 'ec'] as Cond[])('spectrogram %s', (cond) => {
  const { set, data } = continuous(cond);
  const ref = py[cond] as Record<string, { freqs: number[]; times: number[]; power_db: number[][] }>;

  it('full-resolution STFT matches scipy.signal.spectrogram (dB re 1 µV²/Hz)', () => {
    let worst = 0;
    for (const ch of py.channels) {
      const full = fullSpectrogram(data[set.channels.indexOf(ch)], set.sfreq)!;
      expect(Array.from(full.freqs)).toEqual(ref[ch].freqs);
      expect(Array.from(full.times)).toEqual(ref[ch].times);
      ref[ch].power_db.forEach((row, k) =>
        row.forEach((v, t) => {
          worst = Math.max(worst, Math.abs(10 * Math.log10(full.power[k][t] + 1e-12) - v));
        })
      );
    }
    // fixture is rounded to 1e-6 dB; spec tolerance was 0.5 dB
    expect(worst).toBeLessThan(2e-6);
  });

  it('downsamples to ~1 Hz x 1 s blocks of averaged power', () => {
    const out = computeSpectrograms(data, set.channels, set.sfreq);
    expect(Object.keys(out)).toEqual([...SPECTROGRAM_CHANNELS]);
    for (const ch of py.channels) {
      const r = ref[ch];
      const s = out[ch];
      // scipy grid is 0.5 Hz x 0.5 s, so blocks are 2 x 2 bins
      expect(s.freqs.length).toBe(Math.ceil(r.freqs.length / 2));
      expect(s.times.length).toBe(Math.ceil(r.times.length / 2));
      expect(s.freqs[0]).toBeCloseTo((r.freqs[0] + r.freqs[1]) / 2, 3);
      expect(s.times[0]).toBeCloseTo((r.times[0] + r.times[1]) / 2, 3);
      for (let t = 0; t < s.times.length; t++) {
        for (let f = 0; f < s.freqs.length; f++) {
          let sum = 0;
          let n = 0;
          for (let dt = 0; dt < 2; dt++) {
            for (let df = 0; df < 2; df++) {
              const row = r.power_db[2 * f + df];
              const v = row?.[2 * t + dt];
              if (v === undefined) continue;
              sum += 10 ** (v / 10) - 1e-12;
              n++;
            }
          }
          expect(Math.abs(s.power_db[t][f] - 10 * Math.log10(sum / n + 1e-12))).toBeLessThan(0.006);
        }
      }
    }
  });
});

describe('spectrogram shape limits', () => {
  it('caps the number of time columns for long recordings', () => {
    const sfreq = 250;
    const x = new Float64Array(sfreq * 60 * 25); // 25 min
    for (let i = 0; i < x.length; i++) x[i] = Math.sin((2 * Math.PI * 10 * i) / sfreq) * 10 + Math.sin(i * 0.37);
    const full = fullSpectrogram(x, sfreq)!;
    const ds = downsampleSpectrogram(full);
    expect(ds.times.length).toBeLessThanOrEqual(SPECTROGRAM_MAX_COLUMNS);
    expect(ds.times.length).toBeGreaterThan(SPECTROGRAM_MAX_COLUMNS - 5);
    expect(ds.power_db.length).toBe(ds.times.length);
    expect(ds.power_db[0].length).toBe(ds.freqs.length);
    // 10 Hz peak shows up in the right block
    const col = ds.power_db[10];
    const peak = ds.freqs[col.indexOf(Math.max(...col))];
    expect(Math.abs(peak - 10)).toBeLessThanOrEqual(0.5);
  });

  it('skips missing channels and signals shorter than one window', () => {
    const out = computeSpectrograms([new Float64Array(100), new Float64Array(1000)], ['Fz', 'O1'], 250);
    expect(Object.keys(out)).toEqual(['O1']);
  });
});
