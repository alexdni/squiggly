// Client side of the sLORETA time lapse: the frames of one band as the frames API sends them
// (a maximum per frame, -1 for a rejected window, and one byte per voxel relative to it), plus
// the display maths: decoding, smoothing, traces and the fixed colour scale.
//
// Smoothing is display-only, as in the webapp: the peak readout, the traces and the rejected
// markers keep reading true, unblended frames, because a blended value corresponds to no
// measured window.

export interface BandFrames {
  nVox: number;
  /** frame maximum, -1 for a rejected window, NaN while not loaded yet */
  scales: Float32Array;
  /** frame-major bytes, value ≈ byte / 255 × scale */
  bytes: Uint8Array;
  /** frames received so far, from 0 */
  loaded: number;
}

export function emptyBandFrames(nFrames: number, nVox: number): BandFrames {
  return { nVox, scales: new Float32Array(nFrames).fill(NaN), bytes: new Uint8Array(nFrames * nVox), loaded: 0 };
}

/** Copy one API chunk (count maxima, then count × nVox bytes) into the store at `start`. */
export function addChunk(frames: BandFrames, start: number, chunk: ArrayBuffer): number {
  const nVox = frames.nVox;
  const count = chunk.byteLength / (4 + nVox);
  if (!Number.isInteger(count)) throw new Error('frame chunk has an unexpected size');
  frames.scales.set(new Float32Array(chunk, 0, count), start);
  frames.bytes.set(new Uint8Array(chunk, 4 * count, count * nVox), start * nVox);
  frames.loaded = Math.max(frames.loaded, start + count);
  return count;
}

export const isUsable = (frames: BandFrames, i: number) => i >= 0 && i < frames.loaded && frames.scales[i] >= 0;
export const isRejected = (frames: BandFrames, i: number) => i < frames.loaded && frames.scales[i] < 0;

/** Frame i as values, or null when it is rejected or not loaded. */
export function decodeFrame(frames: BandFrames, i: number, out = new Float32Array(frames.nVox)): Float32Array | null {
  if (!isUsable(frames, i)) return null;
  const k = frames.scales[i] / 255;
  const off = i * frames.nVox;
  for (let v = 0; v < frames.nVox; v++) out[v] = frames.bytes[off + v] * k;
  return out;
}

/**
 * Mean of up to `n` frames ending at `end`. Rejected frames are skipped rather than counted as
 * zero (averaging a refused window in would drag the map toward a confident wrong one). Null
 * when nothing in the span is usable.
 */
export function meanFrames(frames: BandFrames, end: number, n: number): Float32Array | null {
  const out = new Float32Array(frames.nVox);
  let used = 0;
  for (let i = Math.max(0, end - n + 1); i <= end; i++) {
    if (!isUsable(frames, i)) continue;
    const k = frames.scales[i] / 255;
    const off = i * frames.nVox;
    for (let v = 0; v < frames.nVox; v++) out[v] += frames.bytes[off + v] * k;
    used++;
  }
  if (!used) return null;
  for (let v = 0; v < out.length; v++) out[v] /= used;
  return out;
}

/**
 * Per frame, the mean over each mask (null = whole brain) and the largest value inside the union
 * of the masks, over the loaded frames. NaN for rejected or missing frames.
 */
export function frameSummaries(
  frames: BandFrames,
  masks: (Uint8Array | null)[],
  union: Uint8Array | null
): { means: Float32Array[]; maxima: Float32Array } {
  const n = frames.scales.length;
  const means = masks.map(() => new Float32Array(n).fill(NaN));
  const maxima = new Float32Array(n).fill(NaN);
  const counts = masks.map((m) => (m ? m.reduce((a, b) => a + b, 0) : frames.nVox));
  for (let i = 0; i < frames.loaded; i++) {
    if (!isUsable(frames, i)) continue;
    const k = frames.scales[i] / 255;
    const off = i * frames.nVox;
    const sums = masks.map(() => 0);
    let max = 0;
    for (let v = 0; v < frames.nVox; v++) {
      const b = frames.bytes[off + v];
      for (let m = 0; m < masks.length; m++) if (!masks[m] || masks[m]![v]) sums[m] += b;
      if ((!union || union[v]) && b > max) max = b;
    }
    masks.forEach((_, m) => (means[m][i] = counts[m] ? (sums[m] / counts[m]) * k : 0));
    maxima[i] = max * k;
  }
  return { means, maxima };
}

/** Move `current` toward `target` by one animation frame of exponential decay (see the hook). */
export function dampValues(
  current: Float32Array,
  target: Float32Array,
  dtMs: number,
  tauMs: number,
  out: Float32Array
): Float32Array {
  const alpha = tauMs > 0 ? 1 - Math.exp(-Math.max(0, dtMs) / tauMs) : 1;
  const shared = Math.min(out.length, current.length, target.length);
  for (let v = 0; v < shared; v++) out[v] = current[v] + (target[v] - current[v]) * alpha;
  return out;
}
