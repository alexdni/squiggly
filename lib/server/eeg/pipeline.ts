// One analysis, start to finish, as pure computation: file bytes in, results JSON and the cleaned
// file out. Runs inside the analysis worker thread (see worker.ts); storage and database access stay
// on the main thread in runAnalysisJob.ts.
//
// Flow: load + channel selection → biofeedback-core artifact pipeline (profile or manual) →
// average reference over channels that survived QC → 2 s feature epochs per EO/EC segment, kept
// only where the pipeline kept the data and no manual artifact overlaps → features + spectrograms.

import {
  InsufficientChannelsError,
  runArtifactPipeline,
  type Annotation,
  type DetectedEvent,
  type EventDetectionReport,
  type EventInputs,
  type PartialPipelineConfig,
  type PipelineResult,
} from '@divergentneuro/biofeedback-core';
import type {
  AnalysisResults,
  Condition,
  DetectedEventResult,
  EventDetectionSummary,
  QcReportSummary,
  RejectedEpoch,
  HrvResults,
  RejectionTimeline,
  SpectrogramData,
  TimeSpan,
} from '@/lib/analysis-results';
import { ANALYSIS_MAX_HZ, DEFAULT_PREPROCESSING_CONFIG } from '@/lib/constants';
import { eegFilterSections, sosFiltFilt } from '@/lib/dsp/zeroPhase';
import { writeCsv, writeEdf } from './export/writers';
import { computeHrv } from './hrv';
import { detectMuBursts, MU_DETECTOR, muEventResults } from './features/muBursts';
import { computePsd, computeSpectrograms, extractFeatures, type EpochSet } from './features';
import {
  computeSourceMaps,
  computeWindowSpectra,
  SLORETA_EPOCH_SEC,
  SLORETA_HOP_SEC,
  SloretaUnavailableError,
} from './sloreta/compute';
import { CHANNELS_10_20 } from '@/lib/eeg-labels';
import {
  averageReference,
  loadRecording,
  type LoadedEeg,
  type SourceFormat,
} from './io/loadRecording';

export type PreprocessingConfig = typeof DEFAULT_PREPROCESSING_CONFIG;

export interface AnalysisJobInput {
  bytes: Uint8Array;
  format: SourceFormat;
  /** seconds from recording start; a missing condition is skipped */
  segments: Partial<Record<Condition, { start: number; end: number }>>;
  preprocessing: Partial<PreprocessingConfig> & { artifact_mode?: string };
  manualArtifacts?: { start: number; end: number }[];
  engine: string;
  /** registered sLORETA kernel (see jobs.ts), or why none could be loaded */
  sloreta?: { kernelId: string } | { unavailable: string };
  /** event ids the analyst dismissed on an earlier run (analyses.config.event_reviews) */
  dismissedEventIds?: string[];
}

export interface AnalysisJobOutput {
  results: Omit<AnalysisResults, 'cleaned_file_url'>;
  cleaned: { bytes: Uint8Array; format: SourceFormat };
  /** sLORETA values, [condition][band][voxel]; described by results.sloreta */
  sloretaValues?: Float32Array;
  /** per-window cross-spectra for the time lapse; described by results.sloreta.timeline */
  sloretaSpectra?: Float32Array;
}

export class AnalysisJobError extends Error {
  partialReport?: unknown;
  constructor(message: string, partialReport?: unknown) {
    super(message);
    this.name = 'AnalysisJobError';
    this.partialReport = partialReport;
  }
}

export type ProgressFn = (stage: string) => void;

const PROFILES = ['full', 'conservative', 'aggressive', 'rejectionOnly', 'legacy'] as const;

const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/**
 * Stored settings → a complete, range-checked config. Stored configs come from clients, so every
 * field is clamped here (a zero epoch length would otherwise loop forever in the worker).
 * Python-era configs ('ica' mode, SOBI keys) map to the `full` profile.
 */
