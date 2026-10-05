// EEG feature extraction, ported from api/workers/extract_features.py. Output shape and units
// match the Python worker (µV² band power, Hz, wPLI in [0, 1]); see the parity tests under
// __tests__ for the tolerances against fixtures produced by the Python code.

import type { AnalysisResults } from '@/lib/analysis-results';
import { computeAlphaPeak } from './alphaPeak';
import { computeBandPower } from './bandPower';
import { computeConnectivity } from './connectivity';
import { computeAsymmetry, computeBandRatios, detectRiskPatterns } from './derived';
import { computeLzc } from './lzc';
import type { EpochSet } from './types';

export type { EpochSet } from './types';
export { computeSpectrograms } from './spectrogram';

export type ExtractedFeatures = Pick<
  AnalysisResults,
  'band_power' | 'connectivity' | 'lzc' | 'alpha_peak' | 'band_ratios' | 'asymmetry' | 'risk_patterns'
>;

function validate(set: EpochSet, label: string): void {
  if (!(set.sfreq > 0)) throw new Error(`${label}: sfreq must be positive`);
  if (set.epochs.length === 0) throw new Error(`${label}: no epochs`);
  const n = set.epochs[0][0]?.length ?? 0;
  for (const epoch of set.epochs) {
    if (epoch.length !== set.channels.length) throw new Error(`${label}: epoch channel count mismatch`);
    for (const ch of epoch) if (ch.length !== n) throw new Error(`${label}: epochs must have equal length`);
  }
}

/**
 * Features for the eyes-open and eyes-closed epoch sets (either may be null, not both).
 * Ratios, asymmetry and risk patterns use EC band power when available, otherwise EO.
 */
export function extractFeatures(eo: EpochSet | null, ec: EpochSet | null): ExtractedFeatures {
  if (!eo && !ec) throw new Error('At least one of eo or ec epochs must be provided');
  if (eo) validate(eo, 'eo');
  if (ec) validate(ec, 'ec');

  const perCondition = (set: EpochSet | null) =>
    set
      ? {
          band_power: computeBandPower(set),
          connectivity: computeConnectivity(set),
          lzc: computeLzc(set),
          alpha_peak: computeAlphaPeak(set),
        }
      : null;
  const fEo = perCondition(eo);
  const fEc = perCondition(ec);

  const primary = (fEc ?? fEo)!.band_power;
  const band_ratios = computeBandRatios(primary);
  const asymmetry = computeAsymmetry(primary);
  const risk_patterns = detectRiskPatterns(primary, band_ratios, asymmetry);

  return {
    band_power: { eo: fEo?.band_power ?? null, ec: fEc?.band_power ?? null },
    connectivity: { eo: fEo?.connectivity ?? null, ec: fEc?.connectivity ?? null },
    lzc: { eo: fEo?.lzc ?? null, ec: fEc?.lzc ?? null },
    alpha_peak: { eo: fEo?.alpha_peak ?? null, ec: fEc?.alpha_peak ?? null },
    band_ratios,
    asymmetry,
    risk_patterns,
  };
}
