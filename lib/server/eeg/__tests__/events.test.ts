import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Engine from '@divergentneuro/biofeedback-core';
import type { LoadedEeg } from '../io/loadRecording';
import {
  buildPipelineConfig,
  cleanEeg,
  EVENT_DETECTION,
  eventInputsFor,
  resolvePreprocessing,
  runAnalysis,
} from '../pipeline';
import { theraqPipelineConfig } from '../theraqJob';
import { edfBytes, FS, LABELS, synthetic } from './synthetic';

// Wrap the engine so a test can see what the job hands it and, for the baseline run, turn event
// detection off without a code path for it in the app.
const engine = vi.hoisted(() => ({
  eventsOff: false,
  calls: [] as { config: unknown; options: unknown }[],
}));
vi.mock('@divergentneuro/biofeedback-core', async (importOriginal) => {
  const actual = await importOriginal<typeof Engine>();
  return {
    ...actual,
    runArtifactPipeline: ((rec, config, options) => {
      engine.calls.push({ config, options });
      const cfg = engine.eventsOff ? { ...config, events: { enabled: false } } : config;
      return actual.runArtifactPipeline(rec, cfg, options);
    }) as typeof Engine.runArtifactPipeline,
  };
});

beforeEach(() => {
  engine.eventsOff = false;
  engine.calls = [];
});

describe('event detection config', () => {
  it('is on, labels-only, in both the pipeline and the manual mode', () => {
    expect(EVENT_DETECTION).toEqual({ enabled: true, exclude: false });
    for (const mode of ['pipeline', 'manual'] as const) {
      for (const profile of ['full', 'legacy', 'rejectionOnly'] as const) {
        const cfg = buildPipelineConfig(resolvePreprocessing({ artifact_mode: mode, profile }), FS);
        expect(cfg.events).toEqual({ enabled: true, exclude: false });
      }
    }
  });

  it('stays off for TheraQ', () => {
    for (const mode of ['pipeline', 'manual'] as const) {
      for (const profile of ['full', 'legacy', 'conservative'] as const) {
        expect(theraqPipelineConfig(resolvePreprocessing({ artifact_mode: mode, profile }), FS).events).toBeUndefined();
      }
    }
  });
});

const seconds = 60;
const segments = { eo: { start: 0, end: 30 }, ec: { start: 30, end: 60 } };
const bytes = edfBytes(synthetic(seconds, { burstAt: 20 }));
const run = (extra: { dismissedEventIds?: string[] } = {}) =>
  runAnalysis({ bytes: bytes.slice(), format: 'edf', segments, preprocessing: { profile: 'full' }, engine: 'test', ...extra });

describe('runAnalysis with event detection', () => {
  it('stores events and coverage, hands the engine the un-notched EEG, and leaves metrics unchanged', () => {
    const on = run();
    const call = engine.calls[0] as { options: { eventInputs: { unnotched: Float64Array[]; ecg?: unknown } } };
    expect(call.options.eventInputs.unnotched).toHaveLength(LABELS.length);
    expect(call.options.eventInputs.unnotched[0]).toHaveLength(seconds * FS);
    expect(call.options.eventInputs.ecg).toBeUndefined(); // no ECG lead in this file

    const { events, event_detection } = on.results;
    expect(Array.isArray(events)).toBe(true);
    expect(events!.length).toBeGreaterThan(0);
    for (const e of events!) {
      expect(e.id).toMatch(/^[0-9a-f]{16}$/);
      expect(e.endSec).toBeGreaterThanOrEqual(e.startSec);
    }
    expect(event_detection!.coverage.detectors.length).toBeGreaterThan(0);
    expect(['none', 'A', 'B', 'C']).toContain(event_detection!.coverage.tier);
    expect(event_detection!.nRejectedEpochsNet).toBe(0); // labels only
    // plain JSON: survives a round trip unchanged
    expect(JSON.parse(JSON.stringify({ events, event_detection }))).toEqual({ events, event_detection });

    engine.eventsOff = true;
    const off = run();
    expect(off.results.events).toBeUndefined();
    expect(off.results.event_detection).toBeUndefined();
    expect(on.results.band_power).toEqual(off.results.band_power);
    expect(on.results.rejected_epochs).toEqual(off.results.rejected_epochs);
    expect(on.results.alpha_peak).toEqual(off.results.alpha_peak);
    expect(on.results.qc_report.final_epochs_eo).toBe(off.results.qc_report.final_epochs_eo);
    expect(on.results.qc_report.final_epochs_ec).toBe(off.results.qc_report.final_epochs_ec);
  }, 180_000);

  it('passes dismissed event ids to the engine', () => {
    const first = run();
    const rejection = first.results.events!.find((e) => e.handling === 'rejected' && e.rejects?.scope === 'epoch')!;
    const noted = first.results.events!.find((e) => e.handling !== 'rejected')!;
    expect(rejection).toBeDefined();
    expect(noted).toBeDefined();
    const ids = [rejection.id, noted.id, 'ffffffffffffffff'];
    engine.calls = [];
    const second = run({ dismissedEventIds: ids });
    expect((engine.calls[0].options as { eventInputs: { dismissedEventIds: string[] } }).eventInputs.dismissedEventIds).toEqual(ids);
    const d = second.results.event_detection!.dismissed;
    expect(d).toMatchObject({ applied: 1, notDismissible: 1, unknownIds: 1 });
    expect(second.results.events!.find((e) => e.id === rejection.id)?.dismissed).toBe(true);
    // ids are deterministic: the same events come back on the re-run
    expect(second.results.events!.map((e) => e.id)).toEqual(first.results.events!.map((e) => e.id));
  }, 180_000);
});

describe('event inputs', () => {
  const data = synthetic(30);
  const ecgAt = (rate: number) => {
    const n = 30 * rate;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = 20 * Math.sin((2 * Math.PI * 7 * i) / rate);
    for (let b = Math.round(0.4 * rate); b < n; b += Math.round(0.8 * rate)) x[b] += 1000;
    return { label: 'ECG', data: x, sampleRate: rate };
  };
  const eeg = (ecg?: LoadedEeg['ecg']): LoadedEeg => ({
    format: 'edf',
    labels: LABELS,
    data,
    sampleRate: FS,
    originalSampleRate: FS,
    ignored: [],
    ...(ecg ? { ecg } : {}),
  });
  const config = buildPipelineConfig(resolvePreprocessing({}), FS);

  it('omits an ECG lead at a different rate; the cardiac detectors are then not assessed', () => {
    const rec = eeg(ecgAt(125));
    const inputs = eventInputsFor(rec, []);
    expect(inputs.ecg).toBeUndefined();
    expect(inputs.unnotched).toBe(rec.data);
    expect(inputs.dismissedEventIds).toBeUndefined();
    const { result } = cleanEeg(rec, config, inputs);
    const skipped = result.report.eventDetection!.coverage.detectors.filter((d) => d.skippedReason === 'no ECG lead');
    expect(skipped.length).toBeGreaterThan(0);
  }, 60_000);

  it('passes an ECG lead with the EEG rate and length', () => {
    const rec = eeg(ecgAt(FS));
    const inputs = eventInputsFor(rec, ['0123456789abcdef']);
    expect(inputs.ecg).toBe(rec.ecg!.data);
    expect(inputs.dismissedEventIds).toEqual(['0123456789abcdef']);
    const { result } = cleanEeg(rec, config, inputs);
    expect(result.report.eventDetection!.coverage.detectors.some((d) => d.skippedReason === 'no ECG lead')).toBe(false);
  }, 60_000);
});
