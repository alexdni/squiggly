// Database Schema Types for Supabase

export type ProjectRole = 'owner' | 'collaborator' | 'viewer';

export type AnalysisStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  role: ProjectRole;
  created_at: string;
}

export interface Recording {
  id: string;
  project_id: string;
  filename: string;
  file_path: string;
  file_size: number;
  duration_seconds: number;
  sampling_rate: number;
  n_channels: number;
  montage: string;
  reference: string;
  eo_label: string;
  ec_label: string;
  eo_start: number | null;
  eo_end: number | null;
  ec_start: number | null;
  ec_end: number | null;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
}

export interface Analysis {
  id: string;
  recording_id: string;
  status: AnalysisStatus;
  config: AnalysisConfig;
  results: AnalysisResults | null;
  error_log: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnalysisConfig {
  preprocessing: {
    resample_freq: number;
    filter_low: number;
    filter_high: number;
    notch_freq: number | null;
    ica_enabled: boolean;
    ica_method: 'fastica' | 'infomax';
    ica_n_components: number;
    artifact_threshold: number;
    epoch_length: number;
    epoch_overlap: number;
  };
  features: {
    bands: BandDefinition[];
    coherence_pairs: CoherencePair[];
    compute_lzc: boolean;
    compute_asymmetry: boolean;
  };
  rules: {
    enabled: boolean;
    percentile_high: number;
    percentile_low: number;
  };
}

export interface BandDefinition {
  name: string;
  low: number;
  high: number;
}

export interface CoherencePair {
  ch1: string;
  ch2: string;
  type: 'interhemispheric' | 'long_range';
}

export interface AnalysisResults {
  qc: QualityControl;
  features: Features;
  visuals: VisualAssets;
  risks: RiskAssessment[];
}

export interface QualityControl {
  channels_dropped: string[];
  epochs_total: number;
  epochs_rejected: number;
  rejection_rate: number;
  ica_components: ICAComponent[];
  pre_ica_power: Record<string, number>;
  post_ica_power: Record<string, number>;
}

export interface ICAComponent {
  component_id: number;
  label: 'blink' | 'ecg' | 'emg' | 'motion' | 'brain' | 'unknown';
  confidence: number;
  dominant_frequency: number;
  kurtosis: number;
  variance_explained: number;
}

export interface Features {
  power: PowerFeatures;
  coherence: CoherenceFeatures;
  complexity: ComplexityFeatures;
  asymmetry: AsymmetryFeatures;
  reactivity: ReactivityFeatures;
}

export interface PowerFeatures {
  absolute: Record<string, BandPower>;
  relative: Record<string, BandPower>;
  ratios: {
    theta_beta: Record<string, number>;
    theta_alpha: Record<string, number>;
    slowing_index: Record<string, number>;
  };
  apf: {
    eo: Record<string, number>;
    ec: Record<string, number>;
  };
  alpha_blocking: Record<string, number>;
  smr: {
    eo: Record<string, number>;
    ec: Record<string, number>;
  };
  regional: {
    frontal: BandPower;
    central: BandPower;
    parietal: BandPower;
    occipital: BandPower;
    temporal: BandPower;
  };
}

export interface BandPower {
  delta: Record<string, number>;
  theta: Record<string, number>;
  alpha1: Record<string, number>;
  alpha2: Record<string, number>;
  smr: Record<string, number>;
  beta2: Record<string, number>;
  hibeta: Record<string, number>;
  lowgamma: Record<string, number>;
}

export interface CoherenceFeatures {
  magnitude_squared: Record<string, CoherencePairValue>;
  hyper_flags: string[];
  hypo_flags: string[];
}

export interface CoherencePairValue {
  eo: Record<string, number>;
  ec: Record<string, number>;
  delta: Record<string, number>;
}

export interface ComplexityFeatures {
  lzc: {
    eo: Record<string, number>;
    ec: Record<string, number>;
    delta: Record<string, number>;
  };
  gradients: {
    anterior_posterior: number;
  };
}

export interface AsymmetryFeatures {
  pai: {
    eo: Record<string, Record<string, number>>;
    ec: Record<string, Record<string, number>>;
  };
  faa: {
    eo: number;
    ec: number;
  };
  alpha_gradient: {
    eo: number;
    ec: number;
  };
}

export interface ReactivityFeatures {
  absolute_change: Record<string, Record<string, number>>;
  percent_change: Record<string, Record<string, number>>;
}

export interface VisualAssets {
  topomaps: Record<string, string>;
  spectrograms: Record<string, string>;
  coherence_matrices: Record<string, string>;
  ratio_charts: Record<string, string>;
  apf_chart: string;
  alpha_blocking_gauge: string;
  qc_dashboard: string;
}

export interface RiskAssessment {
  pattern: 'adhd_like' | 'anxiety_like' | 'depression_like' | 'sleep_dysregulation' | 'hyper_arousal';
  level: 'low' | 'medium' | 'high';
  confidence: number;
  criteria_met: string[];
  trace: RiskTrace[];
}

export interface RiskTrace {
  criterion: string;
  value: number;
  threshold: number;
  met: boolean;
}

export interface ExportLog {
  id: string;
  analysis_id: string;
  export_type: 'pdf' | 'json' | 'png' | 'zip';
  file_path: string;
  exported_by: string;
  created_at: string;
}

// Database interface for type-safe queries
export interface Database {
  public: {
    Tables: {
      projects: {
        Row: Project;
        Insert: Omit<Project, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Project, 'id' | 'created_at' | 'updated_at'>>;
      };
      project_members: {
        Row: ProjectMember;
        Insert: Omit<ProjectMember, 'id' | 'created_at'>;
        Update: Partial<Omit<ProjectMember, 'id' | 'created_at'>>;
      };
      recordings: {
        Row: Recording;
        Insert: Omit<Recording, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Recording, 'id' | 'created_at' | 'updated_at'>>;
      };
      analyses: {
        Row: Analysis;
        Insert: Omit<Analysis, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Analysis, 'id' | 'created_at' | 'updated_at'>>;
      };
      export_logs: {
        Row: ExportLog;
        Insert: Omit<ExportLog, 'id' | 'created_at'>;
        Update: Partial<Omit<ExportLog, 'id' | 'created_at'>>;
      };
    };
  };
}
