import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DatabaseClient } from '@/lib/db/types';
import { CLOSING_LINE, GUIDANCE, GUIDANCE_SHORT } from '@/lib/server/mcp/guidance';
import { sessionId } from '@/lib/server/mcp/ids';
import { TREND_METRICS } from '@/lib/server/mcp/trend';
import { PROJECT_ID } from './fixtures';
import { CLIENT, OWNER, STRANGER, mcpHarness, world } from './harness';

const TOOLS = ['list_projects', 'list_sessions', 'get_session_summary', 'get_analysis_detail', 'compare_sessions', 'get_metric_trend'];

let info: ReturnType<typeof spyInfo>;
const spyInfo = () => vi.spyOn(console, 'info').mockImplementation(() => {});
beforeEach(() => {
  info = spyInfo();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const logs = () => info.mock.calls.map((c: unknown[]) => JSON.parse(String(c[0])));

describe('MCP server', () => {
  it('lists exactly the six read-only tools, with the required description copy', async () => {
    const { rpc } = mcpHarness(world().tables);
    const { tools } = (await rpc('tools/list')) as { tools: { name: string; description: string; annotations?: { readOnlyHint?: boolean } }[] };
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOLS].sort());
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.description).toMatch(/pasted Squiggly links?/i);
    }
    const by = Object.fromEntries(tools.map((t) => [t.name, t.description]));
    expect(by.get_session_summary).toContain(GUIDANCE_SHORT);
    expect(by.compare_sessions).toContain(GUIDANCE_SHORT);
    expect(by.list_sessions).toMatch(/upload date/i);
    expect(by.list_sessions).toMatch(/re-list/i);
    expect(by.list_sessions).toMatch(/new uploads/i);
  });

  it('get_session_summary accepts a pasted /analyses/<id>/ URL', async () => {
    const w = world();
    const { call } = mcpHarness(w.tables);
    const res = await call('get_session_summary', { ref: `https://squiggly.example/analyses/${w.eoA.id}/` });
    expect(res.isError).toBeFalsy();
    const out = res.structuredContent as { session: { id: string } };
    expect(out.session.id).toBe(sessionId([w.eo.id, w.ec.id]));
    expect(JSON.parse(res.content[0].text)).toEqual(res.structuredContent);
  });

  it('a denied id and a random id both read "Not found"', async () => {
    const w = world();
    const { call } = mcpHarness(w.tables, { userId: STRANGER, clientId: CLIENT });
    for (const [tool, args] of [
      ['get_session_summary', { ref: w.eoA.id }],
      ['get_session_summary', { ref: '99999999-9999-9999-9999-999999999999' }],
      ['get_analysis_detail', { analysis: w.eoA.id, section: 'qc' }],
      ['list_sessions', { project: PROJECT_ID }],
      ['get_metric_trend', { project: PROJECT_ID, metrics: ['faa'] }],
      ['compare_sessions', { a: w.oldA.id, b: w.eoA.id }],
    ] as const) {
      const res = await call(tool, args);
      expect(res.isError, tool).toBe(true);
      expect(res.content[0].text).toBe('Not found');
    }
  });

  it('list_sessions and get_metric_trend accept a pasted project link', async () => {
    const w = world();
    const { call } = mcpHarness(w.tables);
    const sessions = await call('list_sessions', { project: `https://squiggly.example/projects/${PROJECT_ID}?tab=recordings` });
    expect(sessions.isError).toBeFalsy();
    expect((sessions.structuredContent as { sessions: unknown[] }).sessions).toHaveLength(2);
    const trend = await call('get_metric_trend', { project: `https://squiggly.example/projects/${PROJECT_ID}`, metrics: ['faa', 'alpha_peak_ec'] });
    expect(trend.isError).toBeFalsy();
    const t = trend.structuredContent as { trends: { metric: string; points: unknown[] }[] };
    expect(t.trends.map((x) => x.metric)).toEqual(['faa', 'alpha_peak_ec']);
    expect(t.trends[0].points).toHaveLength(2);
  });

  it('get_metric_trend: last_n defaults to 8, is capped at 20, and metrics must be known', async () => {
    const { rpc, call } = mcpHarness(world().tables);
    const { tools } = (await rpc('tools/list')) as { tools: { name: string; inputSchema: { properties: Record<string, { default?: number; maximum?: number; items?: { enum?: string[] } }> } }[] };
    const props = tools.find((t) => t.name === 'get_metric_trend')!.inputSchema.properties;
    expect(props.last_n.default).toBe(8);
    expect(props.last_n.maximum).toBe(20);
    expect(props.metrics.items?.enum).toEqual([...TREND_METRICS]);
    expect((await call('get_metric_trend', { project: PROJECT_ID, metrics: ['faa'], last_n: 21 })).isError).toBe(true);
    expect((await call('get_metric_trend', { project: PROJECT_ID, metrics: [] })).isError).toBe(true);
    expect((await call('get_metric_trend', { project: PROJECT_ID, metrics: ['bogus'] })).isError).toBe(true);
  });

  it('compare_sessions compares two sessions and reports the engine version difference', async () => {
    const w = world();
    const { call } = mcpHarness(w.tables);
    const res = await call('compare_sessions', { a: w.oldA.id, b: `https://squiggly.example/analyses/${w.ecA.id}` });
    expect(res.isError).toBeFalsy();
    const out = res.structuredContent as { a: { id: string }; b: { id: string }; engine_versions?: { a: string; b: string }; interpretation_guidance: string };
    expect(out.a.id).toBe(sessionId([w.old.id]));
    expect(out.b.id).toBe(sessionId([w.eo.id, w.ec.id]));
    expect(out.engine_versions).toEqual({ a: '0.32.0', b: '0.33.0' });
    expect(out.interpretation_guidance).toBe(GUIDANCE_SHORT);
  });

  it('compare_sessions expands a pasted compare link given as a (b omitted or equal)', async () => {
    const w = world();
    const { call } = mcpHarness(w.tables);
    const link = `https://squiggly.example/projects/${PROJECT_ID}/compare?a_id=${w.old.id}&b_id=${w.eo.id}`;
    for (const args of [{ a: link }, { a: link, b: link }]) {
      const res = await call('compare_sessions', args);
      expect(res.isError, res.content[0].text).toBeFalsy();
      const out = res.structuredContent as { a: { id: string }; b: { id: string } };
      expect(out.a.id).toBe(sessionId([w.old.id]));
      expect(out.b.id).toBe(sessionId([w.eo.id, w.ec.id]));
    }
  });

  it('compare_sessions without b (and no compare link) asks for two refs', async () => {
    const w = world();
    const { call } = mcpHarness(w.tables);
    for (const a of [w.oldA.id, `https://squiggly.example/projects/${PROJECT_ID}/compare?a_id=${w.old.id}`]) {
      const res = await call('compare_sessions', { a });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toMatch(/pass two session\/analysis refs/i);
    }
  });

  it('compare_sessions flags an engine mismatch between the analyses of one session', async () => {
    const w = world();
    const ecResults = w.ecA.results as { processing_metadata: { engine: string } };
    ecResults.processing_metadata.engine = 'hybrid-asr-ica@0.34.0';
    const { call } = mcpHarness(w.tables);
    const res = await call('compare_sessions', { a: w.oldA.id, b: w.ecA.id });
    const out = res.structuredContent as { caveats: string[]; engine_versions?: { a: string; b: string } };
    expect(out.caveats).toContain('engine version differs within B (0.33.0 vs 0.34.0)');
    expect(out.engine_versions).toEqual({ a: '0.32.0', b: '0.33.0,0.34.0' });
  });

  it('get_session_summary lists a recording with no analysis yet and explains it', async () => {
    const w = world();
    const tables = { ...w.tables, analyses: w.tables.analyses.filter((a) => a !== w.ecA) };
    const { call } = mcpHarness(tables);
    const res = await call('get_session_summary', { ref: w.eoA.id });
    expect(res.isError).toBeFalsy();
    const out = res.structuredContent as { session: { recordings: { id: string; analysis: unknown }[] }; status_note?: string };
    expect(out.session.recordings.map((r) => r.id).sort()).toEqual([w.eo.id, w.ec.id].sort());
    expect(out.session.recordings.find((r) => r.id === w.ec.id)!.analysis).toBeNull();
    expect(out.status_note).toMatch(/EC .*not analyzed yet/);
  });

  it('get_analysis_detail describes 1-based event pages', async () => {
    const { rpc } = mcpHarness(world().tables);
    const { tools } = (await rpc('tools/list')) as { tools: { name: string; description: string }[] };
    expect(tools.find((t) => t.name === 'get_analysis_detail')!.description).toMatch(/page \(events, 1-based/);
  });

  it('get_analysis_detail returns a section and rejects unknown sections', async () => {
    const w = world();
    const { call } = mcpHarness(w.tables);
    const res = await call('get_analysis_detail', { analysis: w.oldA.id, section: 'psd', condition: 'ec', channel: 'O1' });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toBeTruthy();
    expect((await call('get_analysis_detail', { analysis: w.oldA.id, section: 'raw' })).isError).toBe(true);
  });

  it('list_projects returns labelled projects', async () => {
    const { call } = mcpHarness(world().tables);
    const res = await call('list_projects');
    expect((res.structuredContent as { projects: { label: string }[] }).projects.map((p) => p.label)).toEqual(['Project 11111111']);
  });

  it('a call without auth info is Unauthorized', async () => {
    const { call } = mcpHarness(world().tables, null);
    const res = await call('list_projects');
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe('Unauthorized');
  });

  it('an unexpected error is logged and returned as "Internal error"', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = { from: () => { throw new Error('socket hang up'); } } as unknown as DatabaseClient;
    const { call } = mcpHarness({}, { userId: OWNER, clientId: CLIENT }, broken);
    const res = await call('list_projects');
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe('Internal error');
    expect(err).toHaveBeenCalled();
    expect(JSON.stringify(err.mock.calls)).toContain('socket hang up');
  });

  it('logs one mcp_call line per call with parsed ids only, never raw refs or results', async () => {
    const w = world();
    const { call } = mcpHarness(w.tables);
    await call('get_session_summary', { ref: `https://squiggly.example/analyses/${w.eoA.id}?who=Anna_Smith` });
    await call('get_session_summary', { ref: '99999999-9999-9999-9999-999999999999' });
    await call('compare_sessions', { a: sessionId([w.old.id]), b: w.ecA.id });
    const lines = logs();
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({ evt: 'mcp_call', user: OWNER, client: CLIENT, tool: 'get_session_summary', ids: [w.eoA.id], ms: expect.any(Number), ok: true });
    expect(lines[1]).toMatchObject({ tool: 'get_session_summary', ids: ['99999999-9999-9999-9999-999999999999'], ok: false });
    expect(lines[2]).toMatchObject({ tool: 'compare_sessions', ids: [w.old.id, w.ecA.id], ok: true });
    const raw = JSON.stringify(info.mock.calls);
    expect(raw).not.toMatch(/Anna|https?:|quality|token/);
  });

  it('exposes both prompts, built on canonical ids and the full guidance', async () => {
    const w = world();
    const { rpc } = mcpHarness(w.tables);
    const { prompts } = (await rpc('prompts/list')) as { prompts: { name: string }[] };
    expect(prompts.map((p) => p.name).sort()).toEqual(['compare_two_sessions', 'interpret_session']);
    const one = (await rpc('prompts/get', { name: 'interpret_session', arguments: { ref: `https://squiggly.example/analyses/${w.eoA.id}?who=Anna` } })) as {
      messages: { role: string; content: { type: string; text: string } }[];
    };
    expect(one.messages[0].role).toBe('user');
    const text = one.messages[0].content.text;
    expect(text).toContain('get_session_summary');
    expect(text).toContain(w.eoA.id);
    expect(text).toContain(GUIDANCE);
    expect(text).not.toMatch(/Anna|https?:/);
    const two = (await rpc('prompts/get', { name: 'compare_two_sessions', arguments: { a: w.oldA.id, b: w.ecA.id } })) as typeof one;
    expect(two.messages[0].content.text).toContain('compare_sessions');
    expect(two.messages[0].content.text).toContain(w.oldA.id);
    expect(two.messages[0].content.text).toContain(w.ecA.id);
  });

  it('serves the guidance as instructions and as a resource, ending with the closing line', async () => {
    expect(GUIDANCE).toContain(CLOSING_LINE);
    expect(CLOSING_LINE).toBe('Pattern-level interpretation from EEG features — not a diagnosis.');
    expect(GUIDANCE.trimEnd().endsWith(CLOSING_LINE)).toBe(true);
    expect(GUIDANCE_SHORT.length).toBeLessThanOrEqual(400);
    const { rpc } = mcpHarness(world().tables);
    const init = (await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })) as {
      instructions: string;
      serverInfo: { name: string };
    };
    expect(init.instructions).toBe(GUIDANCE);
    expect(init.serverInfo.name).toBe('squiggly');
    const read = (await rpc('resources/read', { uri: 'squiggly://guidance/interpretation' })) as { contents: { uri: string; text: string }[] };
    expect(read.contents[0].text).toBe(GUIDANCE);
  });
});
