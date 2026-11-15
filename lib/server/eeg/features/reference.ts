import { LAPLACIAN_NEIGHBOURS } from '@/lib/eeg-labels';
import { epochLength, type EpochSet } from './types';

const NEIGHBOURS: Record<string, readonly string[]> = LAPLACIAN_NEIGHBOURS;
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
