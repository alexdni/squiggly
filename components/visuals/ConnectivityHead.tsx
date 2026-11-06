'use client';

import { useId, useMemo, useState } from 'react';
import {
  CONNECTIVITY_BAND_NAMES,
  CONNECTIVITY_BANDS,
  type Condition,
  type Connectivity,
  type ConnectivityBandName,
} from '@/lib/analysis-results';
import { coolwarm, electrodePosition, normalize, normalizeChannelName, rgbCss, type Scale } from './topo';
import { ColorLegend } from './Topomap';
import {
  CONDITIONS,
  CONDITION_LABELS,
  connectivityEdges,
  connectivityScale,
  measureMatrix,
  type ConnectivityMeasure,
} from './data';

export const DEFAULT_WPLI_THRESHOLD = 0.1;
// On real 19-channel recordings this keeps roughly 10-45% of the pairs per band, so graphs stay readable
export const DEFAULT_COHERENCE_THRESHOLD = 0.3;

const MEASURE_LABELS: Record<ConnectivityMeasure, string> = { wpli: 'wPLI', coherence: 'Coherence' };

const VIEW = 220;
const R = 90; // head radius in SVG units
const C = VIEW / 2;
const toSvg = (p: { x: number; y: number }) => ({ x: C + p.x * R, y: C + 4 - p.y * R });

