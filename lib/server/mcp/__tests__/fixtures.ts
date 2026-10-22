// Shared MCP test fixtures: deterministic engine-shaped results for EO-only, EC-only and BOTH
// analyses, plus project, recording and analysis rows carrying identifying data (names, filename,
// client metadata, storage paths, kernel ids) that MCP output must never contain.

import {
  BAND_NAMES,
  CONNECTIVITY_BAND_NAMES,
  type AlphaPeak,
  type AnalysisResults,
  type BandPower,
  type Condition,
  type Connectivity,
  type DetectedEventResult,
  type EventDetectionSummary,
  type HrvResults,
  type Lzc,
  type NetworkMetrics,
  type PsdData,
  type QcReportSummary,
  type SloretaResults,
} from '@/lib/analysis-results';
import type { RecordingRow } from '@/lib/server/mcp/sessions';
import type { AnalysisInput } from '@/lib/server/mcp/summary';

/** Values that must never appear in any MCP output. */
export const SECRETS = {
  projectName: 'Anna Smith Clinic',
  filename: 'Anna_Smith_2026-10-01_EO.edf',
  primaryIssue: 'ZZ_SECRET_ISSUE',
  kernelId: 'KERN_SECRET',
  headModelId: 'HEAD_SECRET',
  cleanedFileUrl: 'https://storage.example.test/cleaned/Anna_Smith_cleaned.edf',
  filePath: 'recordings/p1/Anna_Smith_2026-10-01_EO.edf',
  evidence: 'EVIDENCE_SECRET',
  configSecret: 'CONFIG_SECRET',
} as const;

/** QC warnings built from exception messages, carrying a URL, a server path and the kernel id. */
export const LEAKY_WARNINGS = [
  'Source localization unavailable: the head-model kernel could not be loaded (fetch https://storage.example.test/kernels/KERN_SECRET.bin failed)',
  'HRV could not be computed from ECG: ENOENT: no such file /var/task/sloreta/KERN_SECRET.bin',
  'Source localization failed: kernel KERN_SECRET: checksum mismatch at /var/task/sloreta/KERN_SECRET.bin',
  'Cleaned file could not be stored.',
];

/** The 19 10-20 sites, in fixture channel order (index i drives the band power values). */
export const CHANNELS_1020 = [
  'Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8',
  'T7', 'C3', 'Cz', 'C4', 'T8',
  'P7', 'P3', 'Pz', 'P4', 'P8',
  'O1', 'O2',
] as const;

export const PROJECT_ID = '11111111-2222-3333-4444-555555555555';

export function makeProject(over: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    name: SECRETS.projectName,
    description: 'Clinic intake for Anna Smith',
    owner_id: 'owner-user-id',
    client_metadata: { age: 41, primary_issue: SECRETS.primaryIssue },
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  };
}

let recordingSeq = 0;

/** A recordings row (RecordingRow plus the private columns a real select would return). */
export function makeRecording(over: Partial<RecordingRow> & Record<string, unknown> = {}) {
  recordingSeq += 1;
  const id = `aaaaaaaa-0000-0000-0000-${String(recordingSeq).padStart(12, '0')}`;
  return {
    id,
    project_id: PROJECT_ID,
    filename: SECRETS.filename,
    file_path: SECRETS.filePath,
    file_size: 1_234_567,
    condition_type: 'EO',
    created_at: '2026-10-01T10:00:00Z',
    duration_seconds: 300,
    sampling_rate: 256,
    n_channels: 19,
    montage: '10-20',
    reference: 'linked-ears',
    eo_label: 'EO',
    ec_label: 'EC',
    eo_start: null,
    eo_end: null,
    ec_start: null,
    ec_end: null,
    ...over,
  } as RecordingRow & { file_path: string; file_size: number; eo_label: string; ec_label: string };
}

export interface ResultsOptions {
  /** conditions with data; the others are null */
  conditions?: Condition[];
  /** rejection % per condition and overall */
  rejection?: { overall?: number; eo?: number; ec?: number };
  epochs?: { eo?: number; ec?: number };
  bad_channels?: string[];
  ica_components_removed?: number;
  /** QC warnings; default [] */
  warnings?: string[];
  /** EC alpha1/alpha2 multiplier by region (occipital, parietal); default 1.8 and 1.3 */
  ecAlphaGain?: { occipital?: number; parietal?: number };
  events?: DetectedEventResult[];
  /** detector coverage rows; default all ran */
  detectors?: EventDetectionSummary['coverage']['detectors'];
  /** PSD frequency step in Hz (0–60 Hz); default 0.5 */
  psdStepHz?: number;
  /** pair_data length; extra pairs are synthetic channel names; default all 171 channel pairs */
  connectivityPairs?: number;
  /** qc_report.timeline spans and bad channels with reasons */
  timeline?: { spans: [number, number][]; bad_channels: { label: string; reasons: string[]; interpolated: boolean }[] };
  /** HRV series length for nn_ms; default 3 */
  hrvSeriesLength?: number;
  hrv?: boolean;
  sloreta?: boolean;
  legacy?: boolean;
}

