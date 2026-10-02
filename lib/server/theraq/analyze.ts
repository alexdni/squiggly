/**
 * TheraQ four-phase analysis. Port of the non-IO logic of
 * api/workers/theraq_analyze.py: adaptive epoch rejection, per-phase QC and
 * channel checks, amplitude spectra, metric evaluation and result assembly.
 * The caller supplies already-cleaned epochs per phase and persists the result.
 *
 * Educational/research use only — non-diagnostic.
 */

import {
  THERAQ_BANDS,
  THERAQ_DISCLAIMER,
  THERAQ_PHASES,
  THERAQ_PHASE_TO_CONDITION,
  THERAQ_REQUIRED_CHANNELS,
  type TheraqPhase,
  type TheraqPhaseQC,
  type TheraqResults,
} from '@/lib/theraq';
import { computeTheraqMetrics, type ConditionSpectra } from './engine';
import { median, pyRound } from './numeric';
import { computeAmplitudeSpectrum, SPECTRUM_DOMAIN, type PhaseEpochs } from './spectrum';

export const DEFAULT_MIN_CLEAN_EPOCHS = 5;
/** Robust outlier cutoff: median + k * 1.4826 * MAD. */
export const DEFAULT_REJECT_MAD_K = 5.0;

export interface AnalyzeTheraqOptions {
  /** Minimum epochs surviving adaptive rejection per phase (default 5). */
  minCleanEpochs?: number;
  /** k in median + k * 1.4826 * MAD (default 5). */
  rejectMadK?: number;
  /** Recorded in processing_metadata.artifact_mode (default 'ica'). */
  artifactMode?: string;
  /** Recorded in processing_metadata.engine (default 'node'). */
  engine?: string;
}

/** Thrown for input problems that should fail the analysis with a user-facing message. */
export class TheraqAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TheraqAnalysisError';
  }
}

export interface AdaptiveRejection {
  kept: Float64Array[][];
  keptIndices: number[];
  /** Threshold in the epochs' unit (µV); null when there are no epochs. */
  threshold: number | null;
}

/**
 * Scale-invariant epoch rejection. TheraQ metrics are ratios, so recordings
 * arrive at very different amplitude scales; a fixed µV peak-to-peak threshold
 * would reject every epoch on some devices. Epochs whose worst-channel
 * peak-to-peak exceeds `median + k * 1.4826 * MAD` of the recording's own
 * epochs are dropped. If MAD is 0 all epochs are kept (threshold = median).
 */
export function adaptiveRejectEpochs(
  epochs: Float64Array[][],
  madK: number = DEFAULT_REJECT_MAD_K,
): AdaptiveRejection {
  if (epochs.length === 0) return { kept: epochs, keptIndices: [], threshold: null };
  const p2p = epochs.map((epoch) => {
    let worst = -Infinity;
    for (const ch of epoch) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of ch) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo > worst) worst = hi - lo;
    }
    return worst;
  });
  const med = median(p2p);
  const mad = median(p2p.map((v) => Math.abs(v - med)));
  if (mad <= 0) return { kept: epochs, keptIndices: epochs.map((_, i) => i), threshold: med };
  const thr = med + madK * 1.4826 * mad;
  const keptIndices = p2p.flatMap((v, i) => (v <= thr ? [i] : []));
  return { kept: keptIndices.map((i) => epochs[i]), keptIndices, threshold: thr };
}

const pyList = (items: string[]) => `[${items.map((s) => `'${s}'`).join(', ')}]`;

/**
 * Compute a TheraQ four-phase analysis from cleaned epochs (µV) per phase.
 * Returns the object stored in project_analyses.results.
 *
 * @throws TheraqAnalysisError if a phase is missing, has too few clean epochs,
 *   or lacks a required channel (messages match the Python worker).
 */
