// Mu rhythm bursts from the cleaned, average-referenced EEG: arch-shaped 8–13 Hz trains at C3/C4,
// found the way an EEGer would look for them. Each site is a nearest-neighbour surface Laplacian
// (site minus the mean of its neighbours), which removes posterior alpha spread across the scalp.
// Trains of regular cycles are kept when their surface-negative half-waves are sharper than the
// positive ones (the arch shape) and they are not a copy of simultaneous occipital alpha.
// Cycle segmentation follows bycycle (Cole & Voytek 2019): zero-crossings of the narrowband
// signal bracket each half-cycle, and extrema are taken on the broadband signal.

import { createHash } from 'node:crypto';
import type { Condition, DetectedEventResult, MuMorphology, MuMorphologySite } from '@/lib/analysis-results';
import { butter, FiltFilt, Hilbert, median } from '../dsp';

export type MuSiteLabel = 'C3' | 'C4';

export interface MuBurst {
  site: MuSiteLabel;
  condition: Condition;
  startSec: number;
  endSec: number;
  cycles: number;
  freqHz: number;
  /** median surface-negative ÷ surface-positive extremum sharpness; > 1 = arch-shaped */
  sharpness: number;
  /** fraction of the burst during which O1/O2 carry their own alpha burst */
  occipitalOverlap: number;
  /** median peak-to-trough amplitude on the Laplacian, µV */
  amplitudeUv: number;
}

export interface MuBurstInput {
  labels: string[];
  data: ArrayLike<number>[];
  sampleRate: number;
  /** 1 where the sample survived cleaning; bursts never cross a rejected sample */
  keep: Uint8Array;
  /** seconds from recording start */
  segments: Partial<Record<Condition, { start: number; end: number }>>;
}

export const MU_BURST = {
  BAND_HZ: [8, 13] as [number, number],
  BROAD_HZ: [1, 40] as [number, number],
  /** envelope threshold, × the median envelope of the kept samples */
  ENVELOPE_FACTOR: 1.5,
  MIN_CYCLES: 5,
  MAX_PERIOD_CV: 0.25,
  MAX_AMPLITUDE_CV: 0.4,
  /** per burst, and as the site's median over every regular train: short arch-like snippets turn
   *  up in non-mu recordings too, so a site only yields bursts when its trains are arch-shaped overall */
  MIN_SHARPNESS: 1.2,
  MAX_OCCIPITAL_OVERLAP: 0.6,
  /** a site yields events only when mu trains recur at least this often over the analyzed time */
  MIN_BURSTS_PER_MIN: 2,
  /** sharpness is measured this far either side of an extremum */
  SHARPNESS_MS: 5,
  MIN_SEGMENT_SEC: 10,
} as const;

const ALIASES: Record<string, string> = { T3: 'T7', T4: 'T8', T5: 'P7', T6: 'P8' };
const NEIGHBOURS: Record<string, string[]> = {
  C3: ['F3', 'P3', 'T7', 'Cz'],
  C4: ['F4', 'P4', 'T8', 'Cz'],
  O1: ['P3', 'Pz', 'P7', 'O2'],
  O2: ['P4', 'Pz', 'P8', 'O1'],
};
const SITES: MuSiteLabel[] = ['C3', 'C4'];

const canonical = (label: string) => ALIASES[label] ?? label;

/** Site minus the mean of its available neighbours (at least `minNeighbours`); null when too few. */
function laplacian(byLabel: Map<string, ArrayLike<number>>, site: string, s: number, e: number, minNeighbours: number) {
  const x = byLabel.get(site);
  if (!x) return null;
  const nb = NEIGHBOURS[site].map((n) => byLabel.get(n)).filter((v): v is ArrayLike<number> => !!v);
  if (nb.length < minNeighbours) return null;
  const out = new Float64Array(e - s);
  for (let i = 0; i < out.length; i++) {
    let m = 0;
    for (const v of nb) m += v[s + i];
    out[i] = x[s + i] - m / nb.length;
  }
  return out;
}

interface Filtered {
  narrow: Float64Array;
  broad: Float64Array;
  env: Float64Array;
  /** envelope threshold over the kept samples */
  thr: number;
}

function filtered(x: Float64Array, fs: number, keep: Uint8Array, s: number): Filtered | null {
  const nyq = fs / 2;
  const [lo, hi] = MU_BURST.BAND_HZ;
  const narrowF = butter(2, [lo / nyq, hi / nyq], 'bandpass');
  const broadF = butter(2, [MU_BURST.BROAD_HZ[0] / nyq, Math.min(MU_BURST.BROAD_HZ[1], nyq * 0.9) / nyq], 'bandpass');
  const narrow = new Float64Array(x.length);
  const broad = new Float64Array(x.length);
  new FiltFilt(narrowF.b, narrowF.a).apply(x, narrow);
  new FiltFilt(broadF.b, broadF.a).apply(x, broad);
  const re = new Float64Array(x.length);
  const im = new Float64Array(x.length);
  new Hilbert(x.length).transform(narrow, re, im);
  const env = new Float64Array(x.length);
  const kept: number[] = [];
  for (let i = 0; i < x.length; i++) {
    env[i] = Math.hypot(re[i], im[i]);
    if (keep[s + i]) kept.push(env[i]);
  }
  if (kept.length < fs) return null;
  return { narrow, broad, env, thr: MU_BURST.ENVELOPE_FACTOR * median(kept) };
}

