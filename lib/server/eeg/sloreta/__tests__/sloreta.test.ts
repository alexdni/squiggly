import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { computeSourceEstimate, type KernelManifest, type VoxelMetadata } from '@divergentneuro/biofeedback-core';
import { describe, expect, it } from 'vitest';
import { BAND_NAMES, BANDS } from '@/lib/analysis-results';
import { CHANNELS_10_20 } from '@/lib/eeg-labels';
import {
  computeSourceMaps,
  computeWindowSpectra,
  ensureKernel,
  SloretaUnavailableError,
  type SloretaKernelFiles,
} from '../compute';
import { encodeFrames, triSize, voxelGram } from '../frames';
import { resampleEpoch } from '../resample';

const LABELS = [...CHANNELS_10_20];
const FS = 250;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A small random kernel with a valid manifest and checksum, so the core verification path runs. */
async function toyKernel(id: string, nVox = 60): Promise<SloretaKernelFiles> {
  const rand = rng(3);
  const W = new Float32Array(nVox * 3 * LABELS.length).map(() => rand() - 0.5);
  const bin = new Uint8Array(W.buffer);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bin));
  const checksum = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  const manifest: KernelManifest = {
    kernelId: id,
    headModelId: 'toy',
    conductivities: {},
    montage: { channelNames: LABELS, referenceType: 'average', system: '10-20' },
    designSampleRate: FS,
    voxelCount: nVox,
    orientationsPerVoxel: 3,
    alpha: 1,
    assumedSnr: 3,
    effectiveRankAtBuild: 18,
    averageReferenceApplied: true,
    sensitivityThreshold: 0,
    zeroedOrientationComponents: 0,
    atlasVersion: 'toy',
    buildCommit: 'test',
    checksum,
  };
  const voxels: VoxelMetadata = {
    coordsMni: Array.from({ length: nVox }, (_, i) => [(i % 5) * 5 - 10, Math.floor(i / 5) * 5 - 30, 0]),
    labels: Array.from({ length: nVox }, (_, i) => (i % 2 ? 'left-frontal' : 'right-frontal')),
    lowSensitivity: Array.from({ length: nVox }, (_, i) => i % 7 === 0),
  };
  return { bin, manifest, voxels };
}

/** Channel-major epochs: noise plus a 10 Hz rhythm weighted per channel. */
function epochs(count: number, fs: number, weight: (label: string) => number, seed = 1): Float64Array[][] {
  const rand = rng(seed);
  const n = 2 * fs;
  return Array.from({ length: count }, (_, e) =>
    LABELS.map((label) => {
      const w = weight(label);
      return Float64Array.from({ length: n }, (_, t) => w * 20 * Math.sin(2 * Math.PI * 10 * (t / fs) + e) + (rand() - 0.5) * 4);
    })
  );
}

describe('resampleEpoch', () => {
  it('returns the input unchanged at the same rate', () => {
    const x = Float64Array.from({ length: 500 }, (_, i) => Math.sin(i));
    expect(resampleEpoch(x, 250, 250, 500)).toBe(x);
  });

  it('carries a 10 Hz sine from 256 Hz to exactly 250 Hz', () => {
    const x = Float64Array.from({ length: 512 }, (_, i) => Math.sin((2 * Math.PI * 10 * i) / 256));
    const y = resampleEpoch(x, 256, 250, 500);
    expect(y).toHaveLength(500);
    let maxErr = 0;
    for (let j = 20; j < 480; j++) maxErr = Math.max(maxErr, Math.abs(y[j] - Math.sin((2 * Math.PI * 10 * j) / 250)));
    expect(maxErr).toBeLessThan(0.01);
  });

  it('removes content above the output Nyquist when downsampling', () => {
    const x = Float64Array.from({ length: 1200 }, (_, i) => Math.sin((2 * Math.PI * 200 * i) / 600));
    const y = resampleEpoch(x, 600, 250, 500);
    let peak = 0;
    for (let j = 20; j < 480; j++) peak = Math.max(peak, Math.abs(y[j]));
    expect(peak).toBeLessThan(0.05);
  });
});

