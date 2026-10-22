import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getClaims = vi.fn();
const mode = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  return { local: false };
});
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getClaims } }),
}));
vi.mock('@/lib/auth', () => ({ isLocalAuthMode: () => mode.local }));
vi.mock('@/lib/server/mcp/db', async () => {
  const { fakeDb } = await import('./fakeDb');
  const { world } = await import('./harness');
  return { createUserDb: vi.fn(() => ({ db: fakeDb(world().tables).db, supabase: {} })) };
});

import { GET, POST, DELETE, dynamic } from '@/app/api/mcp/route';
import { GET as metadataGET } from '@/app/.well-known/oauth-protected-resource/api/mcp/route';

const ORIGIN = 'https://app.example';

function mcpPost(headers: Record<string, string> = {}, body: object = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) {
  return new Request(`${ORIGIN}/api/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
}

const validClaims = (exp = Math.floor(Date.now() / 1000) + 600) => ({
  data: { claims: { sub: 'owner-user-id', aud: 'authenticated', client_id: 'client-abc', exp } },
  error: null,
});

beforeEach(() => {
  getClaims.mockReset();
  mode.local = false;
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('/api/mcp route', () => {
  it('is dynamic and exports GET, POST and DELETE', () => {
    expect(dynamic).toBe('force-dynamic');
    expect([GET, POST, DELETE].every((f) => typeof f === 'function')).toBe(true);
  });

  it('401s a POST without a bearer, pointing at the protected-resource metadata', async () => {
    const res = await POST(mcpPost());
    expect(res.status).toBe(401);
    const challenge = res.headers.get('WWW-Authenticate') ?? '';
    expect(challenge).toContain('oauth-protected-resource');
    expect(challenge).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`);
    expect(getClaims).not.toHaveBeenCalled();
  });

  it('401s (not 500s) an expired or invalid token', async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error('JWT expired') });
    expect((await POST(mcpPost({ authorization: 'Bearer expired' }))).status).toBe(401);
    getClaims.mockRejectedValue(new Error('network down'));
    expect((await POST(mcpPost({ authorization: 'Bearer x' }))).status).toBe(401);
    getClaims.mockResolvedValue(validClaims(Math.floor(Date.now() / 1000) - 60));
    const res = await POST(mcpPost({ authorization: 'Bearer stale' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('invalid_token');
  });

  it('serves tools with a valid OAuth token', async () => {
    getClaims.mockResolvedValue(validClaims());
    const res = await POST(mcpPost({ authorization: 'Bearer good' }, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_projects', arguments: {} } }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Project 11111111');
    expect(text).not.toContain('Anna');
  });

  it('404s in local auth mode', async () => {
    mode.local = true;
    getClaims.mockResolvedValue(validClaims());
    for (const f of [GET, POST, DELETE]) expect((await f(mcpPost({ authorization: 'Bearer good' }))).status).toBe(404);
    expect((await metadataGET(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/api/mcp`))).status).toBe(404);
  });

  it('path-specific protected-resource metadata names the MCP endpoint as the resource', async () => {
    const res = await metadataGET(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/api/mcp`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ resource: `${ORIGIN}/api/mcp`, authorization_servers: ['https://proj.supabase.co/auth/v1'] });
  });
});
