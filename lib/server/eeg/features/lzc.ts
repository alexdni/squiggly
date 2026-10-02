import type { Lzc } from '@/lib/analysis-results';
import { median } from '../dsp';
import { epochLength, type EpochSet } from './types';

/**
 * LZ76 phrase count of a signal binarised at its median (x > median -> 1), exactly as
 * FeatureExtractor._lempel_ziv_complexity: the window s[ind .. ind+inc) is extended while it
 * occurs in s[0 .. ind+inc-1); otherwise a phrase ends. A trailing partial phrase counts as one.
 */
export function lempelZivComplexity(x: ArrayLike<number>, bits?: Uint8Array): number {
  const n = x.length;
  const m = median(x);
  const s = bits && bits.length >= n ? bits : new Uint8Array(n);
  for (let i = 0; i < n; i++) s[i] = x[i] > m ? 1 : 0;

  let complexity = 0;
  let ind = 0;
  let inc = 1;
  // p: earliest start in [0, ind) where s[p .. p+inc-1) matches s[ind .. ind+inc-1). If a window
  // of length inc occurs at p, its prefix of length inc-1 does too, so p never moves backwards
  // while a phrase grows.
  let p = 0;
  while (ind + inc <= n) {
    let found = false;
    while (p < ind) {
      // s[p .. p+inc-2] already matches; check the newest symbol, else rescan from the next start
      if (s[p + inc - 1] === s[ind + inc - 1] && matches(s, p, ind, inc - 1)) {
        found = true;
        break;
      }
      p++;
    }
    if (found) {
      inc += 1;
    } else {
      complexity += 1;
      ind += inc;
      inc = 1;
      p = 0;
    }
  }
  if (ind < n) complexity += 1;
  return complexity;
}

function matches(s: Uint8Array, p: number, ind: number, len: number): boolean {
  for (let q = 0; q < len; q++) if (s[p + q] !== s[ind + q]) return false;
  return true;
}

/**
 * Mean LZ76 complexity across epochs per channel, plus that mean divided by log2(n_times).
 * Note the Python normalisation is not the usual c·log2(n)/n, so normalized_lzc is about 4 for
 * 500-sample epochs rather than in [0, 1]; it is kept for compatibility with stored results.
 */
export function computeLzc(set: EpochSet): Lzc {
  const nTimes = epochLength(set);
  const nEp = set.epochs.length;
  const bits = new Uint8Array(nTimes);
  const maxComplexity = nTimes > 1 ? Math.log2(nTimes) : 1.0;
  const out: Lzc = {};
  set.channels.forEach((ch, c) => {
    let sum = 0;
    for (let e = 0; e < nEp; e++) sum += lempelZivComplexity(set.epochs[e][c], bits);
    const meanLzc = sum / nEp;
    out[ch] = { lzc: meanLzc, normalized_lzc: maxComplexity > 0 ? meanLzc / maxComplexity : 0.0 };
  });
  return out;
}