describe('computeSourceMaps', () => {
  it('equals the mean of per-epoch core estimates', async () => {
    const kernel = await toyKernel('toy-mean');
    const kernelId = await ensureKernel(kernel);
    const eo = epochs(6, FS, (l) => (l.startsWith('O') ? 1 : 0.2));
    const { meta, values } = computeSourceMaps({ kernelId, labels: LABELS, sampleRate: FS, epochs: { eo }, interpolated: [] });

    expect(meta.conditions).toEqual(['eo']);
    expect(meta.epochs_used).toEqual({ eo: 6 });
    expect(values).toHaveLength(BAND_NAMES.length * 60);

    const bands = BAND_NAMES.map((name) => ({ name, fLo: BANDS[name][0], fHi: BANDS[name][1] }));
    const perEpoch = eo.map(
      (epoch) =>
        computeSourceEstimate({
          kernelId,
          channels: Object.fromEntries(LABELS.map((l, c) => [l, Array.from(epoch[c])])),
          montage: kernel.manifest.montage,
          sampleRate: FS,
          timestamp: 0,
          bands,
          softwareVersion: 'test',
        }).voxel
    );
    bands.forEach((_, bi) => {
      for (let v = 0; v < 60; v++) {
        const mean = perEpoch.reduce((s, est) => s + est[bi].values[v], 0) / perEpoch.length;
        expect(values[bi * 60 + v]).toBeCloseTo(mean, 3);
      }
    });
  });

  it('maps channels by name, not by position', async () => {
    const kernelId = await ensureKernel(await toyKernel('toy-order'));
    const eo = epochs(3, FS, (l) => (l === 'Fz' ? 1 : 0.1));
    const shuffled = [...LABELS].reverse();
    const a = computeSourceMaps({ kernelId, labels: LABELS, sampleRate: FS, epochs: { eo }, interpolated: [] });
    const b = computeSourceMaps({
      kernelId,
      labels: shuffled,
      sampleRate: FS,
      epochs: { eo: eo.map((ep) => [...ep].reverse()) },
      interpolated: [],
    });
    expect(Array.from(b.values)).toEqual(Array.from(a.values));
  });

  it('refuses a montage with a missing channel instead of guessing', async () => {
    const kernelId = await ensureKernel(await toyKernel('toy-missing'));
    const labels = LABELS.filter((l) => l !== 'P7');
    const eo = epochs(2, FS, () => 1).map((ep) => ep.filter((_, c) => LABELS[c] !== 'P7'));
    expect(() => computeSourceMaps({ kernelId, labels, sampleRate: FS, epochs: { eo }, interpolated: [] })).toThrow(
      SloretaUnavailableError
    );
  });

  it('resamples a 256 Hz recording and reports it', async () => {
    const kernelId = await ensureKernel(await toyKernel('toy-256'));
    const eo = epochs(2, 256, () => 1);
    const { meta } = computeSourceMaps({ kernelId, labels: LABELS, sampleRate: 256, epochs: { eo }, interpolated: ['T7'] });
    expect(meta.resampled_from_hz).toBe(256);
    expect(meta.channels_interpolated).toEqual(['T7']);
    expect(meta.effective_rank).toBe(17);
  });

  it('rejects a kernel whose bytes do not match its checksum', async () => {
    const kernel = await toyKernel('toy-corrupt');
    kernel.bin = kernel.bin.slice();
    kernel.bin[0] ^= 0xff;
    await expect(ensureKernel(kernel)).rejects.toThrow(/checksum/);
  });
});

