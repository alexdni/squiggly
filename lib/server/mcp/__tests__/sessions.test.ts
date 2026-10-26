import { describe, it, expect } from 'vitest';
import { pairSessions, conditionOf, isTheraqPhaseFile, type RecordingRow } from '@/lib/server/mcp/sessions';

let n = 0;
function rec(filename: string, created_at: string, over: Partial<RecordingRow> = {}): RecordingRow {
  n += 1;
  return {
    id: `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
    project_id: 'p1',
    filename,
    condition_type: filename.match(/EC/i) ? 'EC' : 'EO',
    created_at,
    duration_seconds: 120,
    sampling_rate: 256,
    n_channels: 19,
    montage: '10-20',
    reference: 'linked',
    eo_start: null,
    eo_end: null,
    ec_start: null,
    ec_end: null,
    ...over,
  } as RecordingRow;
}

describe('conditionOf / isTheraqPhaseFile', () => {
  it('condition_type EO/EC wins over filename', () => {
    expect(conditionOf(rec('x_EC.edf', '2026-01-01T00:00:00Z', { condition_type: 'EO' }))).toBe('EO');
  });
  it('reads the stored labels, not the filename', () => {
    // filenames are read at upload (and by the backfill); an unlabelled row stays BOTH
    expect(conditionOf(rec('x_eyes closed.edf', '2026-01-01T00:00:00Z', { condition_type: 'BOTH' }))).toBe('BOTH');
    expect(conditionOf(rec('x.edf', '2026-01-01T00:00:00Z', { condition_type: 'BOTH', ec_start: 0, ec_end: 120 }))).toBe('EC');
    expect(conditionOf(rec('x_EO.edf', '2026-01-01T00:00:00Z', { condition_type: 'BOTH', eo_start: 0, eo_end: 60, ec_start: 60, ec_end: 120 }))).toBe('BOTH');
  });
  it('pairs digit-adjacent EO/EC files by name', () => {
    const a = rec('Client pre 45EO.edf', '2026-01-01T10:00:00Z');
    const b = rec('Client pre 45EC.edf', '2026-01-01T10:10:00Z');
    const c = rec('Client post 52EC.edf', '2026-01-01T10:05:00Z');
    const s = pairSessions([a, b, c]);
    expect(s.find((x) => x.recordingIds.eo === a.id)).toMatchObject({ pairing: 'filename', recordingIds: { eo: a.id, ec: b.id } });
  });
  it('detects TheraQ phase files', () => {
    expect(isTheraqPhaseFile('x_EO1.edf')).toBe(true);
    expect(isTheraqPhaseFile('x EC2 foo')).toBe(true);
    expect(isTheraqPhaseFile('x_EO.edf')).toBe(false);
  });
});

describe('pairSessions', () => {
  it('pairs by filename', () => {
    const eo = rec('Anna_0101_EO.edf', '2026-01-01T10:00:00Z');
    const ec = rec('Anna_0101_EC.edf', '2026-01-01T10:05:00Z');
    const s = pairSessions([eo, ec]);
    expect(s).toHaveLength(1);
    expect(s[0].pairing).toBe('filename');
    expect(s[0].recordingIds).toEqual({ eo: eo.id, ec: ec.id });
    expect(s[0].date).toBe('2026-01-01T10:00:00Z');
    expect(JSON.stringify(s)).not.toMatch(/Anna/);
  });
  it('weekly same-named uploads give 3 same-day sessions', () => {
    const rows: RecordingRow[] = [];
    for (const d of ['01', '08', '15']) {
      rows.push(rec('Client_EO.edf', `2026-01-${d}T10:00:00Z`));
      rows.push(rec('Client_EC.edf', `2026-01-${d}T10:03:00Z`));
    }
    const s = pairSessions(rows);
    expect(s).toHaveLength(3);
    expect(s.every((x) => x.pairing === 'filename')).toBe(true);
    for (const x of s) {
      const eo = rows.find((r) => r.id === x.recordingIds.eo)!;
      const ec = rows.find((r) => r.id === x.recordingIds.ec)!;
      expect(eo.created_at.slice(0, 10)).toBe(ec.created_at.slice(0, 10));
    }
    expect(s[0].date > s[1].date).toBe(true);
  });
  it('pairs different names by time', () => {
    const s = pairSessions([rec('a_EO.edf', '2026-01-01T10:00:00Z'), rec('b_EC.edf', '2026-01-01T12:00:00Z')]);
    expect(s).toHaveLength(1);
    expect(s[0].pairing).toBe('time');
  });
  it('does not pair 30h apart', () => {
    const s = pairSessions([rec('a_EO.edf', '2026-01-01T00:00:00Z'), rec('b_EC.edf', '2026-01-02T06:00:00Z')]);
    expect(s.map((x) => x.pairing)).toEqual(['single', 'single']);
  });
  it('does not pair across projects', () => {
    const s = pairSessions([rec('a_EO.edf', '2026-01-01T00:00:00Z'), rec('a_EC.edf', '2026-01-01T00:01:00Z', { project_id: 'p2' })]);
    expect(s).toHaveLength(2);
  });
  it('BOTH is a single with both', () => {
    const r = rec('x.edf', '2026-01-01T00:00:00Z', { condition_type: 'BOTH' });
    const s = pairSessions([r]);
    expect(s).toEqual([{ id: expect.any(String), recordingIds: { both: r.id }, date: r.created_at, pairing: 'single' }]);
  });
  it('TheraQ phase files stay single', () => {
    const s = pairSessions([rec('x_EO1.edf', '2026-01-01T00:00:00Z'), rec('x_EC1.edf', '2026-01-01T00:01:00Z')]);
    expect(s).toHaveLength(2);
    expect(s.every((x) => x.pairing === 'single')).toBe(true);
  });
  it('condition_type EO wins over filename saying EC', () => {
    const r = rec('x_EC.edf', '2026-01-01T00:00:00Z', { condition_type: 'EO' });
    const s = pairSessions([r]);
    expect(s[0].recordingIds).toEqual({ eo: r.id });
  });
  it('prefers filename match over closer time-only match', () => {
    const eo = rec('Sam_EO.edf', '2026-01-01T10:00:00Z');
    const other = rec('Zed_EC.edf', '2026-01-01T10:01:00Z');
    const match = rec('Sam_EC.edf', '2026-01-01T15:00:00Z');
    const s = pairSessions([eo, other, match]);
    const paired = s.find((x) => x.recordingIds.eo === eo.id)!;
    expect(paired.recordingIds.ec).toBe(match.id);
    expect(paired.pairing).toBe('filename');
  });
});
