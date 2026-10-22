import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({ local: false, user: { id: 'u1' } as { id: string } | null }));
const approveAuthorization = vi.fn();
const denyAuthorization = vi.fn();
vi.mock('@/lib/auth', () => ({ isLocalAuthMode: () => state.local, getCurrentUser: async () => state.user }));
vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({ auth: { oauth: { approveAuthorization, denyAuthorization } } }),
}));

import { POST } from '@/app/api/oauth/decision/route';

const ORIGIN = 'https://app.example';
const ID = 'auth_AbC-123';

function decide(fields: [string, string][], headers: Record<string, string> = { origin: ORIGIN }) {
  const body = new URLSearchParams(fields);
  return new Request(`${ORIGIN}/api/oauth/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body,
  });
}

beforeEach(() => {
  state.local = false;
  state.user = { id: 'u1' };
  approveAuthorization.mockReset();
  denyAuthorization.mockReset();
  approveAuthorization.mockResolvedValue({ data: { redirect_url: 'https://client.example/cb?code=c1' }, error: null });
  denyAuthorization.mockResolvedValue({ data: { redirect_url: 'https://client.example/cb?error=access_denied' }, error: null });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/oauth/decision', () => {
  it('303s to the client redirect on approve', async () => {
    const res = await POST(decide([['authorization_id', ID], ['decision', 'approve']]));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://client.example/cb?code=c1');
    expect(approveAuthorization).toHaveBeenCalledWith(ID, { skipBrowserRedirect: true });
  });

  it('303s to the client redirect on deny', async () => {
    const res = await POST(decide([['authorization_id', ID], ['decision', 'deny']]));
    expect(res.status).toBe(303);
    expect(denyAuthorization).toHaveBeenCalledWith(ID, { skipBrowserRedirect: true });
  });

  it('accepts Sec-Fetch-Site: same-origin when Origin is absent', async () => {
    const res = await POST(decide([['authorization_id', ID], ['decision', 'approve']], { 'sec-fetch-site': 'same-origin' }));
    expect(res.status).toBe(303);
  });

  it('403s a cross-origin or origin-less POST', async () => {
    const cases: Record<string, string>[] = [{ origin: 'https://evil.example' }, {}, { 'sec-fetch-site': 'cross-site' }, { origin: 'null' }];
    for (const headers of cases) {
      const res = await POST(decide([['authorization_id', ID], ['decision', 'approve']], headers));
      expect(res.status, JSON.stringify(headers)).toBe(403);
    }
    expect(approveAuthorization).not.toHaveBeenCalled();
  });

  it('401s without a signed-in user', async () => {
    state.user = null;
    expect((await POST(decide([['authorization_id', ID], ['decision', 'approve']]))).status).toBe(401);
  });

  it('400s a bad decision', async () => {
    expect((await POST(decide([['authorization_id', ID], ['decision', 'maybe']]))).status).toBe(400);
    expect((await POST(decide([['authorization_id', ID]]))).status).toBe(400);
  });

  it('400s a missing, malformed or repeated authorization_id', async () => {
    for (const fields of [
      [['decision', 'approve']],
      [['authorization_id', ''], ['decision', 'approve']],
      [['authorization_id', '../evil?x=1'], ['decision', 'approve']],
      [['authorization_id', 'a'.repeat(129)], ['decision', 'approve']],
      [['authorization_id', ID], ['authorization_id', 'other'], ['decision', 'approve']],
    ] as [string, string][][]) {
      expect((await POST(decide(fields))).status, JSON.stringify(fields)).toBe(400);
    }
    expect(approveAuthorization).not.toHaveBeenCalled();
  });

  it('redirects back to the consent page with error=1 when Supabase refuses the decision', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    approveAuthorization.mockResolvedValue({ data: null, error: new Error('authorization expired') });
    const res = await POST(decide([['authorization_id', ID], ['decision', 'approve']]));
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.origin).toBe(ORIGIN);
    expect(loc.pathname).toBe('/oauth/consent');
    expect(loc.searchParams.get('authorization_id')).toBe(ID);
    expect(loc.searchParams.get('error')).toBe('1');
  });

  it('404s in local auth mode', async () => {
    state.local = true;
    expect((await POST(decide([['authorization_id', ID], ['decision', 'approve']]))).status).toBe(404);
  });
});
