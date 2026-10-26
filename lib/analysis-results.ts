// Shape of `analyses.results`. Written by the server-side pipeline (lib/server/eeg) and read by
// the analysis, comparison and AI-interpretation views. Field names match what the former Python
// worker produced so existing rows keep loading; the Python-only fields (`visuals` PNG URLs) are
// still read for legacy analyses.

export type Condition = 'eo' | 'ec';

export const BAND_NAMES = [
  'delta',
  'theta',
  'alpha1',
  'alpha2',
  'smr',
  'beta2',
  'hibeta',
  'lowgamma',
] as const;
export type BandName = (typeof BAND_NAMES)[number];

export const BANDS: Record<BandName, [number, number]> = {
  delta: [1, 4],
  theta: [4, 8],
  alpha1: [8, 10],
  alpha2: [10, 12],
  smr: [12, 15],
  beta2: [15, 20],
  hibeta: [20, 30],
  lowgamma: [30, 45],
};

export const CONNECTIVITY_BAND_NAMES = ['delta', 'theta', 'alpha', 'beta'] as const;
export type ConnectivityBandName = (typeof CONNECTIVITY_BAND_NAMES)[number];

export const CONNECTIVITY_BANDS: Record<ConnectivityBandName, [number, number]> = {
  delta: [1, 4],
  theta: [4, 8],
  alpha: [8, 13],
  beta: [13, 30],
};

/** The channels analyses stored spectrograms for before every channel was kept (display order). */
export const SPECTROGRAM_CHANNELS = ['Fp1', 'Fz', 'Cz', 'Pz', 'O1'] as const;

/** µV² (absolute) and fraction of 1–45 Hz total (relative) */
export type BandPower = Record<string, Record<BandName, { absolute: number; relative: number }>>;

export type AlphaPeak = Record<string, { peak_frequency: number; peak_power: number }>;

export type Lzc = Record<string, { lzc: number; normalized_lzc: number }>;

export interface NetworkMetrics {
  global_efficiency: number;
  mean_clustering_coefficient: number;
  clustering_by_channel: Record<string, number>;
  small_worldness: number;
  interhemispheric_connectivity: number;
  node_strength: Record<string, number>;
  regional_connectivity: Record<string, number>;
}

export interface Connectivity {
  connectivity_matrices: Record<ConnectivityBandName, { matrix: number[][]; channels: string[] }>;
  network_metrics: Record<ConnectivityBandName, NetworkMetrics>;
  pair_data: Array<
    { ch1: string; ch2: string; type: string; region: string } & Partial<
      Record<ConnectivityBandName, number>
    >
  >;
}

export interface BandRatios {
  theta_beta_ratio: { frontal_avg: number; central_avg: number };
  alpha_theta_ratio: { occipital_avg: number; parietal_avg: number };
}

export type Asymmetry = Record<string, number>;

export interface RiskPatterns {
  adhd_like: boolean;
  anxiety_like: boolean;
  depression_like: boolean;
  sleep_dysregulation: boolean;
  hyper_arousal: boolean;
}

export interface RejectedEpoch {
  /** seconds from recording start */
  start: number;
  end: number;
  reason: string;
  condition: Condition | string;
}

/** Downsampled STFT power for a channel: power[t][f] in dB, t in seconds from segment start. */
export interface SpectrogramData {
  times: number[];
  freqs: number[];
  power_db: number[][];
}

/** Mean power spectral density over the kept epochs: channels[label][k] in µV²/Hz at freqs[k] Hz. */
export interface PsdData {
  freqs: number[];
  channels: Record<string, number[]>;
}

export type ArtifactMode = 'pipeline' | 'manual';
export type ArtifactProfile = 'full' | 'conservative' | 'aggressive' | 'rejectionOnly' | 'legacy';

/** Rejected stretch of the recording, [start, end] in seconds from recording start. */
export type TimeSpan = [number, number];

/**
 * Where the cleaning pipeline rejected data over the whole recording, derived from its epoch
 * masks: a sample is rejected when no kept pipeline epoch covers it.
 */
