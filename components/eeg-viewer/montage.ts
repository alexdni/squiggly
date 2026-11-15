// Viewer montages: every row on screen is a weighted sum of the file's channels, computed in the
// browser for the visible window. Nothing here changes an analysis.

import {
  BIPOLAR_CIRCUMFERENTIAL,
  BIPOLAR_LONGITUDINAL,
  BIPOLAR_TRANSVERSE,
  canonicalLabel,
  findEarChannels,
  findEarDifference,
  hemisphere,
  LAPLACIAN_NEIGHBOURS,
  referenceSuffix,
} from '@/lib/eeg-labels';

export const MONTAGE_GROUPS = [
  { label: 'Referential', montages: ['recorded', 'average', 'linked_ears', 'a1', 'a2', 'ipsilateral', 'contralateral', 'laplacian'] },
  { label: 'Bipolar', montages: ['bipolar', 'bipolar_transverse', 'bipolar_circumferential'] },
] as const;
export type FixedMontage = (typeof MONTAGE_GROUPS)[number]['montages'][number];
/** A fixed montage, or `ch:<label>`: every channel against one scalp electrode (`ch:Cz`). */
export type Montage = FixedMontage | `ch:${string}`;
export const MONTAGES: readonly FixedMontage[] = MONTAGE_GROUPS.flatMap((g) => [...g.montages]);

export const MONTAGE_LABELS: Record<FixedMontage, string> = {
  recorded: 'As recorded',
  average: 'Average',
  linked_ears: 'Linked ears',
  a1: 'Left ear (A1)',
  a2: 'Right ear (A2)',
  ipsilateral: 'Ipsilateral ears',
  contralateral: 'Contralateral ears',
  laplacian: 'Laplacian (Hjorth)',
  bipolar: 'Longitudinal (double banana)',
  bipolar_transverse: 'Transverse',
  bipolar_circumferential: 'Circumferential (hatband)',
};

const CHAINS: Partial<Record<FixedMontage, readonly (readonly [string, string])[]>> = {
  bipolar: BIPOLAR_LONGITUDINAL,
  bipolar_transverse: BIPOLAR_TRANSVERSE,
  bipolar_circumferential: BIPOLAR_CIRCUMFERENTIAL,
};

const isChannelMontage = (m: Montage): m is `ch:${string}` => m.startsWith('ch:');

export interface MontageRow {
  label: string;
  /** canonical label of the electrode the row belongs to, for event highlights; null for non-scalp rows */
  channel: string | null;
  /** [index into the file's channels, weight] */
  terms: [number, number][];
}

export function cleanChannelLabel(label: string): string {
  return label
    .replace(/^EEG\s+/i, '')
    .replace(/-(LE|REF|AVG|M1|M2)$/i, '')
    .trim();
}

type Term = [number, number];
type Ear = 'A1' | 'A2' | 'LE';

interface Layout {
  /** canonical scalp label per channel, null for ear / ECG / other channels */
  scalp: (string | null)[];
  index: Map<string, number>;
  /** every scalp channel is on linked ears: labelled so, or stated for the recording */
  linkedEars: boolean;
  /** separate ear leads on the file's reference: A1/A2 (or M1/M2), else the TP9/TP10 mastoid sites */
  ears: { a1: number; a2: number; mastoids: boolean } | null;
  /** a channel holding (A2−A1)/2 once multiplied by `w`: "A2-A1" (w ½), "A2-LE" (w 1), ... */
  halfDifference: { index: number; w: number } | null;
}

