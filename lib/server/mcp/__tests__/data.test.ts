import { describe, it, expect } from 'vitest';
import type { DatabaseClient, QueryResult } from '@/lib/db/types';
import { McpUserError } from '@/lib/server/mcp/errors';
import { listProjects, listSessions, loadAnalysis, loadProjectSummaries, loadSession } from '@/lib/server/mcp/data';
import { sessionId } from '@/lib/server/mcp/ids';
import { PROJECT_ID, SECRETS, makeAnalysisRow, makeProject, makeRecording, makeResults } from './fixtures';

type Row = Record<string, unknown>;

/** In-memory db: projects each select's column list (so unselected columns never leak) and records every select. */
function fakeDb(tables: Record<string, object[]>) {
  const selects: { table: string; columns: string }[] = [];
  const db = {
    from(table: string) {
      return {
        select(columns = '*') {
          selects.push({ table, columns });
          let out = [...(tables[table] ?? [])] as Row[];
          const b = {
            eq: (c: string, v: unknown) => ((out = out.filter((r) => r[c] === v)), b),
            in: (c: string, vs: unknown[]) => ((out = out.filter((r) => vs.includes(r[c]))), b),
            order: (c: string, o?: { ascending?: boolean }) => {
              const dir = o?.ascending === false ? -1 : 1;
              out.sort((x, y) => dir * (Date.parse(String(x[c])) - Date.parse(String(y[c]))));
              return b;
            },
            limit: (n: number) => ((out = out.slice(0, n)), b),
            async single(): Promise<QueryResult> {
              return out.length === 1 ? { data: project(out[0]), error: null } : { data: null, error: new Error('no row') };
            },
            async execute(): Promise<QueryResult<Row[]> > {
              return { data: out.map(project) as never, error: null };
            },
          };
          const cols = columns.split(',').map((c) => c.trim());
          const project = (r: Row): Row => (columns === '*' ? r : Object.fromEntries(cols.map((c) => [c, r[c]])));
          return b as never;
        },
      };
    },
  } as unknown as DatabaseClient;
  return { db, selects };
}

const OWNER = 'owner-user-id';
const VIEWER = 'viewer-user-id';
const STRANGER = 'stranger-user-id';

function world() {
  const eo = makeRecording({ condition_type: 'EO', filename: 'x_EO.edf', created_at: '2026-10-01T10:00:00Z' });
  const ec = makeRecording({ condition_type: 'EC', filename: 'x_EC.edf', created_at: '2026-10-01T10:10:00Z' });
  const eoA = makeAnalysisRow(eo, makeResults({ conditions: ['eo'] }));
  const ecA = makeAnalysisRow(ec, makeResults({ conditions: ['ec'] }));
  const tables = {
    projects: [makeProject()],
    project_members: [{ project_id: PROJECT_ID, user_id: VIEWER, role: 'viewer' }],
    recordings: [eo, ec],
    analyses: [eoA, ecA],
  };
  return { eo, ec, eoA, ecA, tables };
}

const notFound = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x) => x);
  expect(e).toBeInstanceOf(McpUserError);
  return (e as Error).message;
};