export function resolvePreprocessing(stored: AnalysisJobInput['preprocessing']): PreprocessingConfig {
  const d = DEFAULT_PREPROCESSING_CONFIG;
  const s = (stored ?? {}) as Record<string, unknown>;
  const highPass = num(s.high_pass_hz, 0.1, 5, d.high_pass_hz);
  return {
    artifact_mode: s.artifact_mode === 'manual' ? 'manual' : 'pipeline',
    profile: (PROFILES as readonly unknown[]).includes(s.profile)
      ? (s.profile as PreprocessingConfig['profile'])
      : 'full',
    rejection_threshold_uv: num(s.rejection_threshold_uv, 20, 1000, d.rejection_threshold_uv),
    asr_k: s.asr_k == null ? null : num(s.asr_k, 5, 100, 20),
    line_freq: s.line_freq === 50 ? 50 : 60,
    high_pass_hz: highPass,
    low_pass_hz: num(s.low_pass_hz, highPass + 1, ANALYSIS_MAX_HZ, d.low_pass_hz),
    epoch_duration: num(s.epoch_duration, 1, 10, d.epoch_duration),
  };
}

/**
 * Channel QC judges channels only on what the analysis keeps. Its high-frequency noise test measures
 * power above 45 Hz, which the low-pass discards, so it is off: it dropped whole channels whose
 * 1-45 Hz EEG was fine.
 */
export const BELOW_LOW_PASS_CHANNEL_QC = { hfNoiseZ: Infinity } as const;

/**
 * Event detection (S6) in labels-only mode: events are detected, named and stored, but S6 adds
 * no exclusions of its own, so every metric is unchanged until the detector thresholds are
 * validated on TUAR. Dismissals still apply: dismissing a cleaning stage's rejection restores
 * the epochs only it excluded.
 */
export const EVENT_DETECTION = { enabled: true, exclude: false } as const;

export function buildPipelineConfig(
  cfg: PreprocessingConfig,
  sampleRate: number
): PartialPipelineConfig {
  const lowPass = Math.min(cfg.low_pass_hz, 0.45 * sampleRate);
  const filter = { lineHz: cfg.line_freq, highPassHz: cfg.high_pass_hz, lowPassHz: lowPass };
  if (cfg.artifact_mode === 'manual') {
    // Manual mode: only channel QC and the zero-phase filters; the user's annotations decide
    // what is excluded.
    return {
      profile: 'full',
      stages: ['channelQc', 'temporalFilter', 'qcReport'],
      asr: { enabled: false },
      channelQc: BELOW_LOW_PASS_CHANNEL_QC,
      filter,
      events: EVENT_DETECTION,
    };
  }
  return {
    profile: cfg.profile,
    // The legacy profile has no filter stage of its own; without one its cleaned data keeps
    // everything above the low-pass
    ...(cfg.profile === 'legacy' ? { stages: ['channelQc', 'legacyGate', 'temporalFilter', 'qcReport'] } : {}),
    filter,
    channelQc: BELOW_LOW_PASS_CHANNEL_QC,
    rejection: { postCleanCeilingUv: cfg.rejection_threshold_uv },
    legacy: { absoluteCeilingUv: cfg.rejection_threshold_uv, legacyFilter: { highHz: lowPass } },
    ...(cfg.asr_k != null ? { asr: { k: cfg.asr_k } } : {}),
    events: EVENT_DETECTION,
  };
}

/**
 * Auxiliary signals for event detection. `unnotched` is the EEG before removeMains (same channel
 * order as the recording cleanEeg hands the engine), so the line-noise detector sees the hum.
 * The ECG lead is passed only when it has the EEG's rate and length; the loader keeps it at its
 * own rate, and when that differs it is omitted and the engine reports the cardiac detectors as
 * not assessed ("no ECG lead") rather than us resampling it here.
 */
export function eventInputsFor(eeg: LoadedEeg, dismissedEventIds?: string[]): EventInputs {
  const n = eeg.data[0]?.length ?? 0;
  const ecg = eeg.ecg;
  return {
    unnotched: eeg.data,
    ...(ecg && ecg.sampleRate === eeg.sampleRate && ecg.data.length === n ? { ecg: ecg.data } : {}),
    ...(dismissedEventIds?.length ? { dismissedEventIds } : {}),
  };
}

