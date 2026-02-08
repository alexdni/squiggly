// EEG signal filtering functions
// Extracted from csv-reader-browser.ts for shared use across the application

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
 * Apply the full prefiltered EEG processing pipeline
 * Matches the DivergenceWebapp/biofeedback-core processing:
 * 1. Highpass at 1 Hz (removes DC and slow drift)
 * 2. Lowpass at 45 Hz (removes high-frequency noise, muscle artifact)
 * 3. Notch at 60 Hz (removes power line interference)
 */
export function prefilterEEG(signal: number[], sampleRate: number): number[] {
  if (signal.length < 10) return signal;

  // 1. Highpass filter at 1 Hz to remove DC offset and slow drift
  const hpCoeffs = butterworthCoeffs('highpass', 1, sampleRate);
  let filtered = filtfilt(signal, hpCoeffs.b, hpCoeffs.a);

  // 2. Lowpass filter at 45 Hz to remove high-frequency noise
  const lpCoeffs = butterworthCoeffs('lowpass', 45, sampleRate);
  filtered = filtfilt(filtered, lpCoeffs.b, lpCoeffs.a);

  // 3. Notch filter at 60 Hz to remove power line noise
  const notch = notchCoeffs(60, sampleRate, 30);
  filtered = filtfilt(filtered, notch.b, notch.a);

  return filtered;
}

/**
 * Apply configurable EEG filters to a signal
 * Allows specifying custom highpass, lowpass, and notch frequencies
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

  let filtered = signal;

  // 1. Highpass filter (if > 0)
  if (config.highpassHz > 0) {
    const hpCoeffs = butterworthCoeffs('highpass', config.highpassHz, sampleRate);
    filtered = filtfilt(filtered, hpCoeffs.b, hpCoeffs.a);
  }

  // 2. Lowpass filter (if > 0 and below Nyquist)
  if (config.lowpassHz > 0 && config.lowpassHz < sampleRate / 2) {
    const lpCoeffs = butterworthCoeffs('lowpass', config.lowpassHz, sampleRate);
    filtered = filtfilt(filtered, lpCoeffs.b, lpCoeffs.a);
  }

  // 3. Notch filter (if > 0)
  if (config.notchHz > 0) {
    const notch = notchCoeffs(config.notchHz, sampleRate, 30);
    filtered = filtfilt(filtered, notch.b, notch.a);
  }

  return filtered;
}
