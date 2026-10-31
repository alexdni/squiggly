import { describe, expect, it } from 'vitest';
import {
  detectPeriodicArtifacts,
  removePeriodicArtifacts,
  summarizePeriodicArtifacts,
} from '../features/periodicArtifacts';
import type { LoadedEeg } from '../io/loadRecording';

const FS = 250;
const SECONDS = 90;

function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Brown-ish noise plus a broad 10 Hz alpha, and a periodic artifact at 8.3 Hz (×2, ×4, ×5, ×6) when `uv` > 0. */
function channel(seed: number, uv: number): Float64Array {
  const rand = random(seed);
  const out = new Float64Array(SECONDS * FS);
  let walk = 0;
  let alpha = 0;
  for (let i = 0; i < out.length; i++) {
    const g = () => Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand());
    walk = 0.97 * walk + g();
    alpha += (2 * Math.PI * 10) / FS + 0.25 * g();
    const phase = (2 * Math.PI * 8.3 * i) / FS;
    const periodic = [2, 4, 5, 6].reduce((sum, k) => sum + Math.sin(k * phase + k), 0);
    out[i] = 4 * walk + 15 * Math.sin(alpha) + 3 * g() + uv * periodic;
  }
  return out;
}

const eeg = (data: Float64Array[]): LoadedEeg => ({
  format: 'csv',
  labels: ['F3', 'F4', 'P3', 'P4'].slice(0, data.length),
  data,
  sampleRate: FS,
  originalSampleRate: FS,
  ignored: [],
});

/** Power at `f` Hz over the whole signal (one DFT bin at 1/90 Hz). */
const powerAt = (x: Float64Array, f: number) => {
  let re = 0;
  let im = 0;
  for (let i = 0; i < x.length; i++) {
    re += x[i] * Math.cos((2 * Math.PI * f * i) / FS);
    im -= x[i] * Math.sin((2 * Math.PI * f * i) / FS);
  }
  return re * re + im * im;
};

describe('periodic artifacts', () => {
  it('finds one source across the channels that carry it and none on clean EEG', () => {
    const rec = eeg([channel(1, 4), channel(2, 4), channel(3, 4), channel(4, 0)]);
    const found = detectPeriodicArtifacts(rec.data, FS, 60);
    const [source, ...rest] = summarizePeriodicArtifacts(rec.labels, found);
    expect(rest).toEqual([]);
    expect(source.fundamental).toBeCloseTo(8.3, 1);
    expect(source.harmonics).toEqual(expect.arrayContaining([2, 4, 5, 6]));
    expect(source.channels.map((c) => c.label).sort()).toEqual(['F3', 'F4', 'P3']);
    expect(found[3]).toEqual([]);
  });

  it('removes its lines and leaves channels without it untouched', () => {
    const rec = eeg([channel(5, 4), channel(6, 0)]);
    const found = detectPeriodicArtifacts(rec.data, FS, 60);
    const cleaned = removePeriodicArtifacts(rec, found, summarizePeriodicArtifacts(rec.labels, found));
    for (const k of [2, 4, 5, 6]) {
      expect(powerAt(cleaned[0], 8.3 * k)).toBeLessThan(powerAt(rec.data[0], 8.3 * k) / 20);
    }
    expect(cleaned[1]).toBe(rec.data[1]);
  });
});
