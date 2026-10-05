// Butterworth design and zero-phase filtering with scipy.signal semantics:
//   butter(N, Wn, btype)  -> (b, a) via buttap -> lp2{lp,hp,bp}_zpk -> bilinear_zpk -> zpk2tf
//   lfilter               -> direct form II transposed, same operation order as scipy's C loop
//   lfilterZi             -> steady-state initial conditions (lfilter_zi)
//   filtfilt              -> padtype='odd', padlen=3*max(len(a), len(b)), method='pad'
// Wn is normalised to Nyquist (0 < Wn < 1) like scipy's default fs=None. Design steps follow
// scipy's operation order (Smith complex division, sequential polynomial expansion) so the
// coefficients agree to a few ULP; that matters for narrow low-frequency bandpasses, where the
// transfer-function form is ill-conditioned.

export type BType = 'lowpass' | 'highpass' | 'bandpass';

export interface BA {
  b: Float64Array;
  a: Float64Array;
}

// --- minimal complex arithmetic (numpy semantics) ---
type C = [number, number];

function cmul(x: C, y: C): C {
  return [x[0] * y[0] - x[1] * y[1], x[0] * y[1] + x[1] * y[0]];
}

/** numpy complex division (Smith's algorithm). */
function cdiv(x: C, y: C): C {
  const [ar, ai] = x;
  const [br, bi] = y;
  if (Math.abs(br) >= Math.abs(bi)) {
    if (br === 0 && bi === 0) return [ar / Math.abs(br), ai / Math.abs(bi)];
    const rat = bi / br;
    const scl = 1.0 / (br + bi * rat);
    return [(ar + ai * rat) * scl, (ai - ar * rat) * scl];
  }
  const rat = br / bi;
  const scl = 1.0 / (bi + br * rat);
  return [(ar * rat + ai) * scl, (ai * rat - ar) * scl];
}

/** Principal complex square root (C99 csqrt). */
function csqrt(z: C): C {
  const [a, b] = z;
  if (a === 0 && b === 0) return [0, b];
  const t = Math.sqrt((Math.abs(a) + Math.hypot(a, b)) * 0.5);
  if (a >= 0) return [t, b / (2 * t)];
  return [Math.abs(b) / (2 * t), b < 0 || Object.is(b, -0) ? -t : t];
}

function csquare(z: C): C {
  return [z[0] * z[0] - z[1] * z[1], z[0] * z[1] + z[1] * z[0]];
}

/** numpy.poly: expand prod (x - r_i) by sequential convolution; returns real part. */
function poly(roots: C[]): Float64Array {
  let a: C[] = [[1, 0]];
  for (const r of roots) {
    const neg: C = [-r[0], -r[1]];
    const next: C[] = new Array(a.length + 1);
    for (let i = 0; i <= a.length; i++) {
      const left: C = i < a.length ? a[i] : [0, 0];
      const right: C = i > 0 ? cmul(a[i - 1], neg) : [0, 0];
      next[i] = [left[0] + right[0], left[1] + right[1]];
    }
    a = next;
  }
  return Float64Array.from(a, (c) => c[0]);
}

/**
 * Digital Butterworth filter in transfer-function form (scipy.signal.butter, output='ba').
 * `wn` is a fraction of Nyquist: a number for low/highpass, [low, high] for bandpass.
 */
