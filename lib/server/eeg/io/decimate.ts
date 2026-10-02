// Integer-factor decimation with a zero-phase FIR anti-alias filter, equivalent in design to
// scipy.signal.decimate(x, q, ftype='fir', zero_phase=True): a Hamming-windowed sinc with
// 20·q + 1 taps and cutoff 1/q of Nyquist. Used to bring high-rate recordings (e.g. 2048 Hz BDF)
// down to ~250 Hz before artifact cleaning, which is quadratic in samples for ICA.

export const TARGET_RATE_HZ = 250;

/** Largest integer factor that keeps the output rate at or above TARGET_RATE_HZ. */
export function decimationFactor(sampleRate: number): number {
  return Math.max(1, Math.floor(sampleRate / TARGET_RATE_HZ));
}

export function firLowpass(numTaps: number, cutoff: number): Float64Array {
  // cutoff is relative to Nyquist (scipy firwin convention), scaled to unity DC gain
  const h = new Float64Array(numTaps);
  const m = (numTaps - 1) / 2;
  let sum = 0;
  for (let i = 0; i < numTaps; i++) {
    const t = i - m;
    const sinc = t === 0 ? cutoff : Math.sin(Math.PI * cutoff * t) / (Math.PI * t);
    const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (numTaps - 1));
    h[i] = sinc * w;
    sum += h[i];
  }
  for (let i = 0; i < numTaps; i++) h[i] /= sum;
  return h;
}

/**
 * Filter with a linear-phase FIR centred on each output sample (no group delay) and keep every
 * q-th sample. Edges use reflected padding so the first/last samples are not attenuated.
 */
export function decimate(x: Float64Array, q: number, taps?: Float64Array): Float64Array {
  if (q <= 1) return x;
  const h = taps ?? firLowpass(20 * q + 1, 1 / q);
  const m = (h.length - 1) / 2;
  const n = x.length;
  const out = new Float64Array(Math.ceil(n / q));
  const at = (i: number) => {
    if (i < 0) i = -i;
    if (i >= n) i = 2 * (n - 1) - i;
    return x[Math.min(Math.max(i, 0), n - 1)];
  };
  for (let o = 0, c = 0; c < n; o++, c += q) {
    let acc = 0;
    const lo = c - m;
    if (lo >= 0 && c + m < n) {
      for (let k = 0; k < h.length; k++) acc += h[k] * x[lo + k];
    } else {
      for (let k = 0; k < h.length; k++) acc += h[k] * at(lo + k);
    }
    out[o] = acc;
  }
  return out;
}
