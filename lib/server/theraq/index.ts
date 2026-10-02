import 'server-only';
/**
 * Server-side TheraQ four-phase comparison (port of the Python worker's
 * theraq_metrics.py + theraq_analyze.py).
 *
 * Educational/research use only — non-diagnostic.
 */

export {
  analyzeTheraq,
  adaptiveRejectEpochs,
  TheraqAnalysisError,
  DEFAULT_MIN_CLEAN_EPOCHS,
  DEFAULT_REJECT_MAD_K,
  type AnalyzeTheraqOptions,
  type AdaptiveRejection,
} from './analyze';
export {
  computeTheraqMetrics,
  TheraqEngine,
  THERAQ_DEFINITIONS,
  INDEX_KEYS,
  type ConditionSpectra,
  type TheraqDefinitions,
  type TheraqMetricDef,
  type TheraqMetricsOutput,
} from './engine';
export { computeAmplitudeSpectrum, SPECTRUM_DOMAIN, type PhaseEpochs } from './spectrum';
export type { TheraqResults as TheraqResult } from '@/lib/theraq';
