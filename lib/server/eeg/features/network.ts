import type { NetworkMetrics } from '@/lib/analysis-results';
import { median } from '../dsp';
import { CHANNEL_GROUPS, INTERHEMISPHERIC_PAIRS } from './types';

// Graph metrics on a wPLI matrix, ported from FeatureExtractor._compute_network_metrics and its
// helpers. All of them are deterministic: small-worldness uses the analytic random-graph
// approximations C_rand ≈ p and L_rand ≈ ln(n)/ln(<k>), not sampled random graphs.

/** Floyd-Warshall on distances 1/(w + 1e-10) with a zero diagonal (in-place update order as Python). */
function shortestPaths(w: number[][]): Float64Array[] {
  const n = w.length;
  const dist = w.map((row, i) => Float64Array.from(row, (v, j) => (i === j ? 0 : 1.0 / (v + 1e-10))));
  for (let k = 0; k < n; k++) {
    const dk = dist[k];
    for (let i = 0; i < n; i++) {
      const di = dist[i];
      const dik = di[k];
      for (let j = 0; j < n; j++) {
        if (dik + dk[j] < di[j]) di[j] = dik + dk[j];
      }
    }
  }
  return dist;
}

export function globalEfficiency(w: number[][]): number {
  const n = w.length;
  if (n < 2) return 0;
  const dist = shortestPaths(w);
  let s = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const inv = 1.0 / dist[i][j];
      if (Number.isFinite(inv)) s += inv;
    }
  }
  return s / (n * (n - 1));
}

/** Weighted clustering coefficient (Onnela) on weights normalised by the maximum. */
export function clusteringCoefficients(w: number[][]): Float64Array {
  const n = w.length;
  const out = new Float64Array(n);
  let max = -Infinity;
  for (const row of w) for (const v of row) if (v > max) max = v;
  if (!(max > 0)) return out;
  const W = w.map((row) => row.map((v) => v / max));
  const W3 = W.map((row) => row.map((v) => Math.pow(v, 1 / 3)));
  for (let i = 0; i < n; i++) {
    const nb: number[] = [];
    for (let j = 0; j < n; j++) if (j !== i && W[i][j] > 0) nb.push(j);
    const k = nb.length;
    if (k < 2) continue;
    let tri = 0;
    for (const j of nb) {
      for (const h of nb) {
        if (j < h) tri += W3[i][j] * W3[j][h] * W3[h][i];
      }
    }
    out[i] = (2 * tri) / (k * (k - 1));
  }
  return out;
}

function meanOf(v: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i];
  return s / v.length;
}

export function characteristicPathLength(w: number[][]): number {
  const n = w.length;
  const dist = shortestPaths(w);
  let s = 0;
  let c = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j && Number.isFinite(dist[i][j])) {
        s += dist[i][j];
        c++;
      }
    }
  }
  return c > 0 ? s / c : Infinity;
}

export function smallWorldness(w: number[][], adj: number[][]): number {
  const n = w.length;
  const cObs = meanOf(clusteringCoefficients(w));
  const lObs = characteristicPathLength(w);
  const k = adj.map((row) => row.reduce((a, b) => a + b, 0));
  const kSum = k.reduce((a, b) => a + b, 0);
  const p = kSum / (n * (n - 1));
  const cRand = Math.max(p, 1e-10);
  const kMean = meanOf(k);
  const lRand = kMean > 1 ? Math.log(n) / Math.log(kMean) : Infinity;
  if (cRand > 0 && lRand > 0 && lObs > 0) {
    const gamma = cObs / cRand;
    const lambda = lObs / lRand;
    return lambda > 0 ? gamma / lambda : 0;
  }
  return 0;
}

export function interhemisphericConnectivity(w: number[][], ch: string[]): number {
  const vals: number[] = [];
  for (const [l, r] of INTERHEMISPHERIC_PAIRS) {
    const li = ch.indexOf(l);
    const ri = ch.indexOf(r);
    if (li >= 0 && ri >= 0) vals.push(w[li][ri]);
  }
  return vals.length ? meanOf(vals) : 0.0;
}

export function regionalConnectivity(w: number[][], ch: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  const idxOf = (names: readonly string[]) => names.filter((c) => ch.includes(c)).map((c) => ch.indexOf(c));
  for (const [region, names] of Object.entries(CHANNEL_GROUPS)) {
    if (region === 'left' || region === 'right') continue;
    const idx = idxOf(names);
    if (idx.length >= 2) {
      const vals: number[] = [];
      for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) vals.push(w[idx[a]][idx[b]]);
      out[`${region}_within`] = meanOf(vals);
    }
  }
  const frontal = idxOf(CHANNEL_GROUPS.frontal);
  const posterior = idxOf([...CHANNEL_GROUPS.parietal, ...CHANNEL_GROUPS.occipital]);
  if (frontal.length && posterior.length) {
    const vals: number[] = [];
    for (const i of frontal) for (const j of posterior) vals.push(w[i][j]);
    out.frontal_posterior = meanOf(vals);
  }
  return out;
}

export function computeNetworkMetrics(w: number[][], ch: string[]): NetworkMetrics {
  const n = w.length;
  const upper: number[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) upper.push(w[i][j]);
  const threshold = median(upper);
  const adj = w.map((row) => row.map((v) => (v > threshold ? 1 : 0)));

  const clustering = clusteringCoefficients(w);
  const clustering_by_channel: Record<string, number> = {};
  const node_strength: Record<string, number> = {};
  ch.forEach((name, i) => {
    clustering_by_channel[name] = clustering[i];
    node_strength[name] = w[i].reduce((a, b) => a + b, 0) / (n - 1);
  });

  return {
    global_efficiency: globalEfficiency(w),
    mean_clustering_coefficient: meanOf(clustering),
    clustering_by_channel,
    small_worldness: smallWorldness(w, adj),
    interhemispheric_connectivity: interhemisphericConnectivity(w, ch),
    node_strength,
    regional_connectivity: regionalConnectivity(w, ch),
  };
}
