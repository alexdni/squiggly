import { describe, expect, it } from 'vitest';
import { addChunk, dampValues, decodeFrame, emptyBandFrames, frameSummaries, isRejected, meanFrames } from '../timelapse';

/** An API chunk: maxima, then one byte per voxel per frame. */
function chunk(frames: (number[] | null)[], nVox: number): ArrayBuffer {
  const out = new Uint8Array(4 * frames.length + frames.length * nVox);
  const scales = new Float32Array(out.buffer, 0, frames.length);
  frames.forEach((f, i) => {
    if (!f) {
      scales[i] = -1;
      return;
    }
    const max = Math.max(...f);
    scales[i] = max;
    f.forEach((v, k) => (out[4 * frames.length + i * nVox + k] = Math.round((v / max) * 255)));
  });
  return out.buffer;
}

describe('time-lapse frames', () => {
  const nVox = 3;
  const store = () => {
    const s = emptyBandFrames(4, nVox);
    addChunk(s, 0, chunk([[255, 0, 51], null], nVox));
    addChunk(s, 2, chunk([[0, 510, 0], [255, 255, 255]], nVox));
    return s;
  };

  it('decodes chunks written at their offsets', () => {
    const s = store();
    expect(s.loaded).toBe(4);
    expect(Array.from(decodeFrame(s, 0)!)).toEqual([255, 0, 51]);
    expect(Array.from(decodeFrame(s, 2)!)).toEqual([0, 510, 0]);
    expect(decodeFrame(s, 1)).toBeNull();
    expect(isRejected(s, 1)).toBe(true);
  });

  it('averages recent frames, skipping rejected ones instead of counting them as zero', () => {
    const s = store();
    expect(Array.from(meanFrames(s, 2, 3)!)).toEqual([127.5, 255, 25.5]);
    expect(meanFrames(s, 1, 1)).toBeNull();
  });

  it('does not read frames that have not arrived', () => {
    const s = emptyBandFrames(4, nVox);
    addChunk(s, 0, chunk([[1, 2, 3]], nVox));
    expect(decodeFrame(s, 1)).toBeNull();
    expect(Array.from(meanFrames(s, 3, 3) ?? [])).toEqual([]);
  });

  it('summarizes masked means and in-mask maxima per frame', () => {
    const s = store();
    const mask = Uint8Array.from([0, 1, 1]);
    const { means, maxima } = frameSummaries(s, [mask, null], mask);
    expect(means[0][0]).toBeCloseTo(25.5, 6);
    expect(means[1][0]).toBeCloseTo(102, 6);
    expect(Number.isNaN(means[0][1])).toBe(true);
    expect(maxima[0]).toBeCloseTo(51, 6);
    expect(maxima[2]).toBeCloseTo(510, 6);
  });

  it('damps toward the target independent of frame rate', () => {
    const out = new Float32Array(1);
    dampValues(Float32Array.of(0), Float32Array.of(1), 120, 120, out);
    expect(out[0]).toBeCloseTo(1 - Math.exp(-1), 6);
  });
});
