// numpy reductions used by the feature code.

/** numpy.trapz(y, x). */
export function trapz(y: ArrayLike<number>, x: ArrayLike<number>): number {
  let s = 0;
  for (let i = 1; i < y.length; i++) s += ((x[i] - x[i - 1]) * (y[i] + y[i - 1])) / 2.0;
  return s;
}

/** Arithmetic mean; NaN for an empty input (like numpy.mean). */
export function mean(v: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i];
  return s / v.length;
}

/** numpy.median: mean of the two middle values for even lengths. */
export function median(v: ArrayLike<number>): number {
  const n = v.length;
  if (n === 0) return NaN;
  const s = Float64Array.from(v).sort();
  const h = n >> 1;
  return n % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}