export function butter(order: number, wn: number | [number, number], btype: BType = 'lowpass'): BA {
  const N = order;
  const wns = typeof wn === 'number' ? [wn] : wn;
  for (const w of wns) if (!(w > 0 && w < 1)) throw new Error('Digital filter critical frequencies must be 0 < Wn < 1');
  if (btype === 'bandpass' && (wns.length !== 2 || !(wns[0] < wns[1]))) {
    throw new Error('bandpass requires Wn = [low, high] with low < high');
  }

  // buttap: z = [], p = -exp(1j*pi*m/(2N)), m = -N+1, -N+3, ..., N-1, k = 1
  let p: C[] = [];
  for (let m = -N + 1; m < N; m += 2) {
    const theta = (Math.PI * m) / (2 * N);
    p.push([-Math.cos(theta), -Math.sin(theta)]);
  }
  let z: C[] = [];
  let k = 1;

  const fs = 2.0;
  const warped = wns.map((w) => 2 * fs * Math.tan((Math.PI * w) / fs));

  if (btype === 'lowpass') {
    const wo = warped[0];
    const degree = p.length - z.length;
    z = z.map((r) => [r[0] * wo, r[1] * wo]);
    p = p.map((r) => [r[0] * wo, r[1] * wo]);
    k = k * Math.pow(wo, degree);
  } else if (btype === 'highpass') {
    const wo = warped[0];
    const degree = p.length - z.length;
    const prodZ = z.reduce<C>((acc, r) => cmul(acc, [-r[0], -r[1]]), [1, 0]);
    const prodP = p.reduce<C>((acc, r) => cmul(acc, [-r[0], -r[1]]), [1, 0]);
    k = k * cdiv(prodZ, prodP)[0];
    z = z.map((r) => cdiv([wo, 0], r));
    p = p.map((r) => cdiv([wo, 0], r));
    for (let i = 0; i < degree; i++) z.push([0, 0]);
  } else {
    const bw = warped[1] - warped[0];
    const wo = Math.sqrt(warped[0] * warped[1]);
    const degree = p.length - z.length;
    const wo2 = wo ** 2;
    const transform = (roots: C[]): C[] => {
      const lp = roots.map<C>((r) => [(r[0] * bw) / 2, (r[1] * bw) / 2]);
      const roots2 = lp.map((r) => {
        const sq = csquare(r);
        return csqrt([sq[0] - wo2, sq[1]]);
      });
      return [
        ...lp.map<C>((r, i) => [r[0] + roots2[i][0], r[1] + roots2[i][1]]),
        ...lp.map<C>((r, i) => [r[0] - roots2[i][0], r[1] - roots2[i][1]]),
      ];
    };
    z = transform(z);
    p = transform(p);
    for (let i = 0; i < degree; i++) z.push([0, 0]);
    k = k * bw ** degree;
  }

  // bilinear_zpk with fs = 2
  const fs2 = 2.0 * fs;
  const degree = p.length - z.length;
  const zz = z.map((r) => cdiv([fs2 + r[0], r[1]], [fs2 - r[0], -r[1]]));
  const pz = p.map((r) => cdiv([fs2 + r[0], r[1]], [fs2 - r[0], -r[1]]));
  for (let i = 0; i < degree; i++) zz.push([-1, 0]);
  const numProd = z.reduce<C>((acc, r) => cmul(acc, [fs2 - r[0], -r[1]]), [1, 0]);
  const denProd = p.reduce<C>((acc, r) => cmul(acc, [fs2 - r[0], -r[1]]), [1, 0]);
  const kz = k * cdiv(numProd, denProd)[0];

  const b = poly(zz);
  for (let i = 0; i < b.length; i++) b[i] *= kz;
  const a = poly(pz);
  return { b, a };
}

function normalize(b: ArrayLike<number>, a: ArrayLike<number>): BA {
  let aa = Array.from(a);
  while (aa.length > 1 && aa[0] === 0) aa = aa.slice(1);
  const a0 = aa[0];
  const n = Math.max(aa.length, b.length);
  const bn = new Float64Array(n);
  const an = new Float64Array(n);
  for (let i = 0; i < b.length; i++) bn[i] = b[i] / a0;
  for (let i = 0; i < aa.length; i++) an[i] = aa[i] / a0;
  return { b: bn, a: an };
}

/**
 * Steady-state initial conditions for a unit step (scipy.signal.lfilter_zi).
 *
 * scipy solves (I - companion(a).T) zi = b[1:] - a[1:]*b[0] with LAPACK. For narrow
 * low-frequency bandpasses (poles close to z = 1) that system is nearly singular, so zi is not
 * well determined in double precision: scipy's answer and ours both satisfy the steady-state
 * equations to ~1e-15 but differ by up to ~50% (1-4 Hz band at 500 Hz). We use the closed form:
 * with y = H(1) = sum(b)/sum(a), the transposed direct form gives z[m-1] = b[m] - a[m]*y and
 * z[i] = z[i+1] + b[i+1] - a[i+1]*y. The difference only affects the filtfilt edge transient
 * (max relative output difference ~5e-5 for 1-4 Hz at 250 Hz).
 */
export function lfilterZi(b: ArrayLike<number>, a: ArrayLike<number>): Float64Array {
  const { b: bn, a: an } = normalize(b, a);
  const m = bn.length - 1;
  const zi = new Float64Array(m);
  if (m === 0) return zi;
  let sb = 0;
  let sa = 0;
  for (let i = 0; i <= m; i++) {
    sb += bn[i];
    sa += an[i];
  }
  const y = sb / sa;
  zi[m - 1] = bn[m] - an[m] * y;
  for (let i = m - 2; i >= 0; i--) zi[i] = zi[i + 1] + bn[i + 1] - an[i + 1] * y;
  return zi;
}

