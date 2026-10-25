import { describe, it, expect } from 'vitest';
import { detectMuBursts, muEventResults, MU_PATTERN } from '../muBursts';

const FS = 250;
const SEC = 60;
const N = FS * SEC;
const LABELS = ['F3', 'F4', 'C3', 'Cz', 'C4', 'P3', 'Pz', 'P4', 'T7', 'T8', 'P7', 'P8', 'O1', 'O2'];
// mu trains: 1.5 s every 5 s from t = 2 s
const BURSTS = Array.from({ length: 11 }, (_, i) => [2 + i * 5, 3.5 + i * 5] as const);

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32 - 0.5;
  };
}

/** Arch-shaped wave: broad positive half, sharp negative half (cos φ − 0.45 cos 2φ). */
const arch = (phi: number) => Math.cos(phi) - 0.45 * Math.cos(2 * phi);
const sine = (phi: number) => Math.cos(phi);

function recording(opts: { c3Wave?: (phi: number) => number; occipitalAlpha?: boolean; transients?: boolean; seed?: number }) {
  const rand = rng(opts.seed ?? 1);
  const data = LABELS.map(() => {
    const x = new Float64Array(N);
    for (let i = 0; i < N; i++) x[i] = 3 * rand();
    return x;
  });
  const c3 = data[LABELS.indexOf('C3')];
  if (opts.c3Wave) {
    for (const [a, b] of BURSTS) {
      for (let i = Math.round(a * FS); i < Math.round(b * FS); i++) c3[i] += 25 * opts.c3Wave(2 * Math.PI * 10 * (i / FS));
    }
  }
  if (opts.occipitalAlpha) {
    // continuous posterior alpha, a little of it everywhere
    for (const [ch, g] of [['O1', 1], ['O2', 1], ['P3', 0.4], ['Pz', 0.4], ['P4', 0.4], ['C3', 0.1]] as const) {
      const x = data[LABELS.indexOf(ch)];
      for (let i = 0; i < N; i++) x[i] += 30 * g * Math.sin(2 * Math.PI * 9.5 * (i / FS));
    }
  }
  if (opts.transients) {
    for (let t = 1; t < SEC; t += 0.7) {
      const i0 = Math.round(t * FS);
      for (let k = -3; k <= 3; k++) c3[i0 + k] -= 60 * Math.exp(-(k * k) / 2);
    }
  }
  return { labels: LABELS, data, sampleRate: FS, keep: new Uint8Array(N).fill(1), segments: { eo: { start: 0, end: SEC } } };
}

describe('detectMuBursts', () => {
  it('finds arch-shaped 10 Hz trains at C3 and only there', () => {
    const r = detectMuBursts(recording({ c3Wave: arch }));
    const c3 = r.bursts.filter((b) => b.site === 'C3');
    expect(c3.length).toBeGreaterThanOrEqual(8);
    expect(r.bursts.every((b) => b.site === 'C3')).toBe(true);
    for (const b of c3) {
      expect(BURSTS.some(([a, e]) => b.startSec >= a - 0.2 && b.endSec <= e + 0.2)).toBe(true);
      expect(b.freqHz).toBeGreaterThan(9.5);
      expect(b.freqHz).toBeLessThan(10.5);
      expect(b.sharpness).toBeGreaterThan(1.2);
      expect(b.cycles).toBeGreaterThanOrEqual(5);
    }
    const site = r.summary.eo!.sites.C3!;
    expect(site.bursts).toBe(c3.length);
    expect(site.sharpness_ratio).toBeGreaterThan(1.2);
    expect(r.summary.eo!.sites.C4!.bursts).toBe(0);
  });

  it('ignores sinusoidal central alpha (no arch shape)', () => {
    const r = detectMuBursts(recording({ c3Wave: sine }));
    expect(r.bursts).toHaveLength(0);
    expect(r.summary.eo!.sites.C3!.rhythmic_trains).toBeGreaterThan(0);
  });

  it('ignores sporadic sharp transients', () => {
    expect(detectMuBursts(recording({ transients: true })).bursts).toHaveLength(0);
  });

  it('drops trains that coincide with occipital alpha bursts', () => {
    // posterior alpha is continuous, so every central train overlaps it
    const r = detectMuBursts(recording({ c3Wave: arch, occipitalAlpha: true }));
    expect(r.bursts.every((b) => b.occipitalOverlap <= 0.6)).toBe(true);
  });

  it('never crosses rejected samples', () => {
    const input = recording({ c3Wave: arch });
    const [a, b] = BURSTS[3];
    input.keep.fill(0, Math.round((a + 0.7) * FS), Math.round((a + 0.8) * FS));
    const r = detectMuBursts(input);
    expect(r.bursts.some((x) => x.startSec < a + 0.8 && x.endSec > a + 0.7)).toBe(false);
    expect(r.bursts.some((x) => x.startSec >= b)).toBe(true);
  });

  it('skips without C3/C4 neighbours', () => {
    const input = recording({ c3Wave: arch });
    const keep = ['C3', 'C4', 'O1', 'O2'];
    const r = detectMuBursts({ ...input, labels: keep, data: keep.map((l) => input.data[LABELS.indexOf(l)]) });
    expect(r.bursts).toHaveLength(0);
    expect(r.skipped).toMatch(/neighbouring/);
  });
});

describe('muEventResults', () => {
  it('one noted variant event per burst on its own channel, with stable ids', () => {
    const { bursts } = detectMuBursts(recording({ c3Wave: arch }));
    const events = muEventResults(bursts);
    expect(events).toHaveLength(bursts.length);
    expect(events[0]).toMatchObject({ category: 'variant', pattern: MU_PATTERN, channels: ['C3'], handling: 'noted', source: 'detector' });
    expect(events[0].id).toMatch(/^[0-9a-f]{16}$/);
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    expect(muEventResults(bursts).map((e) => e.id)).toEqual(events.map((e) => e.id));
    expect(muEventResults(bursts, new Set([events[0].id]))[0].dismissed).toBe(true);
  });
});
