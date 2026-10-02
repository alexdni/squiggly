'use client';

import { useMemo } from 'react';
import type { AlphaPeak, Condition } from '@/lib/analysis-results';
import { viridis } from './topo';
import Topomap from './Topomap';
import { ALPHA_PEAK_SCALE, CONDITIONS, CONDITION_LABELS, alphaPeakValues } from './data';

export interface AlphaPeakTopomapsProps {
  alphaPeak: Partial<Record<Condition, AlphaPeak | null>> | null | undefined;
}

const hz = (v: number) => `${v.toFixed(1)} Hz`;

/** Individual alpha frequency per condition: fixed 8–12 Hz viridis map plus a per-channel table. */
export default function AlphaPeakTopomaps({ alphaPeak }: AlphaPeakTopomapsProps) {
  const conditions = CONDITIONS.filter((c) => alphaPeak?.[c] && Object.keys(alphaPeak[c]!).length > 0);
  const values = useMemo(
    () =>
      Object.fromEntries(CONDITIONS.map((c) => [c, alphaPeakValues(alphaPeak?.[c])])) as Record<
        Condition,
        Record<string, number>
      >,
    [alphaPeak]
  );

  if (conditions.length === 0) {
    return <p className="text-sm text-gray-600">No alpha peak data available.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-6">
      {conditions.map((c) => {
        const rows = Object.entries(alphaPeak?.[c] ?? {}).sort(([a], [b]) => a.localeCompare(b));
        const freqs = Object.values(values[c]);
        const mean = freqs.length ? freqs.reduce((s, v) => s + v, 0) / freqs.length : NaN;
        return (
          <section key={c} className="border border-gray-200 rounded-lg p-4" aria-label={`Alpha peak, ${CONDITION_LABELS[c]}`}>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">
              {CONDITION_LABELS[c]}
              {Number.isFinite(mean) && (
                <span className="ml-2 text-sm font-normal text-gray-700">mean IAF {mean.toFixed(2)} Hz</span>
              )}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              <Topomap
                values={values[c]}
                scale={ALPHA_PEAK_SCALE}
                colormap={viridis}
                contours={6}
                showLabels
                colorbar={{ label: 'Peak frequency (Hz)', format: hz }}
                label={`Peak alpha frequency map, ${CONDITION_LABELS[c]}, scale 8 to 12 Hz`}
                maxSize={380}
              />
              <div className="overflow-x-auto max-h-96 overflow-y-auto border border-gray-200 rounded">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase">Channel</th>
                      <th scope="col" className="px-3 py-2 text-center text-xs font-medium text-gray-700 uppercase">Peak <span className="normal-case">(Hz)</span></th>
                      <th scope="col" className="px-3 py-2 text-center text-xs font-medium text-gray-700 uppercase">Power <span className="normal-case">(µV²/Hz)</span></th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {rows.map(([ch, v]) => (
                      <tr key={ch} className="hover:bg-gray-50">
                        <td className="px-3 py-1.5 text-xs font-medium text-gray-900">{ch}</td>
                        <td className="px-3 py-1.5 text-xs text-gray-900 text-center font-mono">
                          {Number.isFinite(v?.peak_frequency) && v.peak_frequency > 0 ? v.peak_frequency.toFixed(2) : 'N/A'}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-gray-900 text-center font-mono">
                          {Number.isFinite(v?.peak_power) ? v.peak_power.toFixed(1) : 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
