// Artifact-settings form state and processing-status helpers for AnalysisDetailsClient. Kept free
// of React/DOM so they can be unit-tested.

import { ARTIFACT_PROFILES, DEFAULT_PREPROCESSING_CONFIG } from '@/lib/constants';

export type ArtifactProfileName = (typeof ARTIFACT_PROFILES)[number];

export const PROFILE_DESCRIPTIONS: Record<ArtifactProfileName, { label: string; description: string }> = {
  full: { label: 'Full', description: 'Channel QC + ASR + ICA + adaptive epoch rejection (recommended)' },
  conservative: { label: 'Conservative', description: 'Gentler ASR (k = 30); removes at most 2 ICA components' },
  aggressive: { label: 'Aggressive', description: 'Stronger ASR (k = 10) for noisy recordings' },
  rejectionOnly: { label: 'Rejection only', description: 'No ASR or ICA; bad epochs are rejected only' },
  legacy: { label: 'Legacy', description: 'Original 160 µV peak-to-peak gate only' },
};

/** ASR cutoff each profile uses when `asr_k` is null; null where the profile runs no ASR. */
export const PROFILE_ASR_K: Record<ArtifactProfileName, number | null> = {
  full: 20,
  conservative: 30,
  aggressive: 10,
  rejectionOnly: null,
  legacy: null,
};

export const SETTING_LIMITS = {
  rejection_threshold_uv: { min: 20, max: 500 },
  asr_k: { min: 5, max: 100 },
} as const;

export interface ArtifactSettings {
  artifact_mode: 'pipeline' | 'manual';
  profile: ArtifactProfileName;
  rejection_threshold_uv: number;
  /** null = the profile's own ASR cutoff */
  asr_k: number | null;
  line_freq: 50 | 60;
}

/** Python-era keys dropped when a config is re-saved with the new settings. */
const LEGACY_PREPROCESSING_KEYS = ['ica_method', 'sobi_delta_threshold', 'sobi_hf_threshold', 'sobi_frontal_corr'];

const isProfile = (v: unknown): v is ArtifactProfileName =>
  typeof v === 'string' && (ARTIFACT_PROFILES as readonly string[]).includes(v);

/** Clamps to the allowed range; a blank/invalid entry falls back to the default (null for ASR k = profile default). */
export function clampSetting(key: 'rejection_threshold_uv', value: number | null | undefined): number;
export function clampSetting(key: 'asr_k', value: number | null | undefined): number | null;
export function clampSetting(key: keyof typeof SETTING_LIMITS, value: number | null | undefined): number | null {
  const { min, max } = SETTING_LIMITS[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_PREPROCESSING_CONFIG[key];
  return Math.min(max, Math.max(min, value));
}

/** Form state from a stored preprocessing config. Legacy `artifact_mode: 'ica'` maps to the pipeline. */
export function settingsFromConfig(pre: Record<string, unknown> | null | undefined): ArtifactSettings {
  const p = pre ?? {};
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return {
    artifact_mode: p.artifact_mode === 'manual' ? 'manual' : 'pipeline',
    profile: isProfile(p.profile) ? p.profile : DEFAULT_PREPROCESSING_CONFIG.profile,
    rejection_threshold_uv: clampSetting(
      'rejection_threshold_uv',
      num(p.rejection_threshold_uv, DEFAULT_PREPROCESSING_CONFIG.rejection_threshold_uv)
    ),
    asr_k: clampSetting('asr_k', typeof p.asr_k === 'number' ? p.asr_k : null),
    line_freq: p.line_freq === 50 || p.line_freq === 60 ? p.line_freq : DEFAULT_PREPROCESSING_CONFIG.line_freq,
  };
}

/** Preprocessing config to PATCH: existing keys kept, legacy ICA/SOBI keys removed, settings applied. */
export function buildPreprocessingConfig(
  existing: Record<string, unknown> | null | undefined,
  settings: ArtifactSettings
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...DEFAULT_PREPROCESSING_CONFIG, ...(existing ?? {}) };
  for (const k of LEGACY_PREPROCESSING_KEYS) delete out[k];
  return {
    ...out,
    artifact_mode: settings.artifact_mode,
    profile: settings.profile,
    rejection_threshold_uv: clampSetting('rejection_threshold_uv', settings.rejection_threshold_uv),
    asr_k: clampSetting('asr_k', settings.asr_k),
    line_freq: settings.line_freq,
  };
}

// ── processing status ──────────────────────────────────────────────────────
export const STALE_PROCESSING_MS = 10 * 60 * 1000;
export const POLL_INTERVAL_MS = 2000;
/** Client stops polling after this long and treats the job as stalled. */
export const MAX_POLL_MS = 10 * 60 * 1000;

/**
 * A `processing` analysis whose job started (or whose row last changed) more than 10 minutes ago
 * is treated as failed: the server job is bounded by maxDuration, so it will not finish.
 */
export function isProcessingStale(
  analysis: { status: string; started_at?: string | null; updated_at?: string | null },
  now: number = Date.now()
): boolean {
  if (analysis.status !== 'processing') return false;
  const stamp = analysis.started_at ?? analysis.updated_at;
  if (!stamp) return false;
  const t = Date.parse(stamp);
  return Number.isFinite(t) && now - t > STALE_PROCESSING_MS;
}

export const PHYSIOLOGICAL_PATH_LABELS: Record<string, string> = {
  ica: 'ICA',
  blinkRegression: 'Blink regression',
  skipped: 'Skipped',
};

export const LEGACY_ICA_METHOD_LABELS: Record<string, string> = {
  sobi: 'SOBI',
  infomax: 'Extended Infomax',
  picard: 'Picard',
  fastica: 'FastICA',
};

/** Which processing engine produced an analysis: the server ASR + ICA pipeline, or the former Python worker. */
export function engineFamily(engine: string | null | undefined): 'hybrid' | 'python' {
  return engine ? 'hybrid' : 'python';
}

export function engineLabel(engine: string | null | undefined): string {
  return engineFamily(engine) === 'hybrid' ? 'Hybrid ASR + ICA pipeline' : 'Python worker (legacy)';
}
