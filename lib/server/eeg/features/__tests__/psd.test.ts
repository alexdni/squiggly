import { describe, expect, it } from 'vitest';
import { computePsd } from '../psd';
import { trapz } from '../../dsp';

const fs = 256;
const sine = (hz: number, amp: number, n: number, phase = 0) =>
  Float64Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / fs + phase));

describe('computePsd', () => {
  const epochs = Array.from({ length: 6 }, (_, e) => [sine(10, 20, 2 * fs, e), sine(6, 10, 2 * fs, e)]);
  const psd = computePsd({ sfreq: fs, channels: ['O1', 'Fz'], epochs });

  it('covers 1-45 Hz in 0.5 Hz bins for 2 s epochs', () => {
    expect(psd.freqs[0]).toBe(1);
    expect(psd.freqs[psd.freqs.length - 1]).toBe(45);
    expect(psd.freqs[1] - psd.freqs[0]).toBeCloseTo(0.5);
    expect(psd.channels.O1).toHaveLength(psd.freqs.length);
  });

  it('peaks at each channel’s sine frequency with its power (A²/2)', () => {
    const peakHz = (ch: string) => psd.freqs[psd.channels[ch].indexOf(Math.max(...psd.channels[ch]))];
    expect(peakHz('O1')).toBe(10);
    expect(peakHz('Fz')).toBe(6);
    const near = (ch: string, lo: number, hi: number) => {
      const idx = psd.freqs.map((f, k) => (f >= lo && f <= hi ? k : -1)).filter((k) => k >= 0);
      return trapz(idx.map((k) => psd.channels[ch][k]), idx.map((k) => psd.freqs[k]));
    };
    expect(near('O1', 8, 12)).toBeCloseTo(200, -1);
    expect(near('Fz', 4, 8)).toBeCloseTo(50, -1);
  });
});
