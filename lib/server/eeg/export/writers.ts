// Writers for the cleaned recording in the upload's original format. EDF uses 16-bit and BDF
// 24-bit samples with per-channel physical ranges taken from the data, so the cleaned signal keeps
// its full resolution. CSV writes a `timestamp` column in seconds followed by one column per
// channel in µV.

import type { EdfFileHeader } from '../io/edf';

export interface CleanedSignals {
  labels: string[];
  data: Float64Array[];
  sampleRate: number;
}

const pad = (s: string, len: number) => {
  // EDF header fields are printable ASCII, left-aligned and space-padded.
  const ascii = s.replace(/[^\x20-\x7e]/g, '?');
  return ascii.length >= len ? ascii.slice(0, len) : ascii + ' '.repeat(len - ascii.length);
};

/** Shortest decimal representation of `x` that fits in `len` characters. */
export function fitNumber(x: number, len: number): string {
  if (Number.isInteger(x) && String(x).length <= len) return String(x);
  for (let digits = len; digits >= 0; digits--) {
    const s = x.toFixed(digits);
    if (s.length <= len) return s;
  }
  const e = x.toExponential(Math.max(0, len - 6));
  if (e.length <= len) return e;
  throw new Error(`Cannot fit ${x} into ${len} characters`);
}

function recordLayout(sampleRate: number): { spr: number; duration: number } {
  if (Number.isInteger(sampleRate)) return { spr: sampleRate, duration: 1 };
  const spr = Math.max(1, Math.round(sampleRate));
  return { spr, duration: spr / sampleRate };
}

export function writeEdf(
  sig: CleanedSignals,
  opts: { bdf: boolean; source?: EdfFileHeader; prefiltering?: string }
): Uint8Array {
  const { labels, data, sampleRate } = sig;
  const ns = labels.length;
  const n = data[0]?.length ?? 0;
  const bps = opts.bdf ? 3 : 2;
  const dMax = opts.bdf ? 8388607 : 32767;
  const dMin = -dMax - 1;
  const { spr, duration } = recordLayout(sampleRate);
  const nRecords = Math.ceil(n / spr);
  const headerBytes = 256 * (ns + 1);
  const out = new Uint8Array(headerBytes + nRecords * ns * spr * bps);

  const ranges = data.map((d) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < d.length; i++) {
      if (d[i] < lo) lo = d[i];
      if (d[i] > hi) hi = d[i];
    }
    if (!(hi > lo)) {
      lo = (Number.isFinite(lo) ? lo : 0) - 1;
      hi = lo + 2;
    }
    // Round outward to the precision the 8-char fields can store.
    const pLo = Number(fitNumber(Math.floor(lo * 1000) / 1000, 8));
    const pHi = Number(fitNumber(Math.ceil(hi * 1000) / 1000, 8));
    return { pLo: Math.min(pLo, lo), pHi: Math.max(pHi, hi) };
  });

  const src = opts.source;
  let h = '';
  // BDF version field is 0xFF followed by "BIOSEMI"; the 0xFF byte is patched in below.
  h += opts.bdf ? ' BIOSEMI' : pad('0', 8);
  h += pad(src?.patientId ?? 'X X X X', 80);
  h += pad(src?.recordingId ?? 'Startdate X X X X', 80);
  h += pad(src?.startDate ?? '01.01.00', 8);
  h += pad(src?.startTime ?? '00.00.00', 8);
  h += pad(String(headerBytes), 8);
  h += pad(opts.bdf ? '24BIT' : '', 44);
  h += pad(String(nRecords), 8);
  h += pad(fitNumber(duration, 8), 8);
  h += pad(String(ns), 4);
  const each = (f: (i: number) => string, len: number) => {
    for (let i = 0; i < ns; i++) h += pad(f(i), len);
  };
  each((i) => labels[i], 16);
  each(() => 'AgAgCl electrode', 80);
  each(() => 'uV', 8);
  each((i) => fitNumber(ranges[i].pLo, 8), 8);
  each((i) => fitNumber(ranges[i].pHi, 8), 8);
  each(() => String(dMin), 8);
  each(() => String(dMax), 8);
  each(() => opts.prefiltering ?? 'cleaned', 80);
  each(() => String(spr), 8);
  each(() => '', 32);
  for (let i = 0; i < h.length; i++) out[i] = h.charCodeAt(i);
  if (opts.bdf) out[0] = 0xff;

  const view = new DataView(out.buffer);
  let p = headerBytes;
  for (let r = 0; r < nRecords; r++) {
    for (let c = 0; c < ns; c++) {
      const { pLo, pHi } = ranges[c];
      const gain = (dMax - dMin) / (pHi - pLo);
      const d = data[c];
      for (let s = 0; s < spr; s++) {
        const i = r * spr + s;
        const v = i < n ? d[i] : 0;
        let q = Math.round((v - pLo) * gain + dMin);
        if (q > dMax) q = dMax;
        if (q < dMin) q = dMin;
        if (opts.bdf) {
          const u = q < 0 ? q + 0x1000000 : q;
          out[p] = u & 0xff;
          out[p + 1] = (u >> 8) & 0xff;
          out[p + 2] = (u >> 16) & 0xff;
          p += 3;
        } else {
          view.setInt16(p, q, true);
          p += 2;
        }
      }
    }
  }
  return out;
}

export function writeCsv(sig: CleanedSignals): Uint8Array {
  const { labels, data, sampleRate } = sig;
  const n = data[0]?.length ?? 0;
  const parts: string[] = ['timestamp,' + labels.join(',') + '\n'];
  let chunk = '';
  for (let i = 0; i < n; i++) {
    let row = (i / sampleRate).toFixed(6);
    for (let c = 0; c < data.length; c++) row += ',' + data[c][i].toFixed(4);
    chunk += row + '\n';
    if (chunk.length > 1 << 20) {
      parts.push(chunk);
      chunk = '';
    }
  }
  parts.push(chunk);
  return new TextEncoder().encode(parts.join(''));
}
