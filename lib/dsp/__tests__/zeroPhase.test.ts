import { describe, expect, it } from 'vitest';
import { butter } from '@/lib/server/eeg/dsp';
import {
  butterworthSections,
  eegFilterSections,
  filterEeg,
  magnitudeAt,
  notchSection,
  sosFiltFilt,
} from '../zeroPhase';

const FS = 250;

/** |H(e^jw)| of a b/a transfer function (reference from the scipy-parity server DSP). */
function baMagnitude(b: ArrayLike<number>, a: ArrayLike<number>, f: number, fs: number): number {
  const w = (2 * Math.PI * f) / fs;
  const ev = (c: ArrayLike<number>) => {
    let re = 0;
    let im = 0;
    for (let k = 0; k < c.length; k++) {
      re += c[k] * Math.cos(k * w);
      im -= c[k] * Math.sin(k * w);
    }
    return Math.hypot(re, im);
  };
  return ev(b) / ev(a);
}

const sine = (hz: number, n: number, amp = 1, phase = 0) =>
  Float64Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / FS + phase));

describe('butterworthSections', () => {
  it.each([
    ['lowpass', 45],
    ['lowpass', 70],
    ['highpass', 1],
    ['highpass', 0.5],
  ] as const)('%s %s Hz matches scipy butter(4) magnitude', (type, fc) => {
    const sections = butterworthSections(type, fc, FS, 4);
    const ref = butter(4, fc / (FS / 2), type);
    for (const f of [0.1, 0.5, 1, 2, 5, 10, 20, 40, 45, 60, 90, 120]) {
      const got = magnitudeAt(sections, f, FS);
      const want = baMagnitude(ref.b, ref.a, f, FS);
      expect(Math.abs(got - want)).toBeLessThan(1e-6 + 1e-6 * want);
    }
    expect(magnitudeAt(sections, fc, FS)).toBeCloseTo(Math.SQRT1_2, 6);
  });
});

describe('notch', () => {
  it('nulls the mains frequency and leaves the neighbourhood alone', () => {
    const s = [notchSection(60, FS, 30)];
    expect(magnitudeAt(s, 60, FS)).toBeLessThan(1e-9);
    expect(magnitudeAt(s, 50, FS)).toBeGreaterThan(0.99);
    expect(magnitudeAt(s, 10, FS)).toBeGreaterThan(0.999);
  });

  it('matches scipy.signal.iirnotch (60 Hz, Q 30, fs 250)', () => {
    // scipy.signal.iirnotch(60, 30, 250): b = [0.97547839, -0.12250159, 0.97547839],
    // a = [1, -0.12250159, 0.95095678]
    const s = notchSection(60, 250, 30);
    expect(s.b0).toBeCloseTo(0.97547839, 7);
    expect(s.b1).toBeCloseTo(-0.12250159, 7);
    expect(s.b2).toBeCloseTo(0.97547839, 7);
    expect(s.a1).toBeCloseTo(-0.12250159, 7);
    expect(s.a2).toBeCloseTo(0.95095678, 7);
  });

  it('keeps the bandwidth near Nyquist, so it settles quickly (120 Hz at 250 Hz)', () => {
    const s = notchSection(120, 250, 30);
    // -3 dB points at 120 ± 2 Hz
    expect(magnitudeAt([s], 118, 250)).toBeGreaterThan(0.65);
    expect(magnitudeAt([s], 118, 250)).toBeLessThan(0.76);
    // pole radius sqrt(a2) well inside the unit circle: transient below 5 % within 0.3 s
    // (the old sin(w0)-scaled form took several seconds here)
    expect(Math.sqrt(s.a2) ** 75).toBeLessThan(0.05);
  });

  it('adds harmonics below the low-pass, not above it', () => {
    const withLp = eegFilterSections(500, { notchHz: 60, lowpassHz: 100 });
    expect(withLp.length).toBe(2 /* 4th-order LP = 2 biquads */ + 2 /* 60, 120 Hz */);
    const noLp = eegFilterSections(500, { notchHz: 60 });
    expect(noLp.length).toBe(4); // 60, 120, 180, 240
  });
});

describe('sosFiltFilt', () => {
  it('has zero phase: a passband sine comes out aligned and unattenuated', () => {
    const x = sine(10, FS * 8, 50, 0.7);
    const y = filterEeg(x, FS, { highpassHz: 1, lowpassHz: 45, notchHz: 60 });
    // A 1 Hz 4th-order high-pass needs ~3/f seconds to settle at a window edge (the viewer pads
    // by that much); compare away from the edges.
    let err = 0;
    for (let i = 2 * FS; i < x.length - 2 * FS; i++) err = Math.max(err, Math.abs(y[i] - x[i]));
    expect(err).toBeLessThan(0.5); // 1 % of 50 µV
  });

  it('only removes the median when no high-pass is set', () => {
    const x = Float64Array.from(sine(10, FS * 4, 20), (v) => v + 100);
    const y = filterEeg(x, FS, { lowpassHz: 45 });
    const sorted = Float64Array.from(x).sort();
    const med = (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    let err = 0;
    for (let i = FS; i < x.length - FS; i++) err = Math.max(err, Math.abs(y[i] - (x[i] - med)));
    expect(err).toBeLessThan(0.05);
  });

  it('removes mains hum and slow drift', () => {
    const n = FS * 10;
    const alpha = sine(10, n, 20);
    const x = Float64Array.from(alpha, (v, i) => v + 30 * Math.sin((2 * Math.PI * 60 * i) / FS) + 200 + 40 * (i / n));
    const y = filterEeg(x, FS, { highpassHz: 1, lowpassHz: 45, notchHz: 60 });
    let err = 0;
    for (let i = 2 * FS; i < n - 2 * FS; i++) err = Math.max(err, Math.abs(y[i] - alpha[i]));
    expect(err).toBeLessThan(1.5);
  });

  it('does not ring at the window edges on a DC offset', () => {
    const x = new Float64Array(FS * 4).fill(500);
    const y = filterEeg(x, FS, { highpassHz: 0.5, lowpassHz: 70, notchHz: 60 });
    expect(Math.max(...y.map(Math.abs))).toBeLessThan(1e-6);
  });

  it('passes the signal through when no stage is enabled', () => {
    const x = sine(5, 100, 3);
    expect(Array.from(sosFiltFilt([], x))).toEqual(Array.from(x));
  });
});
