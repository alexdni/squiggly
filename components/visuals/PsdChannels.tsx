'use client';

// One full-width power spectrum chart with a channel selector, like DivergenceWebapp's
// LiveSession PowerSpectrum "Overlay" view: a black Global (channel average) trace, a toggle per
// channel, alpha peak markers, band presets and a frequency range, and a CSV of what is shown.

import { useEffect, useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  LogarithmicScale,
  PointElement,
  Tooltip,
  type ChartDataset,
  type ChartOptions,
} from 'chart.js';
import type { AlphaPeak, Condition, PsdData } from '@/lib/analysis-results';
import { CONDITIONS, CONDITION_LABELS } from './data';
import {
  BAND_PRESETS,
  GLOBAL,
  GLOBAL_COLOR,
  PSD_RANGE,
  channelColor,
  globalSpectrum,
  presetFor,
  psdCsv,
  seriesPoints,
  type FreqRange,
} from './psdChannelSeries';
import { snapAlphaPeak } from './psdHeadMapLayout';
import SegmentedToggle from './SegmentedToggle';

ChartJS.register(LinearScale, LogarithmicScale, LineElement, PointElement, Tooltip, Legend);

type Points = { x: number; y: number }[];
type YScale = 'log' | 'linear';

const PEAK_LABEL = ' alpha peak';

export interface PsdChannelsProps {
  psd: Partial<Record<Condition, PsdData | null>> | null | undefined;
  alphaPeak?: Partial<Record<Condition, AlphaPeak | null>> | null;
  /** names the CSV download */
  fileStem?: string;
}

