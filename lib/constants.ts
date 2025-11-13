// Application Constants

// File Upload
export const MAX_UPLOAD_SIZE = 52428800; // 50 MB in bytes
export const ALLOWED_FILE_EXTENSIONS = ['.edf', '.EDF'];

// EEG Configuration
export const EXPECTED_CHANNELS_19 = 19;
export const EXPECTED_CHANNELS_21 = 21;
export const MONTAGE_10_20_19CH = [
  'Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8',
  'T7', 'C3', 'Cz', 'C4', 'T8',
  'P7', 'P3', 'Pz', 'P4', 'P8',
  'O1', 'O2'
];

export const MONTAGE_10_20_21CH = [
  'Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8',
  'T7', 'C3', 'Cz', 'C4', 'T8',
  'P7', 'P3', 'Pz', 'P4', 'P8',
  'O1', 'O2',
  'A1', 'A2'  // Ear references
];

// Legacy export for backwards compatibility
export const MONTAGE_10_20 = MONTAGE_10_20_19CH;

// EO/EC Annotation Labels
export const EO_LABELS = ['EO', 'eo', 'eyes open', 'Eyes Open', 'EYES OPEN'];
export const EC_LABELS = ['EC', 'ec', 'eyes closed', 'Eyes Closed', 'EYES CLOSED'];

// EEG Bands
export const DEFAULT_BANDS = [
  { name: 'delta', low: 1, high: 4 },
  { name: 'theta', low: 4, high: 8 },
  { name: 'alpha1', low: 8, high: 10 },
  { name: 'alpha2', low: 10, high: 12 },
  { name: 'smr', low: 12, high: 15 },
  { name: 'beta2', low: 15, high: 20 },
  { name: 'hibeta', low: 20, high: 30 },
  { name: 'lowgamma', low: 30, high: 45 },
];

// Coherence Pairs
export const COHERENCE_PAIRS = [
  // Interhemispheric
  { ch1: 'Fp1', ch2: 'Fp2', type: 'interhemispheric' as const },
  { ch1: 'F3', ch2: 'F4', type: 'interhemispheric' as const },
  { ch1: 'C3', ch2: 'C4', type: 'interhemispheric' as const },
  { ch1: 'P3', ch2: 'P4', type: 'interhemispheric' as const },
  { ch1: 'O1', ch2: 'O2', type: 'interhemispheric' as const },
  { ch1: 'T7', ch2: 'T8', type: 'interhemispheric' as const },
  // Long-range
  { ch1: 'F3', ch2: 'P3', type: 'long_range' as const },
  { ch1: 'F3', ch2: 'O1', type: 'long_range' as const },
  { ch1: 'F4', ch2: 'P4', type: 'long_range' as const },
  { ch1: 'F4', ch2: 'O2', type: 'long_range' as const },
  { ch1: 'Fz', ch2: 'Pz', type: 'long_range' as const },
  { ch1: 'Cz', ch2: 'Pz', type: 'long_range' as const },
];

// Regional Channel Groups
export const REGIONAL_CHANNELS = {
  frontal: ['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8'],
  central: ['C3', 'Cz', 'C4'],
  parietal: ['P7', 'P3', 'Pz', 'P4', 'P8'],
  occipital: ['O1', 'O2'],
  temporal: ['T7', 'T8'],
};

// Preprocessing Defaults
export const DEFAULT_PREPROCESSING_CONFIG = {
  resample_freq: 250,
  filter_low: 0.5,
  filter_high: 45,
  notch_freq: 60,
  ica_enabled: true,
  ica_method: 'fastica' as const,
  ica_n_components: 19,
  artifact_threshold: 0.7,
  epoch_length: 2,
  epoch_overlap: 0.5,
};

// Feature Extraction Defaults
export const DEFAULT_FEATURE_CONFIG = {
  bands: DEFAULT_BANDS,
  coherence_pairs: COHERENCE_PAIRS,
  compute_lzc: true,
  compute_asymmetry: true,
};

// Rule Engine Defaults
export const DEFAULT_RULE_CONFIG = {
  enabled: true,
  percentile_high: 90,
  percentile_low: 10,
};

// Default Analysis Config
export const DEFAULT_ANALYSIS_CONFIG = {
  preprocessing: DEFAULT_PREPROCESSING_CONFIG,
  features: DEFAULT_FEATURE_CONFIG,
  rules: DEFAULT_RULE_CONFIG,
};

// Storage Buckets
export const STORAGE_BUCKETS = {
  recordings: 'recordings',
  visuals: 'visuals',
  exports: 'exports',
};

// Queue Configuration
export const QUEUE_CONFIG = {
  max_retries: 3,
  retry_delay: 5000,
  timeout: 600000, // 10 minutes
};

// Risk Pattern Configurations
export const RISK_PATTERNS = [
  'adhd_like',
  'anxiety_like',
  'depression_like',
  'sleep_dysregulation',
  'hyper_arousal',
] as const;

// Export Types
export const EXPORT_TYPES = ['pdf', 'json', 'png', 'zip'] as const;

// Status Messages
export const STATUS_MESSAGES = {
  pending: 'Analysis queued',
  processing: 'Processing EEG data',
  completed: 'Analysis complete',
  failed: 'Analysis failed',
};

// Color Schemes for Bands
export const BAND_COLORS = {
  delta: '#7C3AED',
  theta: '#3B82F6',
  alpha1: '#06B6D4',
  alpha2: '#14B8A6',
  smr: '#10B981',
  beta2: '#F59E0B',
  hibeta: '#F97316',
  lowgamma: '#EF4444',
};
