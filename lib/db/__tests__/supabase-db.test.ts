import { describe, expect, it, vi } from 'vitest';

// A minimal stand-in for a Supabase query builder. Like the real one it is a thenable:
// awaiting it runs the query. That is what broke `.single()` when a builder was returned bare
// from an async function.
type FakeBuilder = Record<string, unknown> & { calls: string[] };

function fakeBuilder(rows: Record<string, unknown>[]): FakeBuilder {
  const calls: string[] = [];
  const builder: FakeBuilder = {
    calls,
    select: (..._a: unknown[]) => (calls.push('select'), builder),
    insert: (..._a: unknown[]) => (calls.push('insert'), builder),
    update: (..._a: unknown[]) => (calls.push('update'), builder),
    eq: (..._a: unknown[]) => (calls.push('eq'), builder),
    order: (..._a: unknown[]) => (calls.push('order'), builder),
    single: () => {
      calls.push('single');
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    },
    then: (resolve: (v: unknown) => unknown) => {
      calls.push('then');
      return Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve);
    },
  };
  return builder;
}

const rows = [{ id: 'p1', name: 'Project' }];
let lastBuilder: FakeBuilder;

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    from: () => {
      lastBuilder = fakeBuilder(rows);
      return lastBuilder;
    },
  }),
}));

describe('SupabaseDatabaseClient (cookie-based, lazy builders)', () => {
  it('select().eq().single() resolves the row instead of executing the builder early', async () => {
    const { SupabaseDatabaseClient } = await import('../supabase-db');
    const db = new SupabaseDatabaseClient();
    const { data, error } = await db.from('projects').select('*').eq('id', 'p1').single();
    expect(error).toBeNull();
    expect(data).toEqual(rows[0]);
    expect(lastBuilder.calls).toEqual(['select', 'eq', 'single']);
  });

  it('select().execute() returns all rows', async () => {
    const { SupabaseDatabaseClient } = await import('../supabase-db');
    const { data } = await new SupabaseDatabaseClient().from('projects').select('*').order('name').execute();
    expect(data).toEqual(rows);
  });

  it('insert().select().single() and update().eq().select().single() return the row', async () => {
    const { SupabaseDatabaseClient } = await import('../supabase-db');
    const db = new SupabaseDatabaseClient();
    const ins = await db.from('projects').insert({ name: 'x' }).select('*').single();
    expect(ins.data).toEqual(rows[0]);
    expect(lastBuilder.calls).toContain('single');
    const upd = await db.from('projects').update({ name: 'y' }).eq('id', 'p1').select('*').single();
    expect(upd.data).toEqual(rows[0]);
    expect(lastBuilder.calls.indexOf('then')).toBe(-1);
  });
});
