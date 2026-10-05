/**
 * TheraQ Four-Phase Comparison — shared constants, types, and helpers.
 *
 * TheraQ compares four within-subject recording phases (EO1, EC, EO2, TASK)
 * and rolls comparative metrics into four dysregulation indices. The canonical
 * metric/norm/index math lives server-side in lib/server/theraq; this module
 * holds the shared phase model, types for the results JSON, and presentation helpers.
 *
 * Educational/research use only — non-diagnostic.
 */

export const THERAQ_PHASES = ['EO1', 'EC', 'EO2', 'TASK'] as const;
export type TheraqPhase = (typeof THERAQ_PHASES)[number];

// Map a project phase to the TheraQ internal condition key used in the spectra.
export const THERAQ_PHASE_TO_CONDITION: Record<TheraqPhase, string> = {
  EO1: 'eo1',
  EC: 'ec',
  EO2: 'eo2',
  TASK: 'eoload',
};

export const THERAQ_PHASE_LABELS: Record<TheraqPhase, string> = {
  EO1: 'Eyes Open (baseline)',
  EC: 'Eyes Closed',
  EO2: 'Eyes Open (re-test)',
  TASK: 'Under Task (cognitive load)',
};

// TheraQ operative band edges (Hz). These intentionally differ from the
// platform's DEFAULT_BANDS to reproduce TheraQ metric values faithfully.
export const THERAQ_BANDS = {
  theta: [3.5, 7.5] as [number, number],
  alpha: [7.5, 12.5] as [number, number],
  beta: [15.5, 25.5] as [number, number],
  alphaPeakSearch: [7, 13] as [number, number],
};

// Channels required at every phase for the TheraQ metrics to be computable.
export const THERAQ_REQUIRED_CHANNELS = ['O1', 'Cz', 'F3', 'F4'];

export const THERAQ_DISCLAIMER =
  'Educational and research use only. TheraQ comparative metrics are not a ' +
  'medical diagnosis and must not be used for clinical decision-making.';

/**
 * Infer the TheraQ phase from a recording filename. Order matters: TASK and EO2
 * tokens are checked before the generic eyes-open match because the test files
 * (e.g. "eyes_open_under_load.edf", "eyes_open_2.edf") also contain "open".
 */
export function detectTheraqPhase(filename: string): TheraqPhase | null {
  const f = filename.toLowerCase();

  if (/under[\s_-]?load|cognitive|task|load/.test(f)) return 'TASK';
  if (/closed|\bec\b|eyes[\s_-]?closed/.test(f)) return 'EC';
  if (/(open|eo)[\s_-]?2|second|re[\s_-]?test|retest/.test(f)) return 'EO2';
  if (/open|\beo\b|baseline|resting|\b1\b/.test(f)) return 'EO1';
  return null;
}

export const THERAQ_INDEX_LABELS: Record<string, string> = {
  emotional_dysregulation: 'Emotional Dysregulation',
  cognitive_performance: 'Cognitive Performance',
  stress_trauma: 'Potential Stress / Trauma Markers',
  sleep_dysregulation: 'Sleep Dysregulation',
};

export type TheraqColour = 'green' | 'yellow' | 'red';

export interface TheraqNormRange {
  range: [number, number];
  colour: TheraqColour;
}

export interface TheraqMetricResult {
  name: string;
  value: number | null;
  display: 'percent' | 'decimal' | 'dial';
  colour: TheraqColour | null;
  norms: Array<TheraqNormRange | { range: [number, number]; direction: string }>;
  tags: string[];
  unavailable_reason?: string;
}

export interface TheraqIndexResult {
  name: string;
  score: number | null;
  colour: TheraqColour | null;
  metrics: string[];
}

export interface TheraqPhaseQC {
  clean_epochs: number;
  total_epochs: number;
  artifact_rejection_rate: number;
  adaptive_threshold_uv?: number | null;
  bad_channels: string[];
}

export interface TheraqResults {
  phases: Record<string, TheraqPhaseQC>;
  spectra: Record<string, Record<string, number[]>>;
  spectra_domain?: number[];
  /** Channels present in all four phases (the set the metrics were computed on). */
  channel_names?: string[];
  metrics: TheraqMetricResult[];
  indices: Record<string, TheraqIndexResult>;
  disclaimer: string;
  processing_metadata?: Record<string, unknown>;
}

export interface ProjectAnalysis {
  id: string;
  project_id: string;
  kind: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  phase_map: Partial<Record<TheraqPhase, string>>;
  config: Record<string, unknown>;
  results: TheraqResults | null;
  error_log: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export const THERAQ_COLOUR_HEX: Record<TheraqColour, string> = {
  green: '#16A34A',
  yellow: '#D97706',
  red: '#DC2626',
};
