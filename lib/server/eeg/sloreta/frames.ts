// sLORETA time-lapse frames from stored per-window cross-spectra.
//
// The analysis job stores, for every 2 s window of the cleaned recording, the real part of the
// band cross-spectrum (19×19, symmetric, so 190 upper-triangle values) instead of voxel maps: a
// whole band of voxel frames is ~36 MB for 10 minutes, the cross-spectra for all bands ~5 MB.
// Frames are made from them on request, server-side, because that needs the kernel.
//
// power_i = trace(W_i M W_iᵀ) = Σ_ab (W_iᵀ W_i)_ab M_ab, so with each voxel's 19×19 Gram matrix
// precomputed a frame costs ~190 MACs per voxel instead of core's 3·(19² + 19). Same numbers as
// core's quadraticForm (tested against it), about 6× faster.

/** Number of upper-triangle entries (diagonal included) of an n×n matrix. */
export const triSize = (n: number) => (n * (n + 1)) / 2;

/** Upper triangle (row-major, diagonal included) of a symmetric n×n matrix. */
export function packUpper(M: Float64Array, n: number, out: Float32Array, offset: number): void {
  let k = offset;
  for (let a = 0; a < n; a++) for (let b = a; b < n; b++) out[k++] = M[a * n + b];
}

/**
 * Per-voxel Gram matrices G_i = W_iᵀ W_i, upper triangle with off-diagonal terms doubled, so that
 * power_i = Σ_{a≤b} G_i[ab] · M[ab]. W is row-major (3·nVox) × nCh, three orientation rows per
 * voxel.
 */
export function voxelGram(W: Float32Array, nCh: number, nVox: number): Float32Array {
  const t = triSize(nCh);
  const G = new Float32Array(nVox * t);
  for (let i = 0; i < nVox; i++) {
    let k = i * t;
    for (let a = 0; a < nCh; a++) {
      for (let b = a; b < nCh; b++) {
        let s = 0;
        for (let o = 0; o < 3; o++) {
          const row = (3 * i + o) * nCh;
          s += W[row + a] * W[row + b];
        }
        G[k++] = a === b ? s : 2 * s;
      }
    }
  }
  return G;
}

/** One voxel map from one packed cross-spectrum. Negative round-off is clamped to 0, as core does. */
export function frameFromSpectrum(G: Float32Array, nVox: number, spectrum: Float32Array, offset: number, out: Float32Array): void {
  const t = G.length / nVox;
  for (let i = 0; i < nVox; i++) {
    let s = 0;
    const g = i * t;
    for (let k = 0; k < t; k++) s += G[g + k] * spectrum[offset + k];
    out[i] = s > 0 ? s : 0;
  }
}

/**
 * Frames [start, start + count) of one band, encoded for transfer: a Float32 scale per frame
 * (the frame's maximum, or -1 for a rejected window) followed by one byte per voxel per frame,
 * value ≈ byte / 255 · scale. Eight bits per voxel is plenty for a colour ramp and keeps a
 * chunk of 200 frames at ~3 MB, under the 4.5 MB function response limit.
 *
 * `spectra` is laid out [window][band][triSize(nCh)]; rejected windows are listed in `rejected`.
 */
export function encodeFrames(params: {
  G: Float32Array;
  nVox: number;
  spectra: Float32Array;
  nBands: number;
  band: number;
  rejected: Set<number>;
  start: number;
  count: number;
}): Uint8Array {
  const { G, nVox, spectra, nBands, band, rejected, start, count } = params;
  const t = G.length / nVox;
  const out = new Uint8Array(4 * count + count * nVox);
  const scales = new Float32Array(out.buffer, 0, count);
  const frame = new Float32Array(nVox);
  for (let f = 0; f < count; f++) {
    const w = start + f;
    if (rejected.has(w)) {
      scales[f] = -1;
      continue;
    }
    frameFromSpectrum(G, nVox, spectra, (w * nBands + band) * t, frame);
    let max = 0;
    for (let i = 0; i < nVox; i++) if (frame[i] > max) max = frame[i];
    scales[f] = max;
    const bytes = out.subarray(4 * count + f * nVox, 4 * count + (f + 1) * nVox);
    if (max > 0) for (let i = 0; i < nVox; i++) bytes[i] = Math.round((frame[i] / max) * 255);
  }
  return out;
}
