// Pure data shaping for the full-width PSD chart (PsdChannels): the series, the global average,
// band presets and the CSV export. Modelled on DivergenceWebapp's LiveSession PowerSpectrum overlay.

import { BAND_NAMES, BANDS } from '@/lib/analysis-results';
import { BAND_LABELS } from './data';
import type { Spectra } from './psdHeadMapLayout';

export type FreqRange = [number, number];

/** The frequencies the analysis stores spectra for (see computePsd). */
export const PSD_RANGE: FreqRange = [1, 45];

/** The average of every channel's spectrum, as DivergenceWebapp's "Global" trace. */
export const GLOBAL = 'Global';
export const GLOBAL_COLOR = '#000000';

// DivergenceWebapp's questionStyles, which its PSD overlay colours channels with
const CHANNEL_COLORS = [
  '#0077BB', '#33BBEE', '#009988', '#EE7733', '#990033', '#336600', '#D35400', '#CC9900', '#3399CC',
  '#FF6666', '#333333', '#669900', '#CC0000', '#0066CC', '#CC0099', '#8E44AD', '#006666', '#993333',
  '#6666CC',
];

/** A stable colour by channel position; past the palette, golden-angle hues. */
export const channelColor = (i: number) =>
  CHANNEL_COLORS[i] ?? `hsl(${Math.round((i * 137.508) % 360)}, 70%, 42%)`;

/** Mean power per bin over the channels with a finite value there. */
export function globalSpectrum({ freqs, channels }: Spectra): number[] {
  const all = Object.values(channels);
  return freqs.map((_, k) => {
    let sum = 0;
    let n = 0;
    for (const power of all) {
      if (Number.isFinite(power[k])) {
        sum += power[k];
        n++;
      }
    }
    return n ? sum / n : NaN;
  });
}

/** A trace's points within the range. Non-positive power is dropped, as a log axis can't show it. */
export function seriesPoints(freqs: number[], power: number[], [lo, hi]: FreqRange): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  freqs.forEach((f, k) => {
    if (f >= lo && f <= hi && Number.isFinite(power[k]) && power[k] > 0) points.push({ x: f, y: power[k] });
  });
  return points;
}

export type BandPreset = { key: string; label: string; range: FreqRange };

export const BAND_PRESETS: BandPreset[] = [
  { key: 'full', label: `Full (${PSD_RANGE[0]} ~ ${PSD_RANGE[1]} Hz)`, range: PSD_RANGE },
  ...BAND_NAMES.map((band) => ({
    key: band,
    label: `${BAND_LABELS[band]} (${BANDS[band][0]} ~ ${BANDS[band][1]} Hz)`,
    range: BANDS[band],
  })),
];

/** The preset a range matches, or 'custom'. */
export const presetFor = ([lo, hi]: FreqRange) =>
  BAND_PRESETS.find(({ range }) => range[0] === lo && range[1] === hi)?.key ?? 'custom';

/** The shown traces within the range as CSV: a frequency column, then one column per trace. */
export function psdCsv(spectra: Spectra, traces: string[], range: FreqRange): string {
  const global = traces.includes(GLOBAL) ? globalSpectrum(spectra) : [];
  const columns = traces.map((t) => (t === GLOBAL ? global : spectra.channels[t] ?? []));
  const rows = [['Frequency (Hz)', ...traces.map((t) => `${t} (µV²/Hz)`)].join(',')];
  spectra.freqs.forEach((f, k) => {
    if (f < range[0] || f > range[1]) return;
    rows.push([f, ...columns.map((c) => (Number.isFinite(c[k]) ? c[k] : ''))].join(','));
  });
  return `${rows.join('\n')}\n`;
}
