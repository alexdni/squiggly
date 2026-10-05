// scipy.signal.get_window equivalents. `periodic` (default true) matches get_window's
// fftbins=True, i.e. the symmetric window of length M+1 with the last sample dropped.

export type WindowSpec = 'hann' | { tukey: number };

/** numpy.linspace(start, stop, num) evaluated the same way numpy does. */
function linspace(start: number, stop: number, num: number): Float64Array {
  const out = new Float64Array(num);
  const div = num - 1;
  const step = (stop - start) / div;
  for (let i = 0; i < num; i++) out[i] = i * step + start;
  if (num > 1) out[num - 1] = stop;
  return out;
}

export function hann(M: number, periodic = true): Float64Array {
  if (M <= 1) return new Float64Array(M).fill(1);
  const len = periodic ? M + 1 : M;
  // scipy general_cosine(len, [0.5, 0.5]): fac = linspace(-π, π, len); w = 0.5 + 0.5*cos(fac)
  const fac = linspace(-Math.PI, Math.PI, len);
  const w = new Float64Array(M);
  for (let i = 0; i < M; i++) w[i] = 0.5 + 0.5 * Math.cos(fac[i]);
  return w;
}

export function tukey(M: number, alpha = 0.5, periodic = true): Float64Array {
  if (M <= 1) return new Float64Array(M).fill(1);
  if (alpha <= 0) return new Float64Array(M).fill(1);
  if (alpha >= 1) return hann(M, periodic);
  const len = periodic ? M + 1 : M;
  const width = Math.floor((alpha * (len - 1)) / 2.0);
  const w = new Float64Array(len);
  for (let n = 0; n < len; n++) {
    if (n < width + 1) {
      w[n] = 0.5 * (1 + Math.cos(Math.PI * (-1 + (2.0 * n) / alpha / (len - 1))));
    } else if (n < len - width - 1) {
      w[n] = 1;
    } else {
      w[n] = 0.5 * (1 + Math.cos(Math.PI * (-2.0 / alpha + 1 + (2.0 * n) / alpha / (len - 1))));
    }
  }
  return periodic ? w.subarray(0, M).slice() : w;
}

export function getWindow(spec: WindowSpec, M: number): Float64Array {
  return spec === 'hann' ? hann(M) : tukey(M, spec.tukey);
}
