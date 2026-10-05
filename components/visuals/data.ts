// Pure data shaping for the visual components: pulls per-channel values out of the results JSON
// and computes the shared colour scales (per band across conditions, and across two analyses in
// the comparison view). Map scales are the min/max of the electrode values, as DivergenceWebapp's
// topomaps, pooled over every map that shares the scale.

import {
  BAND_NAMES,
  CONNECTIVITY_BAND_NAMES,
  type AlphaPeak,
  type BandName,
  type BandPower,
  type Condition,
  type Connectivity,
  type ConnectivityBandName,
  type Lzc,
  type SpectrogramData,
} from '@/lib/analysis-results';
import { electrodePosition, percentile, type Scale } from './topo';
import { topoPosition } from './topoRender';

export const CONDITIONS: Condition[] = ['eo', 'ec'];
export const CONDITION_LABELS: Record<Condition, string> = { eo: 'Eyes Open', ec: 'Eyes Closed' };

export const BAND_LABELS: Record<BandName, string> = {
  delta: 'Delta',
  theta: 'Theta',
  alpha1: 'Alpha 1',
  alpha2: 'Alpha 2',
  smr: 'SMR',
  beta2: 'Beta 2',
  hibeta: 'High Beta',
  lowgamma: 'Low Gamma',
};

export type PowerMode = 'absolute' | 'relative';

/** Channel → value for one band. Tolerates the legacy shape where the band value is a number. */
export function bandValues(
  bandPower: BandPower | null | undefined,
  band: BandName,
  mode: PowerMode
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!bandPower) return out;
  for (const [ch, bands] of Object.entries(bandPower)) {
    const v = (bands as Record<string, unknown> | undefined)?.[band];
    const n =
      typeof v === 'number' ? (mode === 'absolute' ? v : NaN) : (v as { absolute?: number; relative?: number })?.[mode];
    if (typeof n === 'number' && Number.isFinite(n)) out[ch] = n;
  }
  return out;
}

/** Only channels that can be placed on the map contribute to its scale. */
function placedValues(values: Record<string, number>): number[] {
  return Object.entries(values)
    .filter(([ch]) => topoPosition(ch))
    .map(([, v]) => v);
}

/** Min/max of the values (the topomap vMin/vMax); null without data. */
export function minMaxScale(values: number[]): Scale | null {
  let vmin = Infinity;
  let vmax = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < vmin) vmin = v;
    if (v > vmax) vmax = v;
  }
  return vmin <= vmax ? { vmin, vmax } : null;
}

/**
 * One min/max scale per band, pooled over every band-power set given (EO and EC of one analysis,
 * or of both analyses in a comparison) so maps of the same band are directly comparable.
 */
export function computeBandScales(
  bandPowers: Array<BandPower | null | undefined>,
  mode: PowerMode
): Partial<Record<BandName, Scale>> {
  const scales: Partial<Record<BandName, Scale>> = {};
  for (const band of BAND_NAMES) {
    const pooled = bandPowers.flatMap((bp) => placedValues(bandValues(bp, band, mode)));
    const s = minMaxScale(pooled);
    if (s) scales[band] = s;
  }
  return scales;
}

export function lzcValues(lzc: Lzc | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [ch, v] of Object.entries(lzc ?? {})) {
    if (Number.isFinite(v?.normalized_lzc)) out[ch] = v.normalized_lzc;
  }
  return out;
}

export function computeLzcScale(lzcs: Array<Lzc | null | undefined>): Scale | null {
  return minMaxScale(lzcs.flatMap((l) => placedValues(lzcValues(l))));
}

export function alphaPeakValues(peaks: AlphaPeak | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [ch, v] of Object.entries(peaks ?? {})) {
    if (Number.isFinite(v?.peak_frequency) && v.peak_frequency > 0) out[ch] = v.peak_frequency;
  }
  return out;
}

export const ALPHA_PEAK_SCALE: Scale = { vmin: 8, vmax: 12 };

// ── connectivity ───────────────────────────────────────────────────────────
export interface Edge {
  a: string;
  b: string;
  value: number;
}