const REGION_OF: Record<string, 'occipital' | 'parietal' | 'other'> = {
  P7: 'parietal', P3: 'parietal', Pz: 'parietal', P4: 'parietal', P8: 'parietal',
  O1: 'occipital', O2: 'occipital',
};

/**
 * Band power: absolute = (bandIndex + 1) * (1 + 0.1 * channelIndex), with EC alpha1/alpha2
 * multiplied by the region's gain. Relative = absolute / sum over bands for that channel.
 */
export function makeBandPower(cond: Condition, gain: { occipital: number; parietal: number }): BandPower {
  const bp: BandPower = {};
  CHANNELS_1020.forEach((ch, i) => {
    const abs = BAND_NAMES.map((b, k) => {
      const base = (k + 1) * (1 + 0.1 * i);
      const region = REGION_OF[ch] ?? 'other';
      const isAlpha = b === 'alpha1' || b === 'alpha2';
      return cond === 'ec' && isAlpha && region !== 'other' ? base * gain[region] : base;
    });
    const total = abs.reduce((a, v) => a + v, 0);
    bp[ch] = Object.fromEntries(
      BAND_NAMES.map((b, k) => [b, { absolute: abs[k], relative: abs[k] / total }]),
    ) as BandPower[string];
  });
  return bp;
}

function makeConnectivity(cond: Condition, pairCount?: number): Connectivity {
  const ch = [...CHANNELS_1020];
  const n = ch.length;
  const offset = cond === 'ec' ? 0.05 : 0;
  const value = (band: number, i: number, j: number) => ((i * 7 + j * 3 + band * 5) % 41) / 50 + offset;
  const matrices = {} as Connectivity['connectivity_matrices'];
  const metrics = {} as Record<(typeof CONNECTIVITY_BAND_NAMES)[number], NetworkMetrics>;
  CONNECTIVITY_BAND_NAMES.forEach((band, b) => {
    const m = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : value(b, Math.min(i, j), Math.max(i, j)))));
    matrices[band] = { matrix: m, channels: ch };
    metrics[band] = {
      global_efficiency: 0.41234 + b * 0.01,
      mean_clustering_coefficient: 0.38765 + b * 0.01,
      clustering_by_channel: Object.fromEntries(ch.map((c, i) => [c, 0.3 + i * 0.01])),
      small_worldness: 1.23456 + b * 0.1,
      interhemispheric_connectivity: 0.29876 + b * 0.01,
      node_strength: Object.fromEntries(ch.map((c, i) => [c, 2 + i * 0.1])),
      regional_connectivity: { frontal: 0.3, central: 0.31, parietal: 0.32, occipital: 0.33, temporal: 0.34 },
    };
  });
  const pair_data: Connectivity['pair_data'] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const entry: Connectivity['pair_data'][number] = { ch1: ch[i], ch2: ch[j], type: 'other', region: 'mixed' };
      CONNECTIVITY_BAND_NAMES.forEach((band, b) => (entry[band] = value(b, i, j)));
      pair_data.push(entry);
    }
  }
  if (pairCount !== undefined) {
    for (let k = pair_data.length; k < pairCount; k++) {
      const entry: Connectivity['pair_data'][number] = { ch1: `X${k}`, ch2: `Y${k}`, type: 'other', region: 'mixed' };
      CONNECTIVITY_BAND_NAMES.forEach((band, b) => (entry[band] = value(b, k, k + 1)));
      pair_data.push(entry);
    }
    pair_data.length = pairCount;
  }
  return { connectivity_matrices: matrices, network_metrics: metrics, pair_data };
}

function makeAlphaPeak(cond: Condition): AlphaPeak {
  return Object.fromEntries(
    CHANNELS_1020.map((c, i) => [c, { peak_frequency: (cond === 'ec' ? 10.2 : 9.8) + (i % 3) * 0.1, peak_power: 5 + i }]),
  );
}

