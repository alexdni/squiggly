// Complex FFT of any length.
//
// Lengths whose prime factors are all <= MAX_DIRECT_RADIX use a recursive mixed-radix
// decimation-in-time transform (specialised radix-2/4 butterflies, generic butterfly for odd
// radices). Other lengths use Bluestein's chirp-z algorithm on a power-of-two transform. scipy
// transforms at the exact segment length (250, 500, 2500, ...), so arbitrary lengths are needed
// for parity; padding to a power of two would change the result.
//
// Sign convention matches numpy: X[k] = sum_t x[t] exp(-2πi k t / n); inverse is scaled by 1/n.

const MAX_DIRECT_RADIX = 31;

export interface FftPlan {
  readonly n: number;
  /** In-place forward transform. */
  forward(re: Float64Array, im: Float64Array): void;
  /** In-place inverse transform, scaled by 1/n. */
  inverse(re: Float64Array, im: Float64Array): void;
}

function factorize(n: number): number[] | null {
  const factors: number[] = [];
  let m = n;
  while (m % 4 === 0) {
    factors.push(4);
    m /= 4;
  }
  while (m % 2 === 0) {
    factors.push(2);
    m /= 2;
  }
  for (let p = 3; p * p <= m; p += 2) {
    while (m % p === 0) {
      if (p > MAX_DIRECT_RADIX) return null;
      factors.push(p);
      m /= p;
    }
  }
  if (m > 1) {
    if (m > MAX_DIRECT_RADIX) return null;
    factors.push(m);
  }
  return factors;
}

class MixedRadixPlan implements FftPlan {
  readonly n: number;
  private readonly factors: number[];
  private readonly twRe: Float64Array;
  private readonly twIm: Float64Array;
  private readonly outRe: Float64Array;
  private readonly outIm: Float64Array;
  private readonly scratchRe: Float64Array;
  private readonly scratchIm: Float64Array;

