import type { AnalysisResults } from '@/lib/analysis-results';
import type { DEFAULT_PREPROCESSING_CONFIG } from '@/lib/constants';

export type { AnalysisResults } from '@/lib/analysis-results';
export type PreprocessingConfig = typeof DEFAULT_PREPROCESSING_CONFIG;

// Database Schema Types for Supabase

export type ProjectRole = 'owner' | 'collaborator' | 'viewer';

export type AnalysisStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type ConditionType = 'EO' | 'EC' | 'BOTH';

export type Gender = 'male' | 'female' | 'other' | 'unknown';

export interface ClientMetadata {
  diagnosis?: string;
  primary_issue?: string;
  secondary_issue?: string;
  gender?: Gender;
  age?: number;
  interventions?: string[];
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  client_metadata: ClientMetadata;
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
  condition_type: ConditionType;
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
  /** see DEFAULT_PREPROCESSING_CONFIG; Python-era rows may also carry ica_method / sobi_* keys */
  preprocessing: PreprocessingConfig & Record<string, unknown>;
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

export interface ExportLog {
  id: string;
  analysis_id: string;
  export_type: 'pdf' | 'json' | 'png' | 'zip';
  file_path: string;
  exported_by: string;
  created_at: string;
}

export interface ComparisonResult {
  recording_a_id: string;
  recording_b_id: string;
  power_deltas: {
    absolute: Record<string, Record<string, number>>;  // channel -> band -> delta (B - A)
    percent: Record<string, Record<string, number>>;   // channel -> band -> percent change (B - A)
  };
  coherence_deltas: Record<string, Record<string, number>>;  // pair -> band -> delta (B - A)
  asymmetry_deltas: {
    pai: Record<string, Record<string, number>>;  // pair -> band -> delta
    faa: number;
    alpha_gradient: number;
  };
  summary_metrics: {
    mean_alpha_change_percent: number;
    alpha_blocking_a: number;
    alpha_blocking_b: number;
    faa_shift: number;
    theta_beta_change: number;
  };
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
