import { describe, it, expect } from 'vitest';
import {
  ELECTRODE_POSITIONS,
  coolwarm,
  cssGradient,
  electrodePosition,
  jet,
  linearTicks,
  normalize,
  normalizeChannelName,
  percentile,
} from '../topo';

describe('connectivity electrode layout', () => {
  it('puts Cz at the centre and the nose up', () => {
    expect(ELECTRODE_POSITIONS.Cz.x).toBeCloseTo(0);
    expect(ELECTRODE_POSITIONS.Cz.y).toBeCloseTo(0);
    expect(ELECTRODE_POSITIONS.Fz.y).toBeGreaterThan(0);
    expect(ELECTRODE_POSITIONS.Pz.y).toBeLessThan(0);
  });

  it('places left channels at negative x and right channels at positive x', () => {
    for (const [l, r] of [
      ['Fp1', 'Fp2'],
      ['F3', 'F4'],
      ['C3', 'C4'],
      ['T7', 'T8'],
      ['O1', 'O2'],
      ['FC1', 'FC2'],
    ]) {
      expect(ELECTRODE_POSITIONS[l].x).toBeLessThan(0);
      expect(ELECTRODE_POSITIONS[r].x).toBeCloseTo(-ELECTRODE_POSITIONS[l].x);
      expect(ELECTRODE_POSITIONS[r].y).toBeCloseTo(ELECTRODE_POSITIONS[l].y);
    }
  });

  it('keeps the 10-20 outer ring on one circle inside the head', () => {
    const ring = ['Fp1', 'Fp2', 'F7', 'F8', 'T7', 'T8', 'P7', 'P8', 'O1', 'O2'].map((n) =>
      Math.hypot(ELECTRODE_POSITIONS[n].x, ELECTRODE_POSITIONS[n].y)
    );
    for (const r of ring) {
      expect(r).toBeCloseTo(ring[0]);
      expect(r).toBeLessThan(1);
    }
  });

  it('normalizes labels and old nomenclature', () => {
    expect(normalizeChannelName('EEG FP1-REF')).toBe('Fp1');
    expect(normalizeChannelName(' cz ')).toBe('Cz');
    expect(normalizeChannelName('T3')).toBe('T3');
    expect(electrodePosition('T3')).toEqual(ELECTRODE_POSITIONS.T7);
    expect(electrodePosition('EEG T6-LE')).toEqual(ELECTRODE_POSITIONS.P8);
    expect(electrodePosition('ECG')).toBeNull();
  });
});

describe('scaling', () => {
  it('matches numpy linear percentiles', () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(v, 50)).toBeCloseTo(5.5);
    expect(percentile(v, 2)).toBeCloseTo(1.18);
    expect(percentile(v, 98)).toBeCloseTo(9.82);
    expect(percentile([NaN, 3], 50)).toBe(3);
    expect(Number.isNaN(percentile([], 50))).toBe(true);
  });

  it('normalizes and clamps', () => {
    const s = { vmin: 10, vmax: 20 };
    expect(normalize(15, s)).toBe(0.5);
    expect(normalize(0, s)).toBe(0);
    expect(normalize(30, s)).toBe(1);
  });

  it('produces evenly spaced ticks', () => {
    expect(linearTicks(0, 1, 5)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
});

describe('colormaps', () => {
  it('hits the documented endpoints', () => {
    expect(coolwarm(0.5)).toEqual([221, 221, 221]);
    expect(jet(0)[2]).toBeGreaterThan(100);
    expect(jet(1)[0]).toBeGreaterThan(100);
  });

  it('clamps out-of-range input and returns valid bytes', () => {
    for (const cmap of [coolwarm, jet]) {
      expect(cmap(-1)).toEqual(cmap(0));
      expect(cmap(2)).toEqual(cmap(1));
      for (const c of cmap(0.37)) {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
    }
  });

  it('builds a CSS gradient', () => {
    expect(cssGradient(coolwarm)).toMatch(/^linear-gradient\(to right, rgb\(59,76,192\) 0%/);
  });
});
