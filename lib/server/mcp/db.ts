import 'server-only';
// Database client bound to a caller-supplied OAuth access token instead of cookies. Every query runs
// as that user under RLS (anon key, never the service role), so MCP requests see only their own data.

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseDatabaseClient } from '@/lib/db/supabase-db';
import type { DatabaseClient } from '@/lib/db/types';

export function createUserDb(accessToken: string): { db: DatabaseClient; supabase: SupabaseClient } {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
  return { db: new SupabaseDatabaseClient(supabase), supabase };
}
