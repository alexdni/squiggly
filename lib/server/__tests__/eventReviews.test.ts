import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissedEventIds, MAX_EVENT_REVIEWS, parseEventReviews } from '../eventReviews';

// In-memory stand-in for the two tables the routes touch. Every update bumps updated_at, like the
// update_analyses_updated_at trigger.
type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  user: { id: 'u1', email: 'u1@example.com' } as { id: string; email: string } | null,
  allowed: true,
  tables: {} as Record<string, Record<string, unknown>[]>,
  clock: 0,
  /** runs once before the next analyses update is applied (simulates a concurrent writer) */
  beforeUpdate: null as null | (() => void),
  permissionChecks: [] as string[],
  /** RLS-style refusal: updates match nothing and change nothing, without an error */
  refuseUpdates: false,
}));

vi.mock('@/lib/auth', () => ({ getCurrentUser: async () => state.user }));
vi.mock('@/lib/rbac', () => ({
  checkProjectPermission: async (_p: string, _u: string, perm: string) => {
    state.permissionChecks.push(perm);
    return state.allowed;
  },
}));
vi.mock('@/lib/storage', () => ({ getStorageClient: () => ({}) }));
vi.mock('@/lib/db', () => {
  const pick = (row: Row, cols?: string) =>
    !cols || cols === '*' ? { ...row } : Object.fromEntries(cols.split(',').map((c) => [c.trim(), row[c.trim()]]));
  const from = (table: string) => ({
    select(cols?: string) {
      const filters: [string, unknown][] = [];
      const b = {
        eq(c: string, v: unknown) {
          filters.push([c, v]);
          return b;
        },
        async single() {
          const row = state.tables[table].find((r) => filters.every(([c, v]) => r[c] === v));
          return row ? { data: pick(row, cols), error: null } : { data: null, error: new Error('not found') };
        },
      };
      return b;
    },
    update(data: Row) {
      const filters: [string, unknown][] = [];
      let cols: string | undefined;
      const b = {
        eq(c: string, v: unknown) {
          filters.push([c, v]);
          return b;
        },
        select(c?: string) {
          cols = c;
          return b;
        },
        async execute() {
          const hook = state.beforeUpdate;
          state.beforeUpdate = null;
          hook?.();
          if (state.refuseUpdates) return { data: [], error: null };
          const rows = state.tables[table].filter((r) => filters.every(([c, v]) => r[c] === v));
          for (const r of rows) Object.assign(r, structuredClone(data), { updated_at: `t${++state.clock}` });
          return { data: rows.map((r) => pick(r, cols)), error: null };
        },
      };
      return b;
    },
  });
  return { getDatabaseClient: () => ({ from }) };
});

import { PUT } from '@/app/api/analyses/[id]/event-reviews/route';
import { PATCH } from '@/app/api/analyses/[id]/route';

const A = 'a1';
const E1 = '0123456789abcdef';
const E2 = 'fedcba9876543210';
const analysis = () => state.tables.analyses[0];

beforeEach(() => {
  state.user = { id: 'u1', email: 'u1@example.com' };
  state.allowed = true;
  state.clock = 0;
  state.beforeUpdate = null;
  state.permissionChecks = [];
  state.refuseUpdates = false;
  state.tables = {
    recordings: [{ id: 'r1', project_id: 'p1' }],
    analyses: [
      {
        id: A,
        recording_id: 'r1',
        status: 'completed',
        started_at: null,
        config: { preprocessing: { profile: 'full' } },
        updated_at: 't0',
      },
    ],
  };
});

const put = (body: unknown, id = A) =>
  PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify(body) }), { params: { id } });
const patch = (body: unknown) =>
  PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), { params: { id: A } });

describe('PUT /api/analyses/[id]/event-reviews', () => {
  it.each([
    [{ eventId: 'XYZ', decision: 'confirmed' }],
    [{ eventId: '0123456789ABCDEF', decision: 'confirmed' }],
    [{ eventId: '0123456789abcde', decision: 'confirmed' }],
    [{ eventId: 42, decision: 'confirmed' }],
    [{ eventId: E1, decision: 'maybe' }],
    [{ eventId: E1 }],
    [[E1, 'confirmed']],
  ])('400 on %j', async (body) => {
    const res = await put(body);
    expect(res.status).toBe(400);
    expect(analysis().config).toEqual({ preprocessing: { profile: 'full' } });
  });

  it('401 without a user, 404 for a missing analysis', async () => {
    state.user = null;
    expect((await put({ eventId: E1, decision: 'confirmed' })).status).toBe(401);
    state.user = { id: 'u1', email: 'u1@example.com' };
    expect((await put({ eventId: E1, decision: 'confirmed' }, 'nope')).status).toBe(404);
  });

  it('403 for a viewer (no edit permission), and nothing is written', async () => {
    state.allowed = false;
    const res = await put({ eventId: E1, decision: 'dismissed' });
    expect(res.status).toBe(403);
    expect(state.permissionChecks).toEqual(['analysis:create']);
    expect(analysis().config).toEqual({ preprocessing: { profile: 'full' } });
  });

  it('merges, changes and clears decisions, keeping the rest of the config', async () => {
    let res = await put({ eventId: E1, decision: 'confirmed' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ event_reviews: { [E1]: 'confirmed' } });

    res = await put({ eventId: E2, decision: 'dismissed' });
    expect(await res.json()).toEqual({ event_reviews: { [E1]: 'confirmed', [E2]: 'dismissed' } });

    res = await put({ eventId: E1, decision: 'dismissed' });
    expect(await res.json()).toEqual({ event_reviews: { [E1]: 'dismissed', [E2]: 'dismissed' } });

    res = await put({ eventId: E1, decision: null });
    expect(await res.json()).toEqual({ event_reviews: { [E2]: 'dismissed' } });
    expect(analysis().config).toEqual({ preprocessing: { profile: 'full' }, event_reviews: { [E2]: 'dismissed' } });
  });

  it('does not lose a decision written concurrently (compare-and-swap on updated_at, then retry)', async () => {
    state.beforeUpdate = () => {
      // another click lands between our read and our write
      Object.assign(analysis(), {
        config: { preprocessing: { profile: 'full' }, event_reviews: { [E2]: 'confirmed' } },
        updated_at: 'other',
      });
    };
    const res = await put({ eventId: E1, decision: 'dismissed' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ event_reviews: { [E2]: 'confirmed', [E1]: 'dismissed' } });
  });
});