/** Engine events → plain JSON objects for analyses.results. */
export function eventResults(events: DetectedEvent[]): DetectedEventResult[] {
  return events.map((e) => ({
    id: e.id,
    category: e.category,
    pattern: e.pattern,
    startSec: e.startSec,
    endSec: e.endSec,
    channels: [...e.channels],
    confidence: e.confidence,
    evidence: { ...e.evidence },
    handling: e.handling,
    ...(e.handledBy !== undefined ? { handledBy: e.handledBy } : {}),
    ...(e.rejects ? { rejects: { ...e.rejects } } : {}),
    source: e.source,
    ...(e.dismissed ? { dismissed: true } : {}),
  }));
}

export function eventDetectionSummary(r: EventDetectionReport): EventDetectionSummary {
  return {
    coverage: {
      tier: r.coverage.tier,
      detectors: r.coverage.detectors.map((d) => ({
        name: d.name,
        ran: d.ran,
        ...(d.skippedReason !== undefined ? { skippedReason: d.skippedReason } : {}),
      })),
    },
    counts: { ...r.counts },
    nRejectedEpochsAdded: r.nRejectedEpochsAdded,
    nRejectedEpochsNet: r.nRejectedEpochsNet,
    retainedEpochFractionRemoved: r.retainedEpochFractionRemoved,
    dismissed: { ...r.dismissed },
  };
}

/**
 * The engine's detection summary plus the mu detector: its coverage row, its events in the variant
 * count, and mu ids the analyst dismissed, which the engine counted as unknown.
 */
export function withMuDetection(
  summary: EventDetectionSummary,
  muEvents: DetectedEventResult[],
  dismissed: ReadonlySet<string>,
  skippedReason?: string
): EventDetectionSummary {
  const muDismissed = muEvents.filter((e) => dismissed.has(e.id)).length;
  return {
    ...summary,
    coverage: {
      ...summary.coverage,
      detectors: [
        ...summary.coverage.detectors,
        { name: MU_DETECTOR, ran: !skippedReason, ...(skippedReason ? { skippedReason } : {}) },
      ],
    },
    counts: { ...summary.counts, variant: (summary.counts.variant ?? 0) + muEvents.length },
    dismissed: { ...summary.dismissed, unknownIds: Math.max(0, summary.dismissed.unknownIds - muDismissed) },
  };
}

