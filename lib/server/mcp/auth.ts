import 'server-only';
// Verifies Supabase-issued OAuth access tokens presented to /api/mcp. Supabase Auth is the OAuth 2.1
// authorization server; its JWTs are checked against the project JWKS, with no service-role key.

import { createClient } from '@supabase/supabase-js';
import type { AuthInfo } from '@modelcontextprotocol/server';
import type { DatabaseClient } from '@/lib/db/types';
import { createUserDb } from '@/lib/server/mcp/db';

/** The Supabase Auth issuer URL; throws (rather than advertising "undefined/auth/v1") when unconfigured. */
export function authIssuer(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set, so the OAuth issuer URL is unknown');
  return `${url}/auth/v1`;
}

const MCP_SCOPES = ['squiggly:read'];

/** A definite "this token is not valid" answer from Auth, as opposed to an outage worth logging. */
function isAuthRejection(e: unknown): boolean {
  const { status, name } = (e ?? {}) as { status?: unknown; name?: unknown };
  if (typeof status === 'number' && status >= 400 && status < 500) return true;
  return name === 'AuthInvalidJwtError' || name === 'AuthSessionMissingError';
}

/** Logs a verification failure that is not a plain rejection. Never the token. */
function logUnexpected(step: string, e: unknown) {
  if (isAuthRejection(e)) return;
  const err = e as { name?: unknown; status?: unknown; message?: unknown };
  console.error('[mcp] token verification error', {
    step,
    name: typeof err?.name === 'string' ? err.name : undefined,
    status: typeof err?.status === 'number' ? err.status : undefined,
    message: typeof err?.message === 'string' ? err.message : String(e),
  });
}

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
    if (error || !data) {
      if (error) logUnexpected('claims', error);
      return undefined;
    }
    claims = data.claims;
  } catch (e) {
    logUnexpected('claims', e);
    return undefined;
  }

  if (typeof claims.client_id !== 'string' || !claims.client_id) return undefined;
  if (claims.aud !== 'authenticated') return undefined;
  if (typeof claims.sub !== 'string' || !claims.sub) return undefined;

  // getClaims checks asymmetric JWTs locally against the JWKS, so a revoked grant would still pass
  // until exp. Asking Auth for the user checks the token's session is still live.
  try {
    const { data, error } = await supabase.auth.getUser(bearer);
    if (error || data?.user?.id !== claims.sub) {
      if (error) logUnexpected('user', error);
      return undefined;
    }
  } catch (e) {
    logUnexpected('user', e);
    return undefined;
  }

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
