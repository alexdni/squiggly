import { describe, expect, it } from 'vitest';
import { CHANNELS_10_20, CHANNELS_10_10_EXTRA } from '@/lib/eeg-labels';
import { HEAD, layoutPsdHeadMap, makePowerScale, niceTicks } from '../psdHeadMapLayout';

const TEN_TWENTY: string[] = [...CHANNELS_10_20];
const LEGACY_NAMES: Record<string, string> = { T7: 'T3', T8: 'T4', P7: 'T5', P8: 'T6' };

const noOverlap = (placed: { channel: string; cx: number; cy: number }[], cell: number) =>
  placed.forEach((a, i) =>
    placed.slice(i + 1).forEach((b) => {
      const overlaps = Math.abs(a.cx - b.cx) < cell - 1e-9 && Math.abs(a.cy - b.cy) < cell - 1e-9;
      expect(overlaps, `${a.channel}/${b.channel}`).toBe(false);
    })
  );

describe('layoutPsdHeadMap', () => {
  it('places electrodes with the nose up and left on the left', () => {
    const { placed, unmapped } = layoutPsdHeadMap(['Fp1', 'O2', 'Cz']);
    expect(unmapped).toEqual([]);
    const at = Object.fromEntries(placed.map((p) => [p.channel, p]));
    expect(at.Cz).toMatchObject({ cx: HEAD.cx, cy: HEAD.cy });
    expect(at.Fp1.cx).toBeLessThan(HEAD.cx);
    expect(at.Fp1.cy).toBeLessThan(HEAD.cy);
    expect(at.O2.cx).toBeGreaterThan(HEAD.cx);
    expect(at.O2.cy).toBeGreaterThan(HEAD.cy);
  });

  it('snaps the 10-20 montage to a regular grid without overlaps (modern or legacy names)', () => {
    for (const names of [TEN_TWENTY, TEN_TWENTY.map((c) => LEGACY_NAMES[c] ?? c)]) {
      const { placed, cell } = layoutPsdHeadMap(names);
      expect(placed).toHaveLength(19);
      const at = Object.fromEntries(placed.map((p) => [p.channel, p]));
      expect(at.Fp1.cx).toBe(at.F3.cx);
      expect(at.O2.cx).toBe(at.P4.cx);
      noOverlap(placed, cell);
    }
  });

  it('keeps true positions for a 10-10 montage, still without overlaps', () => {
    const { placed, unmapped, cell } = layoutPsdHeadMap([...TEN_TWENTY, ...CHANNELS_10_10_EXTRA]);
    expect(unmapped).toEqual([]);
    const at = Object.fromEntries(placed.map((p) => [p.channel, p]));
    expect(at.FC1.cy).toBeGreaterThan(at.F3.cy);
    expect(at.FC1.cy).toBeLessThan(at.C3.cy);
    expect(cell).toBeGreaterThanOrEqual(70);
  });

  it('reports channels without a scalp position', () => {
    const { placed, unmapped } = layoutPsdHeadMap(['Cz', 'EXG1']);
    expect(placed.map((p) => p.channel)).toEqual(['Cz']);
    expect(unmapped).toEqual(['EXG1']);
  });
});

describe('niceTicks', () => {
  it('produces round steps inside the range', () => {
    expect(niceTicks(0, 90)).toEqual([0, 20, 40, 60, 80]);
    expect(niceTicks(1, 45, 5)).toEqual([10, 20, 30, 40]);
    expect(niceTicks(5, 5)).toEqual([5]);
  });
});

describe('makePowerScale', () => {
  // 2-12 Hz, quiet except for a few large drift bins at the low end
  const freqs = Array.from({ length: 101 }, (_, i) => 1 + i * 0.1);
  const series = (base: number, artifact: number) => freqs.map((f, i) => (f < 1.3 ? artifact : base + (i % 10)));

  it('shared scale tops out at a percentile above the drift floor, not at the artifact', () => {
    const spectra = { freqs, channels: { O1: series(10, 500), O2: series(5, 20) } };
    const scale = makePowerScale(spectra, ['O1', 'O2'], 'shared');
    const top = scale('O1').ticks[scale('O1').ticks.length - 1];
    expect(top).toBeGreaterThanOrEqual(19);
    expect(top).toBeLessThan(100);
    expect(scale('O1').isClipped(500)).toBe(true);
    expect(scale('O1').ticks).toEqual(scale('O2').ticks);
  });

  it('log scale spans whole decades and never clips', () => {
    const spectra = { freqs, channels: { O1: series(10, 500) } };
    const scale = makePowerScale(spectra, ['O1'], 'log')('O1');
    expect(scale.ticks).toEqual([10, 100, 1000]);
    expect(scale.isClipped(1e6)).toBe(false);
    expect(scale.toFraction(1000)).toBe(1);
  });
});
