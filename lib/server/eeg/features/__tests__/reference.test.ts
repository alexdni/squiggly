import { describe, expect, it } from 'vitest';
import { computeCoherence } from '../coherence';
import { laplacianEpochs } from '../reference';
import { rng } from '../../__tests__/synthetic';

const N = 512;
const CHANNELS = ['Fp1', 'Fp2', 'F3', 'F7', 'Fz', 'F4', 'F8', 'Cz'];
const gaussian = (seed: number) => {
  const rand = rng(seed);
  return () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
};
const noise = (next: () => number, gain = 1) => Float64Array.from({ length: N }, () => next() * gain);
const set = (epochs: Float64Array[][], channels = CHANNELS) => ({ sfreq: 256, channels, epochs });

describe('laplacianEpochs', () => {
  it('subtracts the mean of the available neighbours', () => {
    const value = (ch: number) => Float64Array.from({ length: N }, () => ch);
    // Fz's neighbours here are Fp1, Fp2, F3, F4 and Cz (values 0, 1, 2, 5, 7)
    const lap = laplacianEpochs(set([CHANNELS.map((_, i) => value(i))]))!;
    expect(lap.epochs[0][lap.channels.indexOf('Fz')][0]).toBeCloseTo(4 - (0 + 1 + 2 + 5 + 7) / 5, 12);
  });

  it('does not depend on the reference', () => {
    const next = gaussian(1);
    const epochs = [CHANNELS.map(() => noise(next))];
    const common = noise(next, 50);
    const shifted = [epochs[0].map((x) => x.map((v, t) => v + common[t]))];
    const a = laplacianEpochs(set(epochs))!;
    const b = laplacianEpochs(set(shifted))!;
    a.epochs[0].forEach((x, c) => x.forEach((v, t) => expect(b.epochs[0][c][t]).toBeCloseTo(v, 8)));
  });

  it('leaves out excluded channels as targets but keeps them as neighbours', () => {
    const next = gaussian(2);
    const epochs = [CHANNELS.map(() => noise(next))];
    const lap = laplacianEpochs(set(epochs), ['Fz'])!;
    expect(lap.channels).not.toContain('Fz');
    const full = laplacianEpochs(set(epochs))!;
    expect(lap.epochs[0][lap.channels.indexOf('F3')]).toEqual(full.epochs[0][full.channels.indexOf('F3')]);
  });

  it('skips channels with too few neighbours and returns null when too few remain', () => {
    const next = gaussian(3);
    const channels = ['Fp1', 'Fp2', 'F3', 'F4', 'AF3'];
    const lap = laplacianEpochs(set([channels.map(() => noise(next))], channels));
    expect(lap!.channels).toEqual(['Fp1', 'Fp2']);
    expect(laplacianEpochs(set([['Fp1', 'O2'].map(() => noise(next))], ['Fp1', 'O2']))).toBeNull();
  });

  it('removes coherence that comes from a signal common to every channel', () => {
    const next = gaussian(4);
    const epochs = Array.from({ length: 100 }, () => {
      const common = noise(next, 10);
      return CHANNELS.map(() => noise(next).map((v, t) => v + common[t]));
    });
    const pair = (s: ReturnType<typeof set>, a: string, b: string) => {
      const { matrix, channels } = computeCoherence(s)!.matrices.alpha;
      return matrix[channels.indexOf(a)][channels.indexOf(b)];
    };
    expect(pair(set(epochs), 'Fp1', 'F8')).toBeGreaterThan(0.9);
    expect(pair(laplacianEpochs(set(epochs))!, 'Fp1', 'F8')).toBeLessThan(0.4);
  });
});
