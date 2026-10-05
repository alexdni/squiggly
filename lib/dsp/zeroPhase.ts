// Zero-phase IIR filtering for EEG display, safe to run in the browser.
//
// Same filter design the server-side cleaning pipeline uses for its temporal filter stage:
// Butterworth high-pass and low-pass (default 4th order) as cascaded second-order sections, plus
// notches at the mains frequency and its harmonics (Q = 30), all applied forward and backward so
// there is no phase shift. Second-order sections stay numerically stable at a 0.5–1 Hz high-pass,
// where a single high-order transfer function does not. Written independently of the analysis
// engine (standard designs: bilinear transform with pre-warping, RBJ biquad forms).

/** One biquad: y = (b0 + b1 z^-1 + b2 z^-2) / (1 + a1 z^-1 + a2 z^-2) */
export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function normalized(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Biquad {
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/**
 * Butterworth low/high-pass of even `order` as order/2 biquads. Each section is the bilinear
 * transform (pre-warped at the cutoff) of one conjugate pole pair, whose quality factor is
 * Q_k = 1 / (2 sin((2k − 1)π / (2·order))).
 */
export function butterworthSections(
  type: 'lowpass' | 'highpass',
  cutoffHz: number,
  sampleRate: number,
  order = 4
): Biquad[] {
  if (order < 2 || order % 2 !== 0) throw new Error('Butterworth order must be even and >= 2');
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const sections: Biquad[] = [];
  for (let k = 1; k <= order / 2; k++) {
    const q = 1 / (2 * Math.sin(((2 * k - 1) * Math.PI) / (2 * order)));
    const alpha = sin / (2 * q);
    const a0 = 1 + alpha;
    const a1 = -2 * cos;
    const a2 = 1 - alpha;
    if (type === 'lowpass') {
      const b = (1 - cos) / 2;
      sections.push(normalized(b, 1 - cos, b, a0, a1, a2));
    } else {
      const b = (1 + cos) / 2;
      sections.push(normalized(b, -(1 + cos), b, a0, a1, a2));
    }
  }
  return sections;
}

/** Second-order notch at `freqHz` with quality factor `q` (bandwidth = freq / q). */
export function notchSection(freqHz: number, sampleRate: number, q = 30): Biquad {
  const w0 = (2 * Math.PI * freqHz) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const c = -2 * Math.cos(w0);
  return normalized(1, c, 1, 1 + alpha, c, 1 - alpha);
}

export interface EegFilterDesign {
  highpassHz?: number;
  lowpassHz?: number;
  /** mains frequency; 0 or undefined disables the notches */
  notchHz?: number;
  order?: number;
  notchQ?: number;
  /** also notch 2×, 3×, ... the mains frequency below Nyquist (default true) */
  notchHarmonics?: boolean;
}

/** The full section cascade for a filter design at `sampleRate`. Invalid stages are skipped. */
export function eegFilterSections(sampleRate: number, design: EegFilterDesign): Biquad[] {
  const nyquist = sampleRate / 2;
  const order = design.order ?? 4;
  const sections: Biquad[] = [];
  if (design.highpassHz && design.highpassHz > 0 && design.highpassHz < nyquist) {
    sections.push(...butterworthSections('highpass', design.highpassHz, sampleRate, order));
  }
  if (design.lowpassHz && design.lowpassHz > 0 && design.lowpassHz < nyquist * 0.98) {
    sections.push(...butterworthSections('lowpass', design.lowpassHz, sampleRate, order));
  }
  if (design.notchHz && design.notchHz > 0) {
    const q = design.notchQ ?? 30;
    const harmonics = design.notchHarmonics ?? true;
    for (let f = design.notchHz; f < nyquist * 0.98; f += design.notchHz) {
      // a notch above the low-pass cutoff only adds ringing to an already-attenuated band
      if (design.lowpassHz && design.lowpassHz > 0 && f > design.lowpassHz * 1.5) break;
      sections.push(notchSection(f, sampleRate, q));
      if (!harmonics) break;
    }
  }
  return sections;
}

/** Steady-state transposed-direct-form-II state for a constant input `x0` through the cascade. */
function steadyState(sections: Biquad[], x0: number): Float64Array {
  const state = new Float64Array(sections.length * 2);
  let x = x0;
  sections.forEach((s, i) => {
    const gain = (s.b0 + s.b1 + s.b2) / (1 + s.a1 + s.a2);
    const y = Number.isFinite(gain) ? gain * x : 0;
    const z2 = s.b2 * x - s.a2 * y;
    const z1 = s.b1 * x - s.a1 * y + z2;
    state[2 * i] = z1;
    state[2 * i + 1] = z2;
    x = y;
  });
  return state;
}

function runCascade(sections: Biquad[], x: Float64Array, state: Float64Array): void {
  for (let i = 0; i < sections.length; i++) {
    const { b0, b1, b2, a1, a2 } = sections[i];
    let z1 = state[2 * i];
    let z2 = state[2 * i + 1];
    for (let n = 0; n < x.length; n++) {
      const v = x[n];
      const y = b0 * v + z1;
      z1 = b1 * v - a1 * y + z2;
      z2 = b2 * v - a2 * y;
      x[n] = y;
    }
  }
}

/**
 * Forward-backward (zero-phase) filtering through the cascade, with odd-reflection padding and
 * steady-state initial conditions at both ends to suppress edge transients (as scipy's
 * sosfiltfilt does). The effective magnitude response is the square of the single-pass one.
 */
export function sosFiltFilt(sections: Biquad[], input: ArrayLike<number>, padLen?: number): Float64Array {
  const n = input.length;
  if (sections.length === 0 || n < 2) return Float64Array.from(input);
  const pad = Math.min(n - 1, padLen ?? 3 * (2 * sections.length + 1));
  const ext = new Float64Array(n + 2 * pad);
  const first = input[0];
  const last = input[n - 1];
  for (let i = 0; i < pad; i++) ext[i] = 2 * first - input[pad - i];
  for (let i = 0; i < n; i++) ext[pad + i] = input[i];
  for (let i = 0; i < pad; i++) ext[pad + n + i] = 2 * last - input[n - 2 - i];

  runCascade(sections, ext, steadyState(sections, ext[0]));
  ext.reverse();
  runCascade(sections, ext, steadyState(sections, ext[0]));
  ext.reverse();
  return ext.slice(pad, pad + n);
}

/** Median of a signal (robust DC estimate, as the pipeline removes before filtering). */
export function median(x: ArrayLike<number>): number {
  const s = Float64Array.from(x).sort();
  const m = s.length >> 1;
  return s.length === 0 ? 0 : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Remove the median, then apply the zero-phase filter cascade for `design`. */
export function filterEeg(input: ArrayLike<number>, sampleRate: number, design: EegFilterDesign): Float64Array {
  const dc = median(input);
  const centred = Float64Array.from(input, (v) => v - dc);
  return sosFiltFilt(eegFilterSections(sampleRate, design), centred, design.highpassHz ? Math.round((3 * sampleRate) / design.highpassHz) : undefined);
}

/** Magnitude response |H(f)| of a cascade (single pass). Used by tests and for display. */
export function magnitudeAt(sections: Biquad[], freqHz: number, sampleRate: number): number {
  const w = (2 * Math.PI * freqHz) / sampleRate;
  let mag = 1;
  for (const s of sections) {
    const nr = s.b0 + s.b1 * Math.cos(w) + s.b2 * Math.cos(2 * w);
    const ni = -(s.b1 * Math.sin(w) + s.b2 * Math.sin(2 * w));
    const dr = 1 + s.a1 * Math.cos(w) + s.a2 * Math.cos(2 * w);
    const di = -(s.a1 * Math.sin(w) + s.a2 * Math.sin(2 * w));
    mag *= Math.hypot(nr, ni) / Math.hypot(dr, di);
  }
  return mag;
}
