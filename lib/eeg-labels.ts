// EEG channel-label normalization, shared by the server pipeline and the browser viewer. Mirrors
// the rules of the former Python preprocessor (strip "EEG " prefixes and reference suffixes, old
// T3/T4/T5/T6 nomenclature → T7/T8/P7/P8) and keeps only electrodes with a known scalp position.

export const CHANNELS_10_20 = [
  'Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8',
  'T7', 'C3', 'Cz', 'C4', 'T8',
  'P7', 'P3', 'Pz', 'P4', 'P8',
  'O1', 'O2',
] as const;

/** 10-10 positions accepted in addition to the 19 base channels. */
export const CHANNELS_10_10_EXTRA = [
  'Fpz', 'AFz', 'FCz', 'CPz', 'POz', 'Oz',
  'AF3', 'AF4', 'AF7', 'AF8',
  'FC1', 'FC2', 'FC3', 'FC4', 'FC5', 'FC6',
  'FT7', 'FT8',
  'CP1', 'CP2', 'CP3', 'CP4', 'CP5', 'CP6',
  'TP7', 'TP8', 'TP9', 'TP10',
  'PO3', 'PO4', 'PO7', 'PO8',
] as const;

const ALIASES: Record<string, string> = { T3: 'T7', T4: 'T8', T5: 'P7', T6: 'P8' };

const PREFIXES = ['EEG ', 'ECG ', 'EMG ', 'EOG '];
const SUFFIXES = ['-LE', '-REF', '-AVG', '-A1', '-A2', '-CZ', '-M1', '-M2'];

const CANONICAL = new Map<string, string>(
  [...CHANNELS_10_20, ...CHANNELS_10_10_EXTRA].map((c) => [c.toUpperCase(), c])
);

/** Canonical label for a raw channel name, or null when it is not a supported scalp electrode. */
export function canonicalLabel(raw: string): string | null {
  let name = raw.trim();
  for (const p of PREFIXES) {
    if (name.toUpperCase().startsWith(p)) name = name.slice(p.length).trim();
  }
  for (const s of SUFFIXES) {
    const i = name.toUpperCase().indexOf(s);
    if (i > 0 && name.toUpperCase().endsWith(s)) name = name.slice(0, i);
  }
  const upper = name.toUpperCase();
  const aliased = ALIASES[upper] ?? upper;
  return CANONICAL.get(aliased.toUpperCase()) ?? null;
}

export interface ChannelSelection {
  /** index into the source channel list */
  sourceIndex: number;
  label: string;
}

/**
 * Pick the supported scalp channels from a list of raw labels. The first occurrence of each
 * canonical label wins; later duplicates (e.g. "T3" and "T7" in the same file) are ignored.
 */
export function selectEegChannels(rawLabels: string[]): {
  selected: ChannelSelection[];
  ignored: string[];
} {
  const seen = new Set<string>();
  const selected: ChannelSelection[] = [];
  const ignored: string[] = [];
  rawLabels.forEach((raw, i) => {
    const label = canonicalLabel(raw);
    if (!label || seen.has(label)) {
      ignored.push(raw);
      return;
    }
    seen.add(label);
    selected.push({ sourceIndex: i, label });
  });
  return { selected, ignored };
}

/**
 * True for an ECG/EKG lead label: "ECG", "EKG", "ecg", "ECG1", "ECG I", "ECG-LA", "EEG ECG"...
 * Excludes impedance companions such as "z-ECG".
 */
export function isEcgLabel(raw: string): boolean {
  const name = raw.trim().replace(/^EEG\s+/i, '');
  return /^(ECG|EKG)(?:$|[\s_\-.:]|\d|I{1,3}\b)/i.test(name);
}

/** Index of the first ECG lead in a label list, or -1. */
export function findEcgChannel(rawLabels: string[]): number {
  return rawLabels.findIndex(isEcgLabel);
}

/**
 * "Annotations" / "EDF Annotations" / "BDF Annotations". Some devices put the ECG lead on a
 * channel with this name; in a standard EDF+ file it holds event text instead, which the reader
 * must rule out by looking at the bytes.
 */
export function isAnnotationsLabel(raw: string): boolean {
  return /^(?:(?:EDF|BDF)\s+)?Annotations?$/i.test(raw.trim());
}