/**
 * Direct-form II transposed IIR filter (scipy.signal.lfilter with zi), in place over
 * buf[0..len). `z` is the state (length n-1) and is updated to the final state.
 * b and a must already be normalised so a[0] == 1 and have equal length.
 */
function lfilterInPlace(b: Float64Array, a: Float64Array, buf: Float64Array, len: number, z: Float64Array): void {
  const n = b.length;
  if (n === 1) {
    const b0 = b[0];
    for (let t = 0; t < len; t++) buf[t] *= b0;
    return;
  }
  const last = n - 2;
  for (let t = 0; t < len; t++) {
    const xn = buf[t];
    const yn = z[0] + b[0] * xn;
    for (let i = 0; i < last; i++) z[i] = z[i + 1] + xn * b[i + 1] - yn * a[i + 1];
    z[last] = xn * b[last + 1] - yn * a[last + 1];
    buf[t] = yn;
  }
}

/** One-shot lfilter (zero or given initial state). */
export function lfilter(
  b: ArrayLike<number>,
  a: ArrayLike<number>,
  x: ArrayLike<number>,
  zi?: ArrayLike<number>
): { y: Float64Array; zf: Float64Array } {
  const { b: bn, a: an } = normalize(b, a);
  const z = new Float64Array(bn.length - 1);
  if (zi) z.set(zi);
  const y = Float64Array.from(x);
  lfilterInPlace(bn, an, y, y.length, z);
  return { y, zf: z };
}

/**
 * Reusable zero-phase filter (scipy.signal.filtfilt with default odd padding).
 * Holds scratch buffers, so one instance must not be used concurrently.
 */
export class FiltFilt {
  readonly b: Float64Array;
  readonly a: Float64Array;
  readonly padlen: number;
  private readonly zi: Float64Array;
  private readonly z: Float64Array;
  private ext = new Float64Array(0);

  constructor(b: ArrayLike<number>, a: ArrayLike<number>) {
    const ntaps = Math.max(a.length, b.length);
    const { b: bn, a: an } = normalize(b, a);
    this.b = bn;
    this.a = an;
    this.padlen = 3 * ntaps;
    this.zi = lfilterZi(b, a);
    this.z = new Float64Array(this.zi.length);
  }

  /** Filter x[offset .. offset+len) into out[outOffset .. outOffset+len). */
  apply(
    x: ArrayLike<number>,
    out: Float64Array,
    offset = 0,
    len = x.length - offset,
    outOffset = 0
  ): void {
    const edge = this.padlen;
    if (len <= edge) {
      throw new Error(`The length of the input vector x must be greater than padlen, which is ${edge}.`);
    }
    const total = len + 2 * edge;
    if (this.ext.length < total) this.ext = new Float64Array(total);
    const ext = this.ext;
    const x0 = x[offset];
    const xl = x[offset + len - 1];
    // odd extension: left = 2*x[0] - x[edge:0:-1], right = 2*x[-1] - x[-2:-(edge+2):-1]
    for (let i = 0; i < edge; i++) ext[i] = 2 * x0 - x[offset + edge - i];
    for (let i = 0; i < len; i++) ext[edge + i] = x[offset + i];
    for (let i = 0; i < edge; i++) ext[edge + len + i] = 2 * xl - x[offset + len - 2 - i];

    const z = this.z;
    const zi = this.zi;
    const e0 = ext[0];
    for (let i = 0; i < z.length; i++) z[i] = zi[i] * e0;
    lfilterInPlace(this.b, this.a, ext, total, z);

    // backward pass on the reversed signal
    for (let i = 0, j = total - 1; i < j; i++, j--) {
      const t = ext[i];
      ext[i] = ext[j];
      ext[j] = t;
    }
    const y0 = ext[0];
    for (let i = 0; i < z.length; i++) z[i] = zi[i] * y0;
    lfilterInPlace(this.b, this.a, ext, total, z);

    // reverse back and drop the padding
    for (let i = 0; i < len; i++) out[outOffset + i] = ext[total - 1 - edge - i];
  }
}

/** One-shot scipy.signal.filtfilt(b, a, x). */
export function filtfilt(b: ArrayLike<number>, a: ArrayLike<number>, x: ArrayLike<number>): Float64Array {
  const out = new Float64Array(x.length);
  new FiltFilt(b, a).apply(x, out);
  return out;
}
