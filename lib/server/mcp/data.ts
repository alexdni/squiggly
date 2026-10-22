// User-scoped data loaders for the MCP tools. Every query runs through the injected db (bound to
// the caller's OAuth token, so RLS applies) and RBAC is re-checked with the same db. Selects list
// explicit columns: never client_metadata, project name, file_path or `*`. Denial, a missing row and
// a malformed ref all throw the same 'Not found'.

import type { DatabaseClient } from '@/lib/db/types';
import { checkProjectPermission, type Permission } from '@/lib/rbac';
import type { AnalysisResults } from '@/lib/analysis-results';
import { McpUserError } from './errors';
import { UUID_RE, decodeSessionId, parseRef } from './ids';
import { pairSessions, type RecordingRow, type Session } from './sessions';
import { buildSessionSummary, recordingMetaOf, type AnalysisInput, type RecordingMeta, type SessionSummary } from './summary';

type Source = 'eo' | 'ec' | 'both';
type Parts = { eo?: AnalysisInput; ec?: AnalysisInput; both?: AnalysisInput };

export const MAX_SESSIONS = 100;
const MAX_TREND = 20;
/** PostgREST silently clips at 1000 rows, so every list query asks for exactly that and checks for it. */
const ROW_CAP = 1000;
const ID_CHUNK = 50;

const RECORDING_COLS =
  'id, project_id, filename, condition_type, created_at, duration_seconds, sampling_rate, n_channels, montage, reference, eo_start, eo_end, ec_start, ec_end';

export interface ProjectListItem {
  id: string;
  label: string;
  role: string;
  recording_count: number;
  first_upload: string | null;
  last_upload: string | null;
  /** true when the project has at least the row cap of recordings, so count and first_upload are lower bounds */
  counts_approximate?: boolean;
}

export interface SessionWithRecordings extends Session {
  recordings: RecordingMeta[];
}

export interface LoadedSession {
  session: Session;
  parts: Parts;
  engines: Record<Source, string | undefined>;
  /** the session's recording rows, filenames blanked; includes recordings with no analysis */
  recordings: RecordingRow[];
}

const notFound = () => new McpUserError('Not found');

/** Callers see 'Not found'; the real error is logged server-side (no tokens, no row contents). */
function dbFailure(table: string, error: Error): McpUserError {
  console.error('[mcp] db error', { table, message: error.message });
  return notFound();
}

async function rows<T>(table: string, q: Promise<{ data: unknown; error: Error | null }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw dbFailure(table, error);
  return (data ?? []) as T[];
}

async function one<T>(table: string, q: Promise<{ data: unknown; error: Error | null }>): Promise<T | null> {
  const { data, error } = await q;
  if (error) {
    // .single() reports a missing row as an error too; only log genuine failures
    if (!/no rows|0 rows|no row|multiple/i.test(error.message)) console.error('[mcp] db error', { table, message: error.message });
    return null;
  }
  if (!data) return null;
  return (Array.isArray(data) ? data[0] ?? null : data) as T | null;
}

async function assertPermission(db: DatabaseClient, userId: string, projectId: string, permission: Permission): Promise<void> {
  if (!(await checkProjectPermission(projectId, userId, permission, db))) throw notFound();
}

async function projectRecordings(db: DatabaseClient, projectId: string): Promise<RecordingRow[]> {
  return rows<RecordingRow>(
    'recordings',
    db.from('recordings').select(RECORDING_COLS).eq('project_id', projectId).order('created_at', { ascending: false }).limit(ROW_CAP).execute(),
  );
}

interface AnalysisHead {
  id: string;
  recording_id: string;
  status: string;
}

/** Latest analysis (by created_at) per recording; `pinned` forces a specific analysis for a recording. */
async function latestAnalyses(
  db: DatabaseClient,
  recordingIds: string[],
  pinned: Record<string, string> = {},
): Promise<Map<string, AnalysisHead>> {
  const out = new Map<string, AnalysisHead>();
  if (!recordingIds.length) return out;
  for (let i = 0; i < recordingIds.length; i += ID_CHUNK) {
    const heads = await rows<AnalysisHead>(
      'analyses',
      db
        .from('analyses')
        .select('id, recording_id, status, created_at')
        .in('recording_id', recordingIds.slice(i, i + ID_CHUNK))
        .order('created_at', { ascending: false })
        .limit(ROW_CAP)
        .execute(),
    );
    for (const h of heads) {
      if (pinned[h.recording_id] ? h.id === pinned[h.recording_id] : !out.has(h.recording_id)) out.set(h.recording_id, h);
    }
  }
  return out;
}

