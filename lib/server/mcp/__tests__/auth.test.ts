import { describe, it, expect, vi, beforeEach } from 'vitest';

const getClaims = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getClaims } }),
}));
vi.mock('@/lib/server/mcp/db', () => ({
  createUserDb: vi.fn(() => ({ db: { marker: 'db' }, supabase: {} })),
}));

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});

import { verifyMcpToken, getMcpUser, AUTH_ISSUER } from '@/lib/server/mcp/auth';

const req = new Request('https://app.example/api/mcp');
const oauthClaims = {
  sub: 'user-1',
  aud: 'authenticated',
  client_id: 'client-abc',
  exp: Math.floor(Date.now() / 1000) + 600,
};

describe('verifyMcpToken', () => {
  beforeEach(() => getClaims.mockReset());

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
  });
});

describe('getMcpUser', () => {
  it('returns the user id and a db bound to the token', async () => {
    getClaims.mockResolvedValue({ data: { claims: oauthClaims }, error: null });
    const info = (await verifyMcpToken(req, 'tok'))!;
    const user = getMcpUser(info);
    expect(user.userId).toBe('user-1');
    expect(user.db).toEqual({ marker: 'db' });
  });
});

describe('AUTH_ISSUER', () => {
  it('is the Supabase auth v1 URL', () => {
    expect(AUTH_ISSUER).toBe('https://proj.supabase.co/auth/v1');
  });
});
