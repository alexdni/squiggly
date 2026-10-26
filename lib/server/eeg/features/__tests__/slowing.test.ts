import { describe, it, expect } from 'vitest';
import { detectSlowing, slowingEventResults } from '../slowing';

const FS = 250;
const SEC = 60;
const N = FS * SEC;
const LABELS = ['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8', 'T7', 'C3', 'Cz', 'C4', 'T8', 'P7', 'P3', 'Pz', 'P4', 'P8', 'O1', 'O2'];
// bursts: 2 s every 10 s from t = 5 s
const BURSTS = Array.from({ length: 5 }, (_, i) => [5 + i * 10, 7 + i * 10] as const);
const LONG = BURSTS.map(([a]) => [a, a + 3] as const);

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32 - 0.5;
  };
}

type Wave = (t: number, burst: number) => number;
const rhythmic = (hz: number): Wave => (t) => Math.sin(2 * Math.PI * hz * t);
/** irregular slow waves: each wave its own period (0.3–1 s) and height, from the burst onset */
function polymorphic(): Wave {
  const T = [0.3, 0.8, 0.45, 1.0, 0.35, 0.6, 0.9];
  const H = [1, 0.4, 1.3, 0.7, 1.1, 0.5, 0.9];
  return (t, onset) => {
    let rel = t - onset;
    for (let k = 0; ; k = (k + 1) % T.length) {
      if (rel < T[k]) return H[k] * Math.sin((2 * Math.PI * rel) / T[k]);
      rel -= T[k];
    }
  };
}

function recording(opts: {
  wave?: Wave;
  gains?: Record<string, number>;
  amplitude?: number;
  spans?: readonly (readonly [number, number])[];
  seed?: number;
}) {
  const rand = rng(opts.seed ?? 7);
  const data = LABELS.map((_, ch) => {
    const x = new Float64Array(N);
    let slow = 0;
    for (let i = 0; i < N; i++) {
      // white noise plus a little slow drift and alpha, so the band envelopes have a background
      slow = 0.98 * slow + rand();
      x[i] = 4 * rand() + 0.6 * slow + 5 * Math.sin(2 * Math.PI * 10 * (i / FS) + ch);
    }
    return x;
  });
  if (opts.wave) {
    for (const [a, b] of opts.spans ?? BURSTS) {
      for (const [ch, g] of Object.entries(opts.gains ?? {})) {
        const x = data[LABELS.indexOf(ch)];
        for (let i = Math.round(a * FS); i < Math.round(b * FS); i++) x[i] += (opts.amplitude ?? 40) * g * opts.wave(i / FS, a);
      }
    }
  }
  return { labels: LABELS, data, sampleRate: FS, keep: new Uint8Array(N).fill(1), segments: { eo: { start: 0, end: SEC } } };
}

const FRONTAL = { F3: 1, F4: 1, Fz: 1, Fp1: 0.8, Fp2: 0.8, F7: 0.6, F8: 0.6, C3: 0.5, Cz: 0.5, C4: 0.5 };
const near = (b: { startSec: number; endSec: number }, spans: readonly (readonly [number, number])[] = BURSTS) =>
  spans.some(([a, e]) => b.startSec >= a - 0.5 && b.endSec <= e + 0.5);

