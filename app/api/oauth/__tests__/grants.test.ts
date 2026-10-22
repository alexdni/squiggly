import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  return { local: false, user: { id: 'u1' } as { id: string } | null };
});
vi.mock('@/lib/auth', () => ({ isLocalAuthMode: () => state.local, getCurrentUser: async () => state.user }));
vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'sess-token' } } }) } }),
}));

import { GET, DELETE } from '@/app/api/oauth/grants/route';
import { listGrants } from '@/lib/server/oauth-grants';

const grant = { client: { client_id: 'c1', client_name: 'Claude' }, scopes: ['openid'], granted_at: '2026-10-01T00:00:00Z' };
const fetchMock = vi.fn();

function reply(body: unknown, status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  state.local = false;
  state.user = { id: 'u1' };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('/api/oauth/grants', () => {
  it('401s without a signed-in user', async () => {
    state.user = null;
    expect((await GET()).status).toBe(401);
    expect((await DELETE(new Request('https://app.example/api/oauth/grants?client_id=c1', { method: 'DELETE' }))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists grants', async () => {
    fetchMock.mockResolvedValue(reply([grant]));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ grants: [grant] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://proj.supabase.co/auth/v1/user/oauth/grants');
    expect(init.headers.Authorization).toBe('Bearer sess-token');
  });

  it('400s DELETE without client_id', async () => {
    expect((await DELETE(new Request('https://app.example/api/oauth/grants', { method: 'DELETE' }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('revokes a grant', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const res = await DELETE(new Request('https://app.example/api/oauth/grants?client_id=c%201', { method: 'DELETE' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][0]).toBe('https://proj.supabase.co/auth/v1/user/oauth/grants?client_id=c%201');
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });
});

describe('listGrants', () => {
  const supabase = { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } } as never;

  it('accepts a bare array or a { grants: [] } object', async () => {
    fetchMock.mockResolvedValueOnce(reply([grant]));
    expect(await listGrants(supabase)).toEqual({ data: [grant], error: null });
    fetchMock.mockResolvedValueOnce(reply({ grants: [grant] }));
    expect(await listGrants(supabase)).toEqual({ data: [grant], error: null });
  });

  it('reports an error, not a throw, for a non-JSON or unexpected body', async () => {
    fetchMock.mockResolvedValueOnce(reply('<html>bad gateway</html>'));
    expect((await listGrants(supabase)).error).toBeTruthy();
    fetchMock.mockResolvedValueOnce(reply({ something: 'else' }));
    expect((await listGrants(supabase)).error).toBeTruthy();
    fetchMock.mockResolvedValueOnce(reply(null));
    expect((await listGrants(supabase)).error).toBeTruthy();
  });
});