/** One head graph: electrodes as nodes, values ≥ threshold as coloured, weighted edges. */
export function ConnectivityGraph({
  matrix,
  threshold,
  scale,
  label,
  measure = 'wpli',
}: {
  matrix: { matrix: number[][]; channels: string[] } | null | undefined;
  threshold: number;
  scale: Scale;
  label: string;
  measure?: ConnectivityMeasure;
}) {
  const edges = useMemo(() => connectivityEdges(matrix, threshold), [matrix, threshold]);
  const nodes = (matrix?.channels ?? [])
    .map((ch) => ({ ch, pos: electrodePosition(ch) }))
    .filter((n): n is { ch: string; pos: { x: number; y: number } } => n.pos !== null);
  const titleId = useId();

  return (
    <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="w-full h-auto max-w-[240px] mx-auto block" role="img" aria-labelledby={titleId}>
      <title id={titleId}>{`${label}: ${edges.length} connections with ${MEASURE_LABELS[measure]} ≥ ${threshold.toFixed(2)}`}</title>
      <circle cx={C} cy={C + 4} r={R} fill="#f9fafb" stroke="#1f2937" strokeWidth={1.5} />
      <path d={`M ${C - 9} ${C + 4 - R + 1} L ${C} ${C + 4 - R - 11} L ${C + 9} ${C + 4 - R + 1}`} fill="none" stroke="#1f2937" strokeWidth={1.5} strokeLinejoin="round" />
      <ellipse cx={C - R - 4} cy={C + 4} rx={4.5} ry={15} fill="none" stroke="#1f2937" strokeWidth={1.5} />
      <ellipse cx={C + R + 4} cy={C + 4} rx={4.5} ry={15} fill="none" stroke="#1f2937" strokeWidth={1.5} />
      <g strokeLinecap="round">
        {edges.map((e) => {
          const a = toSvg(electrodePosition(e.a)!);
          const b = toSvg(electrodePosition(e.b)!);
          const t = normalize(e.value, scale);
          return (
            <line
              key={`${e.a}-${e.b}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={rgbCss(coolwarm(t))}
              strokeWidth={0.6 + 3.4 * t}
              strokeOpacity={0.75}
            >
              <title>{`${e.a}–${e.b}: ${e.value.toFixed(3)}`}</title>
            </line>
          );
        })}
      </g>
      {nodes.map(({ ch, pos }) => {
        const p = toSvg(pos);
        return (
          <g key={ch}>
            <circle cx={p.x} cy={p.y} r={6.5} fill="#ffffff" stroke="#111827" strokeWidth={1} />
            <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" fontSize={4.6} fill="#111827" fontWeight={600}>
              {normalizeChannelName(ch)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function ThresholdSlider({
  value,
  onChange,
  measure = 'wpli',
}: {
  value: number;
  onChange: (v: number) => void;
  measure?: ConnectivityMeasure;
}) {
  const id = useId();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor={id} className="text-sm font-medium text-gray-900">
        {MEASURE_LABELS[measure]} threshold
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={0.9}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-40 accent-neuro-primary"
      />
      <span className="text-sm font-mono text-gray-900 w-10">{value.toFixed(2)}</span>
    </div>
  );
}

export interface ConnectivityHeadProps {
  connectivity: Partial<Record<Condition, Connectivity | null>> | null | undefined;
  /** Controlled threshold (shared across a comparison); otherwise internal, default 0.1. */
  threshold?: number;
  onThresholdChange?: (v: number) => void;
  /** Shared edge colour range; defaults to this analysis's EO+EC edges. */
  scale?: Scale;
  hideSlider?: boolean;
  /** Two graphs per row at most (half-width placement). */
  compact?: boolean;
  measure?: ConnectivityMeasure;
}

/** Head graphs per band (columns) × condition (rows), coolwarm colour and width by strength. */
export default function ConnectivityHead({
  connectivity,
  threshold: controlled,
  onThresholdChange,
  scale: scaleOverride,
  hideSlider = false,
  compact = false,
  measure = 'wpli',
}: ConnectivityHeadProps) {
  const [local, setLocal] = useState(measure === 'coherence' ? DEFAULT_COHERENCE_THRESHOLD : DEFAULT_WPLI_THRESHOLD);
  const threshold = controlled ?? local;
  const setThreshold = (v: number) => {
    setLocal(v);
    onThresholdChange?.(v);
  };
  const conditions = CONDITIONS.filter((c) => measureMatrix(connectivity?.[c], 'alpha', measure));
  const ownScale = useMemo(
    () => connectivityScale(CONDITIONS.map((c) => connectivity?.[c]), threshold, measure),
    [connectivity, threshold, measure]
  );
  const scale = scaleOverride ?? ownScale;

  if (conditions.length === 0) {
    return (
      <p className="text-sm text-gray-600">
        {measure === 'coherence'
          ? 'No coherence for this analysis. Analyses made before coherence was added need a re-analysis.'
          : 'No connectivity data available.'}
      </p>
    );
  }
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
        {!hideSlider && <ThresholdSlider value={threshold} onChange={setThreshold} measure={measure} />}
        <ColorLegend className="w-full max-w-[14rem]" scale={scale} colormap={coolwarm} label={MEASURE_LABELS[measure]} />
      </div>
      {conditions.map((c) => {
        const nEpochs = measure === 'coherence' ? connectivity?.[c]?.coherence?.n_epochs : undefined;
        return (
        <div key={c} className="mb-6 last:mb-0">
          <h3 className="text-base font-semibold text-gray-900 mb-2">
            {CONDITION_LABELS[c]}
            {nEpochs !== undefined && (
              <span className="ml-2 text-sm font-normal text-gray-700">
                {`${nEpochs} epochs, chance level about ${(1 / nEpochs).toFixed(3)}`}
              </span>
            )}
          </h3>
          <div className={`grid grid-cols-2 gap-3 ${compact ? '' : 'lg:grid-cols-4'}`}>
            {CONNECTIVITY_BAND_NAMES.map((band: ConnectivityBandName) => {
              const [lo, hi] = CONNECTIVITY_BANDS[band];
              return (
                <figure key={band} className="border border-gray-200 rounded-lg p-2">
                  <figcaption className="text-center text-sm mb-1">
                    <span className="font-semibold text-gray-900 capitalize">{band}</span>{' '}
                    <span className="text-xs text-gray-600">
                      {lo}–{hi} Hz
                    </span>
                  </figcaption>
                  <ConnectivityGraph
                    matrix={measureMatrix(connectivity?.[c], band, measure)}
                    threshold={threshold}
                    scale={scale}
                    label={`${band} band ${MEASURE_LABELS[measure]}, ${CONDITION_LABELS[c]}`}
                    measure={measure}
                  />
                </figure>
              );
            })}
          </div>
        </div>
        );
      })}
    </div>
  );
}
