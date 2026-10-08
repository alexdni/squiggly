// Heart-rate variability from an ECG lead, using biofeedback-core's HRV feature graph (the same
// definitions the Divergence apps use): NN intervals from its lookahead beat detector, heart
// rate, RMSSD / SDNN / pNN50, and VLF / LF / HF power with normalized units. Runs over the whole
// recording; window metrics use the graph's 1-minute sliding windows (5 s stride).

import {
  compileFeatureDefinitions,
  computeFeatures,
  hrvFeatureDefs,
} from '@divergentneuro/biofeedback-core';
import type { HrvResults, TimeSeries } from '@/lib/analysis-results';
import { eegFilterSections, filterEeg, sosFiltFilt } from '@/lib/dsp/zeroPhase';

/** Below this share of the recording covered by detected beats the metrics are not shown. */
export const MIN_COVERAGE_PCT = 60;
export const MIN_BEATS = 30;
/** Cap per stored series, so long recordings keep results JSON small. */
const MAX_POINTS = 600;

type Feature = { signal: unknown[]; timestamps: number[] };

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

function finiteSeries(f: Feature | undefined, digits: number): TimeSeries | undefined {
  if (!f?.signal?.length) return undefined;
  const t: number[] = [];
  const v: number[] = [];
  f.signal.forEach((value, i) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      t.push(round(f.timestamps[i] / 1000, 2));
      v.push(round(value, digits));
    }
  });
  if (!v.length) return undefined;
  if (v.length <= MAX_POINTS) return { t, v };
  const step = Math.ceil(v.length / MAX_POINTS);
  return { t: t.filter((_, i) => i % step === 0), v: v.filter((_, i) => i % step === 0) };
}

