// Shared visual helpers: the connectivity head's electrode layout and channel-name normalization,
// percentile/normalize scaling, colormaps, tick formatting and `drawColorbar` (the only function
// here that touches the DOM). The scalp-map renderer itself lives in topoRender.ts.

export type RGB = [number, number, number];
/** Maps a normalized value t∈[0,1] to an [r,g,b] triple. */
export type Colormap = (t: number) => RGB;

// ── electrode layout (connectivity head) ───────────────────────────────────
// Azimuthal projection with the nose up: each site is (azimuth from the nose in degrees, positive
// to the right; distance from Cz as a fraction of the outer 10-20 ring Fpz–T7–Oz–T8). The outer
// ring sits at OUTER_RING_RADIUS of the head outline, as in MNE's default sphere.
const OUTER_RING_RADIUS = 0.88;

const POLAR_LAYOUT: Record<string, [number, number]> = {
  // midline
  Fpz: [0, 1],
  AFz: [0, 0.75],
  Fz: [0, 0.5],
  FCz: [0, 0.25],
  Cz: [0, 0],
  CPz: [180, 0.25],
  Pz: [180, 0.5],
  POz: [180, 0.75],
  Oz: [180, 1],
  Iz: [180, 1.12],
  // outer ring (10-20 at 36° steps, 10-10 between)
  Fp1: [-18, 1],
  Fp2: [18, 1],
  AF7: [-36, 1],
  AF8: [36, 1],
  F7: [-54, 1],
  F8: [54, 1],
  FT7: [-72, 1],
  FT8: [72, 1],
  T7: [-90, 1],
  T8: [90, 1],
  TP7: [-108, 1],
  TP8: [108, 1],
  P7: [-126, 1],
  P8: [126, 1],
  PO7: [-144, 1],
  PO8: [144, 1],
  O1: [-162, 1],
  O2: [162, 1],
  // inner 10-20
  F3: [-39, 0.65],
  F4: [39, 0.65],
  C3: [-90, 0.5],
  C4: [90, 0.5],
  P3: [-141, 0.65],
  P4: [141, 0.65],
  // 10-10 inner rows
  AF3: [-23, 0.8],
  AF4: [23, 0.8],
  F1: [-22, 0.55],
  F2: [22, 0.55],
  F5: [-50, 0.82],
  F6: [50, 0.82],
  FC1: [-46, 0.36],
  FC2: [46, 0.36],
  FC3: [-62, 0.55],
  FC4: [62, 0.55],
  FC5: [-73, 0.78],
  FC6: [73, 0.78],
  FT9: [-72, 1.12],
  FT10: [72, 1.12],
  C1: [-90, 0.25],
  C2: [90, 0.25],
  C5: [-90, 0.75],
  C6: [90, 0.75],
  CP1: [-134, 0.36],
  CP2: [134, 0.36],
  CP3: [-118, 0.55],
  CP4: [118, 0.55],
  CP5: [-107, 0.78],
  CP6: [107, 0.78],
  TP9: [-108, 1.12],
  TP10: [108, 1.12],
  P1: [-158, 0.55],
  P2: [158, 0.55],
  P5: [-130, 0.82],
  P6: [130, 0.82],
  PO3: [-157, 0.8],
  PO4: [157, 0.8],
  // ear / mastoid references
  A1: [-90, 1.12],
  A2: [90, 1.12],
};

/** Old 10-20 nomenclature and mastoid aliases → layout keys */
const ALIASES: Record<string, string> = {
  T3: 'T7',
  T4: 'T8',
  T5: 'P7',
  T6: 'P8',
  M1: 'A1',
  M2: 'A2',
};

/** Normalized head space: x right, y toward the nose, head outline radius 1. */
export const ELECTRODE_POSITIONS: Record<string, { x: number; y: number }> = Object.fromEntries(
  Object.entries(POLAR_LAYOUT).map(([name, [az, frac]]) => {
    const r = frac * OUTER_RING_RADIUS;
    const a = (az * Math.PI) / 180;
    return [name, { x: r * Math.sin(a), y: r * Math.cos(a) }];
  })
);

const CANONICAL_BY_UPPER: Record<string, string> = Object.fromEntries(
  [...Object.keys(POLAR_LAYOUT), ...Object.keys(ALIASES)].map((n) => [n.toUpperCase(), n])
);

/** Strips EEG prefixes / reference suffixes and fixes case, e.g. 'EEG FP1-REF' → 'Fp1'. */
export function normalizeChannelName(name: string): string {
  let clean = name.trim().replace(/^(EEG|ECG|EMG|EOG)[\s-]+/i, '');
  clean = clean.replace(/-(LE|REF|AVG|A1|A2|CZ|M1|M2)$/i, '');
  return CANONICAL_BY_UPPER[clean.toUpperCase()] ?? clean;
}

