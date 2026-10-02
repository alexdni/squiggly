/**
 * Minimal FFT for the TheraQ amplitude spectrum: iterative radix-2 for
 * power-of-two lengths, Bluestein (chirp-z) for any other length, so epochs of
 * e.g. 2 s at 250 Hz (500 samples) are handled exactly like numpy's rfft.
 */

class Radix2 {
  readonly n: number;
  private readonly rev: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;

  constructor(n: number) {
    this.n = n;
    const bits = Math.round(Math.log2(n));
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) {
      const theta = (-2 * Math.PI * k) / n;
      this.cos[k] = Math.cos(theta);
      this.sin[k] = Math.sin(theta);
    }
  }

  /** In-place forward transform of (re, im). */
  transform(re: Float64Array, im: Float64Array): void {
    const { n, rev, cos, sin } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * step];
          const wi = sin[k * step];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}

const isPow2 = (n: number) => n > 0 && (n & (n - 1)) === 0;

/** Real-input FFT magnitudes |X_k| for k = 0..floor(n/2), reusable for a fixed n. */
export class RfftMagnitude {
  readonly n: number;
  private readonly radix: Radix2;
  // Bluestein state (null for power-of-two n)
  private readonly chirpRe: Float64Array | null = null;
  private readonly chirpIm: Float64Array | null = null;
  private readonly kernelRe: Float64Array | null = null;
  private readonly kernelIm: Float64Array | null = null;
  private readonly bufRe: Float64Array;
  private readonly bufIm: Float64Array;

  constructor(n: number) {
    if (!Number.isInteger(n) || n < 1) throw new Error(`Invalid FFT length ${n}`);
    this.n = n;
    if (isPow2(n)) {
      this.radix = new Radix2(n);
      this.bufRe = new Float64Array(n);
      this.bufIm = new Float64Array(n);
      return;
    }
    let m = 1;
    while (m < 2 * n - 1) m *= 2;
    this.radix = new Radix2(m);
    this.bufRe = new Float64Array(m);
    this.bufIm = new Float64Array(m);
    // w_k = exp(-i*pi*k^2/n); k^2 is reduced mod 2n to keep the angle accurate.
    this.chirpRe = new Float64Array(n);
    this.chirpIm = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const theta = (-Math.PI * ((k * k) % (2 * n))) / n;
      this.chirpRe[k] = Math.cos(theta);
      this.chirpIm[k] = Math.sin(theta);
    }
    const kr = new Float64Array(m);
    const ki = new Float64Array(m);
    kr[0] = this.chirpRe[0];
    ki[0] = -this.chirpIm[0];
    for (let k = 1; k < n; k++) {
      kr[k] = kr[m - k] = this.chirpRe[k];
      ki[k] = ki[m - k] = -this.chirpIm[k];
    }
    this.radix.transform(kr, ki);
    this.kernelRe = kr;
    this.kernelIm = ki;
  }

  /** Writes |X_k| (k = 0..floor(n/2)) of the real signal x into out. */
  magnitudes(x: ArrayLike<number>, out: Float64Array = new Float64Array((this.n >> 1) + 1)): Float64Array {
    const { n, bufRe: re, bufIm: im } = this;
    if (x.length !== n) throw new Error(`FFT input length ${x.length} != ${n}`);
    const nOut = (n >> 1) + 1;

    if (!this.chirpRe) {
      for (let i = 0; i < n; i++) { re[i] = x[i]; im[i] = 0; }
      this.radix.transform(re, im);
      for (let k = 0; k < nOut; k++) out[k] = Math.hypot(re[k], im[k]);
      return out;
    }

    const cr = this.chirpRe!, ci = this.chirpIm!, kr = this.kernelRe!, ki = this.kernelIm!;
    const m = re.length;
    for (let i = 0; i < n; i++) { re[i] = x[i] * cr[i]; im[i] = x[i] * ci[i]; }
    re.fill(0, n); im.fill(0, n);
    this.radix.transform(re, im);
    // Pointwise multiply by the kernel spectrum, then inverse via conjugation.
    for (let i = 0; i < m; i++) {
      const r = re[i] * kr[i] - im[i] * ki[i];
      const s = re[i] * ki[i] + im[i] * kr[i];
      re[i] = r;
      im[i] = -s;
    }
    this.radix.transform(re, im);
    for (let k = 0; k < nOut; k++) {
      const yr = re[k] / m;
      const yi = -im[k] / m;
      out[k] = Math.hypot(yr * cr[k] - yi * ci[k], yr * ci[k] + yi * cr[k]);
    }
    return out;
  }
}