export default function PsdChannels({ psd, alphaPeak, fileStem = 'psd' }: PsdChannelsProps) {
  const conditions = CONDITIONS.filter((c) => psd?.[c]);
  const [condition, setCondition] = useState<Condition | undefined>(conditions[0]);
  const spectra = condition ? psd?.[condition] ?? null : null;
  const channels = useMemo(() => Object.keys(spectra?.channels ?? {}), [spectra]);
  const multi = channels.length > 1;

  // As in the Divergence webapp: the global average alone for several channels, else the channel
  const [shown, setShown] = useState<string[]>(() => (multi ? [GLOBAL] : channels));
  const [range, setRange] = useState<FreqRange>(PSD_RANGE);
  const [yScale, setYScale] = useState<YScale>('log');

  // Keep the selection to traces this condition has
  useEffect(() => {
    setShown((prev) => {
      const kept = prev.filter((t) => (t === GLOBAL ? multi : channels.includes(t)));
      return kept.length ? kept : multi ? [GLOBAL] : channels;
    });
  }, [channels, multi]);

  const global = useMemo(() => (spectra && multi ? globalSpectrum(spectra) : []), [spectra, multi]);

  const datasets = useMemo(() => {
    if (!spectra) return [];
    const out: ChartDataset<'line', Points>[] = [];
    const line = (label: string, power: number[], color: string) => {
      out.push({
        label,
        data: seriesPoints(spectra.freqs, power, range),
        borderColor: color,
        backgroundColor: color,
        borderWidth: label === GLOBAL ? 2.5 : 1.5,
        pointRadius: 0,
        tension: 0.2,
      });
    };
    const peak = (label: string, power: number[], peakHz: number | undefined, color: string) => {
      const p = snapAlphaPeak(spectra.freqs, power, peakHz);
      if (!p || p.freq < range[0] || p.freq > range[1] || !(p.power > 0)) return;
      out.push({
        label: `${label}${PEAK_LABEL}`,
        data: [{ x: p.freq, y: p.power }],
        borderColor: color,
        backgroundColor: color,
        pointRadius: 5,
        pointHoverRadius: 6,
        showLine: false,
      });
    };

    if (multi && shown.includes(GLOBAL)) line(GLOBAL, global, GLOBAL_COLOR);
    channels.forEach((channel, i) => {
      if (!shown.includes(channel)) return;
      const power = spectra.channels[channel];
      line(channel, power, channelColor(i));
      peak(channel, power, condition ? alphaPeak?.[condition]?.[channel]?.peak_frequency : undefined, channelColor(i));
    });
    return out;
  }, [spectra, channels, multi, shown, global, range, alphaPeak, condition]);

  const options = useMemo<ChartOptions<'line'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => !item.dataset.label?.endsWith(PEAK_LABEL),
          callbacks: {
            title: (items) => (items[0] ? `${Number(items[0].parsed.x).toFixed(1)} Hz` : ''),
            label: (item) => `${item.dataset.label}: ${Number(item.parsed.y).toFixed(2)} µV²/Hz`,
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          min: range[0],
          max: range[1],
          title: { display: true, text: 'Frequency (Hz)', color: '#4B5563' },
          grid: { color: '#F1F5F9' },
        },
        y: {
          type: yScale === 'log' ? 'logarithmic' : 'linear',
          ...(yScale === 'linear' ? { beginAtZero: true } : {}),
          title: { display: true, text: 'Power (µV²/Hz)', color: '#4B5563' },
          grid: { color: '#F1F5F9' },
        },
      },
    }),
    [range, yScale]
  );

  if (!condition || !spectra) {
    return <p className="text-sm text-gray-600">No spectra available.</p>;
  }

  const toggle = (trace: string) =>
    setShown((prev) => (prev.includes(trace) ? prev.filter((t) => t !== trace) : [...prev, trace]));
  const traces = [...(multi ? [GLOBAL] : []), ...channels];
  const preset = presetFor(range);
  const setBound = (i: 0 | 1, value: number) =>
    setRange((prev) => {
      const next: FreqRange = [...prev];
      next[i] = value;
      // keep at least one bin between the ends
      return next[1] - next[0] >= 1 ? next : prev;
    });

  const downloadCsv = () => {
    const blob = new Blob([psdCsv(spectra, traces.filter((t) => shown.includes(t)), range)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileStem}-${condition}-psd.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-center gap-3 mb-3" data-export-ignore>
        {conditions.length > 1 && (
          <SegmentedToggle
            label="Condition"
            value={condition}
            options={conditions.map((c) => [c, CONDITION_LABELS[c]])}
            onChange={setCondition}
          />
        )}
        <span className="text-sm text-gray-700">Y scale</span>
        <SegmentedToggle
          label="Y-axis scale"
          value={yScale}
          options={[
            ['log', 'Log'],
            ['linear', 'Linear'],
          ]}
          onChange={setYScale}
        />
        <button
          type="button"
          onClick={downloadCsv}
          disabled={shown.length === 0}
          className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 disabled:opacity-50"
        >
          Download CSV
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-1.5 mb-3" role="group" aria-label="Channels shown">
        {traces.map((trace) => {
          const on = shown.includes(trace);
          const color = trace === GLOBAL ? GLOBAL_COLOR : channelColor(channels.indexOf(trace));
          return (
            <button
              key={trace}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(trace)}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-sm transition-colors ${
                on ? 'border-gray-400 bg-white text-gray-900' : 'border-gray-200 bg-gray-50 text-gray-400'
              }`}
            >
              <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: on ? color : '#d1d5db' }} />
              {trace}
            </button>
          );
        })}
        {multi && (
          <span className="inline-flex gap-1 ml-2" data-export-ignore>
            <button type="button" onClick={() => setShown(traces)} className="px-2 py-1 text-sm text-neuro-primary hover:underline">
              All
            </button>
            <button type="button" onClick={() => setShown([])} className="px-2 py-1 text-sm text-neuro-primary hover:underline">
              None
            </button>
          </span>
        )}
      </div>

      <figure
        className="relative w-full h-[420px]"
        aria-label={`Power spectral density, ${CONDITION_LABELS[condition]}, ${range[0]} to ${range[1]} Hz`}
      >
        <Line data={{ datasets }} options={options} />
        {shown.length === 0 && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">
            Select a channel to show its spectrum.
          </p>
        )}
      </figure>
      {shown.some((t) => t !== GLOBAL) && (
        <p className="text-xs text-gray-500 text-center mt-1">Dots mark each channel&apos;s individual alpha peak.</p>
      )}

      <div className="flex flex-wrap items-end justify-center gap-6 mt-4" data-export-ignore>
        <label className="text-sm text-gray-700">
          <span className="block mb-1 font-medium">Frequency band</span>
          <select
            value={preset}
            onChange={(e) => {
              const p = BAND_PRESETS.find(({ key }) => key === e.target.value);
              if (p) setRange(p.range);
            }}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white text-gray-900"
          >
            {BAND_PRESETS.map(({ key, label }) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
            {preset === 'custom' && <option value="custom">{`Custom (${range[0]} ~ ${range[1]} Hz)`}</option>}
          </select>
        </label>
        <fieldset className="text-sm text-gray-700">
          <legend className="mb-1 font-medium">Frequency range (Hz)</legend>
          <div className="flex items-center gap-2">
            <input
              type="range"
              aria-label="Lowest frequency"
              min={PSD_RANGE[0]}
              max={PSD_RANGE[1]}
              step={0.5}
              value={range[0]}
              onChange={(e) => setBound(0, Number(e.target.value))}
              className="w-40"
            />
            <span className="tabular-nums w-24 text-center">
              {range[0]} – {range[1]}
            </span>
            <input
              type="range"
              aria-label="Highest frequency"
              min={PSD_RANGE[0]}
              max={PSD_RANGE[1]}
              step={0.5}
              value={range[1]}
              onChange={(e) => setBound(1, Number(e.target.value))}
              className="w-40"
            />
          </div>
        </fieldset>
      </div>
    </div>
  );
}
