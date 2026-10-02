/**
 * Port of api/workers/tests/test_theraq_metrics.py plus numeric helper checks.
 */
import { describe, it, expect } from 'vitest';
import {
  adaptNorms,
  bandToIndices,
  colourFor,
  computeTheraqMetrics,
  type ConditionSpectra,
  type TheraqNormDef,
} from '../engine';
import { SPECTRUM_DOMAIN } from '../spectrum';
import { median, pairwiseSum, pyRound } from '../numeric';
import { RfftMagnitude } from '../fft';

const CHANNELS = ['O1', 'Cz', 'F3', 'F4'];

function spec({ alpha = 1.0, theta = 1.0, beta = 1.0, delta = 1.0, base = 0.5 } = {}): number[] {
  return SPECTRUM_DOMAIN.map((f) => {
    if (f >= 1 && f <= 4) return delta;
    if (f >= 4 && f < 7.5) return theta;
    if (f >= 7.5 && f <= 12.5) return alpha;
    if (f >= 15.5 && f <= 25.5) return beta;
    return base;
  });
}

const cond = (alphaO1: number) => [
  spec({ alpha: alphaO1 }), // O1
  spec({ alpha: 1.5, theta: 1.2 }), // Cz
  spec(), // F3
  spec(), // F4
];

function spectra(alphaEo1 = 1.0, alphaEc = 2.0, alphaEo2 = 1.1, alphaTask = 1.0): ConditionSpectra {
  return { eo1: cond(alphaEo1), ec: cond(alphaEc), eo2: cond(alphaEo2), eoload: cond(alphaTask) };
}

describe('TheraQ engine (ported Python tests)', () => {
  it('band_to_indices matches Divergence slicing', () => {
    // alpha [7.5, 12.5] over integer domain -> ints 8..12 (stop exclusive)
    const [start, stop] = bandToIndices(SPECTRUM_DOMAIN, 7.5, 12.5);
    expect(SPECTRUM_DOMAIN[start]).toBe(8);
    expect(SPECTRUM_DOMAIN[stop - 1]).toBe(12);
  });

  it('produces 21 metrics and the four indices', () => {
    const res = computeTheraqMetrics(CHANNELS, spectra());
    expect(res.metrics).toHaveLength(21);
    expect(new Set(Object.keys(res.indices))).toEqual(
      new Set(['emotional_dysregulation', 'cognitive_performance', 'stress_trauma', 'sleep_dysregulation']),
    );
  });

  it('computes alpha shift value and colour', () => {
    // EC alpha = 2x EO1 alpha -> +100% shift, green (>= 70)
    const res = computeTheraqMetrics(CHANNELS, spectra(1.0, 2.0));
    const m = res.metrics.find((x) => x.name === 'Alpha Shift O1 (EO EC)')!;
    expect(Math.abs(m.value! - 100.0)).toBeLessThan(0.01);
    expect(m.colour).toBe('green');

    // No alpha increase on eye closure -> 0% shift, red (< 50)
    const res2 = computeTheraqMetrics(CHANNELS, spectra(1.0, 1.0));
    const m2 = res2.metrics.find((x) => x.name === 'Alpha Shift O1 (EO EC)')!;
    expect(Math.abs(m2.value!)).toBeLessThan(0.01);
    expect(m2.colour).toBe('red');
  });

  it('classifies every non-dial metric with a finite value', () => {
    const res = computeTheraqMetrics(CHANNELS, spectra());
    for (const m of res.metrics) {
      expect(m.value, m.name).not.toBeNull();
      expect(Number.isFinite(m.value), m.name).toBe(true);
      if (m.display !== 'dial') expect(['green', 'yellow', 'red'], m.name).toContain(m.colour);
    }
  });

  it('scores indices 0..10', () => {
    const res = computeTheraqMetrics(CHANNELS, spectra());
    for (const idx of Object.values(res.indices)) {
      expect(idx.score).toBeGreaterThanOrEqual(0);
      expect(idx.score).toBeLessThanOrEqual(10);
      expect(['green', 'yellow', 'red']).toContain(idx.colour);
    }
  });

  it('adapt_norms extends the outermost range', () => {
    const norms: TheraqNormDef[] = [
      { range: [70, 200], colour: 'green' },
      { range: [50, 70], colour: 'yellow' },
      { range: [-100, 50], colour: 'red' },
    ];
    expect(colourFor(adaptNorms(norms, -250)!, -250)).toBe('red');
    expect(colourFor(adaptNorms(norms, 500)!, 500)).toBe('green');
    // the input is not mutated
    expect(norms[2].range).toEqual([-100, 50]);
  });

  it('returns null value and colour for a zero denominator', () => {
    const s = spectra();
    s.ec[3] = s.ec[3].map((v, i) => (SPECTRUM_DOMAIN[i] >= 15.5 && SPECTRUM_DOMAIN[i] <= 25.5 ? 0 : v));
    const m = computeTheraqMetrics(CHANNELS, s).metrics.find((x) => x.name === 'TBR F4 (EC)')!;
    expect(m.value).toBeNull();
    expect(m.colour).toBeNull();
  });

  it('throws for a missing channel', () => {
    expect(() => computeTheraqMetrics(['O1', 'Cz', 'F3'], spectra())).toThrow(
      "Required channel 'F4' not found in recording",
    );
  });
});

describe('numeric helpers', () => {
  it('pyRound matches Python round() including ties-to-even', () => {
    expect(pyRound(6.25, 1)).toBe(6.2);
    expect(pyRound(3.75, 1)).toBe(3.8);
    expect(pyRound(0.125, 2)).toBe(0.12);
    expect(pyRound(0.375, 2)).toBe(0.38);
    expect(pyRound(2.675, 2)).toBe(2.67); // 2.675 is below the tie in binary
    expect(pyRound(1.005, 2)).toBe(1.0);
    expect(pyRound(-0.125, 2)).toBe(-0.12);
    expect(Object.is(pyRound(-0.001, 2), -0)).toBe(true);
    expect(pyRound(12.5, 0)).toBe(12);
    expect(pyRound(13.5, 0)).toBe(14);
    expect(Number.isNaN(pyRound(NaN, 2))).toBe(true);
  });

  it('pairwiseSum equals plain summation for exact values and handles blocks', () => {
    const a = Array.from({ length: 300 }, (_, i) => i + 1);
    expect(pairwiseSum(a)).toBe(45150);
    expect(pairwiseSum([])).toBe(0);
  });

  it('median matches numpy', () => {
    expect(median([1, 2, 4, 7])).toBe(3);
    expect(median([5, 1, 3])).toBe(3);
  });

  it.each([8, 16, 200, 250, 500, 7])('rfft magnitudes match a direct DFT (n=%i)', (n) => {
    const x = Array.from({ length: n }, (_, i) => Math.sin(0.37 * i) * 3 + Math.cos(1.3 * i * i) + 0.1 * i);
    const got = new RfftMagnitude(n).magnitudes(x);
    for (let k = 0; k <= n >> 1; k++) {
      let re = 0;
      let im = 0;
      for (let t = 0; t < n; t++) {
        const ang = (-2 * Math.PI * ((k * t) % n)) / n;
        re += x[t] * Math.cos(ang);
        im += x[t] * Math.sin(ang);
      }
      expect(got[k]).toBeCloseTo(Math.hypot(re, im), 9);
    }
  });
});