function layoutOf(channelNames: string[], recordedReference?: string | null): Layout {
  const scalp = channelNames.map((n) => canonicalLabel(n));
  const index = new Map<string, number>();
  scalp.forEach((label, i) => {
    if (label && !index.has(label)) index.set(label, i);
  });
  const suffixes = channelNames.filter((_, i) => scalp[i]).map((n) => referenceSuffix(n));
  const labelled = suffixes.length > 0 && suffixes.every((s) => s === 'LE');
  const plain = suffixes.every((s) => s === '');

  const leads = findEarChannels(channelNames);
  const [tp9, tp10] = [index.get('TP9'), index.get('TP10')];
  const ears = leads
    ? { ...leads, mastoids: false }
    : tp9 !== undefined && tp10 !== undefined
      ? { a1: tp9, a2: tp10, mastoids: true }
      : null;

  // An ear lead recorded against linked ears is half the ear difference: A2−LE = (A2−A1)/2
  const diff = findEarDifference(channelNames);
  let halfDifference: Layout['halfDifference'] = diff ? { index: diff.index, w: 0.5 * diff.sign } : null;
  if (!halfDifference) {
    channelNames.some((name, i) => {
      const m = name.trim().replace(/^EEG\s+/i, '').toUpperCase().match(/^([AM])([12])-LE$/);
      if (m) halfDifference = { index: i, w: m[2] === '2' ? 1 : -1 };
      return Boolean(m);
    });
  }
  return { scalp, index, linkedEars: labelled || (plain && recordedReference === 'LE'), ears, halfDifference };
}

/**
 * What to add to a scalp channel to put it on an ear reference, or null when the file cannot
 * give it. On a linked-ears file: X−A1 = X−LE + (A2−A1)/2 and X−A2 = X−LE − (A2−A1)/2. With
 * separate ear leads the difference X − ear does not depend on the file's reference.
 */
function earTerms(l: Layout, ear: Ear): Term[] | null {
  if (l.linkedEars) {
    if (ear === 'LE') return [];
    const h = l.halfDifference;
    return h ? [[h.index, ear === 'A1' ? h.w : -h.w]] : null;
  }
  if (!l.ears) return null;
  if (ear === 'LE') return [[l.ears.a1, -0.5], [l.ears.a2, -0.5]];
  return [[ear === 'A1' ? l.ears.a1 : l.ears.a2, -1]];
}

const MIN_NEIGHBOURS = 2;
const laplacianNeighbours = (label: string, l: Layout) =>
  (LAPLACIAN_NEIGHBOURS[label] ?? []).flatMap((n) => l.index.get(n) ?? []);

/** Scalp electrodes in the file, in file order: the choices for a one-electrode reference. */
export function referenceElectrodes(channelNames: string[]): string[] {
  return [...layoutOf(channelNames).index.keys()];
}

/** Why each montage cannot be shown for this file, or null when it can. */
export function montageAvailability(
  channelNames: string[],
  recordedReference?: string | null
): Record<FixedMontage, string | null> {
  const l = layoutOf(channelNames, recordedReference);
  const nScalp = l.index.size;
  const linkedEars = earTerms(l, 'LE')
    ? null
    : 'The file is not labelled linked ears and has no A1/A2 (or TP9/TP10) channels. If it was recorded on linked ears, set "Recorded as" in the analysis settings.';
  const singleEars =
    earTerms(l, 'A1') && earTerms(l, 'A2')
      ? null
      : l.linkedEars
        ? 'Needs an A2-A1 (or A2-LE) channel to separate the two ears'
        : 'Needs A1 and A2 (or TP9/TP10) channels, or a linked-ears file with an A2-A1 channel';
  const laplacianRows = [...l.index.keys()].filter((c) => laplacianNeighbours(c, l).length >= MIN_NEIGHBOURS).length;
  const chain = (m: FixedMontage) =>
    CHAINS[m]!.filter(([a, b]) => l.index.has(a) && l.index.has(b)).length >= 2
      ? null
      : 'Needs neighbouring 10-20 channels';
  return {
    recorded: null,
    average: nScalp >= 2 ? null : 'Needs at least two scalp channels',
    linked_ears: linkedEars,
    a1: singleEars,
    a2: singleEars,
    ipsilateral: singleEars,
    contralateral: singleEars,
    laplacian: laplacianRows >= 2 ? null : 'Needs neighbouring 10-20 channels',
    bipolar: chain('bipolar'),
    bipolar_transverse: chain('bipolar_transverse'),
    bipolar_circumferential: chain('bipolar_circumferential'),
  };
}

