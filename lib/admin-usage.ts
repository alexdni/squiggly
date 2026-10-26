// Aggregations for the admin usage dashboard. Input is the raw event dump from the
// `admin_usage_events()` SQL function; days and hours are bucketed in the viewer's local time.

export interface UsageUser {
  id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  confirmed: boolean;
}

export interface UsageEvents {
  generated_at: string;
  users: UsageUser[];
  sessions: Array<{ user_id: string; created_at: string; last_seen_at: string | null; oauth: boolean }>;
  activity: Array<{ user_id: string; hour: string; n: number }>;
  projects: Array<{ id: string; owner_id: string; created_at: string }>;
  recordings: Array<{
    id: string;
    user_id: string | null;
    created_at: string;
    file_size: number | null;
    duration_seconds: number | null;
    ext: string | null;
  }>;
  analyses: Array<{
    id: string;
    user_id: string | null;
    status: string;
    created_at: string;
    started_at: string | null;
    completed_at: string | null;
  }>;
  annotations: Array<{ user_id: string | null; created_at: string }>;
}

export type EventKind = 'signup' | 'sign-in' | 'active' | 'upload' | 'analysis' | 'analysis-failed' | 'annotation';

export interface UsageEvent {
  userId: string;
  at: number;
  kind: EventKind;
}

const DAY_MS = 86_400_000;

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** Analysis run time: the latest run's start, falling back to when the row was created. */
export function analysisStart(a: UsageEvents['analyses'][number]): number | null {
  return ms(a.started_at) ?? ms(a.created_at);
}

/** Every timestamped thing a user did, flattened. "active" covers token refreshes and session use. */
export function flattenEvents(ev: UsageEvents): UsageEvent[] {
  const out: UsageEvent[] = [];
  const push = (userId: string | null | undefined, at: number | null, kind: EventKind) => {
    if (userId && at !== null) out.push({ userId, at, kind });
  };
  for (const u of ev.users) {
    push(u.id, ms(u.created_at), 'signup');
    push(u.id, ms(u.last_sign_in_at), 'sign-in');
  }
  for (const s of ev.sessions) {
    push(s.user_id, ms(s.created_at), 'sign-in');
    push(s.user_id, ms(s.last_seen_at), 'active');
  }
  for (const a of ev.activity) push(a.user_id, ms(a.hour), 'active');
  for (const r of ev.recordings) push(r.user_id, ms(r.created_at), 'upload');
  for (const a of ev.analyses) {
    if (a.status === 'failed') push(a.user_id, ms(a.completed_at) ?? analysisStart(a), 'analysis-failed');
    else push(a.user_id, analysisStart(a), 'analysis');
  }
  for (const n of ev.annotations) push(n.user_id, ms(n.created_at), 'annotation');
  return out.sort((a, b) => a.at - b.at);
}

