import { describe, expect, it } from 'vitest';
import { computeCoherence } from '../coherence';
import { computeWpliByMethod } from '../connectivity';
import { rng } from '../../__tests__/synthetic';

const FS = 256;
const N = 512;

const gaussian = (seed: number) => {
  const rand = rng(seed);
  return () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
};
const noise = (next: () => number, gain = 1) => Float64Array.from({ length: N }, () => next() * gain);

/** Noise band-limited to [lo, hi] Hz: sines at every bin there with random phases. */
const bandNoise = (next: () => number, lo: number, hi: number, gain = 1) => {
  const out = new Float64Array(N);
  for (let f = lo; f <= hi; f += 0.5) {
    const phase = next() * Math.PI;
    for (let t = 0; t < N; t++) out[t] += gain * Math.sin((2 * Math.PI * f * t) / FS + phase);
  }
  return out;
};
const add = (a: Float64Array, b: Float64Array, gain = 1) => a.map((v, i) => v + gain * b[i]);
const set = (epochs: Float64Array[][]) => ({ sfreq: FS, channels: ['A', 'B'], epochs });
const pair = (s: ReturnType<typeof set>, band: 'delta' | 'theta' | 'alpha' | 'beta') =>
  computeCoherence(s)!.matrices[band].matrix[0][1];

describe('computeCoherence', () => {
  it('matches the formula computed directly with a DFT', () => {
    const next = gaussian(1);
    const n = 128;
    const epochs = Array.from({ length: 4 }, () => [0, 1].map(() => Float64Array.from({ length: n }, () => next())));
    const hann = Array.from({ length: n }, (_, t) => 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / n));
    const dft = (x: Float64Array, k: number) => {
      const mean = x.reduce((s, v) => s + v, 0) / n;
      let re = 0;
      let im = 0;
      x.forEach((v, t) => {
        re += (v - mean) * hann[t] * Math.cos((2 * Math.PI * k * t) / n);
        im -= (v - mean) * hann[t] * Math.sin((2 * Math.PI * k * t) / n);
      });
      return [re, im];
    };
    // Alpha, 8-13 Hz, at 2 Hz resolution: bins 4 to 6
    const expected = [4, 5, 6].map((k) => {
      let sxyRe = 0;
      let sxyIm = 0;
      let sxx = 0;
      let syy = 0;
      for (const [x, y] of epochs) {
        const [xr, xi] = dft(x, k);
        const [yr, yi] = dft(y, k);
        sxyRe += xr * yr + xi * yi;
        sxyIm += xi * yr - xr * yi;
        sxx += xr * xr + xi * xi;
        syy += yr * yr + yi * yi;
      }
      return (sxyRe ** 2 + sxyIm ** 2) / (sxx * syy);
    });
    const direct = expected.reduce((s, v) => s + v, 0) / expected.length;
    expect(pair(set(epochs), 'alpha')).toBeCloseTo(direct, 10);
  });

  it('is 1 for a channel and a scaled copy, with a unit diagonal', () => {
    const next = gaussian(2);
    const epochs = Array.from({ length: 10 }, () => {
      const x = noise(next);
      return [x, x.map((v) => v * 7)];
    });
    expect(pair(set(epochs), 'alpha')).toBeCloseTo(1, 10);
    expect(computeCoherence(set(epochs))!.matrices.alpha.matrix[0][0]).toBe(1);
  });

  it('reads about 1/N for independent channels', () => {
    const next = gaussian(3);
    const epochs = Array.from({ length: 200 }, () => [noise(next), noise(next)]);
    const value = pair(set(epochs), 'beta');
    expect(value).toBeGreaterThan(1 / 200 / 2);
    expect(value).toBeLessThan((1 / 200) * 2);
  });

  it('keeps zero-lag coupling, which wPLI discards', () => {
    const next = gaussian(4);
    const epochs = Array.from({ length: 100 }, () => {
      const source = bandNoise(next, 8, 13, 10);
      return [add(noise(next), source), add(noise(next), source)];
    });
    expect(pair(set(epochs), 'alpha')).toBeGreaterThan(0.8);
    const wpli = computeWpliByMethod(set(epochs)).alpha;
    expect(Math.max(wpli.csd[0], wpli.hilbert[0])).toBeLessThan(0.4);
  });

  it('weights epochs by amplitude', () => {
    const next = gaussian(5);
    const coupled = (gain: number) => {
      const x = noise(next, gain);
      return [x, add(x, noise(next, gain), 0.2)];
    };
    const uncoupled = (gain: number) => [noise(next, gain), noise(next, gain)];
    const loudCoupled = [...Array.from({ length: 30 }, () => coupled(10)), ...Array.from({ length: 30 }, () => uncoupled(1))];
    const loudUncoupled = [...Array.from({ length: 30 }, () => coupled(1)), ...Array.from({ length: 30 }, () => uncoupled(10))];
    expect(pair(set(loudCoupled), 'alpha')).toBeGreaterThan(0.8);
    expect(pair(set(loudUncoupled), 'alpha')).toBeLessThan(0.1);
  });

  it('stays within the band the coupling is in', () => {
    const next = gaussian(6);
    const epochs = Array.from({ length: 100 }, () => {
      const source = bandNoise(next, 9, 12, 10);
      return [add(noise(next), source), add(noise(next), source)];
    });
    expect(pair(set(epochs), 'alpha')).toBeGreaterThan(0.5);
    expect(pair(set(epochs), 'beta')).toBeLessThan(0.05);
  });

  it('gives 0 for a flat channel and nothing below two epochs', () => {
    const next = gaussian(7);
    const flat = new Float64Array(N);
    expect(pair(set([[noise(next), flat], [noise(next), flat]]), 'alpha')).toBe(0);
    expect(computeCoherence(set([[noise(next), noise(next)]]))).toBeNull();
  });
});
