// MCP test harness: the real mcp-handler stack (JSON-RPC over the Web Request handler) with the
// Squiggly tools registered on a fake, fixture-backed ctx. `world()` is a project whose rows carry
// every kind of identifying data and engine internals that MCP output must never contain.

import { createMcpHandler } from 'mcp-handler';
import type { ServerContext } from '@modelcontextprotocol/server';
import type { DatabaseClient } from '@/lib/db/types';
import { MCP_SERVER_OPTIONS, registerSquigglyTools, type McpCtx } from '@/lib/server/mcp/server';
import { fakeDb } from './fakeDb';
import { LEAKY_WARNINGS, SECRETS, makeAnalysisRow, makeEvent, makeProject, makeRecording, makeResults } from './fixtures';

export const OWNER = 'owner-user-id';
export const STRANGER = 'stranger-user-id';
export const CLIENT = 'client-abc';

export function world() {
  const timeline = {
    spans: [[1, 2]] as [number, number][],
    bad_channels: [
      { label: 'T7', reasons: ['flat: see https://storage.example.test/Anna_Smith.edf', 'noisy near /var/task/sloreta/KERN_SECRET.bin (Anna Smith)'], interpolated: true },
      { label: 'Anna_Smith_EO', reasons: ['bridged'], interpolated: false },
    ],
  };
  const spike = makeEvent({
    category: 'epileptiform',
    pattern: 'spike-wave',
    channels: ['T7'],
    handling: 'noted',
    evidence: { note: SECRETS.evidence, file: SECRETS.filename },
  });
  const leakyArtifact = makeEvent({
    category: 'artifact',
    pattern: 'Anna Smith https://storage.example.test/x.edf',
    handling: '/storage/Anna_Smith.edf' as never,
    channels: ['Fp1', 'Anna Smith'],
    evidence: { url: SECRETS.cleanedFileUrl },
  });
  const events = [spike, leakyArtifact];
  const eo = makeRecording({ condition_type: 'EO', filename: SECRETS.filename, created_at: '2026-10-01T10:00:00Z' });
  const ec = makeRecording({ condition_type: 'EC', filename: 'Anna_Smith_2026-10-01_EC.edf', created_at: '2026-10-01T10:10:00Z' });
  const old = makeRecording({ condition_type: 'BOTH', filename: 'Anna_Smith_2026-09-01.edf', created_at: '2026-09-01T10:00:00Z' });
  // Engine-supplied labels and text that must be filtered (labels) or sanitized (free text)
  const leakyText = {
    bad_channels: ['T7', 'Anna Smith'],
    icaLabels: ['eye-blink', 'muscle (see /var/task/sloreta/KERN_SECRET.bin)', 'https://storage.example.test/Anna_Smith.edf'],
    extraPairs: [{ ch1: 'Anna_Smith', ch2: 'Fz' }, { ch1: 'Cz', ch2: '/storage/x' }],
    sloretaRegion: 'left frontal (atlas https://storage.example.test/Anna_Smith/atlas.nii)',
    detectors: [
      { name: 'eye-blink', ran: true },
      { name: 'spike-wave', ran: false, skippedReason: 'needs temporal chain (montage file /var/task/montages/Anna_Smith.json)' },
    ],
  };
  const common = { warnings: LEAKY_WARNINGS, timeline, events, hrv: true, sloreta: true, ...leakyText };
  const reviews = { secret: SECRETS.configSecret, event_reviews: { [spike.id]: 'confirmed' } };
  const eoA = makeAnalysisRow(eo, makeResults({ conditions: ['eo'], ...common }), { config: reviews });
  const ecA = makeAnalysisRow(ec, makeResults({ conditions: ['ec'], ...common }), { config: reviews });
  const oldA = makeAnalysisRow(old, makeResults({ conditions: ['eo', 'ec'], ...common, engine: 'hybrid-asr-ica@0.32.0' }));
  const tables = {
    projects: [makeProject()],
    project_members: [],
    recordings: [eo, ec, old],
    analyses: [eoA, ecA, oldA],
  };
  return { eo, ec, old, eoA, ecA, oldA, spike, tables };
}

interface RpcResult {
  [k: string]: unknown;
}

/** A JSON-RPC client over the handler; `ctx` null simulates a request without authInfo. */
export function mcpHarness(
  tables: Record<string, object[]>,
  ctx: { userId: string; clientId: string } | null = { userId: OWNER, clientId: CLIENT },
  db: DatabaseClient = fakeDb(tables).db,
) {
  const getCtx = (_extra: ServerContext): McpCtx | null => (ctx ? { ...ctx, db } : null);
  const handler = createMcpHandler((server) => registerSquigglyTools(server, getCtx), MCP_SERVER_OPTIONS);
  let seq = 0;

  async function rpc(method: string, params: object = {}): Promise<RpcResult> {
    const req = new Request('https://app.test/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, params }),
    });
    const res = await handler(req);
    const text = await res.text();
    const line = text.split('\n').find((l) => l.startsWith('data: '));
    const msg = JSON.parse(line ? line.slice(6) : text);
    if (msg.error) throw Object.assign(new Error(msg.error.message), { rpc: msg.error });
    return msg.result;
  }

  const call = (name: string, args: object = {}) =>
    rpc('tools/call', { name, arguments: args }) as Promise<{
      isError?: boolean;
      content: { type: string; text: string }[];
      structuredContent?: Record<string, unknown>;
    }>;

  return { rpc, call };
}