/** 1 for every sample covered by at least one kept pipeline epoch. */
export function keptSampleMask(result: PipelineResult, nSamples: number): Uint8Array {
  const { epochStarts, epochLength, epochMask } = result.masks;
  const keep = new Uint8Array(nSamples);
  for (let e = 0; e < epochMask.length; e++) {
    if (!epochMask[e]) continue;
    keep.fill(1, epochStarts[e], Math.min(nSamples, epochStarts[e] + epochLength));
  }
  return keep;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Runs of 0 in a keep mask as [start, end] seconds (end = last rejected sample's time). */
export function spansFromKeep(keep: Uint8Array, sampleRate: number): TimeSpan[] {
  const spans: TimeSpan[] = [];
  let runStart = -1;
  for (let i = 0; i <= keep.length; i++) {
    const rejected = i < keep.length && !keep[i];
    if (rejected && runStart < 0) runStart = i;
    else if (!rejected && runStart >= 0) {
      spans.push([round2(runStart / sampleRate), round2((i - 1) / sampleRate)]);
      runStart = -1;
    }
  }
  return spans;
}

function epochUnionMask(
  masks: PipelineResult['masks'],
  epochMask: Uint8Array,
  nSamples: number
): Uint8Array {
  const keep = new Uint8Array(nSamples);
  for (let e = 0; e < epochMask.length; e++) {
    if (!epochMask[e]) continue;
    keep.fill(1, masks.epochStarts[e], Math.min(nSamples, masks.epochStarts[e] + masks.epochLength));
  }
  return keep;
}

/** Whole-recording and per-channel rejected spans, as the QC timeline draws them. */
export function rejectionTimeline(result: PipelineResult): RejectionTimeline {
  const { recording, masks, report } = result;
  const fs = recording.sampleRate;
  const n = recording.nSamples;
  const labels = recording.channels.map((c) => c.label);
  return {
    duration_sec: round2(n / fs),
    labels,
    spans: spansFromKeep(epochUnionMask(masks, masks.epochMask, n), fs),
    channel_spans: Object.fromEntries(
      labels.map((label, c) => [
        label,
        spansFromKeep(epochUnionMask(masks, masks.channelEpochMask[c] ?? masks.epochMask, n), fs),
      ])
    ),
    bad_channels: report.channels
      .filter((c) => c.bad)
      .map((c) => ({ label: c.label, reasons: c.reasons, interpolated: c.interpolated })),
  };
}

const REASON_PRIORITY: Record<string, number> = { extreme: 3, reject: 2, legacy: 1 };

function rejectionReason(
  start: number,
  end: number,
  annotations: Annotation[],
  manual: { start: number; end: number }[],
  sampleRate: number
): string {
  const s0 = start / sampleRate;
  const s1 = end / sampleRate;
  if (manual.some((m) => m.start < s1 && m.end > s0)) return 'manual';
  let best: Annotation | null = null;
  for (const a of annotations) {
    if (a.start >= end || a.end <= start) continue;
    const p = REASON_PRIORITY[a.kind];
    if (p !== undefined && (!best || p > REASON_PRIORITY[best.kind])) best = a;
  }
  if (!best) return 'artifact';
  if (best.kind === 'extreme') return best.meta?.source === 'asr' ? 'asr-extreme' : 'extreme-transient';
  if (best.kind === 'legacy') return 'amplitude';
  const reason = typeof best.meta?.reason === 'string' ? best.meta.reason : '';
  return reason ? `rejected: ${reason}` : 'rejected';
}

interface SegmentEpochs {
  set: EpochSet | null;
  total: number;
  kept: number;
  rejected: RejectedEpoch[];
}

export function buildEpochs(
  condition: Condition,
  segment: { start: number; end: number },
  data: Float64Array[],
  labels: string[],
  sampleRate: number,
  epochSec: number,
  keep: Uint8Array,
  annotations: Annotation[],
  manual: { start: number; end: number }[]
): SegmentEpochs {
  const nSamples = data[0].length;
  const len = Math.round(epochSec * sampleRate);
  if (!(len >= 1)) throw new AnalysisJobError(`Invalid epoch length ${epochSec}s at ${sampleRate} Hz`);
  const first = Math.max(0, Math.round(segment.start * sampleRate));
  const last = Math.min(nSamples, Math.round(segment.end * sampleRate));
  const epochs: Float64Array[][] = [];
  const rejected: RejectedEpoch[] = [];
  let total = 0;
  for (let s = first; s + len <= last; s += len) {
    total++;
    const e = s + len;
    let ok = true;
    for (let i = s; i < e; i++) {
      if (!keep[i]) {
        ok = false;
        break;
      }
    }
    if (ok && manual.some((m) => m.start * sampleRate < e && m.end * sampleRate > s)) ok = false;
    if (ok) {
      epochs.push(data.map((d) => d.subarray(s, e)));
    } else {
      rejected.push({
        start: s / sampleRate,
        end: e / sampleRate,
        reason: rejectionReason(s, e, annotations, manual, sampleRate),
        condition,
      });
    }
  }
  return {
    set: epochs.length ? { sfreq: sampleRate, channels: labels, epochs } : null,
    total,
    kept: epochs.length,
    rejected,
  };
}

export interface CleanedEeg {
  result: PipelineResult;
  /** channels that survived QC (good or interpolated), average-referenced */
  labels: string[];
  data: Float64Array[];
}

/**
 * Zero-phase notch at the mains frequency and every harmonic below Nyquist, applied before the
 * artifact pipeline. The pipeline only notches mains below its own low-pass cutoff, so with the
 * 45 Hz analysis low-pass the 60 Hz notch is skipped and only the low-pass's ~0.04 gain is left:
 * a dry-electrode headband with ~5 mV of hum then keeps ~250 µV of 60 Hz in every window and
 * every epoch fails the 160 µV ceiling. Notching here makes mains removal independent of the
 * low-pass setting.
 */
export function removeMains(data: Float64Array[], sampleRate: number, lineHz: number): Float64Array[] {
  const sections = eegFilterSections(sampleRate, { notchHz: lineHz, notchHarmonics: true });
  if (sections.length === 0) return data;
  const pad = Math.round(sampleRate); // a Q-30 notch rings for ~0.2 s; 1 s of padding is ample
  return data.map((d) => (d.length > 2 * pad ? sosFiltFilt(sections, d, pad) : d));
}

/**
 * Run the artifact pipeline and re-reference to the average of the usable channels.
 * `eventInputs` is only read by the engine when `config.events.enabled`.
 */
export function cleanEeg(eeg: LoadedEeg, config: PartialPipelineConfig, eventInputs?: EventInputs): CleanedEeg {
  if (eeg.labels.length < 2) {
    throw new AnalysisJobError(
      `Need at least 2 EEG channels with 10-20/10-10 labels; found ${eeg.labels.length}`
    );
  }
  let result: PipelineResult;
  try {
    result = runArtifactPipeline(
      {
        sampleRate: eeg.sampleRate,
        channels: eeg.labels.map((label) => ({ label })),
        data: removeMains(eeg.data, eeg.sampleRate, config.filter?.lineHz ?? 60),
        nSamples: eeg.data[0].length,
        reference: 'source',
      },
      config,
      { eventInputs }
    );
  } catch (err) {
    if (err instanceof InsufficientChannelsError) {
      throw new AnalysisJobError(err.message, (err as { partialReport?: unknown }).partialReport);
    }
    throw err;
  }
  const cleaned = result.recording;
  const usable = result.report.channels
    .map((c, i) => ({ ...c, i }))
    .filter((c) => !c.bad || c.interpolated)
    .map((c) => c.i);
  averageReference(cleaned.data, usable);
  return {
    result,
    labels: usable.map((i) => cleaned.channels[i].label),
    data: usable.map((i) => cleaned.data[i]),
  };
}

export function runAnalysis(input: AnalysisJobInput, progress: ProgressFn = () => {}): AnalysisJobOutput {
  const t0 = Date.now();
  const cfg = resolvePreprocessing(input.preprocessing);
  const manual = cfg.artifact_mode === 'manual' ? input.manualArtifacts ?? [] : [];

  progress('loading');
  const eeg = loadRecording(input.bytes, input.format);

  progress('cleaning');
  const pipelineConfig = buildPipelineConfig(cfg, eeg.sampleRate);
  const { result, labels, data } = cleanEeg(
    eeg,
    pipelineConfig,
    eventInputsFor(eeg, input.dismissedEventIds)
  );

  progress('epoching');
  const report = result.report;
  const cleaned = result.recording;
  const keep = keptSampleMask(result, cleaned.nSamples);

  const conditions = (['eo', 'ec'] as Condition[]).filter((c) => input.segments[c]);
  const segs = Object.fromEntries(
    conditions.map((c) => [
      c,
      buildEpochs(
        c,
        input.segments[c]!,
        data,
        labels,
        cleaned.sampleRate,
        cfg.epoch_duration,
        keep,
        result.annotations,
        manual
      ),
    ])
  ) as Partial<Record<Condition, SegmentEpochs>>;

  const eo = segs.eo?.set ?? null;
  const ec = segs.ec?.set ?? null;
  if (!eo && !ec) {
    throw new AnalysisJobError(
      'Every epoch was rejected as artifact. Try a gentler profile or a higher rejection threshold.',
      report
    );
  }

  progress('features');
  const features = extractFeatures(eo, ec);
  const psd = { eo: eo ? computePsd(eo) : null, ec: ec ? computePsd(ec) : null };

  // Mu rhythm trains on the cleaned data; labels only, never changes a metric.
  progress('mu');
  const muKeep = keep.slice();
  for (const m of manual) {
    muKeep.fill(0, Math.max(0, Math.floor(m.start * cleaned.sampleRate)), Math.min(muKeep.length, Math.ceil(m.end * cleaned.sampleRate)));
  }
  const mu = detectMuBursts({ labels, data, sampleRate: cleaned.sampleRate, keep: muKeep, segments: input.segments });
  const dismissed = new Set(input.dismissedEventIds ?? []);
  const muEvents = muEventResults(mu.bursts, dismissed);

  progress('spectrograms');
  const spectrograms: Record<Condition, Record<string, SpectrogramData> | null> = { eo: null, ec: null };
  for (const c of conditions) {
    const seg = input.segments[c]!;
    const s = Math.max(0, Math.round(seg.start * cleaned.sampleRate));
    const e = Math.min(cleaned.nSamples, Math.round(seg.end * cleaned.sampleRate));
    if (e - s >= cleaned.sampleRate * 2) {
      spectrograms[c] = computeSpectrograms(
        data.map((d) => d.subarray(s, e)),
        labels,
        cleaned.sampleRate
      );
    }
  }

  // Heart-rate variability when the file has an ECG lead; never fails the EEG analysis.
  let hrv: HrvResults | undefined;
  const hrvWarnings: string[] = (eeg.ecgSkipped ?? []).map((note) => `ECG channel skipped (${note}).`);
  if (eeg.ecg) {
    progress('hrv');
    try {
      hrv = computeHrv(eeg.ecg, { lineHz: cfg.line_freq });
    } catch (err) {
      hrvWarnings.push(`HRV could not be computed from ${eeg.ecg.label}: ${(err as Error).message}`);
    }
  }

  // sLORETA source maps over the kept, cleaned epochs, for recordings with the full 10-20 montage.
  // Like HRV, never fails the EEG analysis.
  let sloreta: ReturnType<typeof computeSourceMaps> | undefined;
  let sloretaSpectra: Float32Array | undefined;
  const sloretaWarnings: string[] = [];
  if (input.sloreta && CHANNELS_10_20.every((ch) => eeg.labels.includes(ch))) {
    if ('unavailable' in input.sloreta) {
      sloretaWarnings.push(`Source localization unavailable: ${input.sloreta.unavailable}`);
    } else {
      progress('sloreta');
      try {
        const epochs = Object.fromEntries(
          conditions.map((c) => [
            c,
            buildEpochs(c, input.segments[c]!, data, labels, cleaned.sampleRate, SLORETA_EPOCH_SEC, keep, result.annotations, manual)
              .set?.epochs ?? [],
          ])
        );
        sloreta = computeSourceMaps({
          kernelId: input.sloreta.kernelId,
          labels,
          sampleRate: cleaned.sampleRate,
          epochs,
          interpolated: report.channels.filter((c) => c.interpolated).map((c) => c.label),
        });
        const windows = computeWindowSpectra({
          kernelId: input.sloreta.kernelId,
          labels,
          sampleRate: cleaned.sampleRate,
          data,
          keep,
          manual,
        });
        if (windows.nWindows > 0) {
          sloretaSpectra = windows.spectra;
          sloreta.meta.timeline = {
            window_sec: SLORETA_EPOCH_SEC,
            hop_sec: SLORETA_HOP_SEC,
            n_windows: windows.nWindows,
            rejected: windows.rejected,
            segments: input.segments,
          };
        }
      } catch (err) {
        const msg = (err as Error).message;
        sloretaWarnings.push(
          err instanceof SloretaUnavailableError ? `Source localization skipped: ${msg}` : `Source localization failed: ${msg}`
        );
      }
    }
  }

  progress('exporting');
  const cleanedSignals = { labels, data, sampleRate: cleaned.sampleRate };
  const cleanedBytes =
    input.format === 'csv'
      ? writeCsv(cleanedSignals)
      : writeEdf(cleanedSignals, {
          bdf: input.format === 'bdf',
          source: eeg.edfHeader,
          prefiltering: `HP:${cfg.high_pass_hz}Hz LP:${pipelineConfig.filter?.lowPassHz}Hz N:${cfg.line_freq}Hz cleaned`,
        });

  const totalEpochs = conditions.reduce((n, c) => n + (segs[c]?.total ?? 0), 0);
  const keptEpochs = conditions.reduce((n, c) => n + (segs[c]?.kept ?? 0), 0);
  // Percent with 2 decimals, as the Python worker stored it.
  const pct = (kept: number, total: number) => (total ? Math.round((1 - kept / total) * 10000) / 100 : 0);
  const rate = (s?: SegmentEpochs) => (s ? pct(s.kept, s.total) : 0);
  const qc: QcReportSummary = {
    artifact_mode: cfg.artifact_mode,
    profile: cfg.artifact_mode === 'manual' ? undefined : cfg.profile,
    artifact_rejection_rate: pct(keptEpochs, totalEpochs),
    eo_rejection_rate: rate(segs.eo),
    ec_rejection_rate: rate(segs.ec),
    final_epochs_eo: segs.eo?.kept ?? 0,
    final_epochs_ec: segs.ec?.kept ?? 0,
    bad_channels: report.channels.filter((c) => c.bad).map((c) => c.label),
    interpolated_channels: report.channels.filter((c) => c.interpolated).map((c) => c.label),
    bad_channel_reasons: Object.fromEntries(
      report.channels.filter((c) => c.bad).map((c) => [c.label, c.reasons])
    ),
    ica_components_removed: report.physiological.removed.length,
    ica_removed_labels: report.physiological.removed.map((r) => r.label),
    physiological_path: report.physiological.path,
    blink_count: report.physiological.blinkCount,
    asr: {
      ran: report.asr.ran,
      k: report.asr.k,
      fraction_windows_modified: report.asr.fractionWindowsModified,
      skipped_reason: report.asr.skippedReason,
    },
    retained_seconds: report.rejection.retainedSec,
    original_sfreq: eeg.originalSampleRate,
    final_sfreq: cleaned.sampleRate,
    n_channels: labels.length,
    ignored_channels: eeg.ignored,
    manual_artifact_epochs_count: cfg.artifact_mode === 'manual' ? manual.length : undefined,
    timeline: rejectionTimeline(result),
    warnings: [
      ...report.warnings,
      ...hrvWarnings,
      ...sloretaWarnings,
      ...conditions
        .filter((c) => !segs[c]?.set)
        .map((c) => `All ${c.toUpperCase()} epochs were rejected; ${c.toUpperCase()} features are unavailable.`),
    ],
    pipeline: {
      version: report.pipelineVersion,
      config_hash: report.configHash,
      band_power_pre_post: report.bandPower,
      stage_timings_ms: report.stageTimingsMs,
    },
  };

  const results: AnalysisJobOutput['results'] = {
    qc_report: qc,
    ...features,
    rejected_epochs: conditions.flatMap((c) => segs[c]?.rejected ?? []),
    spectrograms,
    psd,
    ...(hrv ? { hrv } : {}),
    ...(sloreta ? { sloreta: sloreta.meta } : {}),
    ...(result.events || muEvents.length ? { events: [...eventResults(result.events ?? []), ...muEvents] } : {}),
    ...(report.eventDetection
      ? { event_detection: withMuDetection(eventDetectionSummary(report.eventDetection), muEvents, dismissed, mu.skipped) }
      : {}),
    ...(Object.keys(mu.summary).length ? { mu_morphology: mu.summary } : {}),
    visuals: {},
    processing_metadata: {
      engine: input.engine,
      config: { ...cfg },
      processing_time_seconds: Math.round((Date.now() - t0) / 10) / 100,
    },
    // Leading dot, as the Python worker stored it (the UI builds the download name from it).
    cleaned_file_format: `.${input.format}`,
  };

  return {
    results,
    cleaned: { bytes: cleanedBytes, format: input.format },
    ...(sloreta ? { sloretaValues: sloreta.values } : {}),
    ...(sloretaSpectra ? { sloretaSpectra } : {}),
  };
}