export interface RejectionTimeline {
  duration_sec: number;
  /** every input channel, in recording order */
  labels: string[];
  /** whole-recording decision (what the features use) */
  spans: TimeSpan[];
  /** per-channel decision */
  channel_spans: Record<string, TimeSpan[]>;
  bad_channels: { label: string; reasons: string[]; interpolated: boolean }[];
}

export interface QcReportSummary {
  artifact_mode: ArtifactMode | 'ica';
  profile?: ArtifactProfile;
  /** percent of feature epochs rejected, 0–100 */
  artifact_rejection_rate: number;
  eo_rejection_rate?: number;
  ec_rejection_rate?: number;
  final_epochs_eo: number;
  final_epochs_ec: number;
  bad_channels: string[];
  interpolated_channels?: string[];
  ica_components_removed: number;
  /** e.g. ['eye-blink', 'muscle'] for the components removed by ICA */
  ica_removed_labels?: string[];
  physiological_path?: 'ica' | 'blinkRegression' | 'skipped';
  asr?: { ran: boolean; k: number; fraction_windows_modified: number; skipped_reason?: string };
  original_sfreq: number;
  final_sfreq: number;
  n_channels: number;
  manual_artifact_epochs_count?: number;
  warnings?: string[];
  /** Absent on Python-era analyses */
  timeline?: RejectionTimeline;
  // Legacy (Python) fields, present on old analyses only
  ica_method?: string;
  [key: string]: unknown;
}

export interface ProcessingMetadata {
  /** e.g. 'hybrid-asr-ica@0.33.0-beta.1' (earlier runs: 'node/...'); absent on Python-era analyses */
  engine?: string;
  config?: Record<string, unknown>;
  preprocessing_config?: Record<string, unknown>;
  processing_time_seconds: number;
  [key: string]: unknown;
}

/** Compact time series: t in seconds from recording start, v in the metric's unit. */
export interface TimeSeries {
  t: number[];
  v: number[];
}

/** Heart-rate variability from an ECG channel (biofeedback-core HRV graph, whole recording). */
export interface HrvResults {
  /** source channel label as recorded, e.g. 'ECG' */
  channel: string;
  sample_rate: number;
  duration_sec: number;
  beats: number;
  /** share of the recording covered by detected NN intervals, 0–100 */
  coverage_pct: number;
  /** false when too few beats were detected to trust the metrics (summary/series then empty) */
  reliable: boolean;
  /** whole-recording values; null when the recording is too short for the metric */
  summary: {
    mean_hr_bpm: number | null;
    sdnn_ms: number | null;
    rmssd_ms: number | null;
    pnn50_pct: number | null;
    vlf_ms2: number | null;
    lf_ms2: number | null;
    hf_ms2: number | null;
    lf_nu: number | null;
    hf_nu: number | null;
    lf_hf: number | null;
  };
  series: {
    /** RR tachogram (NN interval per beat, ms) */
    nn_ms?: TimeSeries;
    heart_rate_bpm?: TimeSeries;
    /** 1-minute sliding windows */
    rmssd_ms?: TimeSeries;
    sdnn_ms?: TimeSeries;
    pnn50_pct?: TimeSeries;
    lf_ms2?: TimeSeries;
    hf_ms2?: TimeSeries;
    lf_nu?: TimeSeries;
    hf_nu?: TimeSeries;
    lf_hf?: TimeSeries;
  };
  notes: string[];
}

/** One voxel's place in the kernel grid. */
export interface SloretaPeak {
  voxel: number;
  /** MNI millimetres [x right, y anterior, z superior] */
  mni: [number, number, number];
  value: number;
  /** coarse hemisphere × lobe label from the kernel (placeholder atlas) */
  region: string;
}

/**
 * sLORETA standardized current density (dimensionless) per voxel, averaged over the kept,
 * cleaned 2 s epochs of each condition. The values themselves live in a Float32 file in storage,
 * laid out [condition][band][voxel] in the order of `conditions` and `bands`.
 */
