'use client';

import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  type ChartData,
  type ChartOptions,
} from 'chart.js';
import { CONNECTIVITY_BAND_NAMES, type Condition, type Connectivity } from '@/lib/analysis-results';
import { CONDITIONS, CONDITION_LABELS, NETWORK_METRICS, networkMetricSeries } from './data';

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

// Same EO/EC colours as the former matplotlib summary
const CONDITION_COLORS: Record<Condition, string> = { eo: '#1f77b4', ec: '#ff7f0e' };
const BAND_TICKS = CONNECTIVITY_BAND_NAMES.map((b) => b.charAt(0).toUpperCase() + b.slice(1));

export interface NetworkMetricsBarsProps {
  connectivity: Partial<Record<Condition, Connectivity | null>> | null | undefined;
}

/** Bar charts (one per metric) of network metrics by band, EO vs EC. */
export default function NetworkMetricsBars({ connectivity }: NetworkMetricsBarsProps) {
  const conditions = CONDITIONS.filter((c) => connectivity?.[c]?.network_metrics);
  if (conditions.length === 0) {
    return <p className="text-sm text-gray-600">No network metrics available.</p>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {NETWORK_METRICS.map(({ key, label }) => {
        const data: ChartData<'bar', Array<number | null>, string> = {
          labels: BAND_TICKS,
          datasets: conditions.map((c) => ({
            label: CONDITION_LABELS[c],
            data: networkMetricSeries(connectivity?.[c], key),
            backgroundColor: CONDITION_COLORS[c] + 'cc',
            borderColor: CONDITION_COLORS[c],
            borderWidth: 1,
          })),
        };
        const options: ChartOptions<'bar'> = {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, color: '#1f2937' } },
            tooltip: {
              callbacks: {
                label: (ctx) =>
                  `${ctx.dataset.label}: ${typeof ctx.parsed.y === 'number' ? ctx.parsed.y.toFixed(3) : 'N/A'}`,
              },
            },
          },
          scales: {
            x: { ticks: { color: '#374151' }, grid: { display: false } },
            y: { beginAtZero: true, ticks: { color: '#374151' }, grid: { color: '#e5e7eb' } },
          },
        };
        const summary = conditions
          .map(
            (c) =>
              `${CONDITION_LABELS[c]}: ` +
              networkMetricSeries(connectivity?.[c], key)
                .map((v, i) => `${BAND_TICKS[i]} ${v === null ? 'N/A' : v.toFixed(3)}`)
                .join(', ')
          )
          .join('; ');
        return (
          <figure key={key} className="border border-gray-200 rounded-lg p-3">
            <figcaption className="text-sm font-semibold text-gray-900 text-center mb-2">{label}</figcaption>
            <div className="h-56" role="img" aria-label={`${label} by frequency band. ${summary}`}>
              <Bar data={data} options={options} />
            </div>
          </figure>
        );
      })}
    </div>
  );
}
