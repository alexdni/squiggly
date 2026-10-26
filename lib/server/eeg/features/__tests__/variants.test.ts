import { describe, it, expect } from 'vitest';
import { detectVariants, variantEventResults } from '../variants';
import type { WaveformInput } from '../waveform';

const FS = 200;
const SEC = 120;
const N = FS * SEC;
const LABELS = ['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8', 'T7', 'C3', 'Cz', 'C4', 'T8', 'P7', 'P3', 'Pz', 'P4', 'P8', 'O1', 'O2'];
const POSTERIOR = new Set(['P3', 'Pz', 'P4', 'O1', 'O2', 'P7', 'P8']);
const FRONTOCENTRAL = { F3: 1, F4: 1, Fz: 1, C3: 0.7, C4: 0.7, Cz: 0.8, Fp1: 0.5, Fp2: 0.5 } as Record<string, number>;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32 - 0.5;
  };
}

/** 1/f-ish background (random walk leak plus white noise), scaled by `gain`. */
function background(seed: number, gain = 1): Float64Array[] {
  const rand = rng(seed);
  return LABELS.map(() => {
    const x = new Float64Array(N);
    let slow = 0;
    for (let i = 0; i < N; i++) {
      slow = 0.97 * slow + rand();
      x[i] = gain * (3 * rand() + 1.2 * slow);
    }
    return x;
  });
}

/**
 * Posterior alpha around `hz` (frequency jittering ±0.4 Hz like a real rhythm), amplitude `amp`,
 * everywhere except inside `gaps`; `shape` maps phase to the waveform.
 */
function addAlpha(data: Float64Array[], hz: number, amp: number, gaps: [number, number][] = [], shape = (p: number) => Math.sin(p)) {
  const rand = rng(99);
  let drift = 0;
  let phase = 0;
  const phases = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    drift = 0.999 * drift + 0.02 * rand();
    phase += (2 * Math.PI * (hz + Math.max(-0.4, Math.min(0.4, drift * 4)))) / FS;
    phases[i] = phase;
  }
  LABELS.forEach((l, c) => {
    if (!POSTERIOR.has(l)) return;
    for (let i = 0; i < N; i++) {
      const t = i / FS;
      if (gaps.some(([a, b]) => t >= a && t < b)) continue;
      data[c][i] += amp * shape(phases[i] + c * 0.1);
    }
  });
}

function input(data: Float64Array[], cond: 'eo' | 'ec' = 'ec', labels = LABELS): WaveformInput {
  return { labels, data, sampleRate: FS, keep: new Uint8Array(N).fill(1), segments: { [cond]: { start: 0, end: SEC } } };
}

describe('low-voltage fast', () => {
  it('flags a low-amplitude eyes-closed recording with beta over a poorly developed alpha', () => {
    const data = background(1, 0.6);
    LABELS.forEach((_, c) => {
      for (let i = 0; i < N; i++) data[c][i] += 2 * Math.sin(2 * Math.PI * 21 * (i / FS) + c);
    });
    const v = detectVariants(input(data));
    expect(v.lowVoltage).toHaveLength(1);
    expect(v.lowVoltage[0]).toMatchObject({ condition: 'ec', eyesClosed: true });
    expect(v.lowVoltage[0].amplitudeUv).toBeLessThan(20);
    expect(v.summary.ec!.low_voltage!.flagged).toBe(true);
  });

  it('leaves a recording with a well-developed alpha alone, and one with implausibly small units', () => {
    const alpha = background(2, 0.6);
    addAlpha(alpha, 10, 8);
    expect(detectVariants(input(alpha)).lowVoltage).toHaveLength(0);
    const tiny = background(3, 0.01);
    expect(detectVariants(input(tiny)).lowVoltage).toHaveLength(0);
  });

  it('needs eight standard sites', () => {
    const data = background(4, 0.6).slice(0, 6);
    expect(detectVariants(input(data, 'ec', LABELS.slice(0, 6))).lowVoltage).toHaveLength(0);
  });
});

