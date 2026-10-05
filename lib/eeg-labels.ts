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
