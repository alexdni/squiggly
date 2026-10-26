import { describe, it, expect } from 'vitest';
import {
  accountRows,
  activeUsersWithin,
  analysisDurations,
  dailySeries,
  dayRange,
  flattenEvents,
  histogram,
  median,
  startOfDay,
  weekdayHourGrid,
  type UsageEvents,
} from '@/lib/admin-usage';

// Local-time noon on a given day, so day bucketing doesn't depend on the test machine's zone
const noon = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const iso = (t: number) => new Date(t).toISOString();

const events: UsageEvents = {
  generated_at: iso(noon(2026, 10, 25, 18)),
  users: [
    { id: 'a', email: 'a@x.com', created_at: iso(noon(2026, 10, 1)), last_sign_in_at: iso(noon(2026, 10, 24)), confirmed: true },
    { id: 'b', email: 'b@x.com', created_at: iso(noon(2026, 10, 24)), last_sign_in_at: null, confirmed: false },
  ],
  sessions: [{ user_id: 'a', created_at: iso(noon(2026, 10, 24)), last_seen_at: iso(noon(2026, 10, 25, 9)), oauth: false }],
  activity: [{ user_id: 'a', hour: iso(noon(2026, 10, 25, 9)), n: 3 }],
  projects: [{ id: 'p1', owner_id: 'a', created_at: iso(noon(2026, 10, 1)) }],
  recordings: [
    { id: 'r1', user_id: 'a', created_at: iso(noon(2026, 10, 24)), file_size: 3 * 1_048_576, duration_seconds: 300, ext: 'edf' },
    { id: 'r2', user_id: 'a', created_at: iso(noon(2026, 10, 25)), file_size: 12 * 1_048_576, duration_seconds: 1200, ext: 'edf' },
  ],
  analyses: [
    { id: 'n1', user_id: 'a', status: 'completed', created_at: iso(noon(2026, 10, 24)), started_at: iso(noon(2026, 10, 24)), completed_at: iso(noon(2026, 10, 24) + 40_000) },
    { id: 'n2', user_id: 'a', status: 'failed', created_at: iso(noon(2026, 10, 25)), started_at: iso(noon(2026, 10, 25)), completed_at: iso(noon(2026, 10, 25) + 5_000) },
  ],
  annotations: [{ user_id: 'a', created_at: iso(noon(2026, 10, 25)) }],
};

const now = Date.parse(events.generated_at);
const from = startOfDay(noon(2026, 10, 24));

describe('admin usage aggregation', () => {
  it('counts daily uploads, analyses, failures, sign-ups and distinct active accounts', () => {
    const daily = dailySeries(flattenEvents(events), from, now);
    expect(daily.map((d) => d.day)).toEqual(['2026-10-24', '2026-10-25']);
    expect(daily[0]).toMatchObject({ activeUsers: 2, signups: 1, uploads: 1, analyses: 1, failed: 0 });
    expect(daily[1]).toMatchObject({ activeUsers: 1, signups: 0, uploads: 1, analyses: 0, failed: 1 });
  });

  it('builds day ranges across a DST change without skipping days', () => {
    const days = dayRange(noon(2026, 3, 7), noon(2026, 3, 10));
    expect(days).toEqual(['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10']);
  });

  it('counts active accounts in a trailing window, ignoring sign-up alone', () => {
    const flat = flattenEvents(events);
    expect(activeUsersWithin(flat, now, 86_400_000)).toBe(1);
    expect(activeUsersWithin(flat, now, 7 * 86_400_000)).toBe(1);
  });

  it('dedupes the weekday/hour grid to one slot per account-hour', () => {
    const grid = weekdayHourGrid(flattenEvents(events), from, now);
    const d = new Date(noon(2026, 10, 25, 9));
    // session last_seen and the token refresh fall in the same hour
    expect(grid[d.getDay()][9]).toBe(1);
  });

  it('bins histograms with an open-ended last bin', () => {
    const bins = histogram([0.5, 1, 4, 99, -1, NaN], [0, 1, 5], String);
    expect(bins).toEqual([
      { label: '0–1', count: 1 },
      { label: '1–5', count: 2 },
      { label: '≥5', count: 1 },
    ]);
  });

  it('measures completed analysis durations only', () => {
    expect(analysisDurations(events, from, now, () => true)).toEqual([40]);
    expect(median([3, 1, 2, 10])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('summarises each account', () => {
    const rows = accountRows(events, flattenEvents(events), from, now);
    const a = rows.find((r) => r.id === 'a')!;
    expect(a).toMatchObject({ uploads: 2, analyses: 1, failed: 1, annotations: 1, projects: 1, activeDays: 2 });
    expect(a.lastActive).toBe(noon(2026, 10, 25, 12) + 5_000); // the failed run, dated at completion
    expect(a.spark).toHaveLength(2);
    const b = rows.find((r) => r.id === 'b')!;
    expect(b.lastActive).toBeNull();
  });
});

describe('weekly buckets', () => {
  it('groups days into Monday-keyed weeks with distinct active accounts', () => {
    const weekly = dailySeries(flattenEvents(events), startOfDay(noon(2026, 10, 19)), now, 'week');
    // Oct 19 2026 is a Monday; Oct 24-25 fall in the same week
    expect(weekly.map((w) => w.day)).toEqual(['2026-10-19']);
    expect(weekly[0]).toMatchObject({ activeUsers: 2, uploads: 2, analyses: 1, failed: 1, signups: 1 });
  });
});