/** Upper-triangle edges ≥ threshold whose endpoints both have head positions, weakest first. */
export function connectivityEdges(
  conn: { matrix: number[][]; channels: string[] } | null | undefined,
  threshold: number
): Edge[] {
  if (!conn?.matrix || !conn.channels) return [];
  const edges: Edge[] = [];
  const { matrix, channels } = conn;
  for (let i = 0; i < channels.length; i++) {
    if (!electrodePosition(channels[i])) continue;
    for (let j = i + 1; j < channels.length; j++) {
      const v = matrix[i]?.[j];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < threshold) continue;
      if (!electrodePosition(channels[j])) continue;
      edges.push({ a: channels[i], b: channels[j], value: v });
    }
  }
  return edges.sort((x, y) => x.value - y.value);
}

/**
 * Colour range for edges, as the Python grid: [max(threshold, min − 0.02), min(1, max + 0.05)],
 * pooled over every band/condition matrix given.
 */
export function connectivityScale(
  connectivities: Array<Connectivity | null | undefined>,
  threshold: number
): Scale {
  const vals: number[] = [];
  for (const c of connectivities) {
    for (const band of CONNECTIVITY_BAND_NAMES) {
      for (const e of connectivityEdges(c?.connectivity_matrices?.[band], threshold)) vals.push(e.value);
    }
  }
  if (vals.length === 0) return { vmin: threshold, vmax: 1 };
  const lo = Math.max(threshold, Math.min(...vals) - 0.02);
  const hi = Math.min(1, Math.max(...vals) + 0.05);
  return hi > lo ? { vmin: lo, vmax: hi } : { vmin: threshold, vmax: Math.max(threshold + 0.01, 1) };
}

export const NETWORK_METRICS = [
  { key: 'global_efficiency', label: 'Global Efficiency' },
  { key: 'mean_clustering_coefficient', label: 'Clustering Coefficient' },
  { key: 'small_worldness', label: 'Small-worldness' },
  { key: 'interhemispheric_connectivity', label: 'Interhemispheric' },
] as const;
export type NetworkMetricKey = (typeof NETWORK_METRICS)[number]['key'];

/** Metric value per connectivity band (null where missing) for one condition. */
export function networkMetricSeries(
  conn: Connectivity | null | undefined,
  metric: NetworkMetricKey
): Array<number | null> {
  return CONNECTIVITY_BAND_NAMES.map((band: ConnectivityBandName) => {
    const v = conn?.network_metrics?.[band]?.[metric];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  });
}

// ── spectrogram ────────────────────────────────────────────────────────────
/** 5th–95th percentile of the dB power, as the former Python spectrograms. */
export function spectrogramScale(data: SpectrogramData): Scale | null {
  const flat: number[] = [];
  for (const row of data.power_db ?? []) for (const v of row) flat.push(v);
  const vmin = percentile(flat, 5);
  const vmax = percentile(flat, 95);
  if (!Number.isFinite(vmin) || !Number.isFinite(vmax)) return null;
  return vmax > vmin ? { vmin, vmax } : { vmin: vmin - 1, vmax: vmax + 1 };
}

/**
 * RGBA pixels for a spectrogram: width = time bins, height = frequency bins, low frequency at the
 * bottom row. `power_db[t][f]`.
 */
export function spectrogramPixels(
  data: SpectrogramData,
  scale: Scale,
  colormap: (t: number) => [number, number, number]
): { width: number; height: number; pixels: Uint8ClampedArray } {
  const width = data.power_db.length;
  const height = data.freqs.length;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const range = scale.vmax - scale.vmin;
  for (let t = 0; t < width; t++) {
    const col = data.power_db[t] ?? [];
    for (let f = 0; f < height; f++) {
      const v = col[f];
      const o = ((height - 1 - f) * width + t) * 4;
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const [r, g, b] = colormap((v - scale.vmin) / range);
      pixels[o] = r;
      pixels[o + 1] = g;
      pixels[o + 2] = b;
      pixels[o + 3] = 255;
    }
  }
  return { width, height, pixels };
}

/** Preferred channels first (Fp1/Fz/Cz/Pz/O1), then any others alphabetically. */
export function orderChannels(available: string[], preferred: readonly string[]): string[] {
  const pref = preferred.filter((c) => available.includes(c));
  const rest = available.filter((c) => !preferred.includes(c)).sort();
  return [...pref, ...rest];
}
