import { describe, it, expect } from 'vitest';
import {
  CANVAS_SIZE,
  HEAD_RADIUS_RATIO,
  LEGEND_GRADIENT_CSS,
  TOPO_ELECTRODE_POSITIONS,
  fmtAbs,
  fmtRel,
  idw,
  qeegDiscrete,
  qeegSequential,
  toTopoElectrodes,
  topoPosition,
} from '../topoRender';

// Values pinned from DivergenceWebapp's MeasureTopo/topoConst.ts so drift from the reference fails.
describe('electrode layout (DivergenceWebapp parity)', () => {
  it('uses the reference 10-20 coordinates', () => {
    expect(TOPO_ELECTRODE_POSITIONS.Fp1).toEqual({ x: -0.26, y: 0.8 });
    expect(TOPO_ELECTRODE_POSITIONS.Fz).toEqual({ x: 0, y: 0.34 });
    expect(TOPO_ELECTRODE_POSITIONS.C3).toEqual({ x: -0.43, y: 0 });
    expect(TOPO_ELECTRODE_POSITIONS.T3).toEqual({ x: -0.85, y: 0 });
    expect(TOPO_ELECTRODE_POSITIONS.T6).toEqual({ x: 0.73, y: -0.42 });
    expect(TOPO_ELECTRODE_POSITIONS.Oz).toEqual({ x: 0, y: -0.84 });
    expect(TOPO_ELECTRODE_POSITIONS.TP10).toEqual({ x: 0.83, y: -0.22 });
  });

  it('maps modern T7/T8/P7/P8 and decorated labels onto the legacy sites', () => {
    expect(topoPosition('T7')).toEqual(TOPO_ELECTRODE_POSITIONS.T3);
    expect(topoPosition('T8')).toEqual(TOPO_ELECTRODE_POSITIONS.T4);
    expect(topoPosition('P7')).toEqual(TOPO_ELECTRODE_POSITIONS.T5);
    expect(topoPosition('EEG P8-REF')).toEqual(TOPO_ELECTRODE_POSITIONS.T6);
    expect(topoPosition('fp1')).toEqual(TOPO_ELECTRODE_POSITIONS.Fp1);
    expect(topoPosition('A1')).toBeNull();
    expect(topoPosition('ECG')).toBeNull();
  });

  it('places 10-10 extras symmetrically inside the head', () => {
    for (const [l, r] of [
      ['AF7', 'AF8'],
      ['FC3', 'FC4'],
      ['C1', 'C2'],
      ['PO7', 'PO8'],
    ]) {
      const a = TOPO_ELECTRODE_POSITIONS[l];
      const b = TOPO_ELECTRODE_POSITIONS[r];
      expect(a.x).toBeLessThan(0);
      expect(b.x).toBeCloseTo(-a.x);
      expect(b.y).toBeCloseTo(a.y);
      expect(Math.hypot(a.x, a.y)).toBeLessThan(1);
    }
    expect(TOPO_ELECTRODE_POSITIONS.FCz.y).toBeGreaterThan(0);
    expect(TOPO_ELECTRODE_POSITIONS.POz.y).toBeLessThan(0);
  });

  it('builds electrodes with reference pixel coords and drops unplaced/non-finite channels', () => {
    const e = toTopoElectrodes({ Fz: 1, ECG: 2, Cz: NaN, T7: 3 });
    expect(e).toHaveLength(2);
    const r = CANVAS_SIZE * HEAD_RADIUS_RATIO;
    const fz = e.find((x) => x.value === 1)!;
    expect(fz).toMatchObject({ nx: 0, ny: 0.34, px: 80, py: 80 - 0.34 * r });
    const t7 = e.find((x) => x.value === 3)!;
    expect(t7.px).toBeCloseTo(80 - 0.85 * r);
  });
});

describe('IDW interpolation (p = 2)', () => {
  const electrodes = toTopoElectrodes({ Fz: 10, Pz: 0, C3: 5, C4: 5 });

  it('returns the electrode value at the electrode', () => {
    expect(idw(0, 0.34, electrodes)).toBe(10);
  });

  it('weights by inverse squared distance', () => {
    const two = toTopoElectrodes({ Cz: 0, Fz: 10 });
    // at y = 0.34/3: d(Cz)² : d(Fz)² = 1 : 4 → weights 4 : 1
    expect(idw(0, 0.34 / 3, two)).toBeCloseTo(2);
  });

  it('stays within the data range and is 0 without electrodes', () => {
    for (const [x, y] of [
      [0, 0],
      [0.5, 0.5],
      [-0.9, -0.1],
      [1.2, 1.2],
    ]) {
      const v = idw(x, y, electrodes);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(10);
    }
    expect(idw(0, 0, [])).toBe(0);
  });
});

describe('QEEG colormaps', () => {
  it('splits [0,1] into 11 solid bands', () => {
    expect(qeegDiscrete(0)).toEqual([0, 0, 255]);
    expect(qeegDiscrete(0.5)).toEqual([223, 223, 223]);
    expect(qeegDiscrete(5 / 11 - 1e-6)).toEqual([26, 255, 166]);
    expect(qeegDiscrete(0.99)).toEqual([255, 0, 0]);
    expect(qeegDiscrete(1)).toEqual([255, 0, 0]);
    expect(qeegDiscrete(-1)).toEqual([0, 0, 255]);
  });

  it('interpolates the same stops continuously', () => {
    expect(qeegSequential(0)).toEqual([0, 0, 255]);
    expect(qeegSequential(0.5)).toEqual([223, 223, 223]);
    expect(qeegSequential(1)).toEqual([255, 0, 0]);
    expect(qeegSequential(0.05)).toEqual([0, 59, 255]);
    expect(qeegSequential(2)).toEqual([255, 0, 0]);
  });

  it('builds a hard-stop legend gradient', () => {
    expect(LEGEND_GRADIENT_CSS).toMatch(/^linear-gradient\(to right, rgb\(0,0,255\) 0%, rgb\(0,0,255\) 9\.09/);
    expect(LEGEND_GRADIENT_CSS).toMatch(/rgb\(255,0,0\) 100%\)$/);
  });
});

describe('legend formatting', () => {
  it('formats absolute power', () => {
    expect(fmtAbs(0)).toBe('0');
    expect(fmtAbs(-1)).toBe('0');
    expect(fmtAbs(3.1)).toBe('3.1');
    expect(fmtAbs(123.6)).toBe('124');
    expect(fmtAbs(12345)).toBe('1.2e+4');
  });

  it('formats relative power as a percentage', () => {
    expect(fmtRel(0.1234)).toBe('12.3%');
    expect(fmtRel(0)).toBe('0%');
  });
});
