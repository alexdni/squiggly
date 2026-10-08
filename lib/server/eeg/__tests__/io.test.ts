import { describe, expect, it } from 'vitest';
import { canonicalLabel, selectEegChannels } from '../io/channels';
import { linearDetrend, parseCsvRecording } from '../io/csv';
import { decimate, decimationFactor } from '../io/decimate';
import { decodeEdfSignals, readEdfHeader, toMicrovoltFactor } from '../io/edf';
import { loadRecording } from '../io/loadRecording';
import { fitNumber, writeCsv, writeEdf } from '../export/writers';

function sine(n: number, fs: number, hz: number, amp: number, phase = 0): Float64Array {
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * hz * i) / fs + phase);
  return x;
}

describe('channel labels', () => {
  it.each([
    ['EEG Fp1-LE', 'Fp1'],
    ['FP2', 'Fp2'],
    ['T3', 'T7'],
    ['T6-REF', 'P8'],
    ['  cz ', 'Cz'],
    ['EEG O2-A1', 'O2'],
    ['TP9', 'TP9'],
  ])('%s → %s', (raw, label) => expect(canonicalLabel(raw)).toBe(label));

  it.each(['A1', 'ECG', 'EXG1', 'Status', 'aX', 'z-Cz', 'EDF Annotations'])('rejects %s', (raw) =>
    expect(canonicalLabel(raw)).toBeNull()
  );

  it('keeps the first of duplicate labels', () => {
    const { selected, ignored } = selectEegChannels(['T3', 'T7', 'Cz', 'ECG']);
    expect(selected).toEqual([
      { sourceIndex: 0, label: 'T7' },
      { sourceIndex: 2, label: 'Cz' },
    ]);
    expect(ignored).toEqual(['T7', 'ECG']);
  });
});

describe('EDF/BDF', () => {
  const fs = 256;
  const labels = ['Fp1', 'Cz', 'O2'];
  const data = labels.map((_, c) => sine(fs * 4, fs, 10 + c, 50 + 10 * c));

  it.each([false, true])('round-trips through writer and reader (bdf=%s)', (bdf) => {
    const bytes = writeEdf({ labels, data, sampleRate: fs }, { bdf });
    const header = readEdfHeader(bytes);
    expect(header.isBdf).toBe(bdf);
    const magic = Array.from(bytes.subarray(0, 8));
    expect(magic).toEqual(bdf ? [0xff, ...'BIOSEMI'].map((c) => (typeof c === 'string' ? c.charCodeAt(0) : c)) : [...'0       '].map((c) => c.charCodeAt(0)));
    expect(header.nRecords).toBe(4);
    expect(header.signals.map((s) => s.label)).toEqual(labels);
    const { data: back, sampleRate } = decodeEdfSignals(bytes, header, [0, 1, 2]);
    expect(sampleRate).toBe(fs);
    const tol = bdf ? 1e-4 : 0.01; // quantization step over a ~±70 µV range
    back.forEach((ch, c) => ch.forEach((v, i) => expect(Math.abs(v - data[c][i])).toBeLessThan(tol)));
  });

  it('converts physical units to µV', () => {
    expect(toMicrovoltFactor('uV')).toBe(1);
    expect(toMicrovoltFactor('µV')).toBe(1);
    expect(toMicrovoltFactor('mV')).toBe(1000);
    expect(toMicrovoltFactor('V')).toBe(1e6);
  });

  it('loadRecording selects scalp channels and decimates high-rate files', () => {
    const hi = 1024;
    const raw = ['EEG Fp1-LE', 'ECG', 'EEG Cz-LE'].map((_, c) => sine(hi * 3, hi, 10, 40 + c));
    const bytes = writeEdf({ labels: ['EEG Fp1-LE', 'ECG', 'EEG Cz-LE'], data: raw, sampleRate: hi }, { bdf: true });
    const eeg = loadRecording(bytes, 'bdf');
    expect(eeg.labels).toEqual(['Fp1', 'Cz']);
    expect(eeg.ignored).toEqual([]); // the ECG lead is kept for HRV, not ignored
    expect(eeg.ecg?.label).toBe('ECG');
    expect(eeg.originalSampleRate).toBe(1024);
    expect(eeg.sampleRate).toBe(256);
    expect(eeg.data[0].length).toBe(256 * 3);
  });

  it('fits numbers into 8-character header fields', () => {
    expect(fitNumber(-123.456789, 8)).toBe('-123.457');
    expect(fitNumber(1000000, 8)).toBe('1000000');
    expect(fitNumber(0.000123, 8).length).toBeLessThanOrEqual(8);
  });
});