const engineOf = (results: AnalysisResults | null): string | undefined => {
  const e = (results?.processing_metadata as { engine?: unknown } | undefined)?.engine;
  return typeof e === 'string' ? e : undefined;
};

/** Only the stored event review decisions are carried; the rest of config stays server-side. */
function reviewsOnly(config: unknown): { event_reviews: unknown } | null {
  const reviews = config && typeof config === 'object' ? (config as { event_reviews?: unknown }).event_reviews : undefined;
  return reviews === undefined ? null : { event_reviews: reviews };
}

const SOURCES: Source[] = ['eo', 'ec', 'both'];

/** Loads analyses (with results) for the given sessions' recordings; results are fetched only for the chosen analyses. */
async function loadParts(
  db: DatabaseClient,
  sessions: Session[],
  recs: RecordingRow[],
  pinned: Record<string, string> = {},
): Promise<LoadedSession[]> {
  const byId = new Map(recs.map((r) => [r.id, r]));
  const recIds = sessions.flatMap((s) => SOURCES.map((k) => s.recordingIds[k]).filter((x): x is string => !!x));
  const heads = await latestAnalyses(db, recIds, pinned);
  const chosen = [...heads.values()].map((h) => h.id);
  const full = chosen.length
    ? await rows<AnalysisHead & { results: AnalysisResults | null; config: unknown }>(
        'analyses',
        db.from('analyses').select('id, recording_id, status, results, config').in('id', chosen).limit(ROW_CAP).execute(),
      )
    : [];
  const fullById = new Map(full.map((a) => [a.id, a]));

  return sessions.map((session) => {
    const parts: Parts = {};
    const engines: Record<Source, string | undefined> = { eo: undefined, ec: undefined, both: undefined };
    const recordings: RecordingRow[] = [];
    for (const k of SOURCES) {
      const rid = session.recordingIds[k];
      const head = rid ? heads.get(rid) : undefined;
      const rec = rid ? byId.get(rid) : undefined;
      if (rec) recordings.push({ ...rec, filename: '' });
      if (!head || !rec) continue;
      const a = fullById.get(head.id);
      const results = a?.results ?? null;
      parts[k] = { analysisId: head.id, recording: { ...rec, filename: '' }, status: a?.status ?? head.status, results, config: reviewsOnly(a?.config) };
      engines[k] = engineOf(results);
    }
    return { session, parts, engines, recordings };
  });
}

export async function listProjects(db: DatabaseClient, userId: string): Promise<ProjectListItem[]> {
  const owned = await rows<{ id: string }>('projects', db.from('projects').select('id').eq('owner_id', userId).execute());
  const memberships = await rows<{ project_id: string; role: string }>(
    'project_members',
    db.from('project_members').select('project_id, role').eq('user_id', userId).execute(),
  );
  const roles = new Map<string, string>();
  for (const m of memberships) roles.set(m.project_id, m.role);
  for (const p of owned) roles.set(p.id, 'owner');
  const ids = [...roles.keys()];
  if (!ids.length) return [];

  // One capped query per project so a busy project cannot starve the others' counts
  const stats = new Map<string, { n: number; first: string; last: string; approx: boolean }>();
  for (const id of ids) {
    const recs = await rows<{ created_at: string }>(
      'recordings',
      db.from('recordings').select('created_at').eq('project_id', id).order('created_at', { ascending: false }).limit(ROW_CAP).execute(),
    );
    if (!recs.length) continue;
    stats.set(id, {
      n: recs.length,
      last: recs[0].created_at,
      first: recs[recs.length - 1].created_at,
      approx: recs.length >= ROW_CAP,
    });
  }

  return ids
    .map((id) => ({
      id,
      label: 'Project ' + id.slice(0, 8),
      role: roles.get(id)!,
      recording_count: stats.get(id)?.n ?? 0,
      first_upload: stats.get(id)?.first ?? null,
      last_upload: stats.get(id)?.last ?? null,
      ...(stats.get(id)?.approx ? { counts_approximate: true } : {}),
    }))
    .sort((a, b) => Date.parse(b.last_upload ?? '') - Date.parse(a.last_upload ?? '') || 0);
}

