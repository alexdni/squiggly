import 'server-only';
// Loads the sLORETA kernel files on the main thread. The kernel is never committed (squiggly is a
// public repo) and never sent to the browser: it lives in the private `models` storage bucket,
// or in SLORETA_KERNEL_DIR for local development. Upload it with
// `node scripts/upload-sloreta-kernel.mjs <dir>`. The worker verifies the SHA-256 before use.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { KernelManifest, VoxelMetadata } from '@divergentneuro/biofeedback-core';
import { getStorageClient } from '@/lib/storage';
import type { SloretaKernelFiles } from './compute';
import { voxelGram } from './frames';

export const SLORETA_KERNEL_ID = process.env.SLORETA_KERNEL_ID || 'fsaverage-5mm-19ch-v1';
export const SLORETA_BUCKET = 'models';
export const sloretaKernelPath = (file: string) => `sloreta/${file}`;

const g = globalThis as typeof globalThis & {
  __sloretaKernel?: Promise<SloretaKernelFiles>;
  __sloretaGram?: Promise<SloretaGram>;
};

async function readKernelFile(name: string): Promise<Uint8Array> {
  const dir = process.env.SLORETA_KERNEL_DIR;
  if (dir) return new Uint8Array(await readFile(path.join(dir, name)));
  const buf = await getStorageClient().download(SLORETA_BUCKET, sloretaKernelPath(name));
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

async function fetchKernel(): Promise<SloretaKernelFiles> {
  const id = SLORETA_KERNEL_ID;
  const [bin, manifest, voxels] = await Promise.all([
    readKernelFile(`${id}.bin`),
    readKernelFile(`${id}.manifest.json`),
    readKernelFile(`${id}.voxels.json`),
  ]);
  const text = new TextDecoder();
  return {
    bin,
    manifest: JSON.parse(text.decode(manifest)) as KernelManifest,
    voxels: JSON.parse(text.decode(voxels)) as VoxelMetadata,
  };
}

/** Kernel files, cached per server process. A failed load is not cached, so the next job retries. */
export function loadSloretaKernel(): Promise<SloretaKernelFiles> {
  g.__sloretaKernel ??= fetchKernel().catch((err) => {
    g.__sloretaKernel = undefined;
    throw err;
  });
  return g.__sloretaKernel;
}

/** Kernel for an analysis job, or the reason it is unavailable. */
export async function sloretaKernelForJob(): Promise<SloretaKernelFiles | { unavailable: string }> {
  try {
    return await loadSloretaKernel();
  } catch (err) {
    console.error('[sloreta] kernel could not be loaded', err);
    return { unavailable: `the head-model kernel could not be loaded (${(err as Error).message})` };
  }
}

export interface SloretaGram {
  kernelId: string;
  nCh: number;
  nVox: number;
  /** per-voxel W_iᵀW_i, see frames.ts */
  G: Float32Array;
}

/**
 * Per-voxel Gram matrices for time-lapse frames, built once per server process from the
 * checksum-verified kernel (the same SHA-256 check core's parseKernelAsset makes).
 */
export function loadSloretaGram(): Promise<SloretaGram> {
  g.__sloretaGram ??= loadSloretaKernel()
    .then(({ bin, manifest }) => {
      const sha = createHash('sha256').update(bin).digest('hex');
      if (sha !== manifest.checksum.toLowerCase()) {
        throw new Error(`kernel ${manifest.kernelId}: checksum mismatch`);
      }
      const nCh = manifest.montage.channelNames.length;
      const nVox = manifest.voxelCount;
      if (bin.byteLength !== nVox * 3 * nCh * 4) throw new Error(`kernel ${manifest.kernelId}: byte length mismatch`);
      const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
      const W = new Float32Array(nVox * 3 * nCh);
      for (let i = 0; i < W.length; i++) W[i] = view.getFloat32(i * 4, true);
      return { kernelId: manifest.kernelId, nCh, nVox, G: voxelGram(W, nCh, nVox) };
    })
    .catch((err) => {
      g.__sloretaGram = undefined;
      throw err;
    });
  return g.__sloretaGram;
}
