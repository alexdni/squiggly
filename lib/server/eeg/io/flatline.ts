// Flat-line detection for auxiliary leads (ECG): a disconnected or unused channel is a constant,
// or moves by only a few quantization steps. Unit-free, since "Annotations" channels that carry
// the ECG often have no physical dimension.

/** Below this many quantization steps between the 1st and 99th percentile, the lead is flat. */
const MIN_STEPS = 8;

export function isFlatline(x: ArrayLike<number>): boolean {
  const n = x.length;
  if (n < 2) return true;
  let moving = 0;
  let minStep = Infinity;
  for (let i = 1; i < n; i++) {
    const d = Math.abs(x[i] - x[i - 1]);
    if (!(d > 0) || !Number.isFinite(d)) continue;
    moving++;
    if (d < minStep) minStep = d;
  }
  // constant for 99% of the recording
  if (moving < 0.01 * (n - 1)) return true;

  const stride = Math.max(1, Math.floor(n / 100_000));
  const sample: number[] = [];
  for (let i = 0; i < n; i += stride) if (Number.isFinite(x[i])) sample.push(x[i]);
  const sorted = Float64Array.from(sample).sort();
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return at(0.99) - at(0.01) <= MIN_STEPS * minStep;
}
