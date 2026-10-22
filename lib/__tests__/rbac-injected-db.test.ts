import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  getDatabaseClient: vi.fn(() => {
    throw new Error('getDatabaseClient must not be called when db is injected');
  }),
}));

import { getDatabaseClient } from '@/lib/db';
import { checkProjectPermission } from '../rbac';
import type { DatabaseClient } from '@/lib/db';

// Minimal fake: each table resolves to a fixed row via from().select().eq()...single()
function fakeDb(rows: Record<string, unknown>): DatabaseClient {
  return {
    from(table: string) {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        single: async () => ({ data: rows[table] ?? null, error: null }),
      };
      return builder;
    },
  } as unknown as DatabaseClient;
}

describe('rbac with injected db', () => {
  beforeEach(() => {
    vi.mocked(getDatabaseClient).mockClear();
  });

  it('checkProjectPermission uses the injected db', async () => {
    const db = fakeDb({ projects: { owner_id: 'u1' } });
    await expect(checkProjectPermission('p1', 'u1', 'analysis:read', db)).resolves.toBe(true);
    expect(getDatabaseClient).not.toHaveBeenCalled();
  });

  it('viewer membership reads but cannot create analyses', async () => {
    const db = fakeDb({ projects: { owner_id: 'other' }, project_members: { role: 'viewer' } });
    await expect(checkProjectPermission('p1', 'u1', 'analysis:read', db)).resolves.toBe(true);
    await expect(checkProjectPermission('p1', 'u1', 'analysis:create', db)).resolves.toBe(false);
    expect(getDatabaseClient).not.toHaveBeenCalled();
  });
});
