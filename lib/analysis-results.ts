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
  /** keyed by channel label, per condition */
  spectrograms?: Record<Condition, Record<string, SpectrogramData> | null>;
  /** Legacy PNG URLs from the Python worker. New analyses leave this empty. */
  visuals?: Record<string, string>;
  processing_metadata: ProcessingMetadata;
  cleaned_file_url?: string;
  /** '.edf' | '.bdf' | '.csv' */
  cleaned_file_format?: string;
  ai_interpretation?: unknown;
}

/** True when the analysis was produced by the Python worker and carries PNG visuals. */
export function hasLegacyVisual(results: Partial<AnalysisResults> | null | undefined, key: string): boolean {
  const v = results?.visuals?.[key];
  return typeof v === 'string' && v.length > 0;
}
