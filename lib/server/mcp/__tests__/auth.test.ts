import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getClaims = vi.fn();
const getUser = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getClaims, getUser } }),
}));
vi.mock('@/lib/server/mcp/db', () => ({
  createUserDb: vi.fn(() => ({ db: { marker: 'db' }, supabase: {} })),
}));

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});

import { verifyMcpToken, getMcpUser, authIssuer } from '@/lib/server/mcp/auth';

const req = new Request('https://app.example/api/mcp');
const oauthClaims = {
  sub: 'user-1',
  aud: 'authenticated',
  client_id: 'client-abc',
  exp: Math.floor(Date.now() / 1000) + 600,
};

const liveUser = { data: { user: { id: 'user-1' } }, error: null };
const authApiError = (status: number, message: string) => Object.assign(new Error(message), { name: 'AuthApiError', status });

describe('verifyMcpToken', () => {
  beforeEach(() => {
    getClaims.mockReset();
    getUser.mockReset();
    getUser.mockResolvedValue(liveUser);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects missing bearer', async () => {
    expect(await verifyMcpToken(req, undefined)).toBeUndefined();
    expect(getClaims).not.toHaveBeenCalled();
  });

  it('rejects expired/invalid token', async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error('invalid JWT') });
    expect(await verifyMcpToken(req, 'bad')).toBeUndefined();
  });

  it('rejects when getClaims returns no data and no error', async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    expect(await verifyMcpToken(req, 'tok')).toBeUndefined();
  });

  it('rejects session JWT without client_id', async () => {
    const { client_id: _omit, ...session } = oauthClaims;
    getClaims.mockResolvedValue({ data: { claims: session }, error: null });
    expect(await verifyMcpToken(req, 'tok')).toBeUndefined();
  });

  it('rejects wrong audience', async () => {
    getClaims.mockResolvedValue({ data: { claims: { ...oauthClaims, aud: 'other' } }, error: null });
    expect(await verifyMcpToken(req, 'tok')).toBeUndefined();
  });

  it('accepts OAuth token', async () => {
    getClaims.mockResolvedValue({ data: { claims: oauthClaims }, error: null });
    const info = await verifyMcpToken(req, 'tok');
    expect(info).toBeDefined();
    expect(info!.extra).toEqual({ userId: 'user-1' });
    expect(info!.clientId).toBe('client-abc');
    expect(info!.token).toBe('tok');
    expect(info!.scopes).toEqual(['squiggly:read']);
    expect(info!.expiresAt).toBe(oauthClaims.exp);
    expect(getClaims).toHaveBeenCalledWith('tok');
    expect(getUser).toHaveBeenCalledWith('tok');
  });

  it('rejects a revoked token: valid claims but Auth no longer knows the session', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    getClaims.mockResolvedValue({ data: { claims: oauthClaims }, error: null });
    getUser.mockResolvedValue({ data: { user: null }, error: authApiError(403, 'Session from session_id claim in JWT does not exist') });
    expect(await verifyMcpToken(req, 'tok')).toBeUndefined();
    expect(err).not.toHaveBeenCalled();
  });

  it('rejects when getUser returns a different user than the claims', async () => {
    getClaims.mockResolvedValue({ data: { claims: oauthClaims }, error: null });
    getUser.mockResolvedValue({ data: { user: { id: 'someone-else' } }, error: null });
    expect(await verifyMcpToken(req, 'tok')).toBeUndefined();
  });

  it('does not call getUser when the claims are already refused', async () => {
    const { client_id: _omit, ...session } = oauthClaims;
    getClaims.mockResolvedValue({ data: { claims: session }, error: null });
    await verifyMcpToken(req, 'tok');
    expect(getUser).not.toHaveBeenCalled();
  });

  it('rejects and logs (without the token) when Auth is unreachable', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    getClaims.mockResolvedValue({ data: { claims: oauthClaims }, error: null });
    getUser.mockResolvedValue({ data: { user: null }, error: Object.assign(new Error('fetch failed'), { name: 'AuthRetryableFetchError', status: 0 }) });
    expect(await verifyMcpToken(req, 'secret-token-value')).toBeUndefined();
    getUser.mockRejectedValue(new Error('socket hang up'));
    expect(await verifyMcpToken(req, 'secret-token-value')).toBeUndefined();
    expect(err).toHaveBeenCalledTimes(2);
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).toContain('fetch failed');
    expect(logged).toContain('socket hang up');
    expect(logged).not.toContain('secret-token-value');
  });

  it('logs an unexpected getClaims exception, but not an invalid-token answer', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    getClaims.mockResolvedValue({ data: null, error: Object.assign(new Error('invalid JWT'), { name: 'AuthInvalidJwtError', status: 400 }) });
    expect(await verifyMcpToken(req, 'tok')).toBeUndefined();
    expect(err).not.toHaveBeenCalled();
    getClaims.mockRejectedValue(new Error('JWKS fetch failed'));
    expect(await verifyMcpToken(req, 'secret-token-value')).toBeUndefined();
    expect(err).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(err.mock.calls)).toContain('JWKS fetch failed');
    expect(JSON.stringify(err.mock.calls)).not.toContain('secret-token-value');
  });
});

describe('getMcpUser', () => {
  it('returns the user id and a db bound to the token', async () => {
    getUser.mockResolvedValue(liveUser);
    getClaims.mockResolvedValue({ data: { claims: oauthClaims }, error: null });
    const info = (await verifyMcpToken(req, 'tok'))!;
    const user = getMcpUser(info);
    expect(user.userId).toBe('user-1');
    expect(user.db).toEqual({ marker: 'db' });
  });
});

describe('authIssuer', () => {
  it('is the Supabase auth v1 URL', () => {
    expect(authIssuer()).toBe('https://proj.supabase.co/auth/v1');
  });

  it('throws a clear error when NEXT_PUBLIC_SUPABASE_URL is missing, instead of "undefined/auth/v1"', () => {
    const saved = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      expect(() => authIssuer()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = saved;
    }
  });
});