describe('data loaders', () => {
  it('denies a non-member with the same text as a random uuid', async () => {
    const w = world();
    const { db } = fakeDb(w.tables);
    const denied = await notFound(loadAnalysis(db, STRANGER, w.eoA.id));
    const missing = await notFound(loadAnalysis(db, STRANGER, '99999999-9999-9999-9999-999999999999'));
    expect(denied).toBe('Not found');
    expect(denied).toBe(missing);
    expect(await notFound(loadSession(db, STRANGER, w.eoA.id))).toBe('Not found');
    expect(await notFound(loadSession(db, STRANGER, 'garbage'))).toBe('Not found');
    expect(await notFound(listSessions(db, STRANGER, PROJECT_ID))).toBe('Not found');
  });

  it('lets a viewer load an analysis, without filename', async () => {
    const w = world();
    const { db } = fakeDb(w.tables);
    const a = await loadAnalysis(db, VIEWER, w.eoA.id);
    expect(a.analysisId).toBe(w.eoA.id);
    expect(a.recording.filename).toBe('');
    expect(a.results).not.toBeNull();
    expect(JSON.stringify(a)).not.toContain(SECRETS.filePath);
  });

  it('resolves an analysis, recording and session ref to the paired session', async () => {
    const w = world();
    const { db } = fakeDb(w.tables);
    const sid = sessionId([w.eo.id, w.ec.id]);
    for (const ref of [w.eoA.id, w.eo.id, `https://x.test/analyses/${w.eoA.id}`, sid]) {
      const s = await loadSession(db, OWNER, ref);
      expect(s.session.id).toBe(sid);
      expect(s.parts.eo?.analysisId).toBe(w.eoA.id);
      expect(s.parts.ec?.analysisId).toBe(w.ecA.id);
      expect(s.parts.eo?.recording.filename).toBe('');
      expect(s.engines.eo).toBe('hybrid-asr-ica@0.33.0');
    }
  });

  it('uses the latest analysis per recording, and the pinned one for an analysis ref', async () => {
    const w = world();
    const newer = { ...makeAnalysisRow(w.eo, makeResults({ conditions: ['eo'] })), created_at: '2026-10-02T00:00:00Z' };
    const { db } = fakeDb({ ...w.tables, analyses: [...w.tables.analyses, newer] });
    expect((await loadSession(db, OWNER, w.eo.id)).parts.eo?.analysisId).toBe(newer.id);
    expect((await loadSession(db, OWNER, w.eoA.id)).parts.eo?.analysisId).toBe(w.eoA.id);
  });

  it('caps at 100 sessions and flags truncation', async () => {
    const recs = Array.from({ length: 150 }, (_, i) =>
      makeRecording({ condition_type: 'BOTH', filename: `r${i}.edf`, created_at: new Date(Date.UTC(2026, 0, 1) + i * 3600e3).toISOString() }),
    );
    const { db } = fakeDb({
      projects: [makeProject()],
      project_members: [],
      recordings: recs,
      analyses: recs.map((r) => makeAnalysisRow(r, null, { status: 'pending' })),
    });
    const out = await listSessions(db, OWNER, PROJECT_ID);
    expect(out.truncated).toBe(true);
    expect(out.sessions).toHaveLength(100);
    expect(out.sessions[0].recordings[0].analysis.status).toBe('pending');
    expect(JSON.stringify(out)).not.toMatch(/r\d+\.edf/);
  });

  it('listProjects covers owned and member projects with labels and upload range', async () => {
    const w = world();
    const other = makeProject({ id: '22222222-0000-0000-0000-000000000000', owner_id: 'someone' });
    const { db } = fakeDb({ ...w.tables, projects: [...w.tables.projects, other] });
    const owner = await listProjects(db, OWNER);
    expect(owner).toEqual([
      { id: PROJECT_ID, label: 'Project 11111111', role: 'owner', recording_count: 2, first_upload: '2026-10-01T10:00:00Z', last_upload: '2026-10-01T10:10:00Z' },
    ]);
    expect((await listProjects(db, VIEWER)).map((p) => p.role)).toEqual(['viewer']);
    expect(await listProjects(db, STRANGER)).toEqual([]);
  });

  it('loadProjectSummaries returns the most recent N summaries, clamped', async () => {
    const recs = Array.from({ length: 25 }, (_, i) =>
      makeRecording({ condition_type: 'BOTH', filename: `r${i}.edf`, created_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() }),
    );
    const { db } = fakeDb({
      projects: [makeProject()],
      project_members: [],
      recordings: recs,
      analyses: recs.map((r) => makeAnalysisRow(r, makeResults({ conditions: ['eo', 'ec'] }))),
    });
    expect(await loadProjectSummaries(db, OWNER, PROJECT_ID, 3)).toHaveLength(3);
    expect(await loadProjectSummaries(db, OWNER, PROJECT_ID, 99)).toHaveLength(20);
    expect(await loadProjectSummaries(db, OWNER, PROJECT_ID, 0)).toHaveLength(1);
    const [newest] = await loadProjectSummaries(db, OWNER, PROJECT_ID, 2);
    expect(newest.session.date).toBe(new Date(Date.UTC(2026, 0, 25)).toISOString());
    expect(await notFound(loadProjectSummaries(db, STRANGER, PROJECT_ID, 3))).toBe('Not found');
  });

  it('never selects client_metadata, project name, file_path or *', async () => {
    const w = world();
    const { db, selects } = fakeDb(w.tables);
    await listProjects(db, OWNER);
    await listSessions(db, OWNER, PROJECT_ID);
    await loadSession(db, OWNER, w.eoA.id);
    await loadAnalysis(db, VIEWER, w.eoA.id);
    await loadProjectSummaries(db, OWNER, PROJECT_ID, 5);
    expect(selects.length).toBeGreaterThan(5);
    for (const s of selects) {
      expect(s.columns).not.toMatch(/client_metadata|file_path|\*|\bname\b|description/);
    }
    // results only where summaries are built
    const withResults = selects.filter((s) => /results/.test(s.columns));
    expect(withResults.every((s) => s.table === 'analyses')).toBe(true);
    const list = await (async () => {
      const f = fakeDb(w.tables);
      await listSessions(f.db, OWNER, PROJECT_ID);
      return f.selects;
    })();
    expect(list.some((s) => /results/.test(s.columns))).toBe(false);
  });
});