export interface SloretaResults {
  kernel_id: string;
  head_model_id: string;
  atlas_version: string;
  voxel_count: number;
  design_sample_rate: number;
  /** set when the cleaned EEG was resampled to the kernel rate for this step */
  resampled_from_hz?: number;
  epoch_sec: number;
  bands: { name: BandName; f_lo: number; f_hi: number }[];
  conditions: Condition[];
  epochs_used: Partial<Record<Condition, number>>;
  channels_interpolated: string[];
  /** kernel rank after average reference, less one per interpolated channel */
  effective_rank: number;
  /** per condition, per band: scale and the strongest voxel outside the low-sensitivity set */
  stats: Partial<Record<Condition, Partial<Record<BandName, { max: number; mean: number; peak: SloretaPeak | null }>>>>;
  /** storage path in the visuals bucket; set once the values file is stored */
  values_path?: string;
  /** Time lapse over the whole cleaned recording; frames come from /api/analyses/[id]/sloreta/frames */
  timeline?: SloretaTimeline;
}

export interface SloretaTimeline {
  window_sec: number;
  hop_sec: number;
  /** window w covers [w·hop_sec, w·hop_sec + window_sec] seconds of the recording */
  n_windows: number;
  /** windows overlapping rejected data, shown as rejected rather than skipped */
  rejected: number[];
  /** EO/EC segments in seconds, for shading the transport */
  segments: Partial<Record<Condition, { start: number; end: number }>>;
  /** storage path (visuals bucket) of the per-window cross-spectra; set once stored */
  spectra_path?: string;
}

// Detected EEG events (artifact pipeline event detection). App-side mirrors of the engine's
// shapes, kept JSON-safe; this file is shared with the browser, so it must not import the engine.

export type EventCategory = 'artifact' | 'variant' | 'epileptiform' | 'rhythmic-periodic' | 'slowing';

/** What the cleaning did about the event in the numbers. */
export type EventHandling =
  | 'rejected'
  | 'repaired'
  | 'removed-component'
  | 'channel-excluded'
  | 'interpolated'
  | 'noted';

export interface DetectedEventResult {
  /** deterministic (16 hex chars): the same event keeps its id across Re-Analyze */
  id: string;
  category: EventCategory;
  /** e.g. 'eye-blink', 'muscle', 'electrode-pop' */
  pattern: string;
  /** seconds from recording start */
  startSec: number;
  endSec: number;
  /** channel labels; [] = all channels / generalized */
  channels: string[];
  /** 0..1 */
  confidence: number;
  evidence: Record<string, number | string | boolean>;
  handling: EventHandling;
  /** cleaning stage or IC label, when handling is neither 'rejected' nor 'noted' */
  handledBy?: string;
  /** pipeline epochs the event excluded; present iff handling === 'rejected' */
  rejects?: { scope: 'epoch' | 'channel'; firstEpoch: number; lastEpoch: number };
  /** named after a cleaning stage's action, or found by a detector */
  source: 'pipeline-stage' | 'detector';
  /** the analyst dismissed it before this run */
  dismissed?: boolean;
}

export interface EventDetectionSummary {
  coverage: {
    /** montage coverage tier; 'none' when no detector could run */
    tier: 'none' | 'A' | 'B' | 'C';
    /** per detector: whether it ran, and why not */
    detectors: { name: string; ran: boolean; skippedReason?: string }[];
  };
  /** 'slowing' is absent on analyses run before the slowing detector */
  counts: Partial<Record<EventCategory, number>> & Record<Exclude<EventCategory, 'slowing'>, number>;
  /** epochs the cleaning stages kept that detection excluded, before dismissals */
  nRejectedEpochsAdded: number;
  /** epochs the cleaning stages kept that detection still excludes after dismissals */
  nRejectedEpochsNet: number;
  retainedEpochFractionRemoved: number;
  dismissed: {
    applied: number;
    unknownIds: number;
    /** known ids whose event was not a rejection (nothing to restore) */
    notDismissible: number;
    epochsRestored: number;
  };
}

