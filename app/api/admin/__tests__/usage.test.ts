import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  local: false,
  user: null as { id: string; email: string } | null,
  rpc: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ isLocalAuthMode: () => state.local, getCurrentUser: async () => state.user }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: state.rpc }) }));

import { GET } from '@/app/api/admin/usage/route';
import { isAdminEmail } from '@/lib/server/admin';

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  state.local = false;
  state.user = null;
  state.rpc.mockReset();
  state.rpc.mockResolvedValue({ data: { users: [] }, error: null });
});

describe('GET /api/admin/usage', () => {
  it('returns 404 without touching the database when signed out', async () => {
    const res = await GET();
    expect(res.status).toBe(404);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('returns 404 for any non-admin account', async () => {
    state.user = { id: 'u2', email: 'someone@example.com' };
    expect((await GET()).status).toBe(404);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('returns 404 in local auth mode even for the admin email', async () => {
    state.local = true;
    state.user = { id: 'u1', email: 'alexdni@gmail.com' };
    expect((await GET()).status).toBe(404);
  });

  it('returns the usage events to the admin', async () => {
    state.user = { id: 'u1', email: 'alexdni@gmail.com' };
    const res = await GET();
    expect(res.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith('admin_usage_events');
    expect(await res.json()).toEqual({ users: [] });
  });

  it('matches the admin email case-insensitively and nothing else', () => {
    expect(isAdminEmail('AlexDNI@gmail.com ')).toBe(true);
    expect(isAdminEmail('alexdni@gmail.com.evil.com')).toBe(false);
    expect(isAdminEmail('')).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
  });
});
