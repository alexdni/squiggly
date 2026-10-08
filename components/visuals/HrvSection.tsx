'use client';

// Heart-rate variability from the recording's ECG lead: summary cards and time series, laid
// out like the Divergence webapp's HRV summary (same metric set and colours).

import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartDataset,
  type ChartOptions,
} from 'chart.js';
import type { HrvResults, TimeSeries } from '@/lib/analysis-results';

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Legend, Filler);

const COLORS = {
  heartRate: '#E5397A',
  nn: '#64748B',
  rmssd: '#8E44AD',
  sdnn: '#2E86DE',
  pnn50: '#10B981',
  lf: '#6366F1',
  hf: '#06B6D4',
  ratio: '#F59E0B',
};

const fmt = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits);

const fmtClock = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const points = (s: TimeSeries | undefined) => (s ? s.t.map((t, i) => ({ x: t, y: s.v[i] })) : []);

function line(label: string, s: TimeSeries | undefined, color: string, extra: Partial<ChartDataset<'line'>> = {}): ChartDataset<'line', { x: number; y: number }[]> {
  return {
    label,
    data: points(s),
    borderColor: color,
    backgroundColor: `${color}22`,
    borderWidth: 1.5,
    pointRadius: 0,
    tension: 0.2,
    ...extra,
  } as ChartDataset<'line', { x: number; y: number }[]>;
}

function chartOptions(yTitle: string, opts: { y2Title?: string; stacked?: boolean; max?: number } = {}): ChartOptions<'line'> {
  const tick = { color: '#94A3B8', font: { size: 11 } };
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    parsing: false,
    interaction: { mode: 'nearest', intersect: false, axis: 'x' },
    plugins: {
      legend: { display: true, position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
      tooltip: {
        callbacks: {
          title: (items) => (items[0] ? fmtClock(items[0].parsed.x ?? 0) : ''),
        },
      },
    },
    scales: {
      x: {
        type: 'linear',
        ticks: { ...tick, callback: (v) => fmtClock(Number(v)) },
        title: { display: true, text: 'Time (m:ss)', color: '#94A3B8', font: { size: 11 } },
        grid: { color: '#F1F5F9' },
      },
      y: {
        stacked: opts.stacked,
        min: opts.stacked ? 0 : undefined,
        max: opts.max,
        ticks: tick,
        title: { display: true, text: yTitle, color: '#94A3B8', font: { size: 11 } },
        grid: { color: '#F1F5F9' },
      },
      ...(opts.y2Title
        ? {
            y2: {
              position: 'right' as const,
              ticks: tick,
              title: { display: true, text: opts.y2Title, color: '#94A3B8', font: { size: 11 } },
              grid: { drawOnChartArea: false },
            },
          }
        : {}),
    },
  };
}

