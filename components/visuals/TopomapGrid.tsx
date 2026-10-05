'use client';

import { useMemo, useState } from 'react';
import { BAND_NAMES, BANDS, type BandName, type BandPower, type Condition } from '@/lib/analysis-results';
import type { Scale } from './topo';
import Topomap from './Topomap';
import { CANVAS_SIZE, LEGEND_GRADIENT_CSS, fmtAbs, fmtRel, qeegDiscrete } from './topoRender';
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

/** DivergenceWebapp's master band-power colour legend. */
function MasterLegend({ mode }: { mode: PowerMode }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-sm font-semibold">Color Legend ({mode === 'absolute' ? 'µV²' : '% of total'})</span>
      <div
        aria-hidden="true"
        style={{ width: 240, height: 14, marginTop: 6, borderRadius: 2, background: LEGEND_GRADIENT_CSS, border: '1px solid #bbb' }}
      />
      <span className="text-xs" style={{ color: '#888', marginTop: 4 }}>
        (each band scaled to its own min/max, shared across conditions)
      </span>
    </div>
  );
}

/**
 * Band power maps drawn as DivergenceWebapp's band-power topomaps (discrete QEEG bands, min/max
 * legend under each map): one card per band with EO and EC side by side on a shared scale (min/max
 * pooled across conditions, or across both analyses in a comparison).
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

  const fmt = mode === 'absolute' ? fmtAbs : fmtRel;
  const unit = mode === 'absolute' ? ' µV²' : ''; // relative already carries % via fmtRel

  return (
    <div>
      {!hideToggle && (
        <div className="flex flex-wrap items-center justify-center gap-4 mb-2">
          <PowerModeToggle mode={mode} onChange={setMode} />
        </div>
      )}
      <div className="mb-4">
        <MasterLegend mode={mode} />
      </div>
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${compact ? '' : 'xl:grid-cols-4'}`}>
        {BAND_NAMES.map((band) => {
          const [lo, hi] = BANDS[band];
          return (
            <figure key={band} className="border border-gray-200 rounded-lg p-3">
              <figcaption className="flex flex-col items-center mb-1">
                <span className="text-xs font-semibold">{BAND_LABELS[band]}</span>
                <span style={{ fontSize: 9, color: '#888', minHeight: 12 }}>
                  {lo}–{hi} Hz
                </span>
              </figcaption>
              <div className={`grid gap-3 ${conditions.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {conditions.map((c) => (
                  <Topomap
                    key={c}
                    values={values[band]?.[c] ?? {}}
                    scale={scales[band] ?? null}
                    colormap={qeegDiscrete}
                    label={c.toUpperCase()}
                    legend={{ format: fmt, unit, gradient: LEGEND_GRADIENT_CSS }}
                    ariaLabel={`${BAND_LABELS[band]} ${mode} power, ${CONDITION_LABELS[c]}`}
                    maxSize={CANVAS_SIZE}
                  />
                ))}
              </div>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
