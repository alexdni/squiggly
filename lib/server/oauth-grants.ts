// OAuth grants for the signed-in user, via the Supabase Auth REST API.
// The installed supabase-js (2.81) predates auth.oauth.listGrants/revokeGrant,
// so this mirrors what newer SDK versions send. Tokens are never logged.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface OAuthGrant {
  client: { client_id: string; client_name: string };
  scopes: string[];
  granted_at: string;
}

const base = () => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user/oauth/grants`;

async function authHeaders(supabase: SupabaseClient): Promise<Record<string, string> | null> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;
  return {
    apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    Authorization: `Bearer ${data.session.access_token}`,
  };
}

export async function listGrants(
  supabase: SupabaseClient
): Promise<{ data: OAuthGrant[] | null; error: string | null }> {
  const headers = await authHeaders(supabase);
  if (!headers) return { data: null, error: 'No session' };
  const res = await fetch(base(), { headers, cache: 'no-store' });
  if (!res.ok) return { data: null, error: `Failed to list grants (${res.status})` };
  return { data: (await res.json()) as OAuthGrant[], error: null };
}

export async function revokeGrant(
  supabase: SupabaseClient,
  clientId: string
): Promise<{ error: string | null }> {
  const headers = await authHeaders(supabase);
  if (!headers) return { error: 'No session' };
  const res = await fetch(`${base()}?client_id=${encodeURIComponent(clientId)}`, {
    method: 'DELETE',
    headers,
  });
  return res.ok ? { error: null } : { error: `Failed to revoke grant (${res.status})` };
}