/** Local-time calendar day key, e.g. "2026-10-25". */
export function dayKey(t: number): string {
  const d = new Date(t);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Local midnight at or before t. */
export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Consecutive local days from `from` through `to`, inclusive. */
export function dayRange(from: number, to: number): string[] {
  const keys: string[] = [];
  const d = new Date(startOfDay(from));
  while (d.getTime() <= to) {
    keys.push(dayKey(d.getTime()));
    d.setDate(d.getDate() + 1); // setDate, not +DAY_MS, so DST days don't skip or repeat
  }
  return keys;
}

export interface DailyRow {
  day: string;
  activeUsers: number;
  signups: number;
  uploads: number;
  analyses: number;
  failed: number;
}

/** Day key of the local Monday starting t's week. */
export function weekKey(t: number): string {
  const d = new Date(startOfDay(t));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayKey(d.getTime());
}

/** Per-day (or per-week, keyed by its Monday) counts; activeUsers is distinct within the bucket. */
export function dailySeries(events: UsageEvent[], from: number, to: number, bucket: 'day' | 'week' = 'day'): DailyRow[] {
  const keyOf = bucket === 'week' ? weekKey : dayKey;
  const rows = new Map<string, DailyRow & { users: Set<string> }>();
  for (const day of dayRange(from, to)) {
    const key = keyOf(Date.parse(day + 'T12:00:00') || from);
    if (!rows.has(key)) {
      rows.set(key, { day: key, activeUsers: 0, signups: 0, uploads: 0, analyses: 0, failed: 0, users: new Set() });
    }
  }
  for (const e of events) {
    if (e.at < from || e.at > to) continue;
    const row = rows.get(keyOf(e.at));
    if (!row) continue;
    row.users.add(e.userId);
    if (e.kind === 'signup') row.signups++;
    else if (e.kind === 'upload') row.uploads++;
    else if (e.kind === 'analysis') row.analyses++;
    else if (e.kind === 'analysis-failed') row.failed++;
  }
  return [...rows.values()].map(({ users, ...r }) => ({ ...r, activeUsers: users.size }));
}

/** grid[weekday 0=Sun][hour] = distinct (user, hour) slots with any activity. */
export function weekdayHourGrid(events: UsageEvent[], from: number, to: number): number[][] {
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const seen = new Set<string>();
  for (const e of events) {
    if (e.at < from || e.at > to) continue;
    const slot = `${e.userId}|${Math.floor(e.at / 3_600_000)}`;
    if (seen.has(slot)) continue;
    seen.add(slot);
    const d = new Date(e.at);
    grid[d.getDay()][d.getHours()]++;
  }
  return grid;
}

export interface Bin {
  label: string;
  count: number;
}

/** Counts of values in [edges[i], edges[i+1]); the last bin is open-ended (">= last edge"). */
export function histogram(values: number[], edges: number[], format: (v: number) => string): Bin[] {
  const bins: Bin[] = edges.map((lo, i) => ({
    label: i < edges.length - 1 ? `${format(lo)}–${format(edges[i + 1])}` : `≥${format(lo)}`,
    count: 0,
  }));
  for (const v of values) {
    if (!Number.isFinite(v) || v < edges[0]) continue;
    let i = edges.length - 1;
    while (i > 0 && v < edges[i]) i--;
    bins[i].count++;
  }
  return bins;
}

/** Distinct users with any event in (now - windowMs, now]. */
export function activeUsersWithin(events: UsageEvent[], now: number, windowMs: number): number {
  const users = new Set<string>();
  for (const e of events) {
    if (e.at > now - windowMs && e.at <= now && e.kind !== 'signup') users.add(e.userId);
  }
  return users.size;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Processing times (seconds) of completed analyses that started within the range. */
export function analysisDurations(ev: UsageEvents, from: number, to: number, include: (userId: string | null) => boolean): number[] {
  const out: number[] = [];
  for (const a of ev.analyses) {
    if (a.status !== 'completed' || !include(a.user_id)) continue;
    const start = ms(a.started_at);
    const end = ms(a.completed_at);
    if (start === null || end === null || start < from || start > to || end < start) continue;
    out.push((end - start) / 1000);
  }
  return out;
}

export interface AccountRow {
  id: string;
  email: string;
  createdAt: number | null;
  lastActive: number | null;
  activeDays: number;
  uploads: number;
  analyses: number;
  failed: number;
  annotations: number;
  projects: number;
  lastUpload: number | null;
  /** Events per day over the range, for the sparkline. */
  spark: number[];
}

/** One row per account; counts are within [from, to], lastActive/lastUpload are all-time. */
export function accountRows(ev: UsageEvents, events: UsageEvent[], from: number, to: number): AccountRow[] {
  const days = dayRange(from, to);
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const rows = new Map<string, AccountRow & { daySet: Set<string> }>();
  for (const u of ev.users) {
    rows.set(u.id, {
      id: u.id,
      email: u.email ?? '(no email)',
      createdAt: ms(u.created_at),
      lastActive: null,
      activeDays: 0,
      uploads: 0,
      analyses: 0,
      failed: 0,
      annotations: 0,
      projects: 0,
      lastUpload: null,
      spark: new Array<number>(days.length).fill(0),
      daySet: new Set(),
    });
  }
  for (const p of ev.projects) {
    const row = rows.get(p.owner_id);
    if (row) row.projects++;
  }
  for (const e of events) {
    const row = rows.get(e.userId);
    if (!row) continue;
    if (e.kind !== 'signup') row.lastActive = Math.max(row.lastActive ?? 0, e.at);
    if (e.kind === 'upload') row.lastUpload = Math.max(row.lastUpload ?? 0, e.at);
    if (e.at < from || e.at > to) continue;
    const key = dayKey(e.at);
    row.daySet.add(key);
    const i = dayIndex.get(key);
    if (i !== undefined) row.spark[i]++;
    if (e.kind === 'upload') row.uploads++;
    else if (e.kind === 'analysis') row.analyses++;
    else if (e.kind === 'analysis-failed') row.failed++;
    else if (e.kind === 'annotation') row.annotations++;
  }
  return [...rows.values()].map(({ daySet, ...r }) => ({ ...r, activeDays: daySet.size }));
}

export { DAY_MS };