function makeLzc(cond: Condition): Lzc {
  return Object.fromEntries(
    CHANNELS_1020.map((c, i) => [c, { lzc: 30 + i, normalized_lzc: (cond === 'ec' ? 0.7 : 0.75) + (i % 4) * 0.01 }]),
  );
}

function makePsd(step = 0.5): PsdData {
  const freqs = Array.from({ length: Math.round(60 / step) + 1 }, (_, k) => k * step); // 0–60 Hz
  return { freqs, channels: Object.fromEntries(CHANNELS_1020.map((c, i) => [c, freqs.map((f) => 10 / (1 + f) + i * 0.01)])) };
}

export function makeHrv(): HrvResults {
  return {
    channel: 'ECG',
    sample_rate: 256,
    duration_sec: 300,
    beats: 352,
    coverage_pct: 97.123,
    reliable: true,
    summary: {
      mean_hr_bpm: 70.4567,
      sdnn_ms: 48.1234,
      rmssd_ms: 39.8765,
      pnn50_pct: 18.2222,
      vlf_ms2: 400.123,
      lf_ms2: 812.555,
      hf_ms2: 650.444,
      lf_nu: 55.5555,
      hf_nu: 44.4444,
      lf_hf: 1.24999,
    },
    series: { nn_ms: { t: [0, 1, 2], v: [850, 860, 855] } },
    notes: [],
  };
}

export function makeSloreta(conditions: Condition[]): SloretaResults {
  const stats: SloretaResults['stats'] = {};
  for (const c of conditions) {
    stats[c] = Object.fromEntries(
      BAND_NAMES.map((b, k) => [
        b,
        { max: 3.14159 + k, mean: 1.23456 + k * 0.1, peak: { voxel: 100 + k, mni: [-32.4, 18.6, 44.2], value: 3.14159 + k, region: 'left frontal' } },
      ]),
    );
  }
  return {
    kernel_id: SECRETS.kernelId,
    head_model_id: SECRETS.headModelId,
    atlas_version: 'placeholder-1',
    voxel_count: 5000,
    design_sample_rate: 256,
    epoch_sec: 2,
    bands: BAND_NAMES.map((name) => ({ name, f_lo: 1, f_hi: 45 })),
    conditions,
    epochs_used: Object.fromEntries(conditions.map((c) => [c, 60])),
    channels_interpolated: [],
    effective_rank: 18,
    stats,
    values_path: 'visuals/sloreta/Anna_Smith/values.f32',
    timeline: { window_sec: 2, hop_sec: 1, n_windows: 10, rejected: [], segments: {}, spectra_path: 'visuals/sloreta/spectra.bin' },
  };
}

let eventSeq = 0;

export function makeEvent(over: Partial<DetectedEventResult> = {}): DetectedEventResult {
  eventSeq += 1;
  return {
    id: eventSeq.toString(16).padStart(16, '0'),
    category: 'artifact',
    pattern: 'eye-blink',
    startSec: 10 + eventSeq,
    endSec: 10.4 + eventSeq,
    channels: ['Fp1', 'Fp2'],
    confidence: 0.91234,
    evidence: { note: SECRETS.evidence, z: 4.2 },
    handling: 'rejected',
    rejects: { scope: 'epoch', firstEpoch: 3, lastEpoch: 3 },
    source: 'detector',
    ...over,
  };
}

