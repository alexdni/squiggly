// Synthetic 19-channel recording shared by the pipeline tests.
import { writeEdf } from '../export/writers';

export const LABELS = ['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8', 'T7', 'C3', 'Cz', 'C4', 'T8', 'P7', 'P3', 'Pz', 'P4', 'P8', 'O1', 'O2'];
export const FS = 250;

/** Deterministic PRNG so the synthetic recording (and the test) is reproducible. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * EO for the first half, EC for the second (posterior alpha grows), with blinks on the frontal
 * poles during EO and a large broadband burst on every channel at `burstAt` seconds.
 */
export function synthetic(seconds: number, opts: { burstAt?: number } = {}): Float64Array[] {
  const n = seconds * FS;
  const rand = rng(7);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  // Shared sources mixed into channels so ICA has structure to find. Alpha is narrowband noise
  // from two posterior generators (left/right), like real EEG; a single perfectly coherent sine
  // is not brain-like and ICA classifiers rightly treat it as an artifact.
  const resonator = (hz: number, r: number) => {
    const out = new Float64Array(n);
    const c = 2 * r * Math.cos((2 * Math.PI * hz) / FS);
    for (let i = 2; i < n; i++) out[i] = c * out[i - 1] - r * r * out[i - 2] + gauss();
    let ss = 0;
    for (let i = 0; i < n; i++) ss += out[i] * out[i];
    const rms = Math.sqrt(ss / n);
    for (let i = 0; i < n; i++) out[i] = (out[i] / rms) * (i / FS >= seconds / 2 ? 18 : 6);
    return out;
  };
  const alphaL = resonator(10, 0.985);
  const alphaR = resonator(10.3, 0.985);
  const theta = new Float64Array(n);
  const blink = new Float64Array(n);
  let pink = 0;
  for (let i = 0; i < n; i++) theta[i] = 6 * Math.sin((2 * Math.PI * 6 * i) / FS);
  for (let b = 3; b < seconds / 2 - 1; b += 4) {
    const c = Math.round(b * FS);
    for (let k = -40; k <= 40; k++) blink[c + k] += 150 * Math.exp(-(k * k) / (2 * 12 * 12));
  }
  return LABELS.map((label, ch) => {
    const x = new Float64Array(n);
    const posterior = /^(O|P)/.test(label) ? 1 : 0.3;
    const side = /[13579]$/.test(label) ? 0.8 : /[2468]$/.test(label) ? 0.2 : 0.5; // left vs right
    const frontal = label.startsWith('Fp') ? 1 : label.startsWith('F') ? 0.3 : 0.02;
    for (let i = 0; i < n; i++) {
      pink = 0.98 * pink + gauss();
      const alpha = side * alphaL[i] + (1 - side) * alphaR[i];
      x[i] = posterior * alpha + 0.5 * theta[i] + frontal * blink[i] + 2 * pink + 3 * gauss();
    }
    if (opts.burstAt !== undefined) {
      const s = Math.round(opts.burstAt * FS);
      for (let i = s; i < s + FS; i++) x[i] += 400 * gauss();
    }
    return x;
  });
}

export function edfBytes(data: Float64Array[]): Uint8Array {
  return writeEdf({ labels: LABELS.map((l) => `EEG ${l}-LE`), data, sampleRate: FS }, { bdf: false });
}
