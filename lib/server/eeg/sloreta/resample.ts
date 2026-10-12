// Band-limited resampling of one short epoch to an exact output length. The sLORETA kernel is
// built for exactly 250 Hz and core refuses any other rate, while integer decimation leaves 256,
// 512 and 2048 Hz recordings at 256 Hz. Each kept epoch is resampled on its own, so no sample from
// a rejected stretch can leak into it through the filter support.

/** Taps on each side of the interpolation point, at the input rate. */
const HALF_WIDTH = 16;

const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

/** Blackman window over [-1, 1]. */
const blackman = (u: number) => 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u);

/**
 * Windowed-sinc interpolation of `x` (sampled at `fromHz`) onto `outLength` samples at `toHz`.
 * When downsampling, the kernel is widened to low-pass at 0.95 × the output Nyquist. Edges are
 * reflected so the first and last samples are not pulled toward zero.
 */
export function resampleEpoch(x: Float64Array, fromHz: number, toHz: number, outLength: number): Float64Array {
  if (fromHz === toHz && outLength === x.length) return x;
  const n = x.length;
  const ratio = fromHz / toHz; // input samples per output sample
  const cutoff = Math.min(1, 1 / ratio) * 0.95; // relative to the input Nyquist
  const half = Math.ceil(HALF_WIDTH / cutoff);
  const at = (i: number) => {
    if (n === 1) return x[0];
    const period = 2 * (n - 1);
    let k = ((i % period) + period) % period;
    if (k >= n) k = period - k;
    return x[k];
  };
  const out = new Float64Array(outLength);
  for (let j = 0; j < outLength; j++) {
    const t = j * ratio;
    const centre = Math.floor(t);
    let acc = 0;
    let norm = 0;
    for (let i = centre - half + 1; i <= centre + half; i++) {
      const d = t - i;
      const w = cutoff * sinc(cutoff * d) * blackman(d / half);
      acc += w * at(i);
      norm += w;
    }
    out[j] = norm !== 0 ? acc / norm : 0;
  }
  return out;
}
