// Analytic signal via FFT (scipy.signal.hilbert): X = fft(x); X[1..n/2) *= 2; X[n/2+1..] = 0
// (the Nyquist bin, for even n, and DC are kept as-is); x_a = ifft(X).

import { getFftPlan, getRealFft, type FftPlan, type RealFft } from './fft';

/** Reusable analytic-signal transform for a fixed length; holds scratch buffers. */
export class Hilbert {
  readonly n: number;
  private readonly rf: RealFft;
  private readonly plan: FftPlan;
  private readonly binRe: Float64Array;
  private readonly binIm: Float64Array;

  constructor(n: number) {
    this.n = n;
    this.rf = getRealFft(n);
    this.plan = getFftPlan(n);
    this.binRe = new Float64Array(this.rf.bins);
    this.binIm = new Float64Array(this.rf.bins);
  }

  /** Analytic signal of x[offset .. offset+n) into outRe/outIm (length n). */
  transform(x: ArrayLike<number>, outRe: Float64Array, outIm: Float64Array, offset = 0): void {
    const n = this.n;
    const { binRe, binIm } = this;
    this.rf.transform(x, binRe, binIm, offset);
    const nb = this.rf.bins;
    // bins strictly between DC and Nyquist (or the last bin for odd n) are doubled
    const doubledEnd = n % 2 === 0 ? n / 2 : nb;
    outRe[0] = binRe[0];
    outIm[0] = binIm[0];
    for (let k = 1; k < nb; k++) {
      const g = k < doubledEnd ? 2 : 1;
      outRe[k] = binRe[k] * g;
      outIm[k] = binIm[k] * g;
    }
    for (let k = nb; k < n; k++) {
      outRe[k] = 0;
      outIm[k] = 0;
    }
    this.plan.inverse(outRe, outIm);
  }
}

/** One-shot scipy.signal.hilbert. */
export function hilbert(x: ArrayLike<number>): { re: Float64Array; im: Float64Array } {
  const n = x.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  new Hilbert(n).transform(x, re, im);
  return { re, im };
}
