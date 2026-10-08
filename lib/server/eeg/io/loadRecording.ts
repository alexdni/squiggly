// Uploaded file bytes → channel-major µV EEG ready for the artifact pipeline: supported scalp
// channels only, one sample rate, decimated to ~250 Hz when the device recorded much faster.
// Data keeps the file's reference; the pipeline re-references to the average of the channels that
// survive QC, so one dead or noisy electrode cannot leak into every other channel.

import { ecgCandidates, selectEegChannels } from './channels';
import { parseCsvRecording } from './csv';
import { decimate, decimationFactor } from './decimate';
import { decodeEdfSignals, EdfFileHeader, isAnnotationSignal, isAnnotationText, readEdfHeader } from './edf';
import { isFlatline } from './flatline';

export type SourceFormat = 'edf' | 'bdf' | 'csv';

export interface LoadedEeg {
  format: SourceFormat;
  labels: string[];
  data: Float64Array[];
  sampleRate: number;
  originalSampleRate: number;
  /** raw labels that were not used (non-EEG, unknown, duplicate, or a minority sample rate) */
  ignored: string[];
  /** ECG lead, if the file has one; decimated like the EEG, at its own rate */
  ecg?: { label: string; data: Float64Array; sampleRate: number };
  /** ECG candidates that were passed over (flat line, too slow), for the QC warnings */
  ecgSkipped?: string[];
  edfHeader?: EdfFileHeader;
}

/** Below this rate a lead cannot resolve heartbeats well enough for HRV. */
export const MIN_ECG_RATE_HZ = 50;

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

type ParsedEeg = Omit<LoadedEeg, 'format' | 'originalSampleRate'>;

/** First ECG candidate that is a real, moving signal; the others are reported as skipped. */
function pickEcg(
  candidates: { label: string; decode: () => { data: Float64Array; sampleRate: number } | string }[]
): Pick<ParsedEeg, 'ecg' | 'ecgSkipped'> {
  const ecgSkipped: string[] = [];
  for (const c of candidates) {
    const decoded = c.decode();
    if (typeof decoded === 'string') {
      if (decoded) ecgSkipped.push(`${c.label}: ${decoded}`);
      continue;
    }
    if (decoded.sampleRate < MIN_ECG_RATE_HZ) {
      ecgSkipped.push(`${c.label}: sampled at ${decoded.sampleRate} Hz, too slow for heartbeats`);
      continue;
    }
    if (isFlatline(decoded.data)) {
      ecgSkipped.push(`${c.label}: flat line, not processed as ECG`);
      continue;
    }
    return { ecg: { label: c.label, ...decoded }, ecgSkipped };
  }
  return { ecgSkipped };
}

function loadEdf(bytes: Uint8Array): ParsedEeg {
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
  const { ecg, ecgSkipped } = pickEcg(
    ecgCandidates(header.signals.map((s) => s.label)).map((i) => ({
      label: header.signals[i].label,
      decode: () => {
        // a standard EDF+ annotation channel holds event text: not a signal, nothing to report
        if (isAnnotationText(bytes, header, i)) return '';
        const decoded = decodeEdfSignals(bytes, header, [i]);
        return { data: decoded.data[0], sampleRate: decoded.sampleRate };
      },
    }))
  );
  return {
    labels: keep.map((s) => s.label),
    data,
    sampleRate,
    ignored: ignored.filter((l) => l !== ecg?.label),
    edfHeader: header,
    ecg,
    ecgSkipped,
  };
}

export function loadRecording(bytes: Uint8Array, format: SourceFormat): LoadedEeg {
  const parsed =
    format === 'csv'
      ? (() => {
          const csv = parseCsvRecording(new TextDecoder('utf-8').decode(bytes));
          const parsed: ParsedEeg = {
            labels: csv.labels,
            data: csv.data,
            sampleRate: csv.sampleRate,
            ignored: csv.ignored,
            ...pickEcg(
              csv.ecgColumns.map((c) => ({
                label: c.label,
                decode: () => ({ data: c.data, sampleRate: csv.sampleRate }),
              }))
            ),
          };
          return parsed;
        })()
      : loadEdf(bytes);

  const originalSampleRate = parsed.sampleRate;
  const q = decimationFactor(originalSampleRate);
  const data = q > 1 ? parsed.data.map((d) => decimate(d, q)) : parsed.data;
  let ecg = parsed.ecg;
  if (ecg) {
    const qe = decimationFactor(ecg.sampleRate);
    ecg = qe > 1 ? { ...ecg, data: decimate(ecg.data, qe), sampleRate: ecg.sampleRate / qe } : ecg;
  }

  return {
    format,
    ...parsed,
    data,
    ecg,
    sampleRate: originalSampleRate / q,
    originalSampleRate,
  };
}
