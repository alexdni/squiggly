import 'server-only';
// Database client for background jobs that outlive the request (analysis runs). The default
// Supabase client authenticates with the user's cookies, which are gone once the response is sent,
// so jobs use the service role. Callers must authorize the user BEFORE scheduling the job.

import { createClient } from '@supabase/supabase-js';
import { getDatabaseClient } from '@/lib/db';
import { SupabaseDatabaseClient } from '@/lib/db/supabase-db';
import { getDatabaseMode } from '@/lib/db/types';
import type { DatabaseClient } from '@/lib/db/types';

let instance: DatabaseClient | null = null;

export function getServiceDatabaseClient(): DatabaseClient {
  if (instance) return instance;
  if (getDatabaseMode() === 'postgres') {
    instance = getDatabaseClient();
    return instance;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to run analyses in Supabase mode');
  }
  instance = new SupabaseDatabaseClient(
    createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  );
  return instance;
}
