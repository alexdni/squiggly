export interface EpochSet {
  sfreq: number;
  channels: string[];
  /** [epoch][channel] samples in µV, all epochs equal length */
  epochs: Float64Array[][];
}

export function epochLength(set: EpochSet): number {
  return set.epochs.length ? set.epochs[0][0].length : 0;
}

// Channel groups and pairs from api/workers/extract_features.py (insertion order matters for
// output key order and for which pairs are reported).
export const CHANNEL_GROUPS = {
  frontal: ['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8'],
  central: ['C3', 'Cz', 'C4'],
  temporal: ['T7', 'T8'],
  parietal: ['P7', 'P3', 'Pz', 'P4', 'P8'],
  occipital: ['O1', 'O2'],
  left: ['Fp1', 'F7', 'F3', 'T7', 'C3', 'P7', 'P3', 'O1'],
  right: ['Fp2', 'F8', 'F4', 'T8', 'C4', 'P8', 'P4', 'O2'],
} as const;

export const ASYMMETRY_PAIRS: Record<string, [string, string]> = {
  frontal_alpha: ['F3', 'F4'],
  parietal_alpha: ['P3', 'P4'],
  frontal_theta: ['F3', 'F4'],
};

export const INTERHEMISPHERIC_PAIRS: [string, string][] = [
  ['Fp1', 'Fp2'],
  ['F7', 'F8'],
  ['F3', 'F4'],
  ['T7', 'T8'],
  ['C3', 'C4'],
  ['P7', 'P8'],
  ['P3', 'P4'],
  ['O1', 'O2'],
];

// The Python worker ran on MNE data in volts and compared some sums against absolute epsilons.
// Inputs here are µV, so those epsilons are rescaled to keep the same behaviour.
/** 1e-20 V²/Hz (CSD wPLI denominator floor) in µV²/Hz */
export const CSD_WPLI_EPS = 1e-20 * 1e12;
/** 1e-10 V² (Hilbert wPLI denominator floor) in µV² */
export const HILBERT_WPLI_EPS = 1e-10 * 1e12;