describe('PUT /api/analyses/[id]/event-reviews limits', () => {
  it('rejects ids that are not among the analysis events, but still allows clearing them', async () => {
    analysis().results = { events: [{ id: E1 }] };
    expect((await put({ eventId: E1, decision: 'dismissed' })).status).toBe(200);
    const res = await put({ eventId: E2, decision: 'confirmed' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unknown event' });
    expect((await put({ eventId: E2, decision: null })).status).toBe(200);
    expect(analysis().config).toEqual({ preprocessing: { profile: 'full' }, event_reviews: { [E1]: 'dismissed' } });
  });

  it(`caps stored decisions at ${MAX_EVENT_REVIEWS}`, async () => {
    const full = Object.fromEntries(
      Array.from({ length: MAX_EVENT_REVIEWS }, (_, i) => [i.toString(16).padStart(16, '0'), 'confirmed'])
    );
    analysis().config = { event_reviews: full };
    expect((await put({ eventId: E2, decision: 'dismissed' })).status).toBe(400);
    expect(Object.keys((analysis().config as { event_reviews: object }).event_reviews)).toHaveLength(MAX_EVENT_REVIEWS);
    // changing or clearing an existing decision is still fine
    const existing = '0000000000000001';
    expect((await put({ eventId: existing, decision: 'dismissed' })).status).toBe(200);
    expect((await put({ eventId: existing, decision: null })).status).toBe(200);
    expect((await put({ eventId: E2, decision: 'dismissed' })).status).toBe(200);
  });

  it('403, not "changed while saving", when the database refuses the update', async () => {
    state.refuseUpdates = true;
    expect((await put({ eventId: E1, decision: 'confirmed' })).status).toBe(403);
  });
});

describe('PATCH /api/analyses/[id] races', () => {
  it('409 "Analysis is running" when /process claims the row between read and write', async () => {
    state.beforeUpdate = () => {
      Object.assign(analysis(), { status: 'processing', started_at: new Date().toISOString(), updated_at: 'claimed' });
    };
    const res = await patch({ status: 'pending' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Analysis is running' });
    expect(analysis().status).toBe('processing');
  });

  it('retries after an unrelated concurrent write', async () => {
    state.beforeUpdate = () => {
      Object.assign(analysis(), { updated_at: 'other' });
    };
    const res = await patch({ status: 'pending' });
    expect(res.status).toBe(200);
    expect(analysis().status).toBe('pending');
  });

  it('403 when the database refuses the update', async () => {
    state.refuseUpdates = true;
    expect((await patch({ status: 'pending' })).status).toBe(403);
  });
});

describe('PATCH /api/analyses/[id] keeps event_reviews', () => {
  beforeEach(() => {
    analysis().config = { preprocessing: { profile: 'full' }, event_reviews: { [E1]: 'dismissed' } };
  });

  it('when a settings save sends a config without event_reviews', async () => {
    const res = await patch({ config: { preprocessing: { profile: 'conservative' } }, status: 'pending' });
    expect(res.status).toBe(200);
    expect(analysis().config).toEqual({ preprocessing: { profile: 'conservative' }, event_reviews: { [E1]: 'dismissed' } });
    expect(analysis().status).toBe('pending');
  });

  it('when the client sends back a stale copy of event_reviews', async () => {
    await patch({ config: { preprocessing: { profile: 'full' }, event_reviews: {} } });
    expect(analysis().config).toEqual({ preprocessing: { profile: 'full' }, event_reviews: { [E1]: 'dismissed' } });
  });

  it('on Re-Analyze (status reset only)', async () => {
    const res = await patch({ status: 'pending', results: null });
    expect(res.status).toBe(200);
    expect(analysis().config).toEqual({ preprocessing: { profile: 'full' }, event_reviews: { [E1]: 'dismissed' } });
  });

  it('still refuses viewers', async () => {
    state.allowed = false;
    expect((await patch({ config: {} })).status).toBe(403);
  });
});

describe('stored review parsing', () => {
  it('keeps only well-formed ids with known decisions', () => {
    expect(parseEventReviews({ [E1]: 'dismissed', [E2]: 'confirmed', bad: 'dismissed', ['a'.repeat(16)]: 'nope' })).toEqual({
      [E1]: 'dismissed',
      [E2]: 'confirmed',
    });
    expect(parseEventReviews(null)).toEqual({});
    expect(parseEventReviews(['x'])).toEqual({});
  });

  it('dismissedEventIds reads the config defensively', () => {
    expect(dismissedEventIds({ event_reviews: { [E1]: 'dismissed', [E2]: 'confirmed', zz: 'dismissed' } })).toEqual([E1]);
    expect(dismissedEventIds(undefined)).toEqual([]);
    expect(dismissedEventIds({ event_reviews: 'x' })).toEqual([]);
  });
});
