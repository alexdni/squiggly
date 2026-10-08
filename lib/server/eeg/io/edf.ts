// Server-side EDF/EDF+/BDF reader that decodes only the requested signals, straight into
// Float64Array µV. The browser viewer has its own reader (lib/edf-reader-browser.ts) that keeps
// every channel as number[]; that is too memory-hungry for 200 MB BDF files on the server.

export interface EdfSignalInfo {
  label: string;
  physicalDimension: string;
  physicalMin: number;
  physicalMax: number;
  digitalMin: number;
  digitalMax: number;
  prefiltering: string;
  samplesPerRecord: number;
}

export interface EdfFileHeader {
  isBdf: boolean;
  patientId: string;
  recordingId: string;
  startDate: string;
  startTime: string;
  headerBytes: number;
  reserved: string;
  nRecords: number;
  recordDuration: number;
  signals: EdfSignalInfo[];
}

export function readEdfHeader(bytes: Uint8Array): EdfFileHeader {
  if (bytes.length < 256) throw new Error('Invalid EDF/BDF file: header truncated');
  const isBdf = bytes[0] === 0xff;
  let offset = 0;
  const ascii = (len: number) => {
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[offset + i]);
    offset += len;
    return s.trim();
  };
  ascii(8); // version
  const patientId = ascii(80);
  const recordingId = ascii(80);
  const startDate = ascii(8);
  const startTime = ascii(8);
  const headerBytes = parseInt(ascii(8), 10);
  const reserved = ascii(44);
  let nRecords = parseInt(ascii(8), 10);
  const recordDuration = parseFloat(ascii(8));
  const ns = parseInt(ascii(4), 10);
  if (!Number.isFinite(ns) || ns <= 0) throw new Error('Invalid EDF/BDF file: no signals');
  if (bytes.length < 256 + ns * 256) throw new Error('Invalid EDF/BDF file: header truncated');

  const field = (len: number) => Array.from({ length: ns }, () => ascii(len));
  const labels = field(16);
  field(80); // transducer
  const dims = field(8);
  const pMin = field(8).map(Number);
  const pMax = field(8).map(Number);
  const dMin = field(8).map(Number);
  const dMax = field(8).map(Number);
  const prefilter = field(80);
  const spr = field(8).map((s) => parseInt(s, 10));

  const signals: EdfSignalInfo[] = labels.map((label, i) => ({
    label,
    physicalDimension: dims[i],
    physicalMin: pMin[i],
    physicalMax: pMax[i],
    digitalMin: dMin[i],
    digitalMax: dMax[i],
    prefiltering: prefilter[i],
    samplesPerRecord: spr[i],
  }));

  const bytesPerSample = isBdf ? 3 : 2;
  const recordBytes = spr.reduce((a, b) => a + b, 0) * bytesPerSample;
  const available = Math.floor((bytes.length - headerBytes) / recordBytes);
  // nRecords is -1 while a recorder is still writing; also guard against truncated files.
  if (!(nRecords > 0) || nRecords > available) nRecords = available;
  if (nRecords <= 0) throw new Error('Invalid EDF/BDF file: no data records');

  return {
    isBdf,
    patientId,
    recordingId,
    startDate,
    startTime,
    headerBytes,
    reserved,
    nRecords,
    recordDuration,
    signals,
  };
}

/** Multiplier that converts the signal's physical unit to µV. */
export function toMicrovoltFactor(dimension: string): number {
  const d = dimension.trim().toLowerCase().replace('μ', 'u').replace('µ', 'u');
  if (d === 'v') return 1e6;
  if (d === 'mv') return 1e3;
  if (d === 'nv') return 1e-3;
  return 1; // uV, or missing/unknown units: assume µV like most clinical EDFs
}

export function isAnnotationSignal(label: string): boolean {
  const l = label.trim().toLowerCase();
  return l === 'edf annotations' || l === 'bdf annotations' || l === 'status';
}

/**
 * True when the signal holds EDF+ annotation text (time-stamped annotation lists) rather than
 * samples: the first record starts with a signed onset ("+0" or "-1.5") followed by 0x14 (or 0x15 and a duration).
 */
export function isAnnotationText(bytes: Uint8Array, header: EdfFileHeader, index: number): boolean {
  const bps = header.isBdf ? 3 : 2;
  let offset = header.headerBytes;
  for (let i = 0; i < index; i++) offset += header.signals[i].samplesPerRecord * bps;
  const len = header.signals[index].samplesPerRecord * bps;
  const first = bytes.subarray(offset, Math.min(bytes.length, offset + len));
  if (first.length < 3 || (first[0] !== 0x2b && first[0] !== 0x2d)) return false;
  let i = 1;
  while (i < first.length && ((first[i] >= 0x30 && first[i] <= 0x39) || first[i] === 0x2e)) i++;
  return i > 1 && i < first.length && (first[i] === 0x14 || first[i] === 0x15);
}

/**
 * Decode the given signal indices into µV. All requested signals must share one sample rate;
 * callers pick a rate group first (see `dominantRateGroup`).
 */
export function decodeEdfSignals(
  bytes: Uint8Array,
  header: EdfFileHeader,
  indices: number[]
): { data: Float64Array[]; sampleRate: number } {
  if (indices.length === 0) throw new Error('No signals requested');
  const spr0 = header.signals[indices[0]].samplesPerRecord;
  for (const i of indices) {
    if (header.signals[i].samplesPerRecord !== spr0) {
      throw new Error('Requested EDF signals have different sample rates');
    }
  }
  const bps = header.isBdf ? 3 : 2;
  const offsets: number[] = [];
  let acc = 0;
  for (const s of header.signals) {
    offsets.push(acc);
    acc += s.samplesPerRecord * bps;
  }
  const recordBytes = acc;
  const nSamples = header.nRecords * spr0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const data = indices.map((idx) => {
    const sig = header.signals[idx];
    const out = new Float64Array(nSamples);
    const dRange = sig.digitalMax - sig.digitalMin;
    const gain = dRange !== 0 ? (sig.physicalMax - sig.physicalMin) / dRange : 1;
    const unit = toMicrovoltFactor(sig.physicalDimension);
    const scale = gain * unit;
    const shift = (sig.physicalMin - sig.digitalMin * gain) * unit;
    let k = 0;
    for (let r = 0; r < header.nRecords; r++) {
      let p = header.headerBytes + r * recordBytes + offsets[idx];
      if (header.isBdf) {
        for (let s = 0; s < spr0; s++, p += 3) {
          let v = bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16);
          if (v & 0x800000) v -= 0x1000000;
          out[k++] = v * scale + shift;
        }
      } else {
        for (let s = 0; s < spr0; s++, p += 2) {
          out[k++] = view.getInt16(p, true) * scale + shift;
        }
      }
    }
    return out;
  });

  return { data, sampleRate: spr0 / header.recordDuration };
}
