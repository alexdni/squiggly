/**
 * Numeric helpers that reproduce the exact float behaviour of the Python
 * TheraQ implementation (numpy summation order, Python's round()).
 */

/**
 * numpy's pairwise summation for a contiguous float64 array (what `np.sum` /
 * `np.mean` use for a 1-D reduction). Matching the order keeps results
 * bit-identical to the Python engine instead of merely close.
 */
export function pairwiseSum(a: ArrayLike<number>, start = 0, n = a.length - start): number {
  if (n < 8) {
    let res = 0;
    for (let i = 0; i < n; i++) res += a[start + i];
    return res;
  }
  if (n <= 128) {
    const r = [
      a[start], a[start + 1], a[start + 2], a[start + 3],
      a[start + 4], a[start + 5], a[start + 6], a[start + 7],
    ];
    let i = 8;
    for (; i < n - (n % 8); i += 8) {
      for (let j = 0; j < 8; j++) r[j] += a[start + i + j];
    }
    let res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
    for (; i < n; i++) res += a[start + i];
    return res;
  }
  let n2 = Math.floor(n / 2);
  n2 -= n2 % 8;
  return pairwiseSum(a, start, n2) + pairwiseSum(a, start + n2, n - n2);
}

/** `np.mean` of a 1-D array (NaN when empty). */
export function pairwiseMean(a: ArrayLike<number>): number {
  return a.length === 0 ? NaN : pairwiseSum(a) / a.length;
}

/**
 * Python 3 `round(x, ndigits)`: correctly rounded on the exact binary value,
 * ties to even. `Number.prototype.toFixed` is also exact but breaks ties away
 * from zero, so exact ties (e.g. 6.25 -> 6.2) are detected and fixed up.
 */
export function pyRound(x: number, ndigits: number): number {
  if (!Number.isFinite(x)) return x;
  const ax = Math.abs(x);
  if (ax >= 1e21) return x; // already integral at this magnitude
  let rounded = ax.toFixed(ndigits);
  // toFixed(100) is the exact decimal expansion for any |x| >= 2^-47; smaller
  // values cannot be ties at the precisions used here.
  const exact = ax.toFixed(100);
  const dot = exact.indexOf('.');
  const tail = exact.slice(dot + 1 + ndigits);
  if (/^50*$/.test(tail)) {
    const truncated = exact.slice(0, ndigits > 0 ? dot + 1 + ndigits : dot);
    const lastDigit = Number(truncated[truncated.length - 1]);
    if (lastDigit % 2 === 0) rounded = truncated;
  }
  const v = Number(rounded);
  return x < 0 || Object.is(x, -0) ? -v : v;
}

/** `np.median` of a 1-D array. */
export function median(values: ArrayLike<number>): number {
  const s = Array.from(values).sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  const mid = n >> 1;
  return n % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
