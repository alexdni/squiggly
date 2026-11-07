import { epochLength, type EpochSet } from './types';

// Nearest 10-20 neighbours for the Hjorth Laplacian; the C and O sites match muBursts.ts
const NEIGHBOURS: Record<string, string[]> = {
  Fp1: ['Fp2', 'F7', 'F3'],
  Fp2: ['Fp1', 'F4', 'F8'],
  F7: ['Fp1', 'F3', 'T7'],
  F3: ['Fp1', 'F7', 'Fz', 'C3'],
  Fz: ['Fp1', 'Fp2', 'F3', 'F4', 'Cz'],
  F4: ['Fp2', 'Fz', 'F8', 'C4'],
  F8: ['Fp2', 'F4', 'T8'],
  T7: ['F7', 'C3', 'P7'],
  C3: ['F3', 'P3', 'T7', 'Cz'],
  Cz: ['Fz', 'C3', 'C4', 'Pz'],
  C4: ['F4', 'P4', 'T8', 'Cz'],
  T8: ['F8', 'C4', 'P8'],
  P7: ['T7', 'P3', 'O1'],
  P3: ['C3', 'P7', 'Pz', 'O1'],
  Pz: ['Cz', 'P3', 'P4', 'O1', 'O2'],
  P4: ['C4', 'Pz', 'P8', 'O2'],
  P8: ['T8', 'P4', 'O2'],
  O1: ['P3', 'Pz', 'P7', 'O2'],
  O2: ['P4', 'Pz', 'P8', 'O1'],
};
const MIN_NEIGHBOURS = 2;

/**
 * Hjorth surface Laplacian: each channel minus the mean of its neighbours. The weights sum to
 * zero, so the result does not depend on the reference. Channels in `exclude` get no value, since
 * an interpolated channel is itself built from its neighbours, but they still serve as neighbours.
 * Null when fewer than two channels can be derived.
 */
export function laplacianEpochs(set: EpochSet, exclude: readonly string[] = []): EpochSet | null {
  const index = new Map(set.channels.map((label, i) => [label, i]));
  const targets = set.channels.flatMap((label, i) => {
    const neighbours = (NEIGHBOURS[label] ?? []).flatMap((n) => index.get(n) ?? []);
    return neighbours.length >= MIN_NEIGHBOURS && !exclude.includes(label) ? [{ label, i, neighbours }] : [];
  });
  if (targets.length < 2) return null;
  const nTimes = epochLength(set);
  return {
    sfreq: set.sfreq,
    channels: targets.map((t) => t.label),
    epochs: set.epochs.map((epoch) =>
      targets.map(({ i, neighbours }) => {
        const out = new Float64Array(nTimes);
        for (let t = 0; t < nTimes; t++) {
          let sum = 0;
          for (const n of neighbours) sum += epoch[n][t];
          out[t] = epoch[i][t] - sum / neighbours.length;
        }
        return out;
      })
    ),
  };
}
