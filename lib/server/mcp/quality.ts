// Data-quality block and confidence grading from the analysis QC report.

import type { QcReportSummary } from '@/lib/analysis-results';

export type Confidence = 'high' | 'moderate' | 'low';

export interface QualityBlock {
  rejection_pct: number;
  epochs_kept: { eo?: number; ec?: number };
  bad_channels: string[];
  interpolated_channels: string[];
  ica_components_removed: number;
  ica_removed_labels: string[];
  asr_applied: boolean;
  warnings: string[];
  confidence: Confidence;
  reasons: string[];
}

const ORDER: Confidence[] = ['low', 'moderate', 'high'];

const MAX_REJECTION_PCT = 30;
const MAX_BAD_CHANNEL_FRACTION = 0.15;
const MIN_CLEAN_EPOCHS = 20;
const MAX_ICA_COMPONENTS = 5;

export function worse(a: Confidence, b: Confidence): Confidence {
  return ORDER[Math.min(ORDER.indexOf(a), ORDER.indexOf(b))];
}

export function stepDown(c: Confidence): Confidence {
  return ORDER[Math.max(ORDER.indexOf(c) - 1, 0)];
}

/** Python-era analyses have no engine stamp and an older result shape. */
export function isLegacyResults(r: unknown): boolean {
  if (!r || typeof r !== 'object') return false;
  const res = r as Record<string, unknown>;
  const meta = res.processing_metadata as { engine?: unknown } | undefined;
  if (meta?.engine) return false;
  const visuals = res.visuals;
  if (visuals && typeof visuals === 'object' && Object.keys(visuals).length > 0) return true;
  if (res.coherence && !res.connectivity) return true;
  const qc = res.qc_report as { final_epochs_eo?: unknown } | undefined;
  return typeof qc?.final_epochs_eo !== 'number';
}

export function qualityBlock(qc: QcReportSummary, condition?: 'eo' | 'ec'): QualityBlock {
  const reasons: string[] = [];
  let confidence: Confidence = 'high';

  const condRate = condition === 'eo' ? qc.eo_rejection_rate : condition === 'ec' ? qc.ec_rejection_rate : undefined;
  const rejection = typeof condRate === 'number' ? condRate : qc.artifact_rejection_rate;

  const epochs_kept: { eo?: number; ec?: number } = condition
    ? { [condition]: condition === 'eo' ? qc.final_epochs_eo : qc.final_epochs_ec }
    : { eo: qc.final_epochs_eo, ec: qc.final_epochs_ec };

  const bad_channels = qc.bad_channels ?? [];

  if (rejection > MAX_REJECTION_PCT) {
    confidence = 'low';
    reasons.push(`${round(rejection)}% of epochs rejected (over ${MAX_REJECTION_PCT}%)`);
  }
  if (qc.n_channels > 0 && bad_channels.length / qc.n_channels > MAX_BAD_CHANNEL_FRACTION) {
    confidence = 'low';
    reasons.push(
      `${bad_channels.length} of ${qc.n_channels} channels marked bad (over ${MAX_BAD_CHANNEL_FRACTION * 100}%)`,
    );
  }

  // Without a condition, an empty side (e.g. EO-only file) is not "few epochs"
  const considered = (['eo', 'ec'] as const).filter((c) => (condition ? c === condition : (epochs_kept[c] ?? 0) > 0));
  for (const c of considered) {
    const n = epochs_kept[c] ?? 0;
    if (n < MIN_CLEAN_EPOCHS) {
      if (confidence === 'high') confidence = 'moderate';
      reasons.push(`Only ${n} clean ${c.toUpperCase()} epochs (fewer than ${MIN_CLEAN_EPOCHS})`);
    }
  }

  if (qc.ica_components_removed > MAX_ICA_COMPONENTS) {
    reasons.push(`${qc.ica_components_removed} ICA components removed (more than ${MAX_ICA_COMPONENTS}); ICA can distort signal`);
  }

  return {
    rejection_pct: rejection,
    epochs_kept,
    bad_channels,
    interpolated_channels: qc.interpolated_channels ?? [],
    ica_components_removed: qc.ica_components_removed,
    ica_removed_labels: qc.ica_removed_labels ?? [],
    asr_applied: qc.asr?.ran === true,
    warnings: qc.warnings ?? [],
    confidence,
    reasons,
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