function last(f: Feature | undefined): number | null {
  const sig = f?.signal;
  if (!sig?.length) return null;
  const value = sig[sig.length - 1];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const r1 = (x: number | null) => (x === null ? null : round(x, 1));
const r2 = (x: number | null) => (x === null ? null : round(x, 2));

/** Divide two equal-time series point by point (LF/HF). */
function ratioSeries(a: TimeSeries | undefined, b: TimeSeries | undefined): TimeSeries | undefined {
  if (!a || !b) return undefined;
  const byT = new Map(b.t.map((t, i) => [t, b.v[i]]));
  const t: number[] = [];
  const v: number[] = [];
  a.t.forEach((ti, i) => {
    const den = byT.get(ti);
    if (den && den > 0) {
      t.push(ti);
      v.push(round(a.v[i] / den, 3));
    }
  });
  return v.length ? { t, v } : undefined;
}

/**
 * Remove baseline drift and mains before beat detection. Device exports can carry a large DC
 * offset and drift on the ECG lead; the beat detector's own prefilter is causal and tuned for
 * live streams.
 */
export function preconditionEcg(ecg: Float64Array, sampleRate: number, lineHz: number): Float64Array {
  const notch = eegFilterSections(sampleRate, { notchHz: lineHz });
  const noMains = notch.length ? sosFiltFilt(notch, ecg, Math.round(sampleRate)) : ecg;
  return normalizeAmplitude(filterEeg(noMains, sampleRate, { highpassHz: 0.5 }));
}

/** Typical ECG amplitude (µV) the beat detector is tuned for. */
const TARGET_RANGE_UV = 1000;

/**
 * Rescale so the 0.5–99.5 percentile range is ~1 mV. Only beat timing matters for HRV, and leads
 * on "Annotations" channels often lack a physical unit, which leaves them orders of magnitude
 * off; the beat detector's thresholds are absolute.
 */
export function normalizeAmplitude(x: Float64Array): Float64Array {
  const stride = Math.max(1, Math.floor(x.length / 100_000));
  const sample: number[] = [];
  for (let i = 0; i < x.length; i += stride) sample.push(x[i]);
  const sorted = Float64Array.from(sample).sort();
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const range = at(0.995) - at(0.005);
  if (!(range > 0) || !Number.isFinite(range)) return x;
  const k = TARGET_RANGE_UV / range;
  return x.map((v) => v * k);
}

export function computeHrv(
  ecg: { label: string; data: Float64Array; sampleRate: number },
  opts: { lineHz?: number } = {}
): HrvResults {
  const fs = ecg.sampleRate;
  const n = ecg.data.length;
  const durationSec = n / fs;
  const signal = Array.from(preconditionEcg(ecg.data, fs, opts.lineHz ?? 60));
  const timestamps = Array.from({ length: n }, (_, i) => (i * 1000) / fs);

  const graph = compileFeatureDefinitions(
    hrvFeatureDefs({ channelName: 'ecg', type: 'ecg', samplingRate: Math.round(fs) })
  );
  const f = computeFeatures(graph, { ecg: { signal, timestamps } }) as Record<string, Feature>;

  const nn = (f['nn interval']?.signal ?? []).filter(
    (x): x is number => typeof x === 'number' && Number.isFinite(x)
  );
  const coveragePct = durationSec > 0 ? (100 * nn.reduce((a, b) => a + b, 0)) / 1000 / durationSec : 0;
  const reliable = nn.length >= MIN_BEATS && coveragePct >= MIN_COVERAGE_PCT;

  const base = {
    channel: ecg.label,
    sample_rate: round(fs, 2),
    duration_sec: round(durationSec, 2),
    beats: nn.length,
    coverage_pct: round(Math.min(100, coveragePct), 1),
    reliable,
  };
  const empty: HrvResults['summary'] = {
    mean_hr_bpm: null,
    sdnn_ms: null,
    rmssd_ms: null,
    pnn50_pct: null,
    vlf_ms2: null,
    lf_ms2: null,
    hf_ms2: null,
    lf_nu: null,
    hf_nu: null,
    lf_hf: null,
  };
  if (!reliable) {
    return {
      ...base,
      summary: empty,
      series: {},
      notes: [
        `An ECG channel (${ecg.label}) was found, but heartbeats could only be detected over ` +
          `${base.coverage_pct}% of the recording (${nn.length} beats). HRV is not shown; check ` +
          'electrode contact.',
      ],
    };
  }

  const lf = last(f['hrv lf']);
  const hf = last(f['hrv hf']);
  const lfWindow = finiteSeries(f['hrv lf window'], 2);
  const hfWindow = finiteSeries(f['hrv hf window'], 2);
  const notes: string[] = [];
  if (durationSec < 120) notes.push('LF/HF need at least 2 minutes of ECG; shorter recordings leave them empty.');
  if (durationSec < 270) notes.push('VLF needs at least 4.5 minutes of ECG.');
  if (coveragePct < 85) {
    notes.push(`Heartbeats were detected over ${base.coverage_pct}% of the recording; gaps are left out of the metrics.`);
  }

  return {
    ...base,
    summary: {
      mean_hr_bpm: r1(last(f['average heart rate'])),
      sdnn_ms: r1(last(f['sdnn'])),
      rmssd_ms: r1(last(f['rmssd'])),
      pnn50_pct: r1(last(f['pnn50'])),
      vlf_ms2: r1(last(f['hrv vlf'])),
      lf_ms2: r1(lf),
      hf_ms2: r1(hf),
      lf_nu: r1(last(f['hrv lf nu'])),
      hf_nu: r1(last(f['hrv hf nu'])),
      lf_hf: lf !== null && hf !== null && hf > 0 ? r2(lf / hf) : null,
    },
    series: {
      nn_ms: finiteSeries(f['nn interval'], 0),
      heart_rate_bpm: finiteSeries(f['heart rate'], 1),
      rmssd_ms: finiteSeries(f['rmssd window'], 1),
      sdnn_ms: finiteSeries(f['sdnn window'], 1),
      pnn50_pct: finiteSeries(f['pnn50 window'], 1),
      lf_ms2: lfWindow,
      hf_ms2: hfWindow,
      lf_nu: finiteSeries(f['hrv lf nu window'], 1),
      hf_nu: finiteSeries(f['hrv hf nu window'], 1),
      lf_hf: ratioSeries(lfWindow, hfWindow),
    },
    notes,
  };
}