export async function listSessions(
  db: DatabaseClient,
  userId: string,
  projectId: string,
): Promise<{ sessions: SessionWithRecordings[]; truncated: boolean }> {
  if (!UUID_RE.test(projectId)) throw notFound();
  await assertPermission(db, userId, projectId, 'project:read');
  const recs = await projectRecordings(db, projectId);
  const all = pairSessions(recs);
  const truncated = all.length > MAX_SESSIONS || recs.length >= ROW_CAP;
  const sessions = all.slice(0, MAX_SESSIONS);

  const byId = new Map(recs.map((r) => [r.id, r]));
  const recIds = sessions.flatMap((s) => SOURCES.map((k) => s.recordingIds[k]).filter((x): x is string => !!x));
  const heads = await latestAnalyses(db, recIds);

  return {
    sessions: sessions.map((s) => ({
      ...s,
      recordings: SOURCES.map((k) => s.recordingIds[k])
        .filter((x): x is string => !!x)
        .map((rid) => {
          const head = heads.get(rid);
          return recordingMetaOf(byId.get(rid)!, head ? { id: head.id, status: head.status } : null);
        }),
    })),
    truncated,
  };
}

/** Resolves an analysis id to the pieces needed for auth and pairing. */
async function analysisContext(db: DatabaseClient, id: string) {
  const a = await one<AnalysisHead>('analyses', db.from('analyses').select('id, recording_id, status').eq('id', id).single());
  if (!a) return null;
  const rec = await recordingById(db, a.recording_id);
  return rec ? { analysis: a, recording: rec } : null;
}

async function recordingById(db: DatabaseClient, id: string): Promise<RecordingRow | null> {
  return one<RecordingRow>('recordings', db.from('recordings').select(RECORDING_COLS).eq('id', id).single());
}

export async function loadSession(db: DatabaseClient, userId: string, ref: string): Promise<LoadedSession> {
  const parsed = parseRef(ref);
  let recording: RecordingRow | null = null;
  let analysisId: string | undefined;
  let sessionIdWanted: string | undefined;

  if (parsed.kind === 'session') {
    const ids = decodeSessionId(parsed.id);
    if (!ids) throw notFound();
    recording = await recordingById(db, ids[0]);
    sessionIdWanted = parsed.id;
  } else if (parsed.kind === 'analysis' || parsed.kind === 'unknown') {
    if (!UUID_RE.test(parsed.id)) throw notFound();
    const ctx = await analysisContext(db, parsed.id);
    if (ctx) {
      recording = ctx.recording;
      analysisId = ctx.analysis.id;
    } else if (parsed.kind === 'unknown') {
      recording = await recordingById(db, parsed.id);
    }
  } else if (parsed.kind === 'recording') {
    recording = await recordingById(db, parsed.id);
  } else {
    throw notFound();
  }
  if (!recording) throw notFound();

  await assertPermission(db, userId, recording.project_id, 'analysis:read');
  const recs = await projectRecordings(db, recording.project_id);
  const session = pairSessions(recs).find((s) =>
    sessionIdWanted ? s.id === sessionIdWanted : Object.values(s.recordingIds).includes(recording!.id),
  );
  if (!session) throw notFound();

  const pinned = analysisId ? { [recording.id]: analysisId } : {};
  const [loaded] = await loadParts(db, [session], recs, pinned);
  return loaded;
}

export async function loadAnalysis(db: DatabaseClient, userId: string, analysisRef: string): Promise<AnalysisInput> {
  const parsed = parseRef(analysisRef);
  if ((parsed.kind !== 'analysis' && parsed.kind !== 'unknown') || !UUID_RE.test(parsed.id)) throw notFound();
  const ctx = await analysisContext(db, parsed.id);
  if (!ctx) throw notFound();
  await assertPermission(db, userId, ctx.recording.project_id, 'analysis:read');
  const full = await one<AnalysisHead & { results: AnalysisResults | null; config: unknown }>('analyses', 
    db.from('analyses').select('id, recording_id, status, results, config').eq('id', ctx.analysis.id).single(),
  );
  if (!full) throw notFound();
  return {
    analysisId: full.id,
    recording: { ...ctx.recording, filename: '' },
    status: full.status,
    results: full.results ?? null,
    config: reviewsOnly(full.config),
  };
}

export async function loadProjectSummaries(
  db: DatabaseClient,
  userId: string,
  projectId: string,
  lastN: number,
): Promise<SessionSummary[]> {
  if (!UUID_RE.test(projectId)) throw notFound();
  await assertPermission(db, userId, projectId, 'analysis:read');
  const n = Math.min(MAX_TREND, Math.max(1, Math.floor(Number.isFinite(lastN) ? lastN : MAX_TREND)));
  const recs = await projectRecordings(db, projectId);
  const sessions = pairSessions(recs).slice(0, n);
  const loaded = await loadParts(db, sessions, recs);
  return loaded.map((l) => buildSessionSummary(l.session, l.parts, l.recordings));
}
