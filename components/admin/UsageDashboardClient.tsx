'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  BarElement,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  type ChartData,
  type ChartOptions,
} from 'chart.js';
import SquigglyLogo from '@/components/SquigglyLogo';
import {
  DAY_MS,
  accountRows,
  activeUsersWithin,
  analysisDurations,
  dailySeries,
  flattenEvents,
  histogram,
  median,
  startOfDay,
  weekdayHourGrid,
  type AccountRow,
  type EventKind,
  type UsageEvents,
} from '@/lib/admin-usage';

ChartJS.register(BarElement, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend);

const COLORS = {
  active: '#773DFF', // brand violet
  signups: '#eb6834',
  uploads: '#2a78d6',
  analyses: '#1baf7a',
  failed: '#e34948', // status: critical
  hist: '#773DFF',
};

const RANGES = [
  { key: '7', label: '7 days', days: 7 },
  { key: '30', label: '30 days', days: 30 },
  { key: '90', label: '90 days', days: 90 },
  { key: 'all', label: 'All time', days: null },
] as const;
type RangeKey = (typeof RANGES)[number]['key'];

const KIND_LABELS: Record<EventKind, string> = {
  signup: 'Signed up',
  'sign-in': 'Signed in',
  active: 'Active',
  upload: 'Uploaded a file',
  analysis: 'Ran an analysis',
  'analysis-failed': 'Analysis failed',
  annotation: 'Added an annotation',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type SortKey = 'lastActive' | 'activeDays' | 'uploads' | 'analyses' | 'failed' | 'email';

const fmtDate = (t: number | null) =>
  t === null ? '—' : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const fmtDateTime = (t: number) =>
  new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function fmtAgo(t: number | null, now: number): string {
  if (t === null) return 'never';
  const mins = Math.round((now - t) / 60_000);
  if (mins < 60) return `${Math.max(mins, 0)}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

const fmtSeconds = (s: number) => (s < 60 ? `${Math.round(s)}s` : `${Math.round(s / 60)}m`);
const fmtMB = (mb: number) => `${mb}MB`;
const fmtMinutes = (m: number) => `${m}m`;

const shortDay = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const baseOptions = (stacked = false): ChartOptions<'bar'> => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { position: 'bottom', labels: { boxWidth: 12, color: '#1f2937' } },
  },
  scales: {
    x: { stacked, grid: { display: false }, ticks: { color: '#4b5563', maxRotation: 0, autoSkipPadding: 12 } },
    y: { stacked, beginAtZero: true, grid: { color: '#e5e7eb' }, ticks: { color: '#4b5563', precision: 0 } },
  },
});

export default function UsageDashboardClient({ adminId }: { adminId: string }) {
  const [data, setData] = useState<UsageEvents | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<RangeKey>('30');
  const [excludeMe, setExcludeMe] = useState(true);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'lastActive', desc: true });
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/usage', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const view = useMemo(() => {
    if (!data) return null;
    const now = Date.parse(data.generated_at) || Date.now();
    const include = (id: string | null) =>
      !!id && (!excludeMe || id !== adminId) && (!selectedUser || id === selectedUser);
    const allEvents = flattenEvents(data);
    const events = allEvents.filter((e) => include(e.userId));
    const days = RANGES.find((r) => r.key === range)!.days;
    const firstEvent = allEvents.length ? allEvents[0].at : now;
    const from = days === null ? startOfDay(firstEvent) : startOfDay(now - (days - 1) * DAY_MS);
    const inRange = (iso: string | null) => {
      const t = iso ? Date.parse(iso) : NaN;
      return t >= from && t <= now;
    };

    const weekly = now - from > 120 * DAY_MS;
    const daily = dailySeries(events, from, now, weekly ? 'week' : 'day');
    const grid = weekdayHourGrid(events.filter((e) => e.kind !== 'signup'), from, now);
    const durations = analysisDurations(data, from, now, include);

    const recordings = data.recordings.filter((r) => include(r.user_id) && inRange(r.created_at));
    const analysesInRange = data.analyses.filter(
      (a) => include(a.user_id) && inRange(a.started_at ?? a.created_at)
    );
    const failed = analysesInRange.filter((a) => a.status === 'failed').length;
    const finished = analysesInRange.filter((a) => a.status === 'completed' || a.status === 'failed').length;

    const rows = accountRows(data, allEvents, from, now).filter((r) => !excludeMe || r.id !== adminId);
    const uploadsPerAccount = rows.filter((r) => r.uploads > 0).map((r) => r.uploads);

    const recent = events
      .filter((e) => e.kind !== 'active' && e.at >= from)
      .slice(-40)
      .reverse();

    const emails = new Map(data.users.map((u) => [u.id, u.email ?? '(no email)']));
    const pending = data.analyses.filter(
      (a) => include(a.user_id) && (a.status === 'pending' || a.status === 'processing')
    ).length;

    return {
      now,
      from,
      weekly,
      daily,
      grid,
      rows,
      recent,
      emails,
      kpis: {
        totalUsers: data.users.filter((u) => !excludeMe || u.id !== adminId).length,
        newUsers: data.users.filter((u) => include(u.id) && inRange(u.created_at)).length,
        dau: activeUsersWithin(events, now, DAY_MS),
        wau: activeUsersWithin(events, now, 7 * DAY_MS),
        mau: activeUsersWithin(events, now, 30 * DAY_MS),
        uploads: recordings.length,
        uploaders: new Set(recordings.map((r) => r.user_id)).size,
        analyses: analysesInRange.length,
        failed,
        failureRate: finished ? failed / finished : null,
        pending,
        medianDuration: median(durations),
      },
      hists: {
        duration: histogram(durations, [0, 15, 30, 60, 120, 300, 600], fmtSeconds),
        fileSize: histogram(
          recordings.map((r) => (r.file_size ?? NaN) / 1_048_576),
          [0, 1, 2, 5, 10, 20, 50],
          fmtMB
        ),
        recordingLength: histogram(
          recordings.map((r) => (r.duration_seconds ?? NaN) / 60),
          [0, 2, 5, 10, 20, 30, 60],
          fmtMinutes
        ),
        uploadsPerAccount: histogram(uploadsPerAccount, [1, 2, 3, 5, 10, 20, 50], String),
      },
    };
  }, [data, range, excludeMe, selectedUser, adminId]);

  const sortedRows = useMemo(() => {
    if (!view) return [];
    const q = query.trim().toLowerCase();
    const rows = q ? view.rows.filter((r) => r.email.toLowerCase().includes(q)) : view.rows;
    const dir = sort.desc ? -1 : 1;
    return [...rows].sort((a, b) => {
      if (sort.key === 'email') return a.email.localeCompare(b.email) * dir;
      const av = (a[sort.key] as number | null) ?? -Infinity;
      const bv = (b[sort.key] as number | null) ?? -Infinity;
      return av === bv ? a.email.localeCompare(b.email) : (av < bv ? -1 : 1) * dir;
    });
  }, [view, sort, query]);

  const selectedEmail = selectedUser && view ? view.emails.get(selectedUser) : null;

  return (
    <main className="min-h-screen bg-neuro-light">
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <SquigglyLogo />
            <span className="text-sm font-semibold text-neuro-dark">Usage</span>
          </div>
          <Link href="/dashboard" className="text-sm text-neuro-primary hover:underline whitespace-nowrap">
            Back to dashboard
          </Link>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-gray-300 bg-white overflow-hidden">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`px-3 py-1.5 text-sm ${
                  range === r.key ? 'bg-neuro-primary text-white' : 'text-gray-800 hover:bg-gray-50'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input type="checkbox" checked={excludeMe} onChange={(e) => setExcludeMe(e.target.checked)} />
            Exclude my account
          </label>
          {selectedEmail && (
            <span className="inline-flex items-center gap-2 rounded-full bg-neuro-primary/10 text-neuro-dark px-3 py-1 text-sm">
              Showing {selectedEmail}
              <button onClick={() => setSelectedUser(null)} className="text-neuro-primary hover:underline">
                clear
              </button>
            </span>
          )}
          <div className="ml-auto flex items-center gap-3 text-sm text-gray-600">
            {data && <span>Updated {fmtDateTime(Date.parse(data.generated_at))}</span>}
            <button
              onClick={load}
              disabled={loading}
              className="bg-neuro-primary text-white px-3 py-1.5 rounded-lg hover:bg-neuro-accent disabled:opacity-50"
            >
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            Could not load usage: {error}
          </div>
        )}

        {!view && !error && <p className="text-gray-700">Loading usage…</p>}

        {view && (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
              <Stat label="Accounts" value={view.kpis.totalUsers} sub={`+${view.kpis.newUsers} in range`} />
              <Stat label="Active 24h" value={view.kpis.dau} />
              <Stat label="Active 7d" value={view.kpis.wau} />
              <Stat label="Active 30d" value={view.kpis.mau} />
              <Stat label="Uploads" value={view.kpis.uploads} sub={`${view.kpis.uploaders} accounts`} />
              <Stat label="Analyses" value={view.kpis.analyses} sub={view.kpis.pending ? `${view.kpis.pending} queued now` : undefined} />
              <Stat
                label="Failed"
                value={view.kpis.failed}
                sub={view.kpis.failureRate === null ? undefined : `${(view.kpis.failureRate * 100).toFixed(1)}% of runs`}
                alert={view.kpis.failed > 0}
              />
              <Stat
                label="Median run"
                value={view.kpis.medianDuration === null ? '—' : fmtSeconds(view.kpis.medianDuration)}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card
                title={`Active accounts per ${view.weekly ? 'week' : 'day'}`}
                note="Distinct accounts with any activity; sign-ups shown alongside."
              >
                <div className="h-64">
                  <Bar
                    data={dailyChart(view.daily, [
                      { key: 'activeUsers', label: 'Active accounts', color: COLORS.active },
                      { key: 'signups', label: 'New sign-ups', color: COLORS.signups },
                    ])}
                    options={baseOptions()}
                  />
                </div>
              </Card>
              <Card
                title={`Uploads and analyses per ${view.weekly ? 'week' : 'day'}`}
                note="Analyses are dated by their latest run."
              >
                <div className="h-64">
                  <Bar
                    data={dailyChart(view.daily, [
                      { key: 'uploads', label: 'Uploads', color: COLORS.uploads, stack: 'uploads' },
                      { key: 'analyses', label: 'Analyses completed', color: COLORS.analyses, stack: 'analyses' },
                      { key: 'failed', label: 'Analyses failed', color: COLORS.failed, stack: 'analyses' },
                    ])}
                    options={baseOptions(true)}
                  />
                </div>
              </Card>
            </div>

            <Card
              title="When accounts are active"
              note="Account-hours with any activity, by weekday and hour (your local time)."
            >
              <Heatmap grid={view.grid} />
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <HistCard title="Analysis processing time" bins={view.hists.duration} unit="analyses" />
              <HistCard title="Upload file size" bins={view.hists.fileSize} unit="uploads" />
              <HistCard title="Recording length" bins={view.hists.recordingLength} unit="uploads" />
              <HistCard title="Uploads per account" bins={view.hists.uploadsPerAccount} unit="accounts" />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <div className="xl:col-span-2">
                <Card
                  title={`Accounts (${sortedRows.length})`}
                  note="Counts are within the selected range; last active is all-time. Click a row to filter every chart to that account."
                  action={
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search email"
                      className="border border-gray-300 rounded px-2 py-1 text-sm text-gray-900"
                    />
                  }
                >
                  <AccountsTable
                    rows={sortedRows}
                    now={view.now}
                    sort={sort}
                    onSort={(key) =>
                      setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'email' }))
                    }
                    selected={selectedUser}
                    onSelect={(id) => setSelectedUser((cur) => (cur === id ? null : id))}
                  />
                </Card>
              </div>
              <Card title="Recent events">
                {view.recent.length === 0 ? (
                  <p className="text-sm text-gray-600">Nothing in this range.</p>
                ) : (
                  <ul className="divide-y divide-gray-100 max-h-[560px] overflow-y-auto">
                    {view.recent.map((e, i) => (
                      <li key={i} className="py-2 text-sm">
                        <div className="flex justify-between gap-2">
                          <span className={e.kind === 'analysis-failed' ? 'text-red-700 font-medium' : 'text-gray-900'}>
                            {KIND_LABELS[e.kind]}
                          </span>
                          <span className="text-gray-500 whitespace-nowrap">{fmtDateTime(e.at)}</span>
                        </div>
                        <button
                          onClick={() => setSelectedUser(e.userId)}
                          className="text-gray-600 hover:text-neuro-primary truncate max-w-full text-left"
                        >
                          {view.emails.get(e.userId) ?? e.userId}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <p className="text-xs text-gray-500">
              Activity comes from sign-ins, token refreshes (about hourly while a tab is open), uploads, analysis runs and
              annotations. Sessions are deleted on sign-out, so older browsing activity is undercounted; uploads and
              analyses are complete.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

function dailyChart(
  daily: ReturnType<typeof dailySeries>,
  series: Array<{ key: 'activeUsers' | 'signups' | 'uploads' | 'analyses' | 'failed'; label: string; color: string; stack?: string }>
): ChartData<'bar', number[], string> {
  return {
    labels: daily.map((d) => shortDay(d.day)), // week buckets are labelled by their Monday
    datasets: series.map((s) => ({
      label: s.label,
      data: daily.map((d) => d[s.key]),
      backgroundColor: s.color,
      borderRadius: 2,
      borderSkipped: 'start' as const,
      borderColor: '#ffffff',
      borderWidth: s.stack ? { top: 1 } : 0,
      stack: s.stack,
      maxBarThickness: 18,
    })),
  };
}

function Card({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-lg shadow-md p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="min-w-[12rem] flex-1">
          <h2 className="text-base font-semibold text-neuro-dark">{title}</h2>
          {note && <p className="text-xs text-gray-600 mt-0.5">{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, sub, alert }: { label: string; value: number | string; sub?: string; alert?: boolean }) {
  return (
    <div className="bg-white rounded-lg shadow-md px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-gray-600">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${alert ? 'text-red-700' : 'text-neuro-dark'}`}>{value}</div>
      {sub && <div className="text-xs text-gray-600">{sub}</div>}
    </div>
  );
}

function HistCard({ title, bins, unit }: { title: string; bins: Array<{ label: string; count: number }>; unit: string }) {
  const total = bins.reduce((s, b) => s + b.count, 0);
  const data: ChartData<'bar', number[], string> = {
    labels: bins.map((b) => b.label),
    datasets: [
      {
        label: unit,
        data: bins.map((b) => b.count),
        backgroundColor: COLORS.hist,
        borderRadius: { topLeft: 4, topRight: 4 },
        borderSkipped: 'start',
        barPercentage: 0.94,
        categoryPercentage: 1,
      },
    ],
  };
  const options = baseOptions();
  options.plugins = {
    legend: { display: false },
    tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y} ${unit}` } },
  };
  return (
    <Card title={title} note={`${total} ${unit} in range`}>
      <div className="h-44">
        <Bar data={data} options={options} />
      </div>
    </Card>
  );
}

function Heatmap({ grid }: { grid: number[][] }) {
  const max = Math.max(1, ...grid.flat());
  return (
    <div className="overflow-x-auto">
      <div className="inline-grid gap-[2px] min-w-full" style={{ gridTemplateColumns: `2.5rem repeat(24, minmax(18px, 1fr))` }}>
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="text-[10px] text-gray-500 text-center">
            {h % 3 === 0 ? (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`) : ''}
          </div>
        ))}
        {grid.map((row, d) => (
          <div key={d} className="contents">
            <div className="text-xs text-gray-600 pr-1 leading-[22px]">{WEEKDAYS[d]}</div>
            {row.map((v, h) => (
              <div
                key={h}
                title={`${WEEKDAYS[d]} ${h}:00–${h + 1}:00 · ${v} account-hour${v === 1 ? '' : 's'}`}
                className="h-[22px] rounded-sm"
                style={{
                  backgroundColor: v === 0 ? '#f3f4f6' : `rgba(119, 61, 255, ${0.15 + 0.85 * (v / max)})`,
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-2 text-xs text-gray-600">
        <span>Less</span>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <span
            key={f}
            className="inline-block w-4 h-3 rounded-sm"
            style={{ backgroundColor: f === 0 ? '#f3f4f6' : `rgba(119, 61, 255, ${0.15 + 0.85 * f})` }}
          />
        ))}
        <span>More (max {max})</span>
      </div>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 96;
  const h = 20;
  const max = Math.max(1, ...values);
  if (values.length < 2) return null;
  const step = w / (values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 1 - (v / max) * (h - 2)).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} className="block" aria-hidden>
      <polyline points={points} fill="none" stroke={COLORS.active} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

function AccountsTable({
  rows,
  now,
  sort,
  onSort,
  selected,
  onSelect,
}: {
  rows: AccountRow[];
  now: number;
  sort: { key: SortKey; desc: boolean };
  onSort: (key: SortKey) => void;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const header = (key: SortKey, label: string, align = 'text-right') => (
    <th className={`px-2 py-2 font-medium ${align}`}>
      <button onClick={() => onSort(key)} className="hover:text-neuro-primary whitespace-nowrap">
        {label}
        {sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  );
  return (
    <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 bg-white text-gray-600 border-b border-gray-200">
          <tr>
            {header('email', 'Account', 'text-left')}
            {header('lastActive', 'Last active')}
            <th className="px-2 py-2 font-medium text-left">Activity</th>
            {header('activeDays', 'Days')}
            {header('uploads', 'Uploads')}
            {header('analyses', 'Analyses')}
            {header('failed', 'Failed')}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr
              key={r.id}
              onClick={() => onSelect(r.id)}
              className={`cursor-pointer ${selected === r.id ? 'bg-neuro-primary/10' : 'hover:bg-gray-50'}`}
            >
              <td className="px-2 py-1.5 text-gray-900 max-w-[240px] truncate" title={r.email}>
                {r.email}
                <div className="text-xs text-gray-500">
                  joined {fmtDate(r.createdAt)} · {r.projects} project{r.projects === 1 ? '' : 's'}
                  {r.lastUpload !== null && ` · last upload ${fmtDate(r.lastUpload)}`}
                </div>
              </td>
              <td className="px-2 py-1.5 text-right text-gray-800 whitespace-nowrap" title={r.lastActive ? fmtDateTime(r.lastActive) : ''}>
                {fmtAgo(r.lastActive, now)}
              </td>
              <td className="px-2 py-1.5">
                <Sparkline values={r.spark} />
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-gray-800">{r.activeDays || ''}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-gray-800">{r.uploads || ''}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-gray-800">{r.analyses || ''}</td>
              <td className={`px-2 py-1.5 text-right tabular-nums ${r.failed ? 'text-red-700 font-medium' : ''}`}>
                {r.failed || ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