  constructor(n: number, factors: number[]) {
    this.n = n;
    this.factors = factors;
    this.twRe = new Float64Array(n);
    this.twIm = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const phase = (-2 * Math.PI * k) / n;
      this.twRe[k] = Math.cos(phase);
      this.twIm[k] = Math.sin(phase);
    }
    this.outRe = new Float64Array(n);
    this.outIm = new Float64Array(n);
    const maxP = Math.max(4, ...factors);
    this.scratchRe = new Float64Array(maxP);
    this.scratchIm = new Float64Array(maxP);
  }

  forward(re: Float64Array, im: Float64Array): void {
    if (this.n <= 1) return;
    this.work(re, im, 0, 0, 1, 0);
    re.set(this.outRe);
    im.set(this.outIm);
  }

  inverse(re: Float64Array, im: Float64Array): void {
    const n = this.n;
    for (let i = 0; i < n; i++) im[i] = -im[i];
    this.forward(re, im);
    const s = 1 / n;
    for (let i = 0; i < n; i++) {
      re[i] *= s;
      im[i] = -im[i] * s;
    }
  }

  // Output written to this.out at [outOff, outOff + p*m); input read from in[inOff + j*fstride].
  private work(
    inRe: Float64Array,
    inIm: Float64Array,
    outOff: number,
    inOff: number,
    fstride: number,
    stage: number
  ): void {
    const p = this.factors[stage];
    let m = 1;
    for (let s = stage + 1; s < this.factors.length; s++) m *= this.factors[s];
    const oRe = this.outRe;
    const oIm = this.outIm;
    if (m === 1) {
      for (let q = 0; q < p; q++) {
        oRe[outOff + q] = inRe[inOff + q * fstride];
        oIm[outOff + q] = inIm[inOff + q * fstride];
      }
    } else {
      for (let q = 0; q < p; q++) {
        this.work(inRe, inIm, outOff + q * m, inOff + q * fstride, fstride * p, stage + 1);
      }
    }
    if (p === 2) this.bfly2(outOff, fstride, m);
    else if (p === 4) this.bfly4(outOff, fstride, m);
    else this.bflyGeneric(outOff, fstride, m, p);
  }

  private bfly2(off: number, fstride: number, m: number): void {
    const oRe = this.outRe;
    const oIm = this.outIm;
    const twRe = this.twRe;
    const twIm = this.twIm;
    for (let k = 0; k < m; k++) {
      const a = off + k;
      const b = a + m;
      const wr = twRe[k * fstride];
      const wi = twIm[k * fstride];
      const tr = oRe[b] * wr - oIm[b] * wi;
      const ti = oRe[b] * wi + oIm[b] * wr;
      oRe[b] = oRe[a] - tr;
      oIm[b] = oIm[a] - ti;
      oRe[a] += tr;
      oIm[a] += ti;
    }
  }

  private bfly4(off: number, fstride: number, m: number): void {
    const oRe = this.outRe;
    const oIm = this.outIm;
    const twRe = this.twRe;
    const twIm = this.twIm;
    for (let k = 0; k < m; k++) {
      const i0 = off + k;
      const i1 = i0 + m;
      const i2 = i1 + m;
      const i3 = i2 + m;
      const t1 = k * fstride;
      const t2 = 2 * t1;
      const t3 = 3 * t1;
      const x1r = oRe[i1] * twRe[t1] - oIm[i1] * twIm[t1];
      const x1i = oRe[i1] * twIm[t1] + oIm[i1] * twRe[t1];
      const x2r = oRe[i2] * twRe[t2] - oIm[i2] * twIm[t2];
      const x2i = oRe[i2] * twIm[t2] + oIm[i2] * twRe[t2];
      const x3r = oRe[i3] * twRe[t3] - oIm[i3] * twIm[t3];
      const x3i = oRe[i3] * twIm[t3] + oIm[i3] * twRe[t3];
      const x0r = oRe[i0];
      const x0i = oIm[i0];
      const s0r = x0r + x2r;
      const s0i = x0i + x2i;
      const d0r = x0r - x2r;
      const d0i = x0i - x2i;
      const s1r = x1r + x3r;
      const s1i = x1i + x3i;
      const d1r = x1r - x3r;
      const d1i = x1i - x3i;
      oRe[i0] = s0r + s1r;
      oIm[i0] = s0i + s1i;
      oRe[i2] = s0r - s1r;
      oIm[i2] = s0i - s1i;
      // forward: multiply d1 by -i
      oRe[i1] = d0r + d1i;
      oIm[i1] = d0i - d1r;
      oRe[i3] = d0r - d1i;
      oIm[i3] = d0i + d1r;
    }
  }

  private bflyGeneric(off: number, fstride: number, m: number, p: number): void {
    const oRe = this.outRe;
    const oIm = this.outIm;
    const twRe = this.twRe;
    const twIm = this.twIm;
    const sRe = this.scratchRe;
    const sIm = this.scratchIm;
    const n = this.n;
    for (let u = 0; u < m; u++) {
      for (let q = 0; q < p; q++) {
        sRe[q] = oRe[off + u + q * m];
        sIm[q] = oIm[off + u + q * m];
      }
      for (let q1 = 0; q1 < p; q1++) {
        const k = u + q1 * m;
        let accR = sRe[0];
        let accI = sIm[0];
        let tw = 0;
        const step = fstride * k;
        for (let q = 1; q < p; q++) {
          tw += step;
          tw %= n;
          accR += sRe[q] * twRe[tw] - sIm[q] * twIm[tw];
          accI += sRe[q] * twIm[tw] + sIm[q] * twRe[tw];
        }
        oRe[off + k] = accR;
        oIm[off + k] = accI;
      }
    }
  }
}