interface Cycle {
  start: number;
  end: number;
  /** broadband maximum in the positive half, minimum in the negative half */
  peak: number;
  trough: number;
}

/** Cycles between rising zero-crossings of the narrowband signal. */
function cycles(f: Filtered): Cycle[] {
  const { narrow, broad } = f;
  const rising: number[] = [];
  for (let i = 1; i < narrow.length; i++) if (narrow[i - 1] < 0 && narrow[i] >= 0) rising.push(i);
  const out: Cycle[] = [];
  for (let c = 0; c + 1 < rising.length; c++) {
    const a = rising[c];
    const b = rising[c + 1];
    let fall = a;
    while (fall < b && narrow[fall] >= 0) fall++;
    if (fall <= a || fall >= b) continue;
    let peak = a;
    for (let i = a; i < fall; i++) if (broad[i] > broad[peak]) peak = i;
    let trough = fall;
    for (let i = fall; i < b; i++) if (broad[i] < broad[trough]) trough = i;
    out.push({ start: a, end: b, peak, trough });
  }
  return out;
}

const cv = (v: number[]) => {
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  if (!(m > 0)) return Infinity;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) / m;
};

function sharpnessAt(x: Float64Array, i: number, k: number): number {
  if (i - k < 0 || i + k >= x.length) return NaN;
  return (Math.abs(x[i] - x[i - k]) + Math.abs(x[i] - x[i + k])) / 2;
}

