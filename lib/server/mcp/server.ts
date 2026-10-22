import 'server-only';
// The Squiggly MCP surface: six read-only tools, two prompts and the guidance resource. Every tool
// runs with the caller's token-bound db (RLS + RBAC), returns allowlisted output only, and logs one
// line per call with parsed ids, never raw refs (pasted URLs can carry names) or results.

import { z } from 'zod';
import type { CallToolResult, McpServer, ServerContext } from '@modelcontextprotocol/server';
import type { DatabaseClient } from '@/lib/db/types';
import { compareSessions } from './compare';
import { listProjects, listSessions, loadAnalysis, loadProjectSummaries, loadSession, type LoadedSession } from './data';
import { DETAIL_SECTIONS, buildDetail } from './detail';
import { McpUserError } from './errors';
import { GUIDANCE, GUIDANCE_SHORT } from './guidance';
import { UUID_RE, decodeSessionId, parseRef } from './ids';
import { buildSessionSummary } from './summary';
import { TREND_METRICS, buildTrend } from './trend';

export interface McpCtx {
  userId: string;
  db: DatabaseClient;
  clientId: string;
}

/** Resolves the per-call ctx from the request; null when the request carries no auth info. */
export type GetMcpCtx = (extra: ServerContext) => McpCtx | null;

export const MCP_SERVER_OPTIONS = {
  serverInfo: { name: 'squiggly', version: '1.0.0' },
  instructions: GUIDANCE,
};

export const GUIDANCE_URI = 'squiggly://guidance/interpretation';

const DEFAULT_TREND_N = 8;
const MAX_TREND_N = 20;

const LINKS = 'Accepts pasted Squiggly links as well as plain ids.';

/** Uuids named by a ref (session ids decode to their recording ids); never the raw string. */
function idsOf(...refs: unknown[]): string[] {
  const out = new Set<string>();
  for (const ref of refs) {
    if (typeof ref !== 'string') continue;
    const p = parseRef(ref);
    if (p.kind === 'session') decodeSessionId(p.id)?.forEach((id) => out.add(id));
    else if (UUID_RE.test(p.id)) out.add(p.id);
    for (const x of [p.extra?.a, p.extra?.b]) if (x) out.add(x);
  }
  return [...out];
}

/** A project id from a uuid or a pasted project link. */
function projectId(ref: string): string {
  const p = parseRef(ref);
  if ((p.kind === 'project' || p.kind === 'unknown') && UUID_RE.test(p.id)) return p.id;
  throw new McpUserError('Not found');
}

/** The canonical id a prompt should pass on: never the raw pasted string. */
function sessionRef(ref: string): string {
  const p = parseRef(ref);
  if (p.kind === 'session' || ((p.kind === 'analysis' || p.kind === 'unknown') && UUID_RE.test(p.id))) return p.id;
  throw new McpUserError('Not a Squiggly session, analysis or recording reference');
}

/** Every engine stamp among a session's analyses (EO, EC and combined), so mismatches inside one session show too. */
const enginesOf = (s: LoadedSession) => Object.values(s.engines).filter((e): e is string => !!e);

/**
 * compare_sessions refs: `a` and `b`, or a pasted compare page link as `a` (with `b` omitted or the
 * same link), which names the two recordings itself.
 */
function compareRefs(a: string, b: string | undefined): [string, string] {
  const p = parseRef(a);
  const link = p.kind === 'project' && p.extra?.a && p.extra?.b ? p.extra : null;
  if (link && (b === undefined || !b.trim() || b.trim() === a.trim())) return [link.a!, link.b!];
  if (b === undefined || !b.trim()) {
    throw new McpUserError('Pass two session/analysis refs (a and b), or a pasted Squiggly compare link as a.');
  }
  return [a, b];
}

const text = (message: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text: message }] });

