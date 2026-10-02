// Uploaded file bytes → channel-major µV EEG ready for the artifact pipeline: supported scalp
// channels only, one sample rate, decimated to ~250 Hz when the device recorded much faster.
// Data keeps the file's reference; the pipeline re-references to the average of the channels that
// survive QC, so one dead or noisy electrode cannot leak into every other channel.

import { selectEegChannels } from './channels';
import { parseCsvRecording } from './csv';
import { decimate, decimationFactor } from './decimate';
import { decodeEdfSignals, EdfFileHeader, isAnnotationSignal, readEdfHeader } from './edf';

export type SourceFormat = 'edf' | 'bdf' | 'csv';

export interface LoadedEeg {
  format: SourceFormat;
  labels: string[];
  data: Float64Array[];
  sampleRate: number;
  originalSampleRate: number;
  /** raw labels that were not used (non-EEG, unknown, duplicate, or a minority sample rate) */
  ignored: string[];
  edfHeader?: EdfFileHeader;
}

export function formatFromPath(path: string): SourceFormat {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'edf' || ext === 'bdf' || ext === 'csv') return ext;
  throw new Error(`Unsupported file format: .${ext}. Supported formats: .edf, .bdf, .csv`);
}

/** Subtract the mean of `use` channels (default: all) from every channel, in place. */
export function averageReference(data: Float64Array[], use?: number[]): void {
  const idx = use ?? data.map((_, c) => c);
  if (idx.length < 2) return;
  const n = data[0].length;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const c of idx) m += data[c][i];
    m /= idx.length;
    for (let c = 0; c < data.length; c++) data[c][i] -= m;
  }
}

function loadEdf(bytes: Uint8Array): Omit<LoadedEeg, 'format' | 'originalSampleRate'> {
  const header = readEdfHeader(bytes);
  const candidates = header.signals
    .map((s, i) => ({ i, label: s.label, spr: s.samplesPerRecord }))
    .filter((s) => !isAnnotationSignal(s.label));
  const { selected, ignored } = selectEegChannels(candidates.map((c) => c.label));
  if (selected.length === 0) {
    throw new Error('No EEG channels with 10-20/10-10 labels found in the file');
  }
  // Keep the sample rate shared by most EEG channels; drop the rest.
  const bySpr = new Map<number, number>();
  for (const s of selected) {
    const spr = candidates[s.sourceIndex].spr;
    bySpr.set(spr, (bySpr.get(spr) ?? 0) + 1);
  }
  const spr = [...bySpr.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  const keep = selected.filter((s) => candidates[s.sourceIndex].spr === spr);
  for (const s of selected) {
    if (candidates[s.sourceIndex].spr !== spr) ignored.push(candidates[s.sourceIndex].label);
  }
  const { data, sampleRate } = decodeEdfSignals(
    bytes,
    header,
    keep.map((s) => candidates[s.sourceIndex].i)
  );
  return { labels: keep.map((s) => s.label), data, sampleRate, ignored, edfHeader: header };
}

export function loadRecording(bytes: Uint8Array, format: SourceFormat): LoadedEeg {
  const parsed =
    format === 'csv'
      ? (() => {
          const csv = parseCsvRecording(new TextDecoder('utf-8').decode(bytes));
          return { labels: csv.labels, data: csv.data, sampleRate: csv.sampleRate, ignored: csv.ignored };
        })()
      : loadEdf(bytes);

  const originalSampleRate = parsed.sampleRate;
  const q = decimationFactor(originalSampleRate);
  const data = q > 1 ? parsed.data.map((d) => decimate(d, q)) : parsed.data;

  return {
    format,
    ...parsed,
    data,
    sampleRate: originalSampleRate / q,
    originalSampleRate,
  };
}