describe('beta spindles', () => {
  const spindles = (data: Float64Array[], everySec: number, amp: number, hz = 22) => {
    for (let t = 5; t + 2 < SEC; t += everySec) {
      LABELS.forEach((l, c) => {
        const g = FRONTOCENTRAL[l];
        if (!g) return;
        for (let k = 0; k < FS; k++) data[c][Math.round(t * FS) + k] += amp * g * Math.sin((Math.PI * k) / FS) ** 2 * Math.sin(2 * Math.PI * hz * (k / FS));
      });
    }
  };

  it('finds recurring waxing-and-waning frontocentral beta bursts', () => {
    const data = background(5);
    addAlpha(data, 10, 6);
    spindles(data, 8, 14);
    const v = detectVariants(input(data));
    expect(v.betaSpindles.length).toBeGreaterThanOrEqual(8);
    for (const b of v.betaSpindles) {
      expect(b.freqHz).toBeGreaterThan(20);
      expect(b.freqHz).toBeLessThan(24);
      expect(b.channels.every((c) => c in FRONTOCENTRAL)).toBe(true);
    }
    expect(v.summary.ec!.beta_spindles!.per_min).toBeGreaterThanOrEqual(1);
  });

  it('ignores a few sporadic bursts', () => {
    const data = background(6);
    addAlpha(data, 10, 6);
    spindles(data, 200, 14); // one burst in two minutes
    expect(detectVariants(input(data)).betaSpindles).toHaveLength(0);
  });

  it('ignores the harmonic of sharp arch-shaped alpha', () => {
    const data = background(7);
    // strongly non-sinusoidal 10 Hz waves everywhere put energy at 20 Hz
    LABELS.forEach((_, c) => {
      for (let i = 0; i < N; i++) {
        const p = 2 * Math.PI * 10 * (i / FS);
        data[c][i] += 15 * (Math.cos(p) - 0.6 * Math.cos(2 * p));
      }
    });
    expect(detectVariants(input(data)).betaSpindles).toHaveLength(0);
  });
});

describe('fast alpha variant', () => {
  it('finds a posterior rhythm at twice the alpha frequency standing in for alpha', () => {
    const data = background(8);
    const runs: [number, number][] = [];
    for (let t = 4; t + 6 < SEC; t += 10) runs.push([t, t + 6]);
    addAlpha(data, 9, 10, runs);
    const outside: [number, number][] = [[0, runs[0][0]], ...runs.slice(1).map((r, k) => [runs[k][1], r[0]] as [number, number]), [runs[runs.length - 1][1], SEC]];
    addAlpha(data, 18, 10, outside);
    const v = detectVariants(input(data));
    expect(v.fastAlpha.length).toBeGreaterThanOrEqual(8);
    expect(v.fastAlpha[0].freqHz).toBeGreaterThan(17);
    expect(v.fastAlpha[0].freqHz).toBeLessThan(19);
    expect(v.fastAlpha[0].channels.every((c) => POSTERIOR.has(c))).toBe(true);
    expect(v.summary.ec!.fast_alpha!.dominance).toBeGreaterThanOrEqual(0.6);
  });

  it('does not call an ordinary alpha with a harmonic, or a device line, a fast alpha variant', () => {
    const data = background(9);
    addAlpha(data, 10, 12, [], (p) => Math.sin(p) + 0.3 * Math.sin(2 * p));
    LABELS.forEach((_, c) => {
      for (let i = 0; i < N; i++) data[c][i] += 3 * Math.sin(2 * Math.PI * 20 * (i / FS));
    });
    expect(detectVariants(input(data)).fastAlpha).toHaveLength(0);
  });

  it('runs on eyes-closed data only', () => {
    const data = background(10);
    addAlpha(data, 9, 2);
    addAlpha(data, 18, 10);
    const v = detectVariants(input(data, 'eo'));
    expect(v.fastAlpha).toHaveLength(0);
    expect(v.summary.eo!.fast_alpha).toBeUndefined();
  });
});

describe('variantEventResults', () => {
  it('makes noted variant events with stable ids; low-voltage fast covers all channels', () => {
    const data = background(11, 0.6);
    LABELS.forEach((_, c) => {
      for (let i = 0; i < N; i++) data[c][i] += 2 * Math.sin(2 * Math.PI * 21 * (i / FS) + c);
    });
    const v = detectVariants(input(data));
    const events = variantEventResults(v);
    const lv = events.find((e) => e.pattern === 'low-voltage-fast')!;
    expect(lv).toMatchObject({ category: 'variant', channels: [], handling: 'noted', source: 'detector', startSec: 0, endSec: SEC });
    expect(lv.id).toMatch(/^[0-9a-f]{16}$/);
    expect(variantEventResults(v)[0].id).toBe(events[0].id);
    expect(variantEventResults(v, new Set([lv.id])).find((e) => e.id === lv.id)!.dismissed).toBe(true);
  });
});
