import { describe, it, expect } from 'vitest';
import {
  ELECTRODE_POSITIONS,
  blueRed,
  coolwarm,
  cssGradient,
  electrodePosition,
  idw,
  interpolateGrid,
  jet,
  linearTicks,
  normalize,
  normalizeChannelName,
  percentile,
  percentileScale,
  rdYlBuR,
  toElectrodes,
  viridis,
} from '../topo';

describe('electrode layout', () => {
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

  it('drops unknown channels and non-finite values', () => {
    const e = toElectrodes({ Fz: 1, ECG: 2, Cz: NaN, Pz: 3 });
    expect(e.map((x) => x.name).sort()).toEqual(['Fz', 'Pz']);
  });
});

describe('interpolation', () => {
  const electrodes = toElectrodes({ Fz: 10, Pz: 0, C3: 5, C4: 5 });

  it('returns the electrode value at the electrode', () => {
    const { x, y } = ELECTRODE_POSITIONS.Fz;
    expect(idw(x, y, electrodes)).toBe(10);
  });

  it('stays within the data range', () => {
    for (const [x, y] of [
      [0, 0],
      [0.5, 0.5],
      [-0.9, -0.1],
    ]) {
      const v = idw(x, y, electrodes);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(10);
    }
  });

  it('fills the head circle, masks the corners and keeps front > back', () => {
    const n = 40;
    const grid = interpolateGrid(electrodes, n);
    expect(grid.length).toBe(n * n);
    expect(Number.isNaN(grid[0])).toBe(true); // top-left corner outside head
    const centre = grid[(n / 2) * n + n / 2];
    expect(Number.isFinite(centre)).toBe(true);
    const front = grid[Math.round(n * 0.3) * n + n / 2];
    const back = grid[Math.round(n * 0.7) * n + n / 2];
    expect(front).toBeGreaterThan(back);
  });

  it('is all NaN with no electrodes', () => {
    expect(Array.from(interpolateGrid([], 8)).every(Number.isNaN)).toBe(true);
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

  it('widens a flat range and returns null without data', () => {
    const s = percentileScale([2, 2, 2])!;
    expect(s.vmin).toBeLessThan(2);
    expect(s.vmax).toBeGreaterThan(2);
    expect(percentileScale([])).toBeNull();
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
    expect(blueRed(0)).toEqual([0, 0, 255]);
    expect(blueRed(1)).toEqual([255, 0, 0]);
    expect(viridis(0)).toEqual([0x44, 0x01, 0x54]);
    expect(viridis(1)).toEqual([0xfd, 0xe7, 0x25]);
    expect(rdYlBuR(0)).toEqual([0x31, 0x36, 0x95]);
    expect(rdYlBuR(1)).toEqual([0xa5, 0x00, 0x26]);
    expect(coolwarm(0.5)).toEqual([221, 221, 221]);
    expect(jet(0)[2]).toBeGreaterThan(100);
    expect(jet(1)[0]).toBeGreaterThan(100);
  });

  it('clamps out-of-range input and returns valid bytes', () => {
    for (const cmap of [blueRed, viridis, rdYlBuR, coolwarm, jet]) {
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
    expect(cssGradient(blueRed)).toMatch(/^linear-gradient\(to right, rgb\(0,0,255\) 0%/);
  });
});
