'use client';

import { useMemo, useState } from 'react';
import { BAND_NAMES, BANDS, type AlphaPeak, type Condition, type PsdData } from '@/lib/analysis-results';
import { BAND_LABELS, CONDITIONS, CONDITION_LABELS } from './data';
import SegmentedToggle from './SegmentedToggle';
import {
  SCALE_FLOOR_HZ,
  layoutPsdHeadMap,
  makePowerScale,
  niceTicks,
  snapAlphaPeak,
  type PowerScale,
  type PsdYScale,
  type Spectra,
} from './psdHeadMapLayout';

// Ported from DivergenceWebapp's LiveSession/Widgets/PsdHeadMap: one mini spectrum per electrode,
// placed at its scalp position. No head outline: the view is cropped to the plots so they read large.

const RANGE: [number, number] = [1, 45];
const INK = '#111827';
const MUTED = '#6b7280';
const PEAK = '#773DFF';

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
  const left = cell * 0.17;
  const bottom = cell * 0.11;
  const pad = cell * 0.025;
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
  const peak = snapAlphaPeak(spectra.freqs, power, peakHz);

  return (
    <g transform={`translate(${x - cell / 2}, ${y - cell / 2})`}>
      <title>{peak ? `${channel} — peak alpha ${peakHz!.toFixed(1)} Hz` : channel}</title>
      <rect x={left} y={pad} width={width} height={height} fill="#fff" stroke={INK} strokeWidth={1.2} />
      {points && <polyline points={points} fill="none" stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />}
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
        <text
          key={`y${tick}`}
          x={left - font * 0.4}
          y={toY(tick) + font * 0.35}
          fontSize={font}
          textAnchor="end"
          fill={MUTED}
        >
          {formatPower(tick)}
        </text>
      ))}
      {frequencyTicks(RANGE).map((tick) => (
        <text
          key={`x${tick}`}
          x={toX(tick)}
          y={pad + height + font * 1.2}
          fontSize={font}
          textAnchor="middle"
          fill={MUTED}
        >
          {tick}
        </text>
      ))}
    </g>
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
  const { placed, unmapped, cell, bounds } = useMemo(() => layoutPsdHeadMap(channels), [channels]);
  const scaleFor = useMemo(() => makePowerScale(spectra, channels, yScale), [spectra, channels, yScale]);
  const pad = cell * 0.025;

  return (
    <figure className="flex flex-col items-center w-full border border-gray-200 rounded-lg p-2">
      <figcaption className="w-full text-sm font-bold text-neuro-dark mb-1">{CONDITION_LABELS[condition]}</figcaption>
      {bounds && (
        <svg
          viewBox={`${bounds.x - pad} ${bounds.y - pad} ${bounds.width + 2 * pad} ${bounds.height + 2 * pad}`}
          // Capped to the viewport, so the controls and both conditions fit on one screen
          className="w-full h-auto max-h-[calc(100vh-17rem)]"
          role="img"
          aria-label={`Power spectral density per channel at its scalp position, ${CONDITION_LABELS[condition]}`}
        >
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
      )}

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

      <div className="w-full mt-1 text-xs text-gray-600 space-y-0.5">
        <p>
          {`x: Frequency (Hz) · y: Power (µV²/Hz)${
            yScale === 'perChannel' ? ', per-channel scale' : yScale === 'log' ? ', log scale' : ''
          }`}
          {peaks && (
            <span className="inline-flex items-center gap-1 ml-3">
              <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: PEAK }} />
              Individual alpha peak
            </span>
          )}
        </p>
        <p>{BAND_NAMES.map((band) => `${BAND_LABELS[band]} ${BANDS[band][0]}–${BANDS[band][1]} Hz`).join(' · ')}</p>
      </div>
    </figure>
  );
}

/** Per-channel power spectra at their scalp positions, Eyes Open and Eyes Closed side by side. */
export default function PsdHeadMap({ psd, alphaPeak }: PsdHeadMapProps) {
  const [yScale, setYScale] = useState<PsdYScale>('perChannel');
  const conditions = CONDITIONS.filter((c) => psd?.[c]);

  if (conditions.length === 0) {
    return <p className="text-sm text-gray-600">No spectra available.</p>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-center gap-3 mb-2" data-export-ignore>
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
      <div className={`grid grid-cols-1 gap-3 ${conditions.length > 1 ? 'lg:grid-cols-2' : ''}`}>
        {conditions.map((c) => (
          <ConditionHeadMap key={c} condition={c} spectra={psd![c]!} peaks={alphaPeak?.[c] ?? null} yScale={yScale} />
        ))}
      </div>
    </div>
  );
}