describe('detectSlowing', () => {
  it('finds frontal rhythmic delta bursts as FIRDA', () => {
    const r = detectSlowing(recording({ wave: rhythmic(2.5), gains: FRONTAL }));
    expect(r.bursts).toHaveLength(BURSTS.length);
    for (const b of r.bursts) {
      expect(near(b)).toBe(true);
      expect(b.pattern).toBe('firda');
      expect(b.band).toBe('delta');
      expect(b.rhythmic).toBe(true);
      expect(b.region).toBe('frontal');
      expect(b.side).toBe('bilateral');
      expect(b.freqHz).toBeGreaterThan(2.2);
      expect(b.freqHz).toBeLessThan(2.8);
      expect(b.channels).toEqual(expect.arrayContaining(['F3', 'F4', 'Fz']));
      expect(b.channels).not.toContain('O1');
    }
    expect(r.summary.eo).toMatchObject({ bursts: BURSTS.length, patterns: { firda: BURSTS.length } });
  });

  it('finds irregular left temporal delta as polymorphic and lateralized', () => {
    const r = detectSlowing(recording({ wave: polymorphic(), gains: { T7: 1, P7: 0.9, F7: 0.5, C3: 0.4 }, spans: LONG }));
    expect(r.bursts.length).toBeGreaterThanOrEqual(4);
    for (const b of r.bursts) {
      expect(near(b, LONG)).toBe(true);
      expect(b.pattern).toBe('polymorphic-delta');
      expect(b.rhythmic).toBe(false);
      expect(b.side).toBe('left');
      expect(['T7', 'P7']).toContain(b.peakChannel);
    }
  });

  it('finds posterior rhythmic theta', () => {
    const r = detectSlowing(recording({ wave: rhythmic(6), gains: { O1: 1, O2: 1, P3: 0.7, Pz: 0.7, P4: 0.7 } }));
    expect(r.bursts.length).toBe(BURSTS.length);
    for (const b of r.bursts) {
      expect(b.pattern).toBe('rhythmic-theta');
      expect(b.band).toBe('theta');
    }
  });

  it('ignores slow waves confined to the frontal-pole and lateral-frontal sites (eye movements)', () => {
    expect(detectSlowing(recording({ wave: rhythmic(2), gains: { Fp1: 1, Fp2: 1, F7: 0.6, F8: 0.6 } })).bursts).toHaveLength(0);
  });

  it('ignores a steep frontal-pole gradient', () => {
    const r = detectSlowing(recording({ wave: rhythmic(2), gains: { Fp1: 1, Fp2: 1, F3: 0.25, F4: 0.25, Fz: 0.25 } }));
    expect(r.bursts).toHaveLength(0);
  });

  it('skips spans the artifact detectors flagged', () => {
    const rec = recording({ wave: rhythmic(2.5), gains: FRONTAL });
    const r = detectSlowing({ ...rec, artifactSpans: BURSTS.map(([a, b]) => ({ startSec: a, endSec: b })) });
    expect(r.bursts).toHaveLength(0);
  });

  it('ignores continuous slowing, which is not paroxysmal', () => {
    const r = detectSlowing(recording({ wave: rhythmic(2.5), gains: FRONTAL, spans: [[0, SEC]] }));
    expect(r.bursts).toHaveLength(0);
  });

  it('finds nothing in background activity', () => {
    for (const seed of [1, 2, 3]) expect(detectSlowing(recording({ seed })).bursts).toHaveLength(0);
  });

  it('skips montages with too few 10-20 sites', () => {
    const rec = recording({});
    const r = detectSlowing({ ...rec, labels: ['F3', 'F4', 'X1'], data: rec.data.slice(0, 3) });
    expect(r.skipped).toMatch(/10-20/);
    expect(r.bursts).toHaveLength(0);
  });
});

describe('slowingEventResults', () => {
  it('makes noted slowing events on the involved channels with stable ids', () => {
    const { bursts } = detectSlowing(recording({ wave: rhythmic(2.5), gains: FRONTAL }));
    const events = slowingEventResults(bursts);
    expect(events[0]).toMatchObject({ category: 'slowing', pattern: 'firda', handling: 'noted', source: 'detector' });
    expect(events[0].channels).toEqual(bursts[0].channels);
    expect(events[0].evidence).toMatchObject({ band: 'delta', rhythmic: true, location: 'frontal' });
    expect(events[0].id).toMatch(/^[0-9a-f]{16}$/);
    expect(slowingEventResults(bursts)[0].id).toBe(events[0].id);
    expect(slowingEventResults(bursts, new Set([events[0].id]))[0].dismissed).toBe(true);
  });
});
