// Server-side CSV reader for Divergence/Flex style exports: a `timestamp` column (first or last;
// numeric in s/ms/µs/ns, or ISO 8601) plus one column per channel in µV. Mirrors the former
// Python csv_reader: unit detection from timestamp deltas, NaN gaps linearly interpolated, and a
// linear detrend per channel (device data carries large DC drift).

import { canonicalLabel, isEcgLabel } from './channels';

export interface CsvRecording {
  sampleRate: number;
  labels: string[];
  data: Float64Array[];
  ignored: string[];
  /** first ECG/EKG column, if any (same preprocessing as the EEG columns) */
  ecg?: { label: string; data: Float64Array };
}

/** Numeric timestamp, or ISO 8601 → epoch ms. NaN when empty/unparseable. */
export function parseCsvTimestamp(raw: string | undefined): number {
  if (raw === undefined) return NaN;
  const s = raw.trim();
  if (s === '') return NaN;
  const n = Number(s);
  if (!Number.isNaN(n)) return n;
  return Date.parse(s);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Seconds per timestamp unit, guessed from the median delta like the Python reader. */
function timeScale(medianRawDiff: number): number {
  if (medianRawDiff < 0.1) return 1;
  if (medianRawDiff < 100) return 1e3;
  if (medianRawDiff < 100_000) return 1e6;
  return 1e9;
}

function interpolateNaN(x: Float64Array): void {
  let firstValid = -1;
  for (let i = 0; i < x.length; i++) {
    if (!Number.isNaN(x[i])) {
      firstValid = i;
      break;
    }
  }
  if (firstValid < 0) {
    x.fill(0);
    return;
  }
  x.fill(x[firstValid], 0, firstValid);
  let prev = firstValid;
  for (let i = firstValid + 1; i < x.length; i++) {
    if (Number.isNaN(x[i])) continue;
    if (i - prev > 1) {
      const a = x[prev];
      const b = x[i];
      for (let j = prev + 1; j < i; j++) x[j] = a + ((b - a) * (j - prev)) / (i - prev);
    }
    prev = i;
  }
  x.fill(x[prev], prev + 1);
}

/** scipy.signal.detrend(type='linear'): subtract the least-squares line. */
export function linearDetrend(x: Float64Array): void {
  const n = x.length;
  if (n < 2) return;
  const tMean = (n - 1) / 2;
  let yMean = 0;
  for (let i = 0; i < n; i++) yMean += x[i];
  yMean /= n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dt = i - tMean;
    num += dt * (x[i] - yMean);
    den += dt * dt;
  }
  const slope = num / den;
  for (let i = 0; i < n; i++) x[i] -= yMean + slope * (i - tMean);
}

export function parseCsvRecording(text: string): CsvRecording {
  const lines = text.split(/\r?\n/);
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  if (lines.length < 2) throw new Error('CSV file must have a header row and at least one data row');

  const sep = lines[0].includes('\t') && !lines[0].includes(',') ? '\t' : ',';
  const headers = lines[0].split(sep).map((h) => h.trim().replace(/^"|"$/g, ''));
  const tsCol = headers.findIndex((h) => h.toLowerCase() === 'timestamp');
  if (tsCol < 0) throw new Error("CSV file must have a 'timestamp' column");

  const cols: { col: number; label: string }[] = [];
  const ignored: string[] = [];
  const seen = new Set<string>();
  const ecgCol = headers.findIndex((h, col) => col !== tsCol && isEcgLabel(h));
  headers.forEach((h, col) => {
    if (col === tsCol || col === ecgCol) return;
    const label = canonicalLabel(h);
    if (!label || seen.has(label)) {
      if (h) ignored.push(h);
      return;
    }
    seen.add(label);
    cols.push({ col, label });
  });
  if (cols.length === 0) throw new Error('No EEG channels with 10-20/10-10 labels found in CSV');

  const nRows = lines.length - 1;
  const ts = new Float64Array(nRows);
  const data = cols.map(() => new Float64Array(nRows));
  const ecgRaw = ecgCol >= 0 ? new Float64Array(nRows) : null;
  let n = 0;
  for (let r = 1; r < lines.length; r++) {
    const line = lines[r];
    if (!line.trim()) continue;
    const v = line.split(sep);
    const t = parseCsvTimestamp(v[tsCol]);
    if (Number.isNaN(t)) continue;
    ts[n] = t;
    for (let c = 0; c < cols.length; c++) {
      const cell = v[cols[c].col];
      data[c][n] = cell === undefined || cell.trim() === '' ? NaN : Number(cell);
    }
    if (ecgRaw) {
      const cell = v[ecgCol];
      ecgRaw[n] = cell === undefined || cell.trim() === '' ? NaN : Number(cell);
    }
    n++;
  }
  if (n < 2) throw new Error('CSV file has no valid data rows');

  const rawDiffs: number[] = [];
  for (let i = 1; i < Math.min(20, n); i++) {
    const d = ts[i] - ts[i - 1];
    if (d > 0) rawDiffs.push(d);
  }
  if (!rawDiffs.length) throw new Error('Cannot determine sampling pattern from timestamps');
  const scale = timeScale(median(rawDiffs));
  const diffs: number[] = [];
  for (let i = 1; i < Math.min(100, n); i++) {
    const d = (ts[i] - ts[i - 1]) / scale;
    if (d > 0) diffs.push(d);
  }
  const sampleRate = 1 / median(diffs);

  const prepare = (d: Float64Array) => {
    const x = d.subarray(0, n).slice();
    interpolateNaN(x);
    linearDetrend(x);
    return x;
  };
  const trimmed = data.map(prepare);
  const ecg = ecgRaw ? { label: headers[ecgCol], data: prepare(ecgRaw) } : undefined;

  return { sampleRate, labels: cols.map((c) => c.label), data: trimmed, ignored, ecg };
}
