'use client';

import { useMemo, useState } from 'react';
import {
  BAND_NAMES,
  BANDS,
  type AlphaPeak,
  type Condition,
  type PsdData,
} from '@/lib/analysis-results';
import { BAND_LABELS, CONDITIONS, CONDITION_LABELS } from './data';
import {
  HEAD,
  SCALE_FLOOR_HZ,
  layoutPsdHeadMap,
  makePowerScale,
  niceTicks,
  type PowerScale,
  type PsdYScale,
  type Spectra,
} from './psdHeadMapLayout';

// Ported from DivergenceWebapp's LiveSession/Widgets/PsdHeadMap: one mini spectrum per electrode,
// placed at its scalp position on a head outline.

const RANGE: [number, number] = [1, 45];
const INK = '#111827';
const MUTED = '#6b7280';
const HEAD_STROKE = '#9ca3af';
const PEAK = '#773DFF';
const PEAK_SNAP_HZ = 0.75;

// Label the start frequency too, unless a round tick already sits right next to it
const frequencyTicks = ([start, end]: [number, number]) => {
  const ticks = niceTicks(start, end, 4);
  return ticks[0] - start > (end - start) * 0.1 ? [start, ...ticks] : ticks;
};

const formatPower = (v: number) => (v >= 1000 ? `${v / 1000}k` : `${v}`);

interface MiniPsdProps {
  channel: string;
  spectra: Spectra;
  peakHz: number | undefined;
  x: number;
  y: number;
  cell: number;
  scale: PowerScale;
}

function MiniPsd({ channel, spectra, peakHz, x, y, cell, scale }: MiniPsdProps) {
  const font = cell * 0.075;
  const left = cell * 0.2;
  const bottom = cell * 0.13;
  const pad = cell * 0.04;
  const width = cell - left - pad;
  const height = cell - bottom - pad;
  const toX = (freq: number) => left + ((freq - RANGE[0]) / (RANGE[1] - RANGE[0])) * width;
  const toY = (power: number) => pad + height - scale.toFraction(power) * height;

  const power = spectra.channels[channel] ?? [];
  const points = spectra.freqs
    .map((f, k) => [f, power[k]] as const)
    .filter(([f, v]) => f >= RANGE[0] && f <= RANGE[1] && Number.isFinite(v))
    .map(([f, v]) => `${toX(f).toFixed(1)},${toY(v).toFixed(1)}`)
    .join(' ');
  const clippedAt = spectra.freqs.find((_, k) => scale.isClipped(power[k]));

  // The reported peak comes from a coarser (1 Hz) spectrum, so the marker goes on the highest bin
  // of this trace within PEAK_SNAP_HZ of it
  let peakBin = -1;
  if (peakHz !== undefined && Number.isFinite(peakHz)) {
    spectra.freqs.forEach((f, k) => {
      if (Math.abs(f - peakHz) <= PEAK_SNAP_HZ && Number.isFinite(power[k]) && (peakBin < 0 || power[k] > power[peakBin])) {
        peakBin = k;
      }
    });
  }
  const peak = peakBin >= 0 ? { freq: spectra.freqs[peakBin], power: power[peakBin] } : null;

  return (
    <g transform={`translate(${x - cell / 2}, ${y - cell / 2})`}>
      <title>{peak ? `${channel} — peak alpha ${peakHz!.toFixed(1)} Hz` : channel}</title>
      <rect x={left} y={pad} width={width} height={height} fill="#fff" stroke={INK} strokeWidth={1.2} />
      {points && <polyline points={points} fill="none" stroke={INK} strokeWidth={1.2} strokeLinejoin="round" />}
      {clippedAt !== undefined && (
        <path
          d={`M ${toX(clippedAt) - font * 0.45} ${pad + font * 0.75} l ${font * 0.45} ${-font * 0.7} l ${
            font * 0.45
          } ${font * 0.7} z`}
          fill={MUTED}
        >
          <title>{`Low-frequency power above the axis is clipped (axis fitted from ${SCALE_FLOOR_HZ} Hz)`}</title>
        </path>
      )}
      {peak && <circle cx={toX(peak.freq)} cy={toY(peak.power)} r={cell * 0.018} fill={PEAK} />}
      <text
        x={left + width - pad}
        y={pad + font * 1.3}
        fontSize={font * 1.3}
        textAnchor="end"
        fill={INK}
        fontWeight={600}
      >
        {channel}
      </text>
      {scale.ticks.map((tick) => (
        <text key={`y${tick}`} x={left - font * 0.4} y={toY(tick) + font * 0.35} fontSize={font} textAnchor="end" fill={MUTED}>
          {formatPower(tick)}
        </text>
      ))}
      {frequencyTicks(RANGE).map((tick) => (
        <text key={`x${tick}`} x={toX(tick)} y={pad + height + font * 1.2} fontSize={font} textAnchor="middle" fill={MUTED}>
          {tick}
        </text>
      ))}
    </g>
  );
}

function SegmentedToggle<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-gray-300 overflow-hidden text-sm">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`px-3 py-1.5 font-medium transition-colors ${
            value === v ? 'bg-neuro-primary text-white' : 'bg-white text-gray-800 hover:bg-gray-50'
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export interface PsdHeadMapProps {
  psd: Partial<Record<Condition, PsdData | null>> | null | undefined;
  alphaPeak?: Partial<Record<Condition, AlphaPeak | null>> | null;
}