class BluesteinPlan implements FftPlan {
  readonly n: number;
  private readonly m: number;
  private readonly inner: FftPlan;
  private readonly chirpRe: Float64Array;
  private readonly chirpIm: Float64Array;
  private readonly bRe: Float64Array;
  private readonly bIm: Float64Array;
  private readonly aRe: Float64Array;
  private readonly aIm: Float64Array;

  constructor(n: number) {
    this.n = n;
    let m = 1;
    while (m < 2 * n - 1) m *= 2;
    this.m = m;
    this.inner = getFftPlan(m);
    this.chirpRe = new Float64Array(n);
    this.chirpIm = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      // exp(-iπ k²/n); reduce k² mod 2n first to keep the phase accurate
      const phase = (-Math.PI * ((k * k) % (2 * n))) / n;
      this.chirpRe[k] = Math.cos(phase);
      this.chirpIm[k] = Math.sin(phase);
    }
    this.bRe = new Float64Array(m);
    this.bIm = new Float64Array(m);
    this.bRe[0] = this.chirpRe[0];
    this.bIm[0] = -this.chirpIm[0];
    for (let k = 1; k < n; k++) {
      this.bRe[k] = this.bRe[m - k] = this.chirpRe[k];
      this.bIm[k] = this.bIm[m - k] = -this.chirpIm[k];
    }
    this.inner.forward(this.bRe, this.bIm);
    this.aRe = new Float64Array(m);
    this.aIm = new Float64Array(m);
  }

  forward(re: Float64Array, im: Float64Array): void {
    const { n, m, chirpRe, chirpIm, aRe, aIm, bRe, bIm } = this;
    aRe.fill(0);
    aIm.fill(0);
    for (let k = 0; k < n; k++) {
      aRe[k] = re[k] * chirpRe[k] - im[k] * chirpIm[k];
      aIm[k] = re[k] * chirpIm[k] + im[k] * chirpRe[k];
    }
    this.inner.forward(aRe, aIm);
    for (let k = 0; k < m; k++) {
      const r = aRe[k] * bRe[k] - aIm[k] * bIm[k];
      aIm[k] = aRe[k] * bIm[k] + aIm[k] * bRe[k];
      aRe[k] = r;
    }
    this.inner.inverse(aRe, aIm);
    for (let k = 0; k < n; k++) {
      re[k] = aRe[k] * chirpRe[k] - aIm[k] * chirpIm[k];
      im[k] = aRe[k] * chirpIm[k] + aIm[k] * chirpRe[k];
    }
  }

  inverse(re: Float64Array, im: Float64Array): void {
    const n = this.n;
    for (let i = 0; i < n; i++) im[i] = -im[i];
    this.forward(re, im);
    const s = 1 / n;
    for (let i = 0; i < n; i++) {
      re[i] *= s;
      im[i] = -im[i] * s;
    }
  }
}

const planCache = new Map<number, FftPlan>();

/** Cached plan for length n. Plans own scratch buffers, so do not share one across threads. */
export function getFftPlan(n: number): FftPlan {
  if (!Number.isInteger(n) || n < 1) throw new Error(`FFT length must be a positive integer, got ${n}`);
  let plan = planCache.get(n);
  if (!plan) {
    const factors = n === 1 ? [1] : factorize(n);
    plan = factors ? new MixedRadixPlan(n, factors) : new BluesteinPlan(n);
    planCache.set(n, plan);
  }
  return plan;
}

/** Out-of-place complex FFT. */
export function fft(re: ArrayLike<number>, im?: ArrayLike<number>): { re: Float64Array; im: Float64Array } {
  const n = re.length;
  const r = Float64Array.from(re);
  const i = im ? Float64Array.from(im) : new Float64Array(n);
  getFftPlan(n).forward(r, i);
  return { re: r, im: i };
}

/** Out-of-place inverse complex FFT (scaled by 1/n). */
export function ifft(re: ArrayLike<number>, im: ArrayLike<number>): { re: Float64Array; im: Float64Array } {
  const r = Float64Array.from(re);
  const i = Float64Array.from(im);
  getFftPlan(r.length).inverse(r, i);
  return { re: r, im: i };
}

