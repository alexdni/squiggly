'use client';

import { useMemo, useState } from 'react';
import { BAND_NAMES, BANDS, type BandName, type BandPower, type Condition } from '@/lib/analysis-results';
import type { Scale } from './topo';
import Topomap, { ColorLegend } from './Topomap';
import {
  BAND_LABELS,
  CONDITIONS,
  CONDITION_LABELS,
  bandValues,
  computeBandScales,
  type PowerMode,
} from './data';

export interface TopomapGridProps {
  bandPower: Partial<Record<Condition, BandPower | null>> | null | undefined;
  /** Controlled absolute/relative mode (e.g. shared across both sides of a comparison). */
  mode?: PowerMode;
  onModeChange?: (mode: PowerMode) => void;
  /** Per-band scales to use instead of pooling this analysis's EO/EC (comparison view). */
  scales?: Partial<Record<BandName, Scale>>;
  /** Hide the mode toggle (when the parent renders a shared one). */
  hideToggle?: boolean;
  /** At most two band cards per row (for half-width placement, e.g. comparison columns). */
  compact?: boolean;
}

const formatPercent = (v: number) => `${(v * 100).toFixed(1)}%`;

export function PowerModeToggle({
  mode,
  onChange,
}: {
  mode: PowerMode;
  onChange: (mode: PowerMode) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Band power scale" className="inline-flex rounded-lg border border-gray-300 overflow-hidden text-sm">
      {(['absolute', 'relative'] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          onClick={() => onChange(m)}
          className={`px-3 py-1.5 font-medium transition-colors ${
            mode === m ? 'bg-neuro-primary text-white' : 'bg-white text-gray-800 hover:bg-gray-50'
          }`}
        >
          {m === 'absolute' ? 'Absolute (µV²)' : 'Relative (%)'}
        </button>
      ))}
    </div>
  );
}

/**
 * Band power maps: one card per band with EO and EC side by side on a shared scale (2nd–98th
 * percentile pooled across conditions), as the former Python `generate_topomap_grid`.
 */
export default function TopomapGrid({
  bandPower,
  mode: controlledMode,
  onModeChange,
  scales: scaleOverride,
  hideToggle = false,
  compact = false,
}: TopomapGridProps) {
  const [localMode, setLocalMode] = useState<PowerMode>('absolute');
  const mode = controlledMode ?? localMode;
  const setMode = (m: PowerMode) => {
    setLocalMode(m);
    onModeChange?.(m);
  };

  const conditions = CONDITIONS.filter((c) => bandPower?.[c]);
  const values = useMemo(() => {
    const out: Partial<Record<BandName, Partial<Record<Condition, Record<string, number>>>>> = {};
    for (const band of BAND_NAMES) {
      out[band] = {};
      for (const c of CONDITIONS) out[band]![c] = bandValues(bandPower?.[c], band, mode);
    }
    return out;
  }, [bandPower, mode]);
  const ownScales = useMemo(
    () => computeBandScales(CONDITIONS.map((c) => bandPower?.[c]), mode),
    [bandPower, mode]
  );
  const scales = scaleOverride ?? ownScales;

  if (conditions.length === 0) {
    return <p className="text-sm text-gray-600">No band power data available.</p>;
  }

  return (
    <div>
      {!hideToggle && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <PowerModeToggle mode={mode} onChange={setMode} />
          <span className="text-xs text-gray-600">Each band shares one colour scale across conditions</span>
        </div>
      )}
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${compact ? '' : 'xl:grid-cols-4'}`}>
        {BAND_NAMES.map((band) => {
          const [lo, hi] = BANDS[band];
          return (
            <figure key={band} className="border border-gray-200 rounded-lg p-3">
              <figcaption className="text-center mb-2">
                <span className="font-semibold text-gray-900">{BAND_LABELS[band]}</span>{' '}
                <span className="text-xs text-gray-600">
                  {lo}–{hi} Hz
                </span>
              </figcaption>
              <div className={`grid gap-2 ${conditions.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {conditions.map((c) => (
                  <div key={c}>
                    <div className="text-xs font-medium text-gray-700 text-center mb-1">{c.toUpperCase()}</div>
                    <Topomap
                      values={values[band]?.[c] ?? {}}
                      scale={scales[band] ?? null}
                      label={`${BAND_LABELS[band]} ${mode} power, ${CONDITION_LABELS[c]}`}
                      maxSize={conditions.length > 1 ? 180 : 220}
                    />
                  </div>
                ))}
              </div>
              <ColorLegend
                className="mt-2"
                scale={scales[band]}
                format={mode === 'relative' ? formatPercent : undefined}
                label={mode === 'absolute' ? 'µV²' : 'of 1–45 Hz power'}
              />
            </figure>
          );
        })}
      </div>
    </div>
  );
}
