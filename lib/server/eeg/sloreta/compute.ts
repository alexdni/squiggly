// sLORETA source maps from the cleaned EEG, run inside the analysis worker.
//
// For each condition and band the result is the mean standardized current density over the kept
// 2 s epochs. sLORETA power is trace(W_i M W_i^T), linear in the cross-spectrum M, so averaging M
// over epochs and applying the kernel once gives exactly the mean of per-epoch estimates at a
// fraction of the cost (~7 M MACs per band instead of per band per epoch).
//
// Only epochs the artifact pipeline kept reach this step: core's own README warns that a source
// estimate on uncleaned EEG is "not a weaker result, it is a confidently wrong one".

import {
  applyAverageReference,
  crossSpectrumBand,
  getKernel,
  hasKernel,
  parseKernelAsset,
  quadraticForm,
  registerKernel,
  type KernelManifest,
  type VoxelMetadata,
} from '@divergentneuro/biofeedback-core';
import { BAND_NAMES, BANDS, type Condition, type SloretaPeak, type SloretaResults } from '@/lib/analysis-results';
import { resampleEpoch } from './resample';

export const SLORETA_EPOCH_SEC = 2;
/** Matches core's default and the webapp: ~1 Hz bins over a 2 s epoch. */
const WELCH = { segmentLength: 256, overlap: 128 };

/** Kernel files as loaded on the main thread; verified and registered here. */
export interface SloretaKernelFiles {
  bin: Uint8Array;
  manifest: KernelManifest;
  voxels: VoxelMetadata;
}

/** A recording or kernel that cannot produce a source map; becomes a QC warning, never a failure. */
export class SloretaUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SloretaUnavailableError';
  }
}

/** Verify (SHA-256, byte length, metadata) and register the kernel once per worker. */
export async function ensureKernel(files: SloretaKernelFiles): Promise<string> {
  const id = files.manifest.kernelId;
  if (!hasKernel(id)) {
    const buf = files.bin.buffer.slice(files.bin.byteOffset, files.bin.byteOffset + files.bin.byteLength);
    registerKernel(await parseKernelAsset(buf as ArrayBuffer, files.manifest, files.voxels));
  }
  return id;
}

export interface SourceMapsInput {
  kernelId: string;
  /** cleaned, average-referenced channels that survived QC */
  labels: string[];
  sampleRate: number;
  /** kept epochs per condition, each channel-major in `labels` order, SLORETA_EPOCH_SEC long */
  epochs: Partial<Record<Condition, Float64Array[][]>>;
  interpolated: string[];
}

export interface SourceMapsOutput {
  meta: SloretaResults;
  /** [condition][band][voxel], in meta.conditions × meta.bands order */
  values: Float32Array;
}

