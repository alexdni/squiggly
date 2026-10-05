import { describe, expect, it } from 'vitest';
import { lempelZivComplexity } from '../lzc';
import { computeNetworkMetrics } from '../network';
import { extractFeatures } from '../index';
import { loadEpochs } from './fixtures';

/** Literal transcription of FeatureExtractor._lempel_ziv_complexity (string search). */
function lzcReference(x: number[]): number {
  const sorted = [...x].sort((a, b) => a - b);
  const h = sorted.length >> 1;
  const med = sorted.length % 2 ? sorted[h] : (sorted[h - 1] + sorted[h]) / 2;
  const s = x.map((v) => (v > med ? '1' : '0')).join('');
  const n = s.length;
  let complexity = 0;
  let ind = 0;
  let inc = 1;
  while (ind + inc <= n) {
    if (s.slice(0, ind + inc - 1).includes(s.slice(ind, ind + inc))) inc += 1;
    else {
      complexity += 1;
      ind += inc;
      inc = 1;
    }
  }
  if (ind < n) complexity += 1;
  return complexity;
}

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32) - 0.5;
}

describe('lempelZivComplexity', () => {
  it('matches a literal port of the Python loop on random, periodic and constant inputs', () => {
    const rnd = lcg(42);
    const cases: number[][] = [
      Array.from({ length: 500 }, rnd),
      Array.from({ length: 333 }, (_, i) => Math.sin(i / 7)),
      Array.from({ length: 64 }, (_, i) => (i % 4 < 2 ? 1 : -1)),
      Array.from({ length: 50 }, () => 3),
      [1],
      [],
    ];
    for (let k = 0; k < 20; k++) cases.push(Array.from({ length: 20 + k * 37 }, rnd));
    for (const c of cases) expect(lempelZivComplexity(c)).toBe(lzcReference(c));
  });
});

describe('computeNetworkMetrics', () => {
  it('returns zeros (no NaN/Infinity) for an all-zero matrix', () => {
    const ch = ['F3', 'F4', 'P3', 'P4'];
    const m = computeNetworkMetrics(
      ch.map(() => ch.map(() => 0)),
      ch
    );
    expect(m.small_worldness).toBe(0);
    expect(m.mean_clustering_coefficient).toBe(0);
    expect(Number.isFinite(m.global_efficiency)).toBe(true);
    expect(m.interhemispheric_connectivity).toBe(0);
    expect(m.regional_connectivity).toEqual({ frontal_within: 0, parietal_within: 0, frontal_posterior: 0 });
  });
});

describe('performance', () => {
  it('extracts 19 ch x 600 two-second epochs (20 min) within a few seconds', () => {
    const base = loadEpochs('ec');
    const epochs = Array.from({ length: 600 }, (_, i) => base.epochs[i % base.epochs.length]);
    const t0 = performance.now();
    const out = extractFeatures(null, { ...base, epochs });
    const ms = performance.now() - t0;
    console.log(`extractFeatures 19 ch x 600 epochs: ${ms.toFixed(0)} ms`);
    expect(out.connectivity.ec!.pair_data).toHaveLength(171);
    expect(ms).toBeLessThan(15000);
  });
});