export function registerSquigglyTools(server: McpServer, getCtx: GetMcpCtx): void {
  async function run(
    tool: string,
    extra: ServerContext,
    ids: string[],
    fn: (ctx: McpCtx) => Promise<object>,
  ): Promise<CallToolResult> {
    const started = Date.now();
    let ctx: McpCtx | null = null;
    let ok = false;
    try {
      ctx = getCtx(extra);
      if (!ctx) return text('Unauthorized');
      const out = (await fn(ctx)) as Record<string, unknown>;
      ok = true;
      return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out };
    } catch (e) {
      if (e instanceof McpUserError) return text(e.message);
      console.error('[mcp] tool error', { tool, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
      return text('Internal error');
    } finally {
      console.info(
        JSON.stringify({ evt: 'mcp_call', user: ctx?.userId ?? null, client: ctx?.clientId ?? null, tool, ids, ms: Date.now() - started, ok }),
      );
    }
  }

  const readOnly = { readOnlyHint: true };

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description:
        'List the Squiggly projects you can read, newest upload first, with your role, recording count and upload date range. ' +
        'Projects are shown as "Project <first 8 characters of the id>"; names and client details are never shared. ' +
        'Takes no arguments; the other tools accept pasted Squiggly links or the ids returned here.',
      inputSchema: z.object({}),
      annotations: readOnly,
    },
    async (_args, extra) =>
      run('list_projects', extra, [], async (c) => ({ projects: await listProjects(c.db, c.userId) })),
  );

  server.registerTool(
    'list_sessions',
    {
      title: 'List sessions',
      description:
        'List the EEG sessions of a project, newest first (up to 100). A session is one visit: an EO and an EC recording paired together, or a single recording. ' +
        'Dates are upload dates, not necessarily recording dates. ' +
        "Session ids are stable only while the project's recordings don't change: re-pairing after new uploads can change them, so re-list if a session id stops resolving. " +
        `\`project\`: a project id or a pasted Squiggly project link. ${LINKS}`,
      inputSchema: z.object({ project: z.string().describe('Project id or pasted Squiggly project link') }),
      annotations: readOnly,
    },
    async ({ project }, extra) =>
      run('list_sessions', extra, idsOf(project), async (c) => {
        const id = projectId(project);
        const { sessions, truncated } = await listSessions(c.db, c.userId, id);
        return { project: { id, label: 'Project ' + id.slice(0, 8) }, sessions, truncated };
      }),
  );

  server.registerTool(
    'get_session_summary',
    {
      title: 'Session summary',
      description:
        'Summarize one EEG session per condition (EO/EC): data quality and confidence, regional band power, ratios, asymmetry, alpha peak, complexity, connectivity, risk-pattern screens and detected events. ' +
        `\`ref\`: a session id, analysis id, recording id or a pasted Squiggly analysis link. ${LINKS} ` +
        GUIDANCE_SHORT,
      inputSchema: z.object({ ref: z.string().describe('Session id, analysis id, recording id or pasted Squiggly link') }),
      annotations: readOnly,
    },
    async ({ ref }, extra) =>
      run('get_session_summary', extra, idsOf(ref), async (c) => {
        const { session, parts, recordings } = await loadSession(c.db, c.userId, ref);
        return buildSessionSummary(session, parts, recordings);
      }),
  );

  server.registerTool(
    'get_analysis_detail',
    {
      title: 'Analysis detail',
      description:
        `Drill into one analysis. \`section\`: ${DETAIL_SECTIONS.join(', ')}. ` +
        'Optional filters: condition (eo or ec); band (band_power, connectivity); channel and region (band_power, psd); page (events, 1-based, 100 per page). ' +
        'Results are bounded: up to 200 connectivity pairs, PSD in 1 Hz bins up to 45 Hz. ' +
        `\`analysis\`: an analysis id or a pasted Squiggly analysis link. ${LINKS}`,
      inputSchema: z.object({
        analysis: z.string().describe('Analysis id or pasted Squiggly analysis link'),
        section: z.enum(DETAIL_SECTIONS),
        condition: z.enum(['eo', 'ec']).optional(),
        band: z.string().optional(),
        channel: z.string().optional(),
        region: z.string().optional(),
        page: z.number().int().min(1).optional(),
      }),
      annotations: readOnly,
    },
    async ({ analysis, section, ...filter }, extra) =>
      run('get_analysis_detail', extra, idsOf(analysis), async (c) =>
        buildDetail(await loadAnalysis(c.db, c.userId, analysis), section, filter),
      ),
  );

  server.registerTool(
    'compare_sessions',
    {
      title: 'Compare sessions',
      description:
        'Compare two sessions like-for-like (EO with EO, EC with EC), as B minus A; B should be the later session. ' +
        'Returns regional and channel changes, ratio and asymmetry deltas, risk-pattern flips, comparability caveats and an overall confidence. ' +
        `\`a\`, \`b\`: session ids, analysis ids, recording ids or pasted Squiggly analysis links. ` +
        'A pasted Squiggly compare page link may be given as `a` alone: it names both recordings. ' +
        `${LINKS} ` +
        GUIDANCE_SHORT,
      inputSchema: z.object({
        a: z.string().describe('Earlier session: id or pasted Squiggly link (or a compare page link naming both)'),
        b: z.string().optional().describe('Later session: id or pasted Squiggly link; omit only when a is a compare page link'),
      }),
      annotations: readOnly,
    },
    async ({ a, b }, extra) =>
      run('compare_sessions', extra, idsOf(a, b), async (c) => {
        const [refA, refB] = compareRefs(a, b);
        const sa = await loadSession(c.db, c.userId, refA);
        const sb = await loadSession(c.db, c.userId, refB);
        const comparison = compareSessions(
          buildSessionSummary(sa.session, sa.parts, sa.recordings),
          buildSessionSummary(sb.session, sb.parts, sb.recordings),
          { a: enginesOf(sa), b: enginesOf(sb) },
        );
        return { ...comparison, interpretation_guidance: GUIDANCE_SHORT };
      }),
  );

  server.registerTool(
    'get_metric_trend',
    {
      title: 'Metric trend',
      description:
        `Track metrics across a project's most recent sessions (last_n, default ${DEFAULT_TREND_N}, max ${MAX_TREND_N}), oldest to newest, one point per session with its confidence. ` +
        'A metric a session lacks is null. Dates are upload dates. ' +
        `\`project\`: a project id or a pasted Squiggly project link. ${LINKS}`,
      inputSchema: z.object({
        project: z.string().describe('Project id or pasted Squiggly project link'),
        metrics: z.array(z.enum(TREND_METRICS)).min(1),
        last_n: z.number().int().min(1).max(MAX_TREND_N).default(DEFAULT_TREND_N),
      }),
      annotations: readOnly,
    },
    async ({ project, metrics, last_n }, extra) =>
      run('get_metric_trend', extra, idsOf(project), async (c) => {
        const id = projectId(project);
        const summaries = await loadProjectSummaries(c.db, c.userId, id, last_n);
        return { project: { id, label: 'Project ' + id.slice(0, 8) }, trends: buildTrend(summaries, metrics, last_n) };
      }),
  );

  server.registerPrompt(
    'interpret_session',
    {
      title: 'Interpret a session',
      description: 'Interpret one Squiggly EEG session with the interpretation guidance. Accepts a session id, analysis id or pasted Squiggly link.',
      argsSchema: z.object({ ref: z.string().describe('Session id, analysis id or pasted Squiggly link') }),
    },
    ({ ref }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Call the get_session_summary tool with ref "${sessionRef(ref)}" and interpret the session for me, following the guidance below. ` +
              'Use get_analysis_detail for any section you need in more depth.\n\n' +
              GUIDANCE,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'compare_two_sessions',
    {
      title: 'Compare two sessions',
      description: 'Compare two Squiggly EEG sessions (A earlier, B later) with the interpretation guidance. Accepts session ids, analysis ids or pasted Squiggly links.',
      argsSchema: z.object({
        a: z.string().describe('Earlier session: id or pasted Squiggly link'),
        b: z.string().describe('Later session: id or pasted Squiggly link'),
      }),
    },
    ({ a, b }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Call the compare_sessions tool with a "${sessionRef(a)}" and b "${sessionRef(b)}", then interpret what changed between the two sessions, following the guidance below. ` +
              'Call get_session_summary on either session if you need its context.\n\n' +
              GUIDANCE,
          },
        },
      ],
    }),
  );

  server.registerResource(
    'interpretation_guidance',
    GUIDANCE_URI,
    { title: 'Squiggly interpretation guidance', description: 'How to interpret Squiggly EEG analyses and comparisons.', mimeType: 'text/plain' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/plain', text: GUIDANCE }] }),
  );
}