export function makeResults(opts: ResultsOptions = {}): AnalysisResults {
  const conditions = opts.conditions ?? ['eo', 'ec'];
  const has = (c: Condition) => conditions.includes(c);
  const gain = { occipital: opts.ecAlphaGain?.occipital ?? 1.8, parietal: opts.ecAlphaGain?.parietal ?? 1.3 };
  const rej = opts.rejection ?? {};
  const qc: QcReportSummary = {
    artifact_mode: 'pipeline',
    profile: 'full',
    artifact_rejection_rate: rej.overall ?? rej.ec ?? rej.eo ?? 8,
    ...(has('eo') ? { eo_rejection_rate: rej.eo ?? rej.overall ?? 8 } : {}),
    ...(has('ec') ? { ec_rejection_rate: rej.ec ?? rej.overall ?? 8 } : {}),
    final_epochs_eo: has('eo') ? (opts.epochs?.eo ?? 60) : 0,
    final_epochs_ec: has('ec') ? (opts.epochs?.ec ?? 60) : 0,
    bad_channels: opts.bad_channels ?? [],
    interpolated_channels: opts.bad_channels ?? [],
    ica_components_removed: opts.ica_components_removed ?? 2,
    ica_removed_labels: ['eye-blink'],
    asr: { ran: true, k: 20, fraction_windows_modified: 0.04 },
    original_sfreq: 256,
    final_sfreq: 256,
    n_channels: 19,
    warnings: opts.warnings ?? [],
    ...(opts.timeline
      ? { timeline: { duration_sec: 300, labels: [...CHANNELS_1020], spans: opts.timeline.spans, channel_spans: {}, bad_channels: opts.timeline.bad_channels } }
      : {}),
  };
  const per = <T,>(make: (c: Condition) => T) => ({ eo: has('eo') ? make('eo') : null, ec: has('ec') ? make('ec') : null });
  const results: AnalysisResults = {
    qc_report: qc,
    band_power: per((c) => makeBandPower(c, gain)),
    connectivity: per((c) => makeConnectivity(c, opts.connectivityPairs)),
    lzc: per(makeLzc),
    alpha_peak: per(makeAlphaPeak),
    band_ratios: {
      theta_beta_ratio: { frontal_avg: 2.71828, central_avg: 2.12345 },
      alpha_theta_ratio: { occipital_avg: 1.61803, parietal_avg: 1.41421 },
    },
    asymmetry: { frontal_alpha: -0.123456, parietal_alpha: 0.054321, frontal_theta: 0.011111 },
    risk_patterns: { adhd_like: true, anxiety_like: false, depression_like: false, sleep_dysregulation: false, hyper_arousal: false },
    rejected_epochs: [{ start: 20, end: 22, reason: 'amplitude', condition: conditions[0] }],
    psd: per(() => makePsd(opts.psdStepHz)),
    visuals: {},
    processing_metadata: {
      engine: 'hybrid-asr-ica@0.33.0',
      config: { secret: SECRETS.configSecret },
      processing_time_seconds: 12.5,
    },
    cleaned_file_url: SECRETS.cleanedFileUrl,
    cleaned_file_format: '.edf',
  };
  if (opts.hrv) {
    results.hrv = makeHrv();
    if (opts.hrvSeriesLength) {
      const n = opts.hrvSeriesLength;
      results.hrv.series.nn_ms = { t: Array.from({ length: n }, (_, k) => k), v: Array.from({ length: n }, (_, k) => 800 + (k % 50)) };
    }
  }
  if (opts.sloreta) results.sloreta = makeSloreta(conditions);
  if (opts.events) {
    results.events = opts.events;
    const counts = { artifact: 0, variant: 0, epileptiform: 0, 'rhythmic-periodic': 0 };
    for (const e of opts.events) counts[e.category] += 1;
    results.event_detection = {
      coverage: {
        tier: 'A',
        detectors: opts.detectors ?? [
          { name: 'eye-blink', ran: true },
          { name: 'spike-wave', ran: true },
        ],
      },
      counts,
      nRejectedEpochsAdded: 1,
      nRejectedEpochsNet: 1,
      retainedEpochFractionRemoved: 0.01,
      dismissed: { applied: 0, unknownIds: 0, notDismissible: 0, epochsRestored: 0 },
    };
  }
  if (opts.legacy) {
    delete (results.processing_metadata as { engine?: string }).engine;
    results.visuals = { topomap_eo: 'https://storage.example.test/visuals/topomap.png' };
  }
  return results;
}

let analysisSeq = 0;

/** An analyses row, as the data loaders select it. */
export function makeAnalysisRow(
  recording: { id: string },
  results: AnalysisResults | null,
  over: { id?: string; status?: string; config?: Record<string, unknown> } = {},
) {
  analysisSeq += 1;
  return {
    id: over.id ?? `bbbbbbbb-0000-0000-0000-${String(analysisSeq).padStart(12, '0')}`,
    recording_id: recording.id,
    status: over.status ?? 'completed',
    results,
    config: over.config ?? { secret: SECRETS.configSecret },
    created_at: '2026-10-01T10:05:00Z',
    updated_at: '2026-10-01T10:06:00Z',
    started_at: '2026-10-01T10:05:00Z',
    completed_at: '2026-10-01T10:06:00Z',
    error_log: null,
  };
}

/** The summary builder's input for one analysis. */
export function makeInput(
  recording: RecordingRow,
  results: AnalysisResults | null,
  over: { analysisId?: string; status?: string; config?: unknown } = {},
): AnalysisInput {
  analysisSeq += 1;
  return {
    analysisId: over.analysisId ?? `cccccccc-0000-0000-0000-${String(analysisSeq).padStart(12, '0')}`,
    recording,
    status: over.status ?? 'completed',
    results,
    config: over.config ?? { secret: SECRETS.configSecret },
  };
}