describe('time lapse', () => {
  it('frames from stored window spectra match core per window, and reject windows over bad data', async () => {
    const kernel = await toyKernel('toy-frames');
    const kernelId = await ensureKernel(kernel);
    const seconds = 8;
    const rand = rng(5);
    const data = LABELS.map((l) =>
      Float64Array.from({ length: seconds * FS }, (_, t) => (l.startsWith('O') ? 20 : 3) * Math.sin((2 * Math.PI * 10 * t) / FS) + rand() - 0.5)
    );
    const keep = new Uint8Array(seconds * FS).fill(1);
    keep.fill(0, Math.round(4.5 * FS), Math.round(4.7 * FS)); // touches windows starting at 3 s and 4 s
    const { spectra, nWindows, rejected } = computeWindowSpectra({ kernelId, labels: LABELS, sampleRate: FS, data, keep, manual: [] });
    expect(nWindows).toBe(7);
    expect(rejected).toEqual([3, 4]);

    const nVox = kernel.manifest.voxelCount;
    const G = voxelGram(new Float32Array(kernel.bin.buffer.slice(0)), LABELS.length, nVox);
    const nBands = BAND_NAMES.length;
    const band = BAND_NAMES.indexOf('alpha2');
    const enc = encodeFrames({ G, nVox, spectra, nBands, band, rejected: new Set(rejected), start: 0, count: nWindows });
    const scales = new Float32Array(enc.buffer, 0, nWindows);
    expect(scales[3]).toBe(-1);
    expect(enc.length).toBe(4 * nWindows + nWindows * nVox);

    for (const w of [0, 5]) {
      const core = computeSourceEstimate({
        kernelId,
        channels: Object.fromEntries(LABELS.map((l, c) => [l, Array.from(data[c].subarray(w * FS, w * FS + 2 * FS))])),
        montage: kernel.manifest.montage,
        sampleRate: FS,
        timestamp: 0,
        bands: [{ name: 'alpha2', fLo: BANDS.alpha2[0], fHi: BANDS.alpha2[1] }],
        softwareVersion: 'test',
      }).voxel[0].values;
      const max = Math.max(...core);
      expect(scales[w]).toBeCloseTo(max, 3);
      const bytes = enc.subarray(4 * nWindows + w * nVox, 4 * nWindows + (w + 1) * nVox);
      for (let v = 0; v < nVox; v++) expect(Math.abs((bytes[v] / 255) * scales[w] - core[v])).toBeLessThan(max / 255 + 1e-9);
    }
    expect(spectra.length).toBe(nWindows * nBands * triSize(LABELS.length));
  });
});

// Localization against the production fsaverage kernel, when it is available locally
// (SLORETA_KERNEL_DIR, as for `next dev`).
const kernelDir = process.env.SLORETA_KERNEL_DIR;
const kernelFile = (name: string) => path.join(kernelDir ?? '', `fsaverage-5mm-19ch-v1.${name}`);
describe.skipIf(!kernelDir || !existsSync(kernelFile('bin')))('fsaverage kernel', () => {
  const load = async () =>
    ensureKernel({
      bin: new Uint8Array(readFileSync(kernelFile('bin'))),
      manifest: JSON.parse(readFileSync(kernelFile('manifest.json'), 'utf8')),
      voxels: JSON.parse(readFileSync(kernelFile('voxels.json'), 'utf8')),
    });

  it.each([
    ['occipital', (l: string) => (l.startsWith('O') ? 1 : 0.05), (mni: number[]) => mni[1] < -50],
    ['frontal', (l: string) => (l.startsWith('Fp') || l.startsWith('F') ? 1 : 0.05), (mni: number[]) => mni[1] > 0],
    ['left', (l: string) => (/[1357]$/.test(l) ? 1 : 0.05), (mni: number[]) => mni[0] < 0],
    ['right', (l: string) => (/[2468]$/.test(l) ? 1 : 0.05), (mni: number[]) => mni[0] > 0],
  ])('localizes %s alpha to the matching region', async (_name, weight, where) => {
    const kernelId = await load();
    const { meta } = computeSourceMaps({
      kernelId,
      labels: LABELS,
      sampleRate: FS,
      epochs: { ec: epochs(10, FS, weight) },
      interpolated: [],
    });
    expect(where(meta.stats.ec!.alpha2!.peak!.mni)).toBe(true);
  });
});