/** Mu rhythm trains at one central site over one condition (cleaned data, Laplacian). */
export interface MuMorphologySite {
  /** arch-shaped trains kept as mu (each one is a 'mu-rhythm' event) */
  bursts: number;
  bursts_per_min: number;
  /** share of the analyzed time inside a mu burst, 0–100 */
  burst_time_pct: number;
  median_burst_s: number;
  /** median negative/positive sharpness over every regular 8–13 Hz train; null when none */
  sharpness_ratio: number | null;
  /** regular 8–13 Hz trains of any shape */
  rhythmic_trains: number;
}

export type MuMorphology = Partial<
  Record<Condition, { analyzed_sec: number; sites: Partial<Record<'C3' | 'C4', MuMorphologySite>> }>
>;

/** Paroxysmal slowing bursts over one condition (cleaned data, average reference). */
export type SlowingSummary = Partial<
  Record<
    Condition,
    {
      analyzed_sec: number;
      /** each one is a 'slowing' event */
      bursts: number;
      bursts_per_min: number;
      /** share of the analyzed time inside a burst, 0–100 */
      burst_time_pct: number;
      /** bursts per pattern ('firda', 'polymorphic-delta', ...) */
      patterns: Record<string, number>;
    }
  >
>;

/** An analyst's decision on one detected event, stored in `analyses.config.event_reviews`. */
export type EventReviewDecision = 'confirmed' | 'dismissed';

export interface AnalysisResults {
  qc_report: QcReportSummary;
  band_power: Record<Condition, BandPower | null>;
  connectivity: Record<Condition, Connectivity | null>;
  lzc: Record<Condition, Lzc | null>;
  alpha_peak: Record<Condition, AlphaPeak | null>;
  band_ratios: BandRatios;
  asymmetry: Asymmetry;
  risk_patterns: RiskPatterns;
  rejected_epochs: RejectedEpoch[];
  /**
   * keyed by channel label, per condition. Newer analyses keep only the first channel here and
   * every channel in the spectrograms file (spectrograms_path); older ones have five channels.
   */
  spectrograms?: Record<Condition, Record<string, SpectrogramData> | null>;
  /** channels with a spectrogram in the spectrograms file, in recording order */
  spectrogram_channels?: string[];
  /** storage path (visuals bucket) of every channel's spectrogram, { [condition]: { [channel]: data } } */
  spectrograms_path?: string;
  /** Per-channel PSD per condition; absent on analyses run before it was added */
  psd?: Record<Condition, PsdData | null>;
  /** Present when the recording has an ECG channel */
  hrv?: HrvResults;
  /** Present when the recording has the full 19-channel montage and the kernel was available */
  sloreta?: SloretaResults;
  /** Detected EEG events; absent on analyses run before event detection was added */
  events?: DetectedEventResult[];
  /** Detector coverage, counts and dismissal stats; absent on analyses run before detection was added */
  event_detection?: EventDetectionSummary;
  /** Mu rhythm burst summary; absent on analyses run before the mu detector */
  mu_morphology?: MuMorphology;
  /** The EO/EC segments (seconds) this analysis ran on; absent on analyses run before it was stored */
  segments?: Partial<Record<Condition, { start: number; end: number }>>;
  /** Paroxysmal slowing summary; absent on analyses run before the slowing detector */
  paroxysmal_slowing?: SlowingSummary;
  /** Legacy PNG URLs from the Python worker. New analyses leave this empty. */
  visuals?: Record<string, string>;
  processing_metadata: ProcessingMetadata;
  cleaned_file_url?: string;
  /** '.edf' | '.bdf' | '.csv' */
  cleaned_file_format?: string;
}

/** True when the analysis was produced by the Python worker and carries PNG visuals. */
export function hasLegacyVisual(results: Partial<AnalysisResults> | null | undefined, key: string): boolean {
  const v = results?.visuals?.[key];
  return typeof v === 'string' && v.length > 0;
}
