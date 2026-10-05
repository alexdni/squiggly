import { describe, expect, it } from 'vitest';
import { writeEdf } from '../export/writers';
import { readEdfHeader } from '../io/edf';
import { AnalysisJobError, buildPipelineConfig, removeMains, resolvePreprocessing, runAnalysis, spansFromKeep } from '../pipeline';
import { runTheraq } from '../theraqJob';

const LABELS = ['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8', 'T7', 'C3', 'Cz', 'C4', 'T8', 'P7', 'P3', 'Pz', 'P4', 'P8', 'O1', 'O2'];
const FS = 250;

/** Deterministic PRNG so the synthetic recording (and the test) is reproducible. */
function rng(seed: number) {
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
function synthetic(seconds: number, opts: { burstAt?: number } = {}): Float64Array[] {
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

function edfBytes(data: Float64Array[]): Uint8Array {
  return writeEdf({ labels: LABELS.map((l) => `EEG ${l}-LE`), data, sampleRate: FS }, { bdf: false });
}

describe('runAnalysis', () => {
  const seconds = 120;
  const bytes = edfBytes(synthetic(seconds, { burstAt: 30 }));
  const segments = { eo: { start: 0, end: 60 }, ec: { start: 60, end: 120 } };

  it('cleans, epochs and extracts features end to end', () => {
    const stages: string[] = [];
    const { results, cleaned } = runAnalysis(
      { bytes: bytes.slice(), format: 'edf', segments, preprocessing: { profile: 'full' }, engine: 'test' },
      (s) => stages.push(s)
    );
    expect(stages).toEqual(['loading', 'cleaning', 'epoching', 'features', 'spectrograms', 'exporting']);

    const qc = results.qc_report;
    expect(qc.artifact_mode).toBe('pipeline');
    expect(qc.profile).toBe('full');
    expect(qc.n_channels).toBe(19);
    expect(qc.final_epochs_eo).toBeGreaterThan(15);
    expect(qc.final_epochs_ec).toBeGreaterThan(20);
    expect(results.processing_metadata.engine).toBe('test');
    // Python-compatible conventions the UI and AI prompt rely on
    expect(qc.artifact_rejection_rate).toBeGreaterThan(0);
    expect(qc.artifact_rejection_rate).toBeLessThan(100);
    expect(qc.artifact_rejection_rate).toBe(Math.round(qc.artifact_rejection_rate * 100) / 100);
    expect(results.cleaned_file_format).toBe('.edf');

    // QC timeline: whole-recording + per-channel rejected spans, burst at 30 s rejected
    const tl = qc.timeline!;
    expect(tl.duration_sec).toBeCloseTo(seconds, 1);
    expect(tl.labels).toHaveLength(19);
    expect(Object.keys(tl.channel_spans)).toEqual(tl.labels);
    expect(tl.spans.some(([s0, s1]) => s0 <= 30.5 && s1 >= 30.5)).toBe(true);
    for (const [s0, s1] of tl.spans) expect(s1).toBeGreaterThanOrEqual(s0);

    // The burst at 30–31 s must not survive into a kept epoch.
    const burstRejected = results.rejected_epochs.some((r) => r.start <= 30.5 && r.end >= 30.5);
    expect(burstRejected).toBe(true);
    for (const r of results.rejected_epochs) {
      expect(r.end - r.start).toBeCloseTo(2, 6);
      expect(['eo', 'ec']).toContain(r.condition);
    }

    // EC alpha is ~3x EO alpha posteriorly → much higher alpha power in EC
    const eo = results.band_power.eo!;
    const ec = results.band_power.ec!;
    expect(ec.O1.alpha2.absolute).toBeGreaterThan(3 * eo.O1.alpha2.absolute);
    expect(results.alpha_peak.ec!.O1.peak_frequency).toBeCloseTo(10, 0);

    expect(Object.keys(results.spectrograms!.eo!)).toEqual(expect.arrayContaining(['Fp1', 'Cz', 'O1']));

    const header = readEdfHeader(cleaned.bytes);
    expect(cleaned.format).toBe('edf');
    expect(header.signals.map((s) => s.label)).toEqual(LABELS);
    expect(header.nRecords).toBe(seconds);
  }, 120_000);

  it('manual mode only rejects annotated epochs', () => {
    const { results } = runAnalysis({
      bytes: bytes.slice(),
      format: 'edf',
      segments,
      preprocessing: { artifact_mode: 'manual' },
      manualArtifacts: [{ start: 29.5, end: 31.5 }],
      engine: 'test',
    });
    expect(results.qc_report.artifact_mode).toBe('manual');
    expect(results.qc_report.asr?.ran).toBe(false);
    expect(results.rejected_epochs.map((r) => [r.start, r.reason])).toEqual([
      [28, 'manual'],
      [30, 'manual'],
    ]);
  }, 60_000);

  it('fails with a clear error when every epoch is rejected', () => {
    expect(() =>
      runAnalysis({
        bytes: bytes.slice(),
        format: 'edf',
        segments: { eo: { start: 29, end: 32 } },
        preprocessing: { profile: 'legacy', rejection_threshold_uv: 20 },
        engine: 'test',
      })
    ).toThrow(AnalysisJobError);
  }, 60_000);
});

describe('config mapping', () => {
  it('maps Python-era configs onto the full profile', () => {
    const cfg = resolvePreprocessing({ artifact_mode: 'ica', ica_method: 'sobi' } as never);
    expect(cfg.artifact_mode).toBe('pipeline');
    expect(cfg.profile).toBe('full');
  });

  it('only overrides ASR k when the user set it', () => {
    const base = resolvePreprocessing({ profile: 'conservative' });
    expect(buildPipelineConfig(base, 250).asr).toBeUndefined();
    const set = resolvePreprocessing({ profile: 'conservative', asr_k: 12 });
    expect(buildPipelineConfig(set, 250).asr).toEqual({ k: 12 });
  });

  it('keeps the low-pass below Nyquist for low-rate devices', () => {
    const cfg = buildPipelineConfig(resolvePreprocessing({}), 64);
    expect(cfg.filter?.lowPassHz).toBeCloseTo(28.8, 6);
  });
});

describe('runTheraq', () => {
  it('runs all four phases through cleaning and the TheraQ engine', () => {
    const phase = () => ({ bytes: edfBytes(synthetic(60)), format: 'edf' as const });
    const out = runTheraq({
      phases: { EO1: phase(), EC: phase(), EO2: phase(), TASK: phase() },
      preprocessing: {},
      engine: 'test',
    });
    expect(Object.keys(out.phases ?? {})).toEqual(expect.arrayContaining(['EO1', 'EC', 'EO2', 'TASK']));
    expect(out.metrics?.length).toBeGreaterThan(0);
  }, 180_000);
});

describe('spansFromKeep', () => {
  it('turns runs of rejected samples into [start, end] seconds', () => {
    const keep = Uint8Array.from([1, 0, 0, 1, 1, 0, 0, 0]);
    expect(spansFromKeep(keep, 2)).toEqual([
      [0.5, 1],
      [2.5, 3.5],
    ]);
    expect(spansFromKeep(new Uint8Array(4).fill(1), 2)).toEqual([]);
  });
});

describe('mains hum', () => {
  it('removeMains suppresses off-centre hum and its harmonics, leaving EEG-band signal', () => {
    const n = FS * 20;
    const alpha = Float64Array.from({ length: n }, (_, i) => 20 * Math.sin((2 * Math.PI * 10 * i) / FS));
    const x = Float64Array.from(alpha, (v, i) => v + 5000 * Math.sin((2 * Math.PI * 59.95 * i) / FS) + 800 * Math.sin((2 * Math.PI * 120 * i) / FS));
    const [y] = removeMains([x], FS, 60);
    let err = 0;
    for (let i = 2 * FS; i < n - 2 * FS; i++) err = Math.max(err, Math.abs(y[i] - alpha[i]));
    // The Q-30 notch (2 Hz wide) leaves ~0.25 % of hum 0.05 Hz off-centre (12 µV of 5 mV); the
    // pipeline's 45 Hz low-pass then removes ~96 % of that. 120 Hz is notched completely.
    expect(err).toBeLessThan(0.005 * 5000);
  });

  it('a recording with heavy 60 Hz hum (dry electrodes) is not rejected wholesale', () => {
    // Regression: with the 45 Hz analysis low-pass the pipeline skipped its own 60 Hz notch, so
    // ~5 mV of hum left ~250 µV in every window and every epoch was rejected.
    const seconds = 60;
    const data = synthetic(seconds).map((ch, c) =>
      Float64Array.from(ch, (v, i) => v + 5000 * Math.sin((2 * Math.PI * 59.95 * i) / FS + c))
    );
    const { results } = runAnalysis({
      bytes: edfBytes(data),
      format: 'edf',
      segments: { eo: { start: 0, end: seconds } },
      preprocessing: { profile: 'conservative' },
      engine: 'test',
    });
    expect(results.qc_report.final_epochs_eo).toBeGreaterThan(20);
  }, 120_000);
});