/**
 * Real-input FFT, returning the n/2+1 non-negative-frequency bins (numpy.fft.rfft).
 * `x` is read from `offset` for n samples. Output buffers must have length >= floor(n/2)+1.
 */
export class RealFft {
  readonly n: number;
  private readonly half: FftPlan | null;
  private readonly full: FftPlan | null;
  private readonly bufRe: Float64Array;
  private readonly bufIm: Float64Array;
  private readonly wRe: Float64Array;
  private readonly wIm: Float64Array;

  constructor(n: number) {
    this.n = n;
    if (n % 2 === 0 && n >= 2) {
      const h = n / 2;
      this.half = getFftPlan(h);
      this.full = null;
      this.bufRe = new Float64Array(h);
      this.bufIm = new Float64Array(h);
      this.wRe = new Float64Array(h + 1);
      this.wIm = new Float64Array(h + 1);
      for (let k = 0; k <= h; k++) {
        const phase = (-2 * Math.PI * k) / n;
        this.wRe[k] = Math.cos(phase);
        this.wIm[k] = Math.sin(phase);
      }
    } else {
      this.half = null;
      this.full = getFftPlan(n);
      this.bufRe = new Float64Array(n);
      this.bufIm = new Float64Array(n);
      this.wRe = this.wIm = new Float64Array(0);
    }
  }

  get bins(): number {
    return Math.floor(this.n / 2) + 1;
  }

  transform(x: ArrayLike<number>, outRe: Float64Array, outIm: Float64Array, offset = 0): void {
    const n = this.n;
    const zr = this.bufRe;
    const zi = this.bufIm;
    if (this.full) {
      for (let t = 0; t < n; t++) {
        zr[t] = x[offset + t];
        zi[t] = 0;
      }
      this.full.forward(zr, zi);
      const nb = this.bins;
      for (let k = 0; k < nb; k++) {
        outRe[k] = zr[k];
        outIm[k] = zi[k];
      }
      return;
    }
    const h = n / 2;
    for (let t = 0; t < h; t++) {
      zr[t] = x[offset + 2 * t];
      zi[t] = x[offset + 2 * t + 1];
    }
    this.half!.forward(zr, zi);
    const wRe = this.wRe;
    const wIm = this.wIm;
    for (let k = 0; k <= h; k++) {
      const a = k % h;
      const b = (h - k) % h;
      // E = (Z[k] + conj(Z[h-k]))/2, O = (Z[k] - conj(Z[h-k]))/(2i)
      const er = 0.5 * (zr[a] + zr[b]);
      const ei = 0.5 * (zi[a] - zi[b]);
      const or = 0.5 * (zi[a] + zi[b]);
      const oi = -0.5 * (zr[a] - zr[b]);
      outRe[k] = er + wRe[k] * or - wIm[k] * oi;
      outIm[k] = ei + wRe[k] * oi + wIm[k] * or;
    }
  }
}

const realCache = new Map<number, RealFft>();

export function getRealFft(n: number): RealFft {
  let r = realCache.get(n);
  if (!r) {
    r = new RealFft(n);
    realCache.set(n, r);
  }
  return r;
}

/** numpy.fft.rfft equivalent (out-of-place). */
export function rfft(x: ArrayLike<number>): { re: Float64Array; im: Float64Array } {
  const r = getRealFft(x.length);
  const re = new Float64Array(r.bins);
  const im = new Float64Array(r.bins);
  r.transform(x, re, im);
  return { re, im };
}

/** scipy.fft.rfftfreq / numpy.fft.rfftfreq with the same floating-point evaluation order. */
export function rfftfreq(n: number, d: number): Float64Array {
  const val = 1.0 / (n * d);
  const out = new Float64Array(Math.floor(n / 2) + 1);
  for (let k = 0; k < out.length; k++) out[k] = k * val;
  return out;
}
