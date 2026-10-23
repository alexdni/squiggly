import 'server-only';
// Server-side EO/EC session pairing. Filenames are used for pairing only
// and are never carried on a Session.
import { sessionId } from './ids';

export type Condition = 'EO' | 'EC' | 'BOTH';

export interface RecordingRow {
  id: string;
  project_id: string;
  filename: string;
  condition_type: Condition;
  created_at: string;
  duration_seconds: number | null;
  sampling_rate: number | null;
  n_channels: number | null;
  montage: string | null;
  reference: string | null;
  eo_start: number | null;
  eo_end: number | null;
  ec_start: number | null;
  ec_end: number | null;
}

export interface Session {
  id: string;
  recordingIds: { eo?: string; ec?: string; both?: string };
  date: string;
  pairing: 'filename' | 'time' | 'single';
}

// Any non-letter may precede the token (e.g. '…45EO.edf'); a digit after it is a TheraQ phase file ('EO1'), not a token.
const TOKEN_RE = /(^|[^a-z])(EO|EC|eyes[\s_-]?open|eyes[\s_-]?closed)(?=$|[^a-z0-9])/i;
const THERAQ_RE = /(^|[\s_.-])E[OC]\d(?=$|[\s_.-])/i;
const MAX_GAP_MS = 24 * 3600 * 1000;

export function isTheraqPhaseFile(filename: string): boolean {
  return THERAQ_RE.test(filename);
}

export function conditionOf(r: RecordingRow): Condition {
  if (r.condition_type === 'EO' || r.condition_type === 'EC') return r.condition_type;
  const m = TOKEN_RE.exec(r.filename);
  if (!m) return 'BOTH';
  return m[2].toLowerCase().startsWith('eyes')
    ? m[2].toLowerCase().includes('open') ? 'EO' : 'EC'
    : (m[2].toUpperCase() as 'EO' | 'EC');
}

/** Lowercased filename without extension and condition token, separators collapsed to '_'. */
function baseName(filename: string): string {
  return filename
    .replace(/\.[^.\s]{1,5}$/, '')
    .replace(TOKEN_RE, (_m, lead: string) => lead)
    .toLowerCase()
    .replace(/[\s_.-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function pairSessions(rows: RecordingRow[]): Session[] {
  const time = (r: RecordingRow) => Date.parse(r.created_at);
  const theraq = (r: RecordingRow) => isTheraqPhaseFile(r.filename);
  const cond = new Map(rows.map((r) => [r.id, conditionOf(r)]));
  const eos = rows.filter((r) => cond.get(r.id) === 'EO' && !theraq(r));
  const ecs = rows.filter((r) => cond.get(r.id) === 'EC' && !theraq(r));

  const candidates: { eo: RecordingRow; ec: RecordingRow; match: boolean; gap: number }[] = [];
  for (const eo of eos) {
    for (const ec of ecs) {
      if (eo.project_id !== ec.project_id) continue;
      const gap = Math.abs(time(eo) - time(ec));
      if (!(gap < MAX_GAP_MS)) continue;
      candidates.push({ eo, ec, match: baseName(eo.filename) === baseName(ec.filename), gap });
    }
  }
  candidates.sort((a, b) => Number(b.match) - Number(a.match) || a.gap - b.gap);

  const used = new Set<string>();
  const sessions: Session[] = [];
  const make = (
    recordingIds: Session['recordingIds'],
    ids: string[],
    dates: string[],
    pairing: Session['pairing'],
  ): Session => ({
    id: sessionId(ids),
    recordingIds,
    date: dates.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b)),
    pairing,
  });

  for (const c of candidates) {
    if (used.has(c.eo.id) || used.has(c.ec.id)) continue;
    used.add(c.eo.id);
    used.add(c.ec.id);
    sessions.push(
      make({ eo: c.eo.id, ec: c.ec.id }, [c.eo.id, c.ec.id], [c.eo.created_at, c.ec.created_at], c.match ? 'filename' : 'time'),
    );
  }

  for (const r of rows) {
    if (used.has(r.id)) continue;
    const c = cond.get(r.id)!;
    const key = c === 'EO' ? 'eo' : c === 'EC' ? 'ec' : 'both';
    sessions.push(make({ [key]: r.id }, [r.id], [r.created_at], 'single'));
  }

  return sessions.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}