export function analyzeTheraq(
  phases: Partial<Record<TheraqPhase, PhaseEpochs>>,
  opts: AnalyzeTheraqOptions = {},
): TheraqResults {
  const minEpochs = Math.trunc(opts.minCleanEpochs ?? DEFAULT_MIN_CLEAN_EPOCHS);
  const madK = opts.rejectMadK ?? DEFAULT_REJECT_MAD_K;
  const artifactMode = opts.artifactMode ?? 'ica';

  const missing = THERAQ_PHASES.filter((p) => !phases[p]);
  if (missing.length > 0) {
    throw new TheraqAnalysisError(`Missing phase recordings: ${missing.join(', ')}`);
  }

  const startTime = performance.now();
  const phaseQc: Record<string, TheraqPhaseQC> = {};
  const spectrumByPhase = {} as Record<TheraqPhase, Record<string, number[]>>;

  for (const phase of THERAQ_PHASES) {
    const input = phases[phase]!;
    if (input.epochs.length === 0) {
      throw new TheraqAnalysisError(`Phase ${phase}: no epochs could be formed from the recording`);
    }

    const totalEpochs = input.epochs.length;
    const { kept, threshold } = adaptiveRejectEpochs(input.epochs, madK);
    const clean = kept.length;
    if (clean < minEpochs) {
      throw new TheraqAnalysisError(
        `Phase ${phase}: only ${clean} of ${totalEpochs} epochs survived ` +
          `adaptive rejection (minimum ${minEpochs} required)`,
      );
    }

    const missingCh = THERAQ_REQUIRED_CHANNELS.filter((c) => !input.channels.includes(c));
    if (missingCh.length > 0) {
      throw new TheraqAnalysisError(`Phase ${phase}: missing required channels ${pyList(missingCh)}`);
    }

    spectrumByPhase[phase] = computeAmplitudeSpectrum({ ...input, epochs: kept });

    const rejectionRate = totalEpochs ? ((totalEpochs - clean) / totalEpochs) * 100 : 0;
    phaseQc[phase] = {
      clean_epochs: clean,
      total_epochs: totalEpochs,
      artifact_rejection_rate: pyRound(rejectionRate, 1),
      adaptive_threshold_uv: threshold ? pyRound(threshold, 1) : null,
      bad_channels: input.badChannels ?? [],
    };
  }

  // EO1 channel order is canonical; keep channels present in every phase so the
  // engine indexes consistently.
  const commonChannels = Object.keys(spectrumByPhase.EO1).filter((ch) =>
    THERAQ_PHASES.every((p) => ch in spectrumByPhase[p]),
  );
  for (const required of THERAQ_REQUIRED_CHANNELS) {
    if (!commonChannels.includes(required)) {
      throw new TheraqAnalysisError(`Channel '${required}' is not present across all four phases`);
    }
  }

  const spectra: ConditionSpectra = {};
  const spectraForResults: Record<string, Record<string, number[]>> = {};
  for (const phase of THERAQ_PHASES) {
    const condition = THERAQ_PHASE_TO_CONDITION[phase];
    spectra[condition] = commonChannels.map((ch) => spectrumByPhase[phase][ch]);
    spectraForResults[condition] = spectrumByPhase[phase];
  }

  const { metrics, indices } = computeTheraqMetrics(commonChannels, spectra, SPECTRUM_DOMAIN);

  return {
    phases: phaseQc,
    spectra: spectraForResults,
    spectra_domain: [...SPECTRUM_DOMAIN],
    channel_names: commonChannels,
    metrics,
    indices,
    disclaimer: THERAQ_DISCLAIMER,
    processing_metadata: {
      engine: opts.engine ?? 'node',
      theraq_bands: {
        theta: THERAQ_BANDS.theta,
        alpha: THERAQ_BANDS.alpha,
        beta: THERAQ_BANDS.beta,
        alpha_peak_search: THERAQ_BANDS.alphaPeakSearch,
      },
      min_clean_epochs: minEpochs,
      artifact_mode: artifactMode,
      rejection: `adaptive (median + ${madK.toFixed(1)}*MAD, scale-invariant)`,
      processing_time_seconds: pyRound((performance.now() - startTime) / 1000, 1),
    },
  };
}