/** Runs of consecutive above-threshold, fully kept cycles. */
function runs(cs: Cycle[], f: Filtered, keep: Uint8Array, s: number): Cycle[][] {
  const out: Cycle[][] = [];
  let cur: Cycle[] = [];
  const ok = (c: Cycle) => {
    for (let i = c.start; i < c.end; i++) if (!keep[s + i]) return false;
    return f.env[(c.start + c.end) >> 1] > f.thr;
  };
  for (const c of cs) {
    if (ok(c) && (!cur.length || cur[cur.length - 1].end === c.start)) cur.push(c);
    else {
      if (cur.length) out.push(cur);
      cur = ok(c) ? [c] : [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Stretches of a run whose cycles match the run's own amplitude and period: an above-threshold run
 * often starts or ends with a few low noise cycles that would otherwise fail the regularity checks.
 */
function consistentCores(run: Cycle[], broad: Float64Array): Cycle[][] {
  if (run.length < MU_BURST.MIN_CYCLES) return [];
  const amps = run.map((c) => broad[c.peak] - broad[c.trough]);
  const periods = run.map((c) => c.end - c.start);
  const mAmp = median(amps);
  const mPer = median(periods);
  const out: Cycle[][] = [];
  let cur: Cycle[] = [];
  run.forEach((c, i) => {
    if (amps[i] >= 0.5 * mAmp && Math.abs(periods[i] - mPer) <= 0.25 * mPer) cur.push(c);
    else {
      if (cur.length) out.push(cur);
      cur = [];
    }
  });
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Mu bursts per condition segment and site, and a per-site summary. Sites without C3/C4 or with
 * fewer than 3 neighbours are left out; `skipped` says why.
 */
export function detectMuBursts(input: MuBurstInput): { bursts: MuBurst[]; summary: MuMorphology; skipped?: string } {
  const fs = input.sampleRate;
  const byLabel = new Map(input.labels.map((l, i) => [canonical(l), input.data[i]] as const));
  const k = Math.max(1, Math.round((MU_BURST.SHARPNESS_MS / 1000) * fs));
  const bursts: MuBurst[] = [];
  const summary: MuMorphology = {};
  const usable = SITES.filter((site) => byLabel.has(site) && NEIGHBOURS[site].filter((n) => byLabel.has(n)).length >= 3);
  if (!usable.length) return { bursts, summary, skipped: 'needs C3 or C4 with at least 3 neighbouring electrodes' };

  for (const cond of ['eo', 'ec'] as Condition[]) {
    const seg = input.segments[cond];
    if (!seg) continue;
    const n = input.data[0]?.length ?? 0;
    const s = Math.max(0, Math.round(seg.start * fs));
    const e = Math.min(n, Math.round(seg.end * fs));
    if (e - s < MU_BURST.MIN_SEGMENT_SEC * fs) continue;
    let keptSec = 0;
    for (let i = s; i < e; i++) keptSec += input.keep[i] ? 1 : 0;
    keptSec /= fs;

    // occipital control: Laplacian when possible, else the channel itself
    const occ: Filtered[] = [];
    for (const o of ['O1', 'O2']) {
      const raw = byLabel.get(o);
      const x = laplacian(byLabel, o, s, e, 2) ?? (raw ? Float64Array.from({ length: e - s }, (_, i) => raw[s + i]) : null);
      const f = x && filtered(x, fs, input.keep, s);
      if (f) occ.push(f);
    }
    const occActive = (i: number) => occ.some((o) => o.env[i] > o.thr);

    const sites: Partial<Record<MuSiteLabel, MuMorphologySite>> = {};
    for (const site of usable) {
      const lap = laplacian(byLabel, site, s, e, 3)!;
      const f = filtered(lap, fs, input.keep, s);
      if (!f) continue;
      const found: MuBurst[] = [];
      for (const run of runs(cycles(f), f, input.keep, s).flatMap((r) => consistentCores(r, f.broad))) {
        if (run.length < MU_BURST.MIN_CYCLES) continue;
        const periods = run.map((c) => c.end - c.start);
        const amps = run.map((c) => f.broad[c.peak] - f.broad[c.trough]);
        if (cv(periods) > MU_BURST.MAX_PERIOD_CV || cv(amps) > MU_BURST.MAX_AMPLITUDE_CV) continue;
        // surface-negative half-wave = trough of the positive-up signal
        const tr = run.map((c) => sharpnessAt(f.broad, c.trough, k)).filter(Number.isFinite);
        const pk = run.map((c) => sharpnessAt(f.broad, c.peak, k)).filter(Number.isFinite);
        if (!tr.length || !pk.length) continue;
        const sharp = median(tr) / median(pk);
        const a = run[0].start;
        const b = run[run.length - 1].end;
        let overlap = 0;
        for (let i = a; i < b; i++) if (occActive(i)) overlap++;
        found.push({
          site,
          condition: cond,
          startSec: round2((s + a) / fs),
          endSec: round2((s + b) / fs),
          cycles: run.length,
          freqHz: round2(fs / (periods.reduce((x, y) => x + y, 0) / periods.length)),
          sharpness: round2(sharp),
          occipitalOverlap: round2(occ.length ? overlap / (b - a) : 0),
          amplitudeUv: round2(median(amps)),
        });
      }
      const siteSharpness = found.length ? median(found.map((x) => x.sharpness)) : 0;
      const candidates =
        siteSharpness >= MU_BURST.MIN_SHARPNESS
          ? found.filter((x) => x.sharpness >= MU_BURST.MIN_SHARPNESS && x.occipitalOverlap <= MU_BURST.MAX_OCCIPITAL_OVERLAP)
          : [];
      const mu = keptSec > 0 && (candidates.length / keptSec) * 60 >= MU_BURST.MIN_BURSTS_PER_MIN ? candidates : [];
      bursts.push(...mu);
      const dur = mu.map((x) => x.endSec - x.startSec);
      sites[site] = {
        bursts: mu.length,
        bursts_per_min: keptSec > 0 ? round2((mu.length / keptSec) * 60) : 0,
        burst_time_pct: keptSec > 0 ? round2((dur.reduce((x, y) => x + y, 0) / keptSec) * 100) : 0,
        median_burst_s: dur.length ? round2(median(dur)) : 0,
        sharpness_ratio: found.length ? round2(siteSharpness) : null,
        rhythmic_trains: found.length,
      };
    }
    if (Object.keys(sites).length) summary[cond] = { analyzed_sec: round2(keptSec), sites };
  }
  return { bursts: bursts.sort((x, y) => x.startSec - y.startSec), summary };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export const MU_PATTERN = 'mu-rhythm';
export const MU_DETECTOR = 'mu-rhythm';

/**
 * Bursts → detected events (normal variant, noted, one per site so the viewer can highlight that
 * channel). Ids are deterministic like the engine's, so review decisions carry over Re-Analyze.
 */
export function muEventResults(bursts: MuBurst[], dismissedIds: ReadonlySet<string> = new Set()): DetectedEventResult[] {
  return bursts.map((b) => {
    const id = createHash('sha256')
      .update(`${MU_PATTERN}|${b.site}|${b.startSec.toFixed(2)}|${b.endSec.toFixed(2)}`)
      .digest('hex')
      .slice(0, 16);
    // longer, more arch-shaped trains are more certain
    const confidence = Math.min(0.95, 0.5 + (b.sharpness - MU_BURST.MIN_SHARPNESS) * 0.5 + Math.min(b.cycles, 30) / 100);
    return {
      id,
      category: 'variant',
      pattern: MU_PATTERN,
      startSec: b.startSec,
      endSec: b.endSec,
      channels: [b.site],
      confidence: round2(confidence),
      evidence: {
        freqHz: b.freqHz,
        cycles: b.cycles,
        archSharpness: b.sharpness,
        occipitalOverlap: b.occipitalOverlap,
        amplitudeUv: b.amplitudeUv,
      },
      handling: 'noted',
      source: 'detector',
      ...(dismissedIds.has(id) ? { dismissed: true } : {}),
    };
  });
}