function MetricCard({ label, value, unit, hint, color }: { label: string; value: string; unit?: string; hint?: string; color: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} aria-hidden="true" />
        {label}
      </div>
      <div className="mt-1 text-xl font-bold text-gray-900">
        {value}
        {unit && value !== '—' && <span className="ml-1 text-sm font-medium text-gray-500">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-gray-500">{hint}</div>}
    </div>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
      {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      <div className="mt-2 h-56">{children}</div>
    </div>
  );
}

export default function HrvSection({ hrv }: { hrv: HrvResults }) {
  const s = hrv.summary;
  const se = hrv.series;
  const hasFreq = Boolean(se.lf_ms2?.v.length);

  return (
    <div>
      <p className="text-sm text-gray-600 mb-4">
        From the <strong>{hrv.channel}</strong> lead over the whole recording: {hrv.beats} heartbeats detected,
        covering {fmt(hrv.coverage_pct, 0)}% of {fmtClock(hrv.duration_sec)}. Window metrics use a 1-minute sliding
        window.
      </p>

      {!hrv.reliable ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {hrv.notes.map((n, i) => (
            <p key={i}>{n}</p>
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
            <MetricCard label="Average heart rate" value={fmt(s.mean_hr_bpm)} unit="bpm" color={COLORS.heartRate} />
            <MetricCard label="SDNN" value={fmt(s.sdnn_ms)} unit="ms" hint="Overall variability" color={COLORS.sdnn} />
            <MetricCard label="RMSSD" value={fmt(s.rmssd_ms)} unit="ms" hint="Beat-to-beat (vagal)" color={COLORS.rmssd} />
            <MetricCard label="pNN50" value={fmt(s.pnn50_pct)} unit="%" hint="Successive Δ > 50 ms" color={COLORS.pnn50} />
            <MetricCard label="LF / HF" value={fmt(s.lf_hf, 2)} hint="Sympatho-vagal balance" color={COLORS.ratio} />
            <MetricCard label="LF power" value={fmt(s.lf_ms2)} unit="ms²" hint="0.04–0.15 Hz" color={COLORS.lf} />
            <MetricCard label="HF power" value={fmt(s.hf_ms2)} unit="ms²" hint="0.15–0.4 Hz" color={COLORS.hf} />
            <MetricCard label="LF nu" value={fmt(s.lf_nu)} unit="%" color={COLORS.lf} />
            <MetricCard label="HF nu" value={fmt(s.hf_nu)} unit="%" color={COLORS.hf} />
            <MetricCard label="VLF power" value={fmt(s.vlf_ms2)} unit="ms²" hint="< 0.04 Hz, needs ≥ 4.5 min" color="#8895A7" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Heart rate & RR tachogram" subtitle="Instantaneous heart rate and the interval between detected beats">
              <Line
                data={{
                  datasets: [
                    line('Heart rate (bpm)', se.heart_rate_bpm, COLORS.heartRate),
                    line('NN interval (ms)', se.nn_ms, COLORS.nn, { yAxisID: 'y2', borderWidth: 1 }),
                  ],
                }}
                options={chartOptions('bpm', { y2Title: 'ms' })}
              />
            </ChartCard>

            <ChartCard title="Time-domain HRV" subtitle="RMSSD and SDNN (ms), pNN50 (%) — 1-minute windows">
              <Line
                data={{
                  datasets: [
                    line('RMSSD (ms)', se.rmssd_ms, COLORS.rmssd),
                    line('SDNN (ms)', se.sdnn_ms, COLORS.sdnn),
                    line('pNN50 (%)', se.pnn50_pct, COLORS.pnn50, { yAxisID: 'y2', borderDash: [4, 3] }),
                  ],
                }}
                options={chartOptions('ms', { y2Title: '%' })}
              />
            </ChartCard>

            {hasFreq ? (
              <>
                <ChartCard title="LF & HF power" subtitle="ms², 1-minute windows; LF/HF ratio on the right axis">
                  <Line
                    data={{
                      datasets: [
                        line('LF (ms²)', se.lf_ms2, COLORS.lf),
                        line('HF (ms²)', se.hf_ms2, COLORS.hf),
                        line('LF/HF', se.lf_hf, COLORS.ratio, { yAxisID: 'y2', borderDash: [4, 3] }),
                      ],
                    }}
                    options={chartOptions('ms²', { y2Title: 'LF/HF' })}
                  />
                </ChartCard>

                <ChartCard title="LF / HF balance (normalized units)" subtitle="Share of LF+HF power, %">
                  <Line
                    data={{
                      datasets: [
                        line('LF nu', se.lf_nu, COLORS.lf, { fill: 'origin', backgroundColor: `${COLORS.lf}55` }),
                        line('HF nu', se.hf_nu, COLORS.hf, { fill: '-1', backgroundColor: `${COLORS.hf}55` }),
                      ],
                    }}
                    options={chartOptions('%', { stacked: true, max: 100 })}
                  />
                </ChartCard>
              </>
            ) : (
              <p className="text-sm text-gray-600 lg:col-span-2">
                LF/HF need at least 2 minutes of ECG; this recording is too short for the frequency-domain charts.
              </p>
            )}
          </div>

          {hrv.notes.length > 0 && (
            <ul className="mt-3 list-disc pl-5 text-xs text-gray-500 space-y-0.5">
              {hrv.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