export function computeSourceMaps(input: SourceMapsInput): SourceMapsOutput {
  const asset = getKernel(input.kernelId);
  const { manifest, voxels, W } = asset;
  const required = manifest.montage.channelNames;
  const nCh = required.length;
  const nVox = manifest.voxelCount;
  const fs = manifest.designSampleRate;

  // Kernel order, exact names. Labels are already canonical 10-10 (T7/T8/P7/P8), as is the
  // kernel montage; nothing is substituted, reordered by guess, or synthesized.
  const index = required.map((name) => input.labels.indexOf(name));
  const missing = required.filter((_, i) => index[i] < 0);
  if (missing.length) {
    throw new SloretaUnavailableError(
      `Source localization needs all ${nCh} 10-20 channels after QC; missing ${missing.join(', ')}.`
    );
  }

  const conditions = (['eo', 'ec'] as Condition[]).filter((c) => (input.epochs[c]?.length ?? 0) > 0);
  if (!conditions.length) throw new SloretaUnavailableError('No kept epochs to localize.');

  const bands = BAND_NAMES.map((name) => ({ name, f_lo: BANDS[name][0], f_hi: BANDS[name][1] }));
  const outLen = Math.round(SLORETA_EPOCH_SEC * fs);
  const values = new Float32Array(conditions.length * bands.length * nVox);
  const stats: SloretaResults['stats'] = {};
  const epochsUsed: SloretaResults['epochs_used'] = {};

  conditions.forEach((cond, ci) => {
    const sums = bands.map(() => new Float64Array(nCh * nCh));
    let used = 0;
    for (const epoch of input.epochs[cond]!) {
      const data = new Float64Array(nCh * outLen);
      let finite = true;
      for (let c = 0; c < nCh && finite; c++) {
        const src = epoch[index[c]];
        const x = input.sampleRate === fs && src.length === outLen ? src : resampleEpoch(src, input.sampleRate, fs, outLen);
        for (let t = 0; t < outLen; t++) {
          const v = x[t];
          if (!Number.isFinite(v)) {
            finite = false;
            break;
          }
          data[c * outLen + t] = v;
        }
      }
      if (!finite) continue;
      const referenced = applyAverageReference(data, nCh, outLen);
      bands.forEach((b, bi) => {
        const M = crossSpectrumBand(referenced, nCh, outLen, fs, { name: b.name, fLo: b.f_lo, fHi: b.f_hi }, WELCH);
        const s = sums[bi];
        for (let k = 0; k < s.length; k++) s[k] += M[k];
      });
      used++;
    }
    if (!used) return;
    epochsUsed[cond] = used;
    stats[cond] = {};
    bands.forEach((b, bi) => {
      const M = sums[bi].map((v) => v / used);
      const map = quadraticForm(W, nCh, nVox, M);
      values.set(map, (ci * bands.length + bi) * nVox);
      stats[cond]![b.name] = summarize(map, voxels);
    });
  });

  const kept = conditions.filter((c) => epochsUsed[c]);
  if (!kept.length) throw new SloretaUnavailableError('Every kept epoch had non-finite samples.');
  // Drop a condition whose epochs were all non-finite so the layout stays dense.
  const dense =
    kept.length === conditions.length
      ? values
      : Float32Array.from(
          kept.flatMap((c) => {
            const ci = conditions.indexOf(c);
            return Array.from(values.subarray(ci * bands.length * nVox, (ci + 1) * bands.length * nVox));
          })
        );

  return {
    values: dense,
    meta: {
      kernel_id: manifest.kernelId,
      head_model_id: manifest.headModelId,
      atlas_version: manifest.atlasVersion,
      voxel_count: nVox,
      design_sample_rate: fs,
      ...(input.sampleRate !== fs ? { resampled_from_hz: input.sampleRate } : {}),
      epoch_sec: SLORETA_EPOCH_SEC,
      bands,
      conditions: kept,
      epochs_used: epochsUsed,
      channels_interpolated: input.interpolated.filter((l) => required.includes(l)),
      effective_rank: manifest.effectiveRankAtBuild - input.interpolated.filter((l) => required.includes(l)).length,
      stats,
    },
  };
}

/** Max, mean and the strongest voxel the kernel supports well (low-sensitivity voxels are mostly prior). */
function summarize(map: Float32Array, voxels: VoxelMetadata) {
  let max = 0;
  let sum = 0;
  let peak = -1;
  for (let i = 0; i < map.length; i++) {
    const v = map[i];
    sum += v;
    if (v > max) max = v;
    if (!voxels.lowSensitivity[i] && (peak < 0 || v > map[peak])) peak = i;
  }
  const p: SloretaPeak | null =
    peak < 0
      ? null
      : {
          voxel: peak,
          // + 0 turns the grid's -0 into 0 for display
          mni: voxels.coordsMni[peak].map((v) => v + 0) as [number, number, number],
          value: map[peak],
          region: voxels.labels[peak],
        };
  return { max, mean: map.length ? sum / map.length : 0, peak: p };
}