export function electrodePosition(name: string): { x: number; y: number } | null {
  const n = normalizeChannelName(name);
  return ELECTRODE_POSITIONS[ALIASES[n] ?? n] ?? null;
}

// ── scaling ────────────────────────────────────────────────────────────────
/** Linear-interpolated percentile (numpy default). Ignores non-finite values. */
export function percentile(values: number[], p: number): number {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  const idx = (Math.min(100, Math.max(0, p)) / 100) * (v.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return v[lo] + (v[hi] - v[lo]) * (idx - lo);
}

export interface Scale {
  vmin: number;
  vmax: number;
}

export function normalize(value: number, scale: Scale): number {
  const t = (value - scale.vmin) / (scale.vmax - scale.vmin);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

// ── colormaps ──────────────────────────────────────────────────────────────
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : Number.isNaN(t) ? 0 : t);

/** Colormap linearly interpolating evenly spaced stops. */
export function fromStops(stops: RGB[]): Colormap {
  const n = stops.length - 1;
  return (t) => {
    const x = clamp01(t) * n;
    const i = Math.min(Math.floor(x), n - 1);
    const f = x - i;
    const a = stops[i];
    const b = stops[i + 1];
    return [
      Math.round(a[0] + (b[0] - a[0]) * f),
      Math.round(a[1] + (b[1] - a[1]) * f),
      Math.round(a[2] + (b[2] - a[2]) * f),
    ];
  };
}

/** matplotlib coolwarm: blue → light grey → red */
export const coolwarm = fromStops([
  [59, 76, 192],
  [98, 130, 234],
  [141, 176, 254],
  [184, 208, 249],
  [221, 221, 221],
  [245, 196, 173],
  [244, 154, 123],
  [222, 96, 77],
  [180, 4, 38],
]);

/** matplotlib jet */
export const jet: Colormap = (t) => {
  const v = clamp01(t);
  const ch = (x: number) => Math.round(255 * clamp01(1.5 - Math.abs(4 * v - x)));
  return [ch(3), ch(2), ch(1)];
};

export const rgbCss = ([r, g, b]: RGB) => `rgb(${r},${g},${b})`;

/** CSS linear-gradient sampling the colormap (for HTML legends). */
export function cssGradient(cmap: Colormap, direction = 'to right', samples = 11): string {
  const stops = Array.from({ length: samples }, (_, i) => {
    const t = i / (samples - 1);
    return `${rgbCss(cmap(t))} ${(t * 100).toFixed(0)}%`;
  });
  return `linear-gradient(${direction}, ${stops.join(', ')})`;
}

// ── formatting ─────────────────────────────────────────────────────────────
export function formatTick(v: number): string {
  if (!Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1000 || a < 0.01) return v.toExponential(1);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

/** n evenly spaced ticks from vmin to vmax inclusive. */
export function linearTicks(vmin: number, vmax: number, n = 5): number[] {
  if (n < 2) return [vmin];
  return Array.from({ length: n }, (_, i) => vmin + ((vmax - vmin) * i) / (n - 1));
}

/** Vertical colorbar (high at the top) with 5 ticks and an optional rotated label. */
export function drawColorbar(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  colormap: Colormap,
  scale: Scale,
  opts: { label?: string; format?: (v: number) => string; ink?: string; fontPx?: number } = {}
): void {
  const { label, format = formatTick, ink = '#374151', fontPx = 10 } = opts;
  const steps = Math.max(2, Math.round(box.h));
  for (let i = 0; i < steps; i++) {
    ctx.fillStyle = rgbCss(colormap(1 - i / (steps - 1)));
    ctx.fillRect(box.x, box.y + (i * box.h) / steps, box.w, box.h / steps + 1);
  }
  ctx.strokeStyle = '#6b7280';
  ctx.lineWidth = 1;
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  ctx.fillStyle = ink;
  ctx.font = `${fontPx}px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let maxTickW = 0;
  for (const v of linearTicks(scale.vmin, scale.vmax, 5)) {
    const y = box.y + box.h * (1 - normalize(v, scale));
    const text = format(v);
    ctx.fillRect(box.x + box.w, y - 0.5, 3, 1);
    ctx.fillText(text, box.x + box.w + 5, y);
    maxTickW = Math.max(maxTickW, ctx.measureText(text).width);
  }
  if (label) {
    ctx.save();
    ctx.translate(box.x + box.w + 5 + maxTickW + fontPx * 0.9, box.y + box.h / 2);
    ctx.rotate(Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }
}
