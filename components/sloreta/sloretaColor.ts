// Colour ramp for source-space values.
//
// The conventional source-localization ramp: blue at the floor through cyan,
// green and yellow to red at the peak — what LORETA-KEY and most qEEG software
// use, so a clinician reads it without a key.
//
// It is a magnitude scale, not a diverging one: 0 is the bottom, not a neutral
// midpoint. The values remain dimensionless standardized current density and
// share no scale with the band-power topomaps, which the legend states.

export type Rgb = [number, number, number];

const STOPS: Rgb[] = [
  [0, 0, 160],
  [0, 80, 255],
  [0, 200, 255],
  [40, 215, 120],
  [220, 230, 0],
  [255, 120, 0],
  [225, 0, 0],
];

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

export const sloretaColormap = (t: number): Rgb => {
  const n = STOPS.length - 1;
  const x = clamp01(Number.isFinite(t) ? t : 0) * n;
  const i = Math.min(Math.floor(x), n - 1);
  const f = x - i;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
};

/** CSS gradient for the legend, sampled at 11 stops. */
export const SLORETA_GRADIENT_CSS = `linear-gradient(to right, ${Array.from(
  { length: 11 },
  (_, i) => {
    const [r, g, b] = sloretaColormap(i / 10);
    return `rgb(${r},${g},${b}) ${(i / 10) * 100}%`;
  }
).join(', ')})`;

/** Values are dimensionless, so the legend shows magnitude in exponent form
 *  rather than inventing a unit. */
export const formatSourceValue = (v: number): string => {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  return v.toExponential(1);
};
