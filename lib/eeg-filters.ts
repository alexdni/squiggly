// EEG signal filtering functions
// Extracted from csv-reader-browser.ts for shared use across the application

import { filterEeg } from './dsp/zeroPhase';

/**
 * Butterworth filter coefficient calculator
 * Compute biquad (second-order section) coefficients for Butterworth filter
 */
export function butterworthCoeffs(
  filterType: 'lowpass' | 'highpass',
  cutoffHz: number,
  sampleRate: number
): { b: number[], a: number[] } {
  const w0 = Math.tan(Math.PI * cutoffHz / sampleRate);
  const w0sq = w0 * w0;
  const sqrt2 = Math.SQRT2;

  let b0: number, b1: number, b2: number;
  let a0: number, a1: number, a2: number;

  if (filterType === 'lowpass') {
    a0 = 1 + sqrt2 * w0 + w0sq;
    a1 = 2 * (w0sq - 1);
    a2 = 1 - sqrt2 * w0 + w0sq;
    b0 = w0sq;
    b1 = 2 * w0sq;
    b2 = w0sq;
  } else {
    // highpass
    a0 = 1 + sqrt2 * w0 + w0sq;
    a1 = 2 * (w0sq - 1);
    a2 = 1 - sqrt2 * w0 + w0sq;
    b0 = 1;
    b1 = -2;
    b2 = 1;
  }

  // Normalize
  return {
    b: [b0 / a0, b1 / a0, b2 / a0],
    a: [1, a1 / a0, a2 / a0]
  };
}

/**
 * Apply a biquad (second-order IIR) filter to a signal
 * Uses direct form II transposed for numerical stability
 */
export function applyBiquad(signal: number[], b: number[], a: number[]): number[] {
  if (signal.length < 3) return signal;

  const output: number[] = new Array(signal.length);
  let z1 = 0, z2 = 0;

  for (let i = 0; i < signal.length; i++) {
    const x = signal[i];
    const y = b[0] * x + z1;
    z1 = b[1] * x - a[1] * y + z2;
    z2 = b[2] * x - a[2] * y;
    output[i] = y;
  }

  return output;
}

/**
 * Apply forward-backward filtering (zero-phase) to avoid phase distortion
 * This is equivalent to scipy's filtfilt
 * Includes edge padding to minimize startup transients
 */
export function filtfilt(signal: number[], b: number[], a: number[]): number[] {
  const n = signal.length;
  if (n < 10) return signal;

  // Pad length - use 3x the filter order (second order = 6 samples min)
  // But for better results, use a larger pad based on signal length
  const padLen = Math.min(Math.floor(n / 4), 250); // Up to 1 second at 250Hz

  // Create padded signal with reflected edges (like scipy's filtfilt)
  const padded: number[] = new Array(n + 2 * padLen);

  // Reflect the beginning
  for (let i = 0; i < padLen; i++) {
    padded[i] = 2 * signal[0] - signal[padLen - i];
  }
  // Copy original signal
  for (let i = 0; i < n; i++) {
    padded[padLen + i] = signal[i];
  }
  // Reflect the end
  for (let i = 0; i < padLen; i++) {
    padded[padLen + n + i] = 2 * signal[n - 1] - signal[n - 2 - i];
  }

  // Forward pass
  let filtered = applyBiquad(padded, b, a);
  // Reverse
  filtered = filtered.reverse();
  // Backward pass
  filtered = applyBiquad(filtered, b, a);
  // Reverse again
  filtered = filtered.reverse();

  // Remove padding and return original length
  return filtered.slice(padLen, padLen + n);
}

/**
 * Notch filter coefficients for power line noise removal
 */
export function notchCoeffs(notchFreq: number, sampleRate: number, Q: number = 30): { b: number[], a: number[] } {
  const w0 = (2 * Math.PI * notchFreq) / sampleRate;
  const alpha = Math.sin(w0) / (2 * Q);

  const b0 = 1;
  const b1 = -2 * Math.cos(w0);
  const b2 = 1;
  const a0 = 1 + alpha;
  const a1 = -2 * Math.cos(w0);
  const a2 = 1 - alpha;

  return {
    b: [b0 / a0, b1 / a0, b2 / a0],
    a: [1, a1 / a0, a2 / a0]
  };
}

/**
 * Fixed display prefilter: 1 Hz high-pass, 45 Hz low-pass, 60 Hz notch, using the same
 * zero-phase design as the server-side cleaning pipeline (see lib/dsp/zeroPhase.ts).
 */
export function prefilterEEG(signal: number[], sampleRate: number): number[] {
  if (signal.length < 10) return signal;
  return Array.from(filterEeg(signal, sampleRate, { highpassHz: 1, lowpassHz: 45, notchHz: 60 }));
}

/**
 * Configurable display filters for the EEG viewer. Same design as the server-side cleaning
 * pipeline's temporal filter: 4th-order Butterworth high/low-pass as second-order sections,
 * notches at the mains frequency and its harmonics (Q 30), median DC removal, zero phase.
 * A value of 0 disables that stage.
 */
export function applyEEGFilters(
  signal: number[],
  sampleRate: number,
  config: {
    highpassHz: number;
    lowpassHz: number;
    notchHz: number;
  }
): number[] {
  if (signal.length < 10) return signal;
  return Array.from(
    filterEeg(signal, sampleRate, {
      highpassHz: config.highpassHz,
      lowpassHz: config.lowpassHz,
      notchHz: config.notchHz,
    })
  );
}

/**
 * Seconds of signal to include on each side of the visible window before filtering, so the
 * high-pass has settled by the time the visible part starts (about 3 time constants).
 */
export function filterPaddingSeconds(highpassHz: number): number {
  if (!(highpassHz > 0)) return 1;
  return Math.min(10, Math.max(1, 3 / highpassHz));
}