/** Channels that may carry the ECG, best first: ECG/EKG leads, then "Annotations" channels. */
export function ecgCandidates(rawLabels: string[]): number[] {
  const idx = rawLabels.map((_, i) => i);
  return [...idx.filter((i) => isEcgLabel(rawLabels[i])), ...idx.filter((i) => isAnnotationsLabel(rawLabels[i]))];
}

// Nearest 10-20 neighbours for the Hjorth Laplacian; the C and O sites match muBursts.ts
export const LAPLACIAN_NEIGHBOURS: Record<string, readonly string[]> = {
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

/** Longitudinal bipolar ("double banana") chains, left temporal to right temporal. */
export const BIPOLAR_LONGITUDINAL: readonly (readonly [string, string])[] = [
  ['Fp1', 'F7'], ['F7', 'T7'], ['T7', 'P7'], ['P7', 'O1'],
  ['Fp1', 'F3'], ['F3', 'C3'], ['C3', 'P3'], ['P3', 'O1'],
  ['Fz', 'Cz'], ['Cz', 'Pz'],
  ['Fp2', 'F4'], ['F4', 'C4'], ['C4', 'P4'], ['P4', 'O2'],
  ['Fp2', 'F8'], ['F8', 'T8'], ['T8', 'P8'], ['P8', 'O2'],
];

/** Transverse bipolar chains, front to back, each left to right. */
export const BIPOLAR_TRANSVERSE: readonly (readonly [string, string])[] = [
  ['Fp1', 'Fp2'],
  ['F7', 'F3'], ['F3', 'Fz'], ['Fz', 'F4'], ['F4', 'F8'],
  ['T7', 'C3'], ['C3', 'Cz'], ['Cz', 'C4'], ['C4', 'T8'],
  ['P7', 'P3'], ['P3', 'Pz'], ['Pz', 'P4'], ['P4', 'P8'],
  ['O1', 'O2'],
];

/** Circumferential ("hatband") bipolar ring: down the left side, across the back, up the right. */
export const BIPOLAR_CIRCUMFERENTIAL: readonly (readonly [string, string])[] = [
  ['Fp1', 'F7'], ['F7', 'T7'], ['T7', 'P7'], ['P7', 'O1'],
  ['O1', 'O2'],
  ['O2', 'P8'], ['P8', 'T8'], ['T8', 'F8'], ['F8', 'Fp2'],
  ['Fp2', 'Fp1'],
];

/** Side of the head from a 10-20 label: odd numbers left, even right, "z" midline. */
export function hemisphere(label: string): 'left' | 'right' | 'midline' {
  const m = label.match(/(\d+)$/);
  if (!m) return 'midline';
  return Number(m[1]) % 2 === 1 ? 'left' : 'right';
}

// ── recorded reference ─────────────────────────────────────────────────────

/**
 * What a recording's channels are referenced to, as far as its labels say. EDF/BDF have no
 * reference field, so the label suffix ("Fp1-LE") is the only indicator; plain labels say nothing.
 */
export type ReferenceKind = 'LE' | 'A1' | 'A2' | 'ipsilateral' | 'REF' | 'AVG' | 'CZ' | 'CSD' | 'bipolar' | 'unknown';

export const REFERENCE_KINDS: readonly ReferenceKind[] = [
  'LE', 'A1', 'A2', 'ipsilateral', 'REF', 'AVG', 'CZ', 'CSD', 'bipolar', 'unknown',
];

export const REFERENCE_LABELS: Record<ReferenceKind, string> = {
  LE: 'Linked ears',
  A1: 'Left ear (A1)',
  A2: 'Right ear (A2)',
  ipsilateral: 'Ipsilateral ears (A1/A2)',
  REF: 'Device reference (not named)',
  AVG: 'Average',
  CZ: 'Cz',
  CSD: 'Current source density',
  bipolar: 'Bipolar',
  unknown: 'Unknown',
};

export function isReferenceKind(v: unknown): v is ReferenceKind {
  return typeof v === 'string' && (REFERENCE_KINDS as readonly string[]).includes(v);
}

const stripEegPrefix = (raw: string) => raw.trim().replace(/^EEG\s+/i, '');
const scalp = (name: string) => CANONICAL.get(ALIASES[name.toUpperCase()] ?? name.toUpperCase()) ?? null;
const EAR_ALIASES: Record<string, 'A1' | 'A2'> = { A1: 'A1', M1: 'A1', A2: 'A2', M2: 'A2' };

/** Index of the "A2-A1" (or "A1-A2") channel and its sign as A2 − A1, or null. */
export function findEarDifference(rawLabels: string[]): { index: number; sign: 1 | -1 } | null {
  for (let i = 0; i < rawLabels.length; i++) {
    const m = stripEegPrefix(rawLabels[i]).toUpperCase().match(/^([AM][12])-([AM][12])$/);
    if (!m) continue;
    const [a, b] = [EAR_ALIASES[m[1]], EAR_ALIASES[m[2]]];
    if (a === 'A2' && b === 'A1') return { index: i, sign: 1 };
    if (a === 'A1' && b === 'A2') return { index: i, sign: -1 };
  }
  return null;
}

/** Indices of separate ear channels ("A1", "M2", "A1-Ref"...), not ones referenced to linked ears. */
export function findEarChannels(rawLabels: string[]): { a1: number; a2: number } | null {
  const found: Partial<Record<'A1' | 'A2', number>> = {};
  rawLabels.forEach((raw, i) => {
    const m = stripEegPrefix(raw).toUpperCase().match(/^([AM][12])(?:-(REF|AVG))?$/);
    const ear = m && EAR_ALIASES[m[1]];
    if (ear && found[ear] === undefined) found[ear] = i;
  });
  return found.A1 !== undefined && found.A2 !== undefined ? { a1: found.A1, a2: found.A2 } : null;
}

/** The reference suffix of one scalp-channel label: 'LE', 'A1', ... '' for a plain label, null when not a scalp channel. */
export function referenceSuffix(raw: string): ReferenceKind | '' | null {
  const name = stripEegPrefix(raw);
  if (scalp(name)) return '';
  const m = name.match(/^([A-Za-z0-9]+)-([A-Za-z0-9]+)$/);
  if (!m || !scalp(m[1])) return null;
  const s = m[2].toUpperCase();
  if (s === 'LE' || s === 'LM') return 'LE';
  if (s === 'REF') return 'REF';
  if (s === 'AVG' || s === 'AV' || s === 'AVE' || s === 'CAR') return 'AVG';
  if (s === 'CSD' || s === 'LAP') return 'CSD';
  if (EAR_ALIASES[s]) return EAR_ALIASES[s];
  if (s === 'CZ') return 'CZ';
  return scalp(s) ? 'bipolar' : null;
}

export interface DetectedReference {
  kind: ReferenceKind;
  /** how many scalp channels carry each suffix, for display ("19 of 19 channels labelled -LE") */
  evidence: string;
}

/**
 * The recorded reference from a file's raw channel labels: the suffix carried by most scalp
 * channels. A file can therefore be linked ears with a few channels labelled otherwise; callers
 * that need every channel on the reference check the labels themselves.
 */
export function detectReference(rawLabels: string[]): DetectedReference {
  const counts = new Map<ReferenceKind | '', number>();
  let total = 0;
  for (const raw of rawLabels) {
    const s = referenceSuffix(raw);
    if (s === null) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
    total++;
  }
  if (total === 0) return { kind: 'unknown', evidence: 'no scalp channel labels' };
  const n = (k: ReferenceKind | '') => counts.get(k) ?? 0;
  const said = (k: ReferenceKind, suffix: string) => `${n(k)} of ${total} channels labelled -${suffix}`;
  // Cz as a suffix on every channel but Cz itself is a reference; on a few channels it is a bipolar pair
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [top, topCount] = ranked[0];
  if (top === '' && topCount === total) return { kind: 'unknown', evidence: 'plain channel labels, no reference suffix' };
  if (n('A1') > 0 && n('A2') > 0 && n('A1') + n('A2') > total / 2) {
    return { kind: 'ipsilateral', evidence: `${n('A1')} channels labelled -A1, ${n('A2')} labelled -A2` };
  }
  if (top === '' || topCount <= total / 2) {
    return { kind: 'unknown', evidence: 'channel labels disagree about the reference' };
  }
  const suffix = { LE: 'LE', A1: 'A1', A2: 'A2', REF: 'Ref', AVG: 'Avg', CZ: 'Cz', CSD: 'CSD' } as Record<string, string>;
  if (top === 'bipolar') return { kind: 'bipolar', evidence: `${topCount} of ${total} channels are electrode pairs` };
  return { kind: top, evidence: said(top, suffix[top] ?? top) };
}
