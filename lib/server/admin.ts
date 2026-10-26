import 'server-only';
// Site-wide admin access (the /admin usage dashboard). Admins are listed by verified account
// email; everyone else gets a 404 so the page's existence isn't revealed.

import { createClient } from '@supabase/supabase-js';
import { getCurrentUser, isLocalAuthMode } from '@/lib/auth';
import type { UsageEvents } from '@/lib/admin-usage';

const ADMIN_EMAILS = new Set(['alexdni@gmail.com']);

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.has(email.trim().toLowerCase());
}

/** The signed-in user when they are an admin, otherwise null. Supabase mode only. */
export async function getAdminUser(): Promise<{ id: string; email: string } | null> {
  if (isLocalAuthMode()) return null;
  const user = await getCurrentUser();
  return user && isAdminEmail(user.email) ? user : null;
}

/** All raw usage events. Callers must check getAdminUser() first: this bypasses RLS. */
export async function fetchUsageEvents(): Promise<UsageEvents> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for usage stats');
  const service = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await service.rpc('admin_usage_events');
  if (error) throw new Error(error.message);
  return data as UsageEvents;
}
