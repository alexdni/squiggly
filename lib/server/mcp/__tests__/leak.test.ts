// End-to-end leak test: every tool, both prompts, the guidance resource and the initialize result,
// run through the real MCP handler against a project whose rows carry names, filenames, client
// metadata, storage URLs and paths, kernel ids, evidence and leaky engine text. Every output is
// deep-walked; no denylisted key and no identifying or internal string may appear anywhere.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DETAIL_SECTIONS } from '@/lib/server/mcp/detail';
import { sessionId } from '@/lib/server/mcp/ids';
import { TREND_METRICS } from '@/lib/server/mcp/trend';
import { PROJECT_ID } from './fixtures';
import { mcpHarness, world } from './harness';

const DENY_KEYS = new Set([
  'client_metadata', 'age', 'gender', 'primary_issue', 'name', 'description', 'filename', 'file_path', 'email',
  'cleaned_file_url', 'cleaned_file_format', 'kernel_id', 'head_model_id', 'processing_metadata', 'config',
  'evidence', 'visuals', 'values_path', 'spectra_path',
]);
const DENY_KEY_RE = /_path$|_url$/;
const DENY_STRINGS = ['Anna', 'Smith', 'ZZ_SECRET_ISSUE', 'KERN_SECRET', 'HEAD_SECRET', 'EVIDENCE_SECRET', 'CONFIG_SECRET', '.edf', 'http://', 'https://', '/storage/', '/var/task'];

function walk(v: unknown, path: string, hits: string[], checkKeys = true) {
  if (typeof v === 'string') {
    for (const s of DENY_STRINGS) if (v.includes(s)) hits.push(`${path}: ${JSON.stringify(v.slice(0, 120))} contains ${s}`);
    return;
  }
  if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}[${i}]`, hits, checkKeys));
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (checkKeys && (DENY_KEYS.has(k) || DENY_KEY_RE.test(k))) hits.push(`${path}.${k}: denylisted key`);
      walk(k, `${path}{key}`, hits);
      walk(x, `${path}.${k}`, hits, checkKeys);
    }
  }
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('MCP leak test', () => {
  it('no output of any tool, prompt or resource carries identifying data or engine internals', async () => {
    const w = world();
    const { rpc, call } = mcpHarness(w.tables);
    const outputs: [string, unknown][] = [];
    const tool = async (name: string, args: object = {}) => {
      const res = await call(name, args);
      expect(res.isError, `${name} ${JSON.stringify(args)}: ${res.content?.[0]?.text}`).toBeFalsy();
      outputs.push([`${name}(${JSON.stringify(args)})`, res]);
    };

    await tool('list_projects');
    await tool('list_sessions', { project: PROJECT_ID });
    await tool('list_sessions', { project: `https://squiggly.example/projects/${PROJECT_ID}` });
    for (const ref of [w.eoA.id, w.ecA.id, w.oldA.id, w.eo.id, sessionId([w.old.id]), `https://squiggly.example/analyses/${w.eoA.id}/`]) {
      await tool('get_session_summary', { ref });
    }
    for (const a of [w.eoA, w.ecA, w.oldA]) {
      for (const section of DETAIL_SECTIONS) {
        await tool('get_analysis_detail', { analysis: a.id, section, ...(section === 'psd' ? { region: 'occipital' } : {}) });
      }
    }
    await tool('get_analysis_detail', { analysis: w.oldA.id, section: 'band_power', condition: 'ec', band: 'alpha1', region: 'occipital' });
    await tool('get_analysis_detail', { analysis: w.oldA.id, section: 'connectivity', condition: 'eo', band: 'theta' });
    await tool('get_analysis_detail', { analysis: w.oldA.id, section: 'psd', channel: 'T7' });
    await tool('get_analysis_detail', { analysis: w.oldA.id, section: 'events', page: 1 });
    await tool('get_analysis_detail', { analysis: w.oldA.id, section: 'qc', condition: 'ec' });
    await tool('compare_sessions', { a: w.oldA.id, b: w.eoA.id });
    await tool('compare_sessions', { a: sessionId([w.old.id]), b: `https://squiggly.example/analyses/${w.ecA.id}` });
    await tool('get_metric_trend', { project: PROJECT_ID, metrics: [...TREND_METRICS], last_n: 20 });

    // error outputs too
    outputs.push(['not found', await call('get_session_summary', { ref: `https://squiggly.example/analyses/Anna_Smith` })]);

    outputs.push(['interpret_session', await rpc('prompts/get', { name: 'interpret_session', arguments: { ref: `https://squiggly.example/analyses/${w.eoA.id}?who=Anna_Smith` } })]);
    outputs.push(['compare_two_sessions', await rpc('prompts/get', { name: 'compare_two_sessions', arguments: { a: w.oldA.id, b: `https://squiggly.example/analyses/${w.ecA.id}` } })]);
    outputs.push(['resource', await rpc('resources/read', { uri: 'squiggly://guidance/interpretation' })]);
    // protocol metadata legitimately has `name` keys (prompt, argument and server names): strings only
    const meta: [string, unknown][] = [
      ['resources/list', await rpc('resources/list')],
      ['prompts/list', await rpc('prompts/list')],
      ['initialize', await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })],
    ];

    const hits: string[] = [];
    for (const [label, out] of meta) walk(out, label, hits, false);
    for (const [label, out] of outputs) {
      walk(out, label, hits);
      // the text content is JSON of the same output: walk the parsed form as well
      const content = (out as { content?: { text?: string }[] }).content;
      for (const c of content ?? []) {
        if (!c.text) continue;
        try {
          walk(JSON.parse(c.text), `${label}#text`, hits);
        } catch {
          walk(c.text, `${label}#text`, hits);
        }
      }
    }
    expect(hits).toEqual([]);
    // sanity: the walk saw the leaky inputs' surroundings (events, bad channels, warnings)
    const all = JSON.stringify(outputs);
    expect(all).toContain('spike-wave');
    expect(all).toContain('"T7"');
    expect(all).toContain('Source localization unavailable');
    expect(all).toContain('"pattern":"other"');
    // sanitized engine text keeps its readable part
    expect(all).toContain('"region":"left frontal"');
    expect(all).toContain('needs temporal chain');
    expect(all).toContain('"muscle"');
  });
});