/** True when the montage can be drawn for this file. */
export function montageAvailable(montage: Montage, channelNames: string[], recordedReference?: string | null): boolean {
  if (isChannelMontage(montage)) {
    const l = layoutOf(channelNames);
    return l.index.has(montage.slice(3)) && l.index.size >= 2;
  }
  return !montageAvailability(channelNames, recordedReference)[montage];
}

/**
 * Rows to draw for a montage. `selected` are the file channels switched on, in display order;
 * non-scalp channels (ear leads, ECG) are passed through unchanged. An unavailable montage falls
 * back to the recording's own reference.
 */
export function buildMontage(
  montage: Montage,
  channelNames: string[],
  selected: number[],
  recordedReference?: string | null
): MontageRow[] {
  const l = layoutOf(channelNames, recordedReference);
  const row = (i: number, extra: Term[] = []): MontageRow => ({
    label: cleanChannelLabel(channelNames[i] ?? ''),
    channel: l.scalp[i],
    terms: [[i, 1], ...extra],
  });
  const asRecorded = () => selected.map((i) => row(i));
  if (montage === 'recorded' || !montageAvailable(montage, channelNames, recordedReference)) return asRecorded();
  const scalpSelected = selected.filter((i) => l.scalp[i]);
  const perScalp = (extra: (i: number) => Term[] | null) =>
    selected.flatMap((i) => {
      if (!l.scalp[i]) return [row(i)];
      const e = extra(i);
      return e ? [row(i, e)] : [];
    });

  if (isChannelMontage(montage)) {
    const ref = l.index.get(montage.slice(3))!;
    return perScalp((i) => (i === ref ? null : [[ref, -1]]));
  }

  const chain = CHAINS[montage];
  if (chain) {
    const on = new Set(selected);
    const pairs = chain.flatMap(([a, b]): MontageRow[] => {
      const i = l.index.get(a);
      const j = l.index.get(b);
      return i !== undefined && j !== undefined && on.has(i) && on.has(j)
        ? [{ label: `${a}-${b}`, channel: a, terms: [[i, 1], [j, -1]] }]
        : [];
    });
    return [...pairs, ...selected.filter((i) => !l.scalp[i]).map((i) => row(i))];
  }

  // an ear lead used as the reference is not drawn against itself
  const earRef = (ear: (side: ReturnType<typeof hemisphere>) => Ear) =>
    perScalp((i) => {
      if (!l.linkedEars && l.ears && (i === l.ears.a1 || i === l.ears.a2)) return null;
      return earTerms(l, ear(hemisphere(l.scalp[i]!)));
    });

  switch (montage) {
    case 'average': {
      if (scalpSelected.length < 2) return asRecorded();
      const w = -1 / scalpSelected.length;
      return perScalp(() => scalpSelected.map((j): Term => [j, w]));
    }
    case 'linked_ears':
      return earRef(() => 'LE');
    case 'a1':
      return earRef(() => 'A1');
    case 'a2':
      return earRef(() => 'A2');
    case 'ipsilateral':
      return earRef((side) => (side === 'left' ? 'A1' : side === 'right' ? 'A2' : 'LE'));
    case 'contralateral':
      return earRef((side) => (side === 'left' ? 'A2' : side === 'right' ? 'A1' : 'LE'));
    case 'laplacian':
      return perScalp((i) => {
        const n = laplacianNeighbours(l.scalp[i]!, l);
        return n.length >= MIN_NEIGHBOURS ? n.map((j): Term => [j, -1 / n.length]) : null;
      });
  }
  return asRecorded();
}

/** One montage row over samples [start, end) of the file's channels. */
export function combine(signals: ArrayLike<number>[], terms: [number, number][], start: number, end: number): number[] {
  const out = new Array<number>(Math.max(0, end - start)).fill(0);
  for (const [c, w] of terms) {
    const sig = signals[c];
    if (!sig) continue;
    for (let i = 0; i < out.length; i++) out[i] += w * sig[start + i];
  }
  return out;
}
