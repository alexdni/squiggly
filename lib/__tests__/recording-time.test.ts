import { describe, expect, it } from 'vitest';
import { csvRecordedAt, edfRecordedAt, formatRecordedAt, recordedAtFromFile } from '../recording-time';

const uploaded = new Date('2025-11-12T10:00:00Z');

describe('edfRecordedAt', () => {
  it('reads the header date and time as written', () => {
    expect(edfRecordedAt('10.11.25', '21.53.17', uploaded)).toBe('2025-11-10T21:53:17');
  });
  it('keeps only the date when the time is 00.00.00', () => {
    expect(edfRecordedAt('02.04.22', '00.00.00', uploaded)).toBe('2022-04-02');
  });
  it.each([
    ['01.01.85', '00.00.00'], // anonymised placeholder
    ['01.01.00', '00.00.00'], // writer without a clock
    ['00.00.00', '00.00.00'],
    ['01.01.01', '01.01.01'], // device clock never set
    ['01.01.24', '00.00.00'],
    ['', ''],
    ['31.02.24', '10.00.00'],
    ['10.11.25', '25.00.00'],
    ['20.11.25', '09.00.00'], // more than two days after the upload
    ['10.11.99', '09.00.00'], // 1999
  ])('rejects %s %s', (d, t) => expect(edfRecordedAt(d, t, uploaded)).toBeNull());
  it('allows a clock slightly ahead of the upload', () => {
    expect(edfRecordedAt('13.11.25', '08.00.00', uploaded)).toBe('2025-11-13T08:00:00');
  });
});

describe('csvRecordedAt', () => {
  it.each([
    ['1762811597.996', '2025-11-10T21:53:17Z'],
    ['1762811597996', '2025-11-10T21:53:17Z'],
    ['1762811597996000', '2025-11-10T21:53:17Z'],
    ['1762811597996000000', '2025-11-10T21:53:17Z'],
    ['2025-06-24T22:13:59.340Z', '2025-06-24T22:13:59Z'],
  ])('%s → %s', (raw, iso) => expect(csvRecordedAt(raw, uploaded)).toBe(iso));
  it.each(['0', '479146', '0.004', '', 'abc', '1900000000'])('rejects %s', (raw) =>
    expect(csvRecordedAt(raw, uploaded)).toBeNull()
  );
});

describe('recordedAtFromFile', () => {
  const bytes = (s: string) => new TextEncoder().encode(s);
  it('reads an EDF header', () => {
    const head = '0'.padEnd(8) + 'X'.padEnd(80) + 'Startdate X'.padEnd(80) + '10.11.25' + '21.53.17' + ' '.repeat(72);
    expect(recordedAtFromFile(bytes(head), 'edf', uploaded)).toBe('2025-11-10T21:53:17');
  });
  it('reads the timestamp column of a CSV, first or last', () => {
    expect(recordedAtFromFile(bytes('timestamp,Fz,Cz\n1762811597.996,1,2\n'), 'csv', uploaded)).toBe('2025-11-10T21:53:17Z');
    expect(recordedAtFromFile(bytes('Fz,Cz,timestamp\n1,2,1762811597996\n'), 'CSV', uploaded)).toBe('2025-11-10T21:53:17Z');
    expect(recordedAtFromFile(bytes('timestamp,Fz\n479146,1\n'), 'csv', uploaded)).toBeNull();
    expect(recordedAtFromFile(bytes('Fz,Cz\n1,2\n'), 'csv', uploaded)).toBeNull();
  });
  it('gives null for a truncated file', () => {
    expect(recordedAtFromFile(bytes('0   '), 'edf', uploaded)).toBeNull();
  });
});

describe('formatRecordedAt', () => {
  it('shows file-local times as written', () => {
    expect(formatRecordedAt('2025-11-10T21:53:17')).toBe('10 Nov 2025, 21:53');
    expect(formatRecordedAt('2025-11-10T21:53:17', { dateOnly: true })).toBe('10 Nov 2025');
    expect(formatRecordedAt('2022-04-02')).toBe('2 Apr 2022');
  });
  it('shows absolute times in the viewer time zone', () => {
    const d = new Date('2025-11-10T21:53:17Z');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    expect(formatRecordedAt('2025-11-10T21:53:17Z')).toMatch(new RegExp(`, ${hh}:${mm}$`));
  });
  it('gives null for nothing or nonsense', () => {
    expect(formatRecordedAt(null)).toBeNull();
    expect(formatRecordedAt('yesterday')).toBeNull();
  });
});
