// Layout and axis scaling for the PSD head map, ported from DivergenceWebapp's
// LiveSession/Widgets/PsdHeadMap/psdHeadMapLayout.ts. Positions come from topoPosition (the
// Divergence 10-20 table plus the 10-10 extras), so the map follows the recording's montage.

import { topoPosition } from './topoRender';

export type PlacedChannel = { channel: string; cx: number; cy: number };

/** Head geometry in SVG user units. */
export const HEAD = { width: 1160, height: 1000, cx: 640, cy: 530, r: 420 };

// Electrodes sit slightly inside the rim so their plots do not spill past the head outline
const ELECTRODE_SPREAD = 0.9;
const MIN_CELL = 70;
const MAX_CELL = 180;
const CELL_FILL = 0.94;

// The 10-20 montage reads best as a regular grid (Fp1 above F3, O1 below P3, T3 in the F7 column)
const GRID_COLUMNS = [-0.73, -0.37, 0, 0.37, 0.73];
const GRID_ROWS = [0.76, 0.38, 0, -0.38, -0.76];
const nearest = (values: number[], v: number) =>
  values.reduce((best, c) => (Math.abs(c - v) < Math.abs(best - v) ? c : best));

const snapToGrid = (positions: { x: number; y: number }[]) => {
  const snapped = positions.map(({ x, y }) => ({ x: nearest(GRID_COLUMNS, x), y: nearest(GRID_ROWS, y) }));
  const unique = new Set(snapped.map(({ x, y }) => `${x},${y}`));
  return unique.size === snapped.length ? snapped : positions;
};

/**
 * Places each channel at its scalp position and sizes the mini plots so the closest pair never
 * overlaps. Channels without a known position are returned in `unmapped`.
 */
export function layoutPsdHeadMap(channels: string[]) {
  const unmapped = channels.filter((channel) => !topoPosition(channel));
  const mapped = channels.filter((channel) => topoPosition(channel));
  // Denser montages (FC/CP/AF...) collide on the grid and keep their true positions
  const positions = snapToGrid(mapped.map((channel) => topoPosition(channel)!));
  const placed: PlacedChannel[] = mapped.map((channel, i) => ({
    channel,
    cx: HEAD.cx + positions[i].x * HEAD.r * ELECTRODE_SPREAD,
    cy: HEAD.cy - positions[i].y * HEAD.r * ELECTRODE_SPREAD,
  }));

  let minDistance = Infinity;
  placed.forEach((a, i) =>
    placed.slice(i + 1).forEach((b) => {
      // Chebyshev distance: square cells only collide when both axes overlap
      minDistance = Math.min(minDistance, Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cy - b.cy)));
    })
  );
  const cell = Math.min(MAX_CELL, Math.max(MIN_CELL, minDistance * CELL_FILL));

  return { placed, unmapped, cell };
}

const niceStep = (span: number, targetTicks: number) => {
  const raw = span / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const nice = normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10;
  return nice * magnitude;
};

/** Evenly spaced round tick values covering [min, max]. */
export function niceTicks(min: number, max: number, targetTicks = 4): number[] {
  if (!(max > min)) return [min];
  const step = niceStep(max - min, targetTicks);
  const first = Math.ceil(min / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = first; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

export type PsdYScale = 'shared' | 'perChannel' | 'log';

export type PowerScale = {
  toFraction: (v: number) => number;
  ticks: number[];
  /** Linear scales cut off sub-2 Hz drift; true for values drawn clipped at the top edge. */
  isClipped: (v: number) => boolean;
};

/** Slow drift piles up just above 1 Hz and would otherwise set every linear axis. */
export const SCALE_FLOOR_HZ = 2;

// Axes top out at a high percentile so one artifact channel cannot flatten every other spectrum
const SHARED_PERCENTILE = 0.98;
const CHANNEL_PERCENTILE = 0.99;

const percentileOf = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(p * (sorted.length - 1))];
};

const niceCeil = (v: number) => {
  if (!(v > 0)) return 1;
  const step = niceStep(v, 4);
  return Math.ceil(v / step) * step;
};

/** One channel's spectrum: power[k] at freqs[k]. */
export type Spectra = { freqs: number[]; channels: Record<string, number[]> };

const scalingValues = ({ freqs, channels }: Spectra, channel: string) => {
  const power = channels[channel] ?? [];
  const above = power.filter((v, k) => freqs[k] >= SCALE_FLOOR_HZ && Number.isFinite(v));
  return above.length ? above : power.filter(Number.isFinite);
};

const linearScale = (lo: number, hi: number): PowerScale => ({
  toFraction: (v) => Math.min(1, Math.max(0, (v - lo) / (hi - lo))),
  ticks: niceTicks(lo, hi, 3),
  isClipped: (v) => v > hi,
});

// Fits the axis to this channel's own range, so a flat-looking spectrum still shows its shape
const fittedChannelScale = (values: number[]): PowerScale => {
  if (!values.length) return linearScale(0, 1);
  const min = Math.min(...values);
  const max = percentileOf(values, CHANNEL_PERCENTILE);
  const step = max > min ? niceStep(max - min, 3) : niceStep(Math.abs(max) || 1, 3);
  const lo = Math.floor(min / step) * step;
  return linearScale(lo, Math.max(lo + step, Math.ceil(max / step) * step));
};

/** Maps a power value to [0, 1] of the plot height for the chosen scale. */
export function makePowerScale(
  spectra: Spectra,
  channels: string[],
  mode: PsdYScale
): (channel: string) => PowerScale {
  if (mode === 'log') {
    let min = Infinity;
    let max = 0;
    channels.forEach((channel) =>
      (spectra.channels[channel] ?? []).forEach((v) => {
        if (Number.isFinite(v) && v > 0) {
          min = Math.min(min, v);
          max = Math.max(max, v);
        }
      })
    );
    const lo = Math.floor(Math.log10(Number.isFinite(min) ? min : 0.01));
    const hi = Math.max(lo + 1, Math.ceil(Math.log10(max || 1)));
    const ticks = Array.from({ length: hi - lo + 1 }, (_, i) => 10 ** (lo + i));
    const toFraction = (v: number) =>
      Math.min(1, Math.max(0, (Math.log10(Math.max(v, 10 ** lo)) - lo) / (hi - lo)));
    return () => ({ toFraction, ticks, isClipped: () => false });
  }

  if (mode === 'perChannel') return (channel) => fittedChannelScale(scalingValues(spectra, channel));

  const pooled = channels.flatMap((channel) => scalingValues(spectra, channel));
  const shared = linearScale(0, pooled.length ? niceCeil(percentileOf(pooled, SHARED_PERCENTILE)) : 1);
  return () => shared;
}
