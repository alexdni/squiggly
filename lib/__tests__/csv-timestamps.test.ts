import { describe, it, expect } from 'vitest';
import { validateCSVFile } from '../csv-validator';
import { parseCSVFile } from '../csv-reader-browser';
import { parseCsvTimestamp } from '../csv-timestamp';

// Regression: CSVs exported with ISO 8601 timestamps (e.g. TheraQ / Divergence
// exports: "2026-06-24T22:13:59.340Z") failed with "Cannot determine sampling
// pattern from timestamps" because the column was run through parseFloat,
// which truncates every value to the year.

function isoCsv(rows: number, stepMs = 4, tsLast = false): string {
  const start = Date.UTC(2026, 5, 24, 22, 13, 59, 340);
  const lines = [tsLast ? 'F3,F4,timestamp' : 'timestamp,F3,F4'];
  for (let i = 0; i < rows; i++) {
    const ts = new Date(start + i * stepMs).toISOString();
    const vals = [`${Math.sin(i) * 100}`, `${Math.cos(i) * 50}`];
    lines.push(tsLast ? [...vals, ts].join(',') : [ts, ...vals].join(','));
  }
  return lines.join('\n') + '\n';
}

function epochMsCsv(rows: number, stepMs = 4): string {
  const start = 1782339239340;
  const lines = ['timestamp,F3,F4'];
  for (let i = 0; i < rows; i++) {
    lines.push(`${start + i * stepMs},${i},${-i}`);
  }
  return lines.join('\n') + '\n';
}

describe('parseCsvTimestamp', () => {
  it('parses numeric timestamps unchanged', () => {
    expect(parseCsvTimestamp('1782339239340')).toBe(1782339239340);
    expect(parseCsvTimestamp('12.5')).toBe(12.5);
    expect(parseCsvTimestamp('1.5e3')).toBe(1500);
  });

  it('parses ISO 8601 timestamps to epoch milliseconds', () => {
    expect(parseCsvTimestamp('2026-06-24T22:13:59.340Z')).toBe(1782339239340);
    expect(parseCsvTimestamp('2026-06-24T22:13:59.344Z')).toBe(1782339239344);
  });

  it('tolerates surrounding whitespace and CR', () => {
    expect(parseCsvTimestamp(' 42\r')).toBe(42);
    expect(parseCsvTimestamp('2026-06-24T22:13:59.340Z\r')).toBe(1782339239340);
  });

  it('returns NaN for garbage or empty input', () => {
    expect(parseCsvTimestamp('')).toBeNaN();
    expect(parseCsvTimestamp('abc')).toBeNaN();
    expect(parseCsvTimestamp(undefined)).toBeNaN();
  });
});

describe('validateCSVFile with ISO 8601 timestamps', () => {
  it('detects 250 Hz and duration from ISO timestamps', async () => {
    const result = await validateCSVFile(Buffer.from(isoCsv(500)));
    expect(result.valid, result.error).toBe(true);
    expect(result.metadata!.sampling_rate).toBe(250);
    expect(result.metadata!.duration_seconds).toBeCloseTo(499 * 0.004, 3);
    expect(result.metadata!.channels).toEqual(['F3', 'F4']);
  });

  it('handles timestamp as the last column', async () => {
    const result = await validateCSVFile(Buffer.from(isoCsv(500, 4, true)));
    expect(result.valid, result.error).toBe(true);
    expect(result.metadata!.sampling_rate).toBe(250);
    expect(result.metadata!.duration_seconds).toBeCloseTo(499 * 0.004, 3);
  });

  it('still accepts numeric epoch-millisecond timestamps', async () => {
    const result = await validateCSVFile(Buffer.from(epochMsCsv(500)));
    expect(result.valid, result.error).toBe(true);
    expect(result.metadata!.sampling_rate).toBe(250);
    expect(result.metadata!.duration_seconds).toBeCloseTo(499 * 0.004, 3);
  });
});

describe('parseCSVFile with ISO 8601 timestamps', () => {
  it('parses ISO timestamps into a 250 Hz recording', async () => {
    const data = await parseCSVFile(isoCsv(500));
    expect(data.sampleRate).toBe(250);
    expect(data.duration).toBeCloseTo(499 * 0.004, 3);
    expect(data.signals[0]).toHaveLength(500);
    expect(data.header.timestamps[1] - data.header.timestamps[0]).toBeCloseTo(0.004, 6);
  });
});
