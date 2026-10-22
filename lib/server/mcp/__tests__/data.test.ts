import { describe, it, expect, vi } from 'vitest';
import { McpUserError } from '@/lib/server/mcp/errors';
import { listProjects, listSessions, loadAnalysis, loadProjectSummaries, loadSession } from '@/lib/server/mcp/data';
import { sessionId } from '@/lib/server/mcp/ids';
import { buildSessionSummary } from '@/lib/server/mcp/summary';
import { fakeDb } from './fakeDb';
import { PROJECT_ID, SECRETS, makeAnalysisRow, makeEvent, makeProject, makeRecording, makeResults } from './fixtures';

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
    expect(out.sessions[0].recordings[0].analysis?.status).toBe('pending');
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

  it('passes only event_reviews from the stored config, so review decisions reach the summary', async () => {
    const w = world();
    const ev = makeEvent({ category: 'epileptiform', pattern: 'spike-wave', channels: ['T7'], handling: 'noted' });
    const gone = makeEvent({ category: 'epileptiform', pattern: 'sharp', channels: ['F3'], handling: 'noted' });
    const results = makeResults({ conditions: ['eo'], events: [ev, gone] });
    const eoA = makeAnalysisRow(w.eo, results, { config: { secret: SECRETS.configSecret, event_reviews: { [ev.id]: 'confirmed', [gone.id]: 'dismissed' } } });
    const { db } = fakeDb({ ...w.tables, analyses: [eoA, w.ecA] });
    const a = await loadAnalysis(db, OWNER, eoA.id);
    expect(a.config).toEqual({ event_reviews: { [ev.id]: 'confirmed', [gone.id]: 'dismissed' } });
    const { session, parts } = await loadSession(db, OWNER, eoA.id);
    const s = buildSessionSummary(session, parts);
    expect(s.clinical_flags.map((f) => [f.id, f.review])).toEqual([[ev.id, 'confirmed']]);
    expect(JSON.stringify(parts.eo?.config)).not.toContain(SECRETS.configSecret);
    const [sum] = await loadProjectSummaries(db, OWNER, PROJECT_ID, 1);
    expect(sum.clinical_flags.map((f) => f.review)).toEqual(['confirmed']);
  });

  it('uses explicit limits and flags truncation when the row cap is hit', async () => {
    const recs = Array.from({ length: 1000 }, (_, i) =>
      makeRecording({ condition_type: 'BOTH', filename: `r${i}.edf`, created_at: new Date(Date.UTC(2026, 0, 1) + i * 3600e3).toISOString() }),
    );
    const f = fakeDb({ projects: [makeProject()], project_members: [], recordings: recs, analyses: [] });
    const out = await listSessions(f.db, OWNER, PROJECT_ID);
    expect(out.truncated).toBe(true);
    const few = fakeDb({ projects: [makeProject()], project_members: [], recordings: recs.slice(0, 999), analyses: [] });
    expect((await listSessions(few.db, OWNER, PROJECT_ID)).truncated).toBe(true); // 999 sessions > 100
    const tiny = fakeDb({ projects: [makeProject()], project_members: [], recordings: recs.slice(0, 3), analyses: [] });
    expect((await listSessions(tiny.db, OWNER, PROJECT_ID)).truncated).toBe(false);
    for (const t of [f, few, tiny]) {
      expect(t.selects.filter((s) => ['recordings', 'analyses'].includes(s.table) && !/^id, recording_id, status, results$/.test(s.columns)).every((s) => s.limit === 1000)).toBe(true);
    }
  });

  it('listProjects marks counts_approximate when the recordings cap is hit', async () => {
    const recs = Array.from({ length: 1000 }, (_, i) =>
      makeRecording({ condition_type: 'BOTH', created_at: new Date(Date.UTC(2026, 0, 1) + i * 3600e3).toISOString() }),
    );
    const f = fakeDb({ projects: [makeProject()], project_members: [], recordings: recs, analyses: [] });
    const [p] = await listProjects(f.db, OWNER);
    expect(p.recording_count).toBe(1000);
    expect(p.counts_approximate).toBe(true);
    expect(f.selects.filter((s) => s.table === 'recordings').every((s) => s.limit === 1000)).toBe(true);
    const w = world();
    expect((await listProjects(fakeDb(w.tables).db, OWNER))[0]).not.toHaveProperty('counts_approximate');
  });

  it('db errors still read as Not found but are logged server-side without row data', async () => {
    const w = world();
    const f = fakeDb(w.tables);
    f.errors.recordings = new Error('boom');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await notFound(listSessions(f.db, OWNER, PROJECT_ID))).toBe('Not found');
    expect(spy).toHaveBeenCalledWith('[mcp] db error', { table: 'recordings', message: 'boom' });
    spy.mockRestore();
  });

  it('a recording without an analysis has analysis: null', async () => {
    const w = world();
    const { db } = fakeDb({ ...w.tables, analyses: [] });
    const out = await listSessions(db, OWNER, PROJECT_ID);
    expect(out.sessions[0].recordings.every((r) => r.analysis === null)).toBe(true);
  });
});
