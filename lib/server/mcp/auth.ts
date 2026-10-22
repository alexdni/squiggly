import 'server-only';
// Verifies Supabase-issued OAuth access tokens presented to /api/mcp. Supabase Auth is the OAuth 2.1
// authorization server; its JWTs are checked against the project JWKS, with no service-role key.

import { createClient } from '@supabase/supabase-js';
import type { AuthInfo } from '@modelcontextprotocol/server';
import type { DatabaseClient } from '@/lib/db/types';
import { createUserDb } from '@/lib/server/mcp/db';

export const AUTH_ISSUER = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`;

const MCP_SCOPES = ['squiggly:read'];

// Returns undefined for anything that is not a valid OAuth access token, which withMcpAuth turns into a
// 401 with a WWW-Authenticate challenge. Browser session JWTs have no client_id and are refused.
export async function verifyMcpToken(_req: Request, bearer?: string): Promise<AuthInfo | undefined> {
  if (!bearer) return undefined;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  let claims;
  try {
    const { data, error } = await supabase.auth.getClaims(bearer);
    if (error || !data) return undefined;
    claims = data.claims;
  } catch {
    return undefined;
  }

  if (typeof claims.client_id !== 'string' || !claims.client_id) return undefined;
  if (claims.aud !== 'authenticated') return undefined;
  if (typeof claims.sub !== 'string' || !claims.sub) return undefined;

  return {
    token: bearer,
    clientId: claims.client_id,
    scopes: MCP_SCOPES,
    expiresAt: claims.exp,
    extra: { userId: claims.sub },
  };
}

export function getMcpUser(authInfo: AuthInfo): { userId: string; db: DatabaseClient } {
  const userId = authInfo.extra?.userId;
  if (typeof userId !== 'string') throw new Error('Authenticated MCP request has no user id');
  return { userId, db: createUserDb(authInfo.token).db };
}