describe('CSV', () => {
  it('parses timestamp-last ISO 8601 files, interpolates gaps and detrends', () => {
    const t0 = Date.parse('2026-06-24T22:13:59.000Z');
    const rows = ['Fp1,ECG,T3,aX,timestamp'];
    for (let i = 0; i < 500; i++) {
      const fp1 = i === 10 ? '' : String(100 + 0.5 * i + 20 * Math.sin((2 * Math.PI * 10 * i) / 250));
      rows.push(`${fp1},1,${-5 + 0.1 * i},0,${new Date(t0 + i * 4).toISOString()}`);
    }
    const rec = parseCsvRecording(rows.join('\n'));
    expect(rec.labels).toEqual(['Fp1', 'T7']);
    expect(rec.ignored).toEqual(['aX']); // the ECG column is kept for HRV
    expect(rec.ecg?.label).toBe('ECG');
    expect(rec.sampleRate).toBeCloseTo(250, 6);
    const fp1 = rec.data[0];
    expect(Number.isNaN(fp1[10])).toBe(false);
    const mean = fp1.reduce((a, b) => a + b, 0) / fp1.length;
    expect(Math.abs(mean)).toBeLessThan(1e-6);
    // T3/T7 was a pure line → removed entirely by the linear detrend
    expect(Math.max(...rec.data[1].map(Math.abs))).toBeLessThan(1e-9);
  });

  it('detects millisecond numeric timestamps in the first column', () => {
    const rows = ['timestamp,Cz'];
    for (let i = 0; i < 100; i++) rows.push(`${1700000000000 + i * 2},${Math.sin(i)}`);
    expect(parseCsvRecording(rows.join('\n')).sampleRate).toBeCloseTo(500, 6);
  });

  it('writes a CSV the reader accepts', () => {
    const data = [sine(250, 250, 5, 10), sine(250, 250, 7, 10)];
    const text = new TextDecoder().decode(writeCsv({ labels: ['Fz', 'Pz'], data, sampleRate: 250 }));
    const rec = parseCsvRecording(text);
    expect(rec.labels).toEqual(['Fz', 'Pz']);
    expect(rec.sampleRate).toBeCloseTo(250, 3);
  });

  it('linearDetrend removes slope and offset', () => {
    const x = Float64Array.from({ length: 50 }, (_, i) => 3 + 2 * i);
    linearDetrend(x);
    x.forEach((v) => expect(Math.abs(v)).toBeLessThan(1e-9));
  });
});

describe('decimate', () => {
  it('chooses the largest factor keeping ≥250 Hz', () => {
    expect(decimationFactor(250)).toBe(1);
    expect(decimationFactor(256)).toBe(1);
    expect(decimationFactor(500)).toBe(2);
    expect(decimationFactor(1000)).toBe(4);
    expect(decimationFactor(2048)).toBe(8);
  });

  it('keeps in-band signal and suppresses aliases', () => {
    const fs = 1000;
    const n = fs * 4;
    const inBand = sine(n, fs, 10, 1);
    const alias = sine(n, fs, 240, 1); // would fold to 10 Hz at 250 Hz
    const y = decimate(Float64Array.from(inBand, (v, i) => v + alias[i]), 4);
    let err = 0;
    for (let o = 50; o < y.length - 50; o++) err = Math.max(err, Math.abs(y[o] - inBand[o * 4]));
    expect(err).toBeLessThan(0.02);
  });
});

describe('cleaned files open in the browser viewer', () => {
  const fs = 250;
  const labels = ['Fp1', 'Cz', 'O2'];
  const data = labels.map((_, c) => sine(fs * 6, fs, 8 + c, 30 + 5 * c));

  it.each([false, true])('browser EDF/BDF reader parses writer output (bdf=%s)', async (bdf) => {
    const { parseEDFFile } = await import('@/lib/edf-reader-browser');
    const bytes = writeEdf({ labels, data, sampleRate: fs }, { bdf });
    const parsed = await parseEDFFile(bytes.slice().buffer);
    expect(parsed.sampleRate).toBe(fs);
    expect(parsed.header.channels.map((c) => c.label)).toEqual(labels);
    expect(parsed.signals[2].length).toBe(fs * 6);
    const tol = bdf ? 1e-3 : 0.01;
    parsed.signals.forEach((ch, c) => ch.forEach((v, i) => expect(Math.abs(v - data[c][i])).toBeLessThan(tol)));
  });

  it('browser CSV reader parses writer output', async () => {
    const { parseCSVFile } = await import('@/lib/csv-reader-browser');
    const text = new TextDecoder().decode(writeCsv({ labels, data, sampleRate: fs }));
    const parsed = await parseCSVFile(text);
    expect(parsed.channelNames).toEqual(labels);
    expect(parsed.sampleRate).toBe(fs);
    expect(Math.abs(parsed.signals[1][100] - data[1][100])).toBeLessThan(1e-3);
  });
});
