import { describe, it, expect } from 'vitest';
import type { BandPower, Connectivity, SpectrogramData } from '@/lib/analysis-results';
import {
  alphaPeakValues,
  bandValues,
  computeBandScales,
  connectivityEdges,
  connectivityScale,
  networkMetricSeries,
  orderChannels,
  spectrogramPixels,
  spectrogramScale,
} from '../data';
import { blueRed } from '../topo';

function bp(scale: number): BandPower {
  const out: Record<string, any> = {};
  ['Fp1', 'Fz', 'Cz', 'Pz', 'O1', 'ECG'].forEach((ch, i) => {
    out[ch] = {
      delta: { absolute: (i + 1) * scale, relative: 0.1 * (i + 1) },
      alpha1: { absolute: 100 * scale, relative: 0.5 },
    };
  });
  return out as BandPower;
}

describe('band values and shared scales', () => {
  it('reads absolute and relative values and tolerates legacy numbers', () => {
    expect(bandValues(bp(1), 'delta', 'absolute').Fz).toBe(2);
    expect(bandValues(bp(1), 'delta', 'relative').Fz).toBeCloseTo(0.2);
    const legacy = { Fz: { delta: 7 } } as unknown as BandPower;
    expect(bandValues(legacy, 'delta', 'absolute')).toEqual({ Fz: 7 });
    expect(bandValues(legacy, 'delta', 'relative')).toEqual({});
    expect(bandValues(null, 'delta', 'absolute')).toEqual({});
  });

  it('pools every analysis/condition into one scale per band and ignores unplaced channels', () => {
    const scales = computeBandScales([bp(1), bp(10), null], 'absolute');
    // placed delta values: 1..5 and 10..50 (ECG excluded)
    expect(scales.delta!.vmin).toBeGreaterThanOrEqual(1);
    expect(scales.delta!.vmin).toBeLessThan(2);
    expect(scales.delta!.vmax).toBeGreaterThan(40);
    expect(scales.delta!.vmax).toBeLessThanOrEqual(50);
    expect(scales.theta).toBeUndefined();
  });
});

describe('alpha peak', () => {
  it('drops missing peaks', () => {
    expect(alphaPeakValues({ O1: { peak_frequency: 10.2, peak_power: 3 }, O2: { peak_frequency: 0, peak_power: 0 } })).toEqual({
      O1: 10.2,
    });
  });
});

describe('connectivity', () => {
  const m = {
    channels: ['Fz', 'Cz', 'Pz', 'ECG'],
    matrix: [
      [0, 0.5, 0.05, 0.9],
      [0.5, 0, 0.3, 0.9],
      [0.05, 0.3, 0, 0.9],
      [0.9, 0.9, 0.9, 0],
    ],
  };

  it('returns upper-triangle edges above threshold between placed electrodes, weakest first', () => {
    expect(connectivityEdges(m, 0.1)).toEqual([
      { a: 'Cz', b: 'Pz', value: 0.3 },
      { a: 'Fz', b: 'Cz', value: 0.5 },
    ]);
    expect(connectivityEdges(null, 0.1)).toEqual([]);
  });

  it('pads the colour range like the Python grid', () => {
    const conn = { connectivity_matrices: { delta: m } } as unknown as Connectivity;
    const s = connectivityScale([conn], 0.1);
    expect(s.vmin).toBeCloseTo(0.28);
    expect(s.vmax).toBeCloseTo(0.55);
    expect(connectivityScale([], 0.2)).toEqual({ vmin: 0.2, vmax: 1 });
  });

  it('extracts network metric series per band', () => {
    const conn = {
      network_metrics: { delta: { global_efficiency: 0.4 }, alpha: { global_efficiency: 0.6 } },
    } as unknown as Connectivity;
    expect(networkMetricSeries(conn, 'global_efficiency')).toEqual([0.4, null, 0.6, null]);
  });
});

describe('spectrogram', () => {
  const data: SpectrogramData = {
    times: [0, 1, 2],
    freqs: [1, 2],
    power_db: [
      [0, 10],
      [5, 15],
      [10, 20],
    ],
  };

  it('scales to the 5th–95th percentile', () => {
    const s = spectrogramScale(data)!;
    expect(s.vmin).toBeCloseTo(1.25);
    expect(s.vmax).toBeCloseTo(18.75);
  });

  it('lays time along x and puts low frequencies on the bottom row', () => {
    const { width, height, pixels } = spectrogramPixels(data, { vmin: 0, vmax: 20 }, blueRed);
    expect([width, height]).toEqual([3, 2]);
    // bottom-left pixel = t0, f=1 Hz, value 0 → blue
    const bl = (1 * width + 0) * 4;
    expect(Array.from(pixels.slice(bl, bl + 4))).toEqual([0, 0, 255, 255]);
    // top-right = t2, f=2 Hz, value 20 → red
    const tr = (0 * width + 2) * 4;
    expect(Array.from(pixels.slice(tr, tr + 4))).toEqual([255, 0, 0, 255]);
  });
});

describe('orderChannels', () => {
  it('puts preferred channels first in their order', () => {
    expect(orderChannels(['O1', 'C3', 'Fz', 'A1'], ['Fp1', 'Fz', 'O1'])).toEqual(['Fz', 'O1', 'A1', 'C3']);
  });
});