function ConditionHeadMap({
  condition,
  spectra,
  peaks,
  yScale,
}: {
  condition: Condition;
  spectra: PsdData;
  peaks: AlphaPeak | null;
  yScale: PsdYScale;
}) {
  const channels = useMemo(() => Object.keys(spectra.channels), [spectra]);
  const { placed, unmapped, cell } = useMemo(() => layoutPsdHeadMap(channels), [channels]);
  const scaleFor = useMemo(() => makePowerScale(spectra, channels, yScale), [spectra, channels, yScale]);
  const { cx, cy, r } = HEAD;
  const legendFont = 17;

  return (
    <figure className="flex flex-col items-center w-full border border-gray-200 rounded-lg p-3">
      <svg
        viewBox={`0 0 ${HEAD.width} ${HEAD.height}`}
        className="w-full h-auto max-w-[900px]"
        role="img"
        aria-label={`Power spectral density per channel on a head map, ${CONDITION_LABELS[condition]}`}
      >
        <g fill="none" stroke={HEAD_STROKE} strokeWidth={5} strokeLinejoin="round">
          <path d={`M ${cx - r * 0.14} ${cy - r * 0.99} L ${cx} ${cy - r * 1.14} L ${cx + r * 0.14} ${cy - r * 0.99}`} />
          {[-1, 1].map((side) => (
            <path
              key={side}
              d={`M ${cx + side * r * 0.99} ${cy - r * 0.18} C ${cx + side * r * 1.13} ${cy - r * 0.24}, ${
                cx + side * r * 1.13
              } ${cy + r * 0.3}, ${cx + side * r * 0.99} ${cy + r * 0.24}`}
            />
          ))}
          <circle cx={cx} cy={cy} r={r} />
        </g>

        <g transform="translate(20, 40)">
          <text fontSize={legendFont * 1.4} fill={INK} fontWeight={700}>
            {CONDITION_LABELS[condition]}
          </text>
          <text y={legendFont * 1.45 * 1.4} fontSize={legendFont} fill={INK} fontWeight={600}>
            Band range
          </text>
          {BAND_NAMES.map((band, i) => (
            <text key={band} y={(i + 2.4) * legendFont * 1.45} fontSize={legendFont} fill={MUTED}>
              {`${BAND_LABELS[band]}: ${BANDS[band][0]} ~ ${BANDS[band][1]} Hz`}
            </text>
          ))}
        </g>

        <g transform={`translate(20, ${HEAD.height - 50})`}>
          <text fontSize={legendFont} fill={MUTED}>
            x: Frequency (Hz)
          </text>
          <text y={legendFont * 1.45} fontSize={legendFont} fill={MUTED}>
            {`y: Power (µV²/Hz)${yScale === 'perChannel' ? ', per-channel scale' : yScale === 'log' ? ', log scale' : ''}`}
          </text>
        </g>
        {peaks && (
          <g transform={`translate(${HEAD.width - 230}, ${HEAD.height - 50 + legendFont * 1.45})`}>
            <circle cx={6} cy={-legendFont * 0.35} r={6} fill={PEAK} />
            <text x={18} fontSize={legendFont} fill={MUTED}>
              Individual alpha peak
            </text>
          </g>
        )}

        {placed.map(({ channel, cx: x, cy: y }) => (
          <MiniPsd
            key={channel}
            channel={channel}
            spectra={spectra}
            peakHz={peaks?.[channel]?.peak_frequency}
            x={x}
            y={y}
            cell={cell}
            scale={scaleFor(channel)}
          />
        ))}
      </svg>

      {unmapped.length > 0 && (
        <div className="w-full flex flex-col items-center">
          <p className="text-sm text-gray-600">Channels without a standard scalp position</p>
          <svg
            viewBox={`0 0 ${unmapped.length * cell * 1.05} ${cell}`}
            className="w-full h-auto"
            style={{ maxWidth: unmapped.length * 180 }}
          >
            {unmapped.map((channel, i) => (
              <MiniPsd
                key={channel}
                channel={channel}
                spectra={spectra}
                peakHz={peaks?.[channel]?.peak_frequency}
                x={cell * 1.05 * i + cell / 2}
                y={cell / 2}
                cell={cell}
                scale={scaleFor(channel)}
              />
            ))}
          </svg>
        </div>
      )}
    </figure>
  );
}

/** Per-channel power spectra on a head map, Eyes Open and Eyes Closed side by side. */
export default function PsdHeadMap({ psd, alphaPeak }: PsdHeadMapProps) {
  const [yScale, setYScale] = useState<PsdYScale>('perChannel');
  const conditions = CONDITIONS.filter((c) => psd?.[c]);

  if (conditions.length === 0) {
    return <p className="text-sm text-gray-600">No spectra available.</p>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-center gap-3 mb-3" data-export-ignore>
        <span className="text-sm text-gray-700">Y scale</span>
        <SegmentedToggle
          label="Y-axis scale"
          value={yScale}
          options={[
            ['perChannel', 'Per channel'],
            ['shared', 'Shared'],
            ['log', 'Log'],
          ]}
          onChange={setYScale}
        />
      </div>
      <div className={`grid grid-cols-1 gap-4 ${conditions.length > 1 ? 'xl:grid-cols-2' : ''}`}>
        {conditions.map((c) => (
          <ConditionHeadMap
            key={c}
            condition={c}
            spectra={psd![c]!}
            peaks={alphaPeak?.[c] ?? null}
            yScale={yScale}
          />
        ))}
      </div>
    </div>
  );
}
