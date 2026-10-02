// Pure helpers for client-rendered scalp maps: electrode layout, interpolation, colormaps and
// scaling, plus `drawTopomap` (the only function here that touches the DOM). Everything except
// `drawTopomap`/`drawColorbar` runs in Node so it can be unit-tested.

export type RGB = [number, number, number];
/** Maps a normalized value t∈[0,1] to an [r,g,b] triple. */
export type Colormap = (t: number) => RGB;

// ── electrode layout ───────────────────────────────────────────────────────
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

export interface Electrode {
  name: string;
  x: number;
  y: number;
  value: number;
}

/** Channels with a known position and a finite value. */
export function toElectrodes(values: Record<string, number>): Electrode[] {
  const out: Electrode[] = [];
  for (const [name, value] of Object.entries(values)) {
    const pos = electrodePosition(name);
    if (pos && Number.isFinite(value)) out.push({ name, x: pos.x, y: pos.y, value });
  }
  return out;
}

// ── interpolation ──────────────────────────────────────────────────────────
/** Inverse-distance-weighted value at (x, y) in head space. */
export function idw(x: number, y: number, electrodes: Electrode[], power = 2): number {
  let num = 0;
  let den = 0;
  for (const e of electrodes) {
    const d2 = (x - e.x) ** 2 + (y - e.y) ** 2;
    if (d2 < 1e-12) return e.value;
    const w = power === 2 ? 1 / d2 : 1 / Math.pow(d2, power / 2);
    num += w * e.value;
    den += w;
  }
  return den === 0 ? NaN : num / den;
}

function boxBlur(src: Float32Array, n: number, radius: number): Float32Array {
  if (radius < 1) return src;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const pass = (from: Float32Array, to: Float32Array, horizontal: boolean) => {
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        let sum = 0;
        let count = 0;
        for (let k = -radius; k <= radius; k++) {
          const c = b + k;
          if (c < 0 || c >= n) continue;
          sum += horizontal ? from[a * n + c] : from[c * n + a];
          count++;
        }
        if (horizontal) to[a * n + b] = sum / count;
        else to[b * n + a] = sum / count;
      }
    }
  };
  pass(src, tmp, true);
  pass(tmp, out, false);
  return out;
}

/**
 * IDW field on an n×n grid spanning the head bounding square ([-1, 1] in x and y, row 0 = front).
 * The field is computed over the whole square (so smoothing has neighbours at the rim) and then
 * box-blurred `smoothPasses` times; points outside the head circle are NaN.
 */
export function interpolateGrid(
  electrodes: Electrode[],
  n: number,
  opts: { power?: number; smoothRadius?: number; smoothPasses?: number } = {}
): Float32Array {
  const { power = 2, smoothRadius = Math.round(n / 24), smoothPasses = 2 } = opts;
  let grid: Float32Array = new Float32Array(n * n);
  if (electrodes.length === 0) return grid.fill(NaN);
  for (let row = 0; row < n; row++) {
    const y = 1 - ((row + 0.5) / n) * 2;
    for (let col = 0; col < n; col++) {
      const x = ((col + 0.5) / n) * 2 - 1;
      grid[row * n + col] = idw(x, y, electrodes, power);
    }
  }
  for (let p = 0; p < smoothPasses; p++) grid = boxBlur(grid, n, smoothRadius);
  for (let row = 0; row < n; row++) {
    const y = 1 - ((row + 0.5) / n) * 2;
    for (let col = 0; col < n; col++) {
      const x = ((col + 0.5) / n) * 2 - 1;
      if (x * x + y * y > 1) grid[row * n + col] = NaN;
    }
  }
  return grid;
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

/** 2nd–98th percentile scale (as the former Python topomaps). Widens a degenerate range. */
export function percentileScale(values: number[], lo = 2, hi = 98): Scale | null {
  let vmin = percentile(values, lo);
  let vmax = percentile(values, hi);
  if (!Number.isFinite(vmin) || !Number.isFinite(vmax)) return null;
  if (vmax - vmin < 1e-12) {
    const pad = Math.abs(vmin) * 0.05 || 1;
    vmin -= pad;
    vmax += pad;
  }
  return { vmin, vmax };
}

export function normalize(value: number, scale: Scale): number {
  const t = (value - scale.vmin) / (scale.vmax - scale.vmin);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

// ── colormaps ──────────────────────────────────────────────────────────────
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : Number.isNaN(t) ? 0 : t);

function hex(h: string): RGB {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

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

/** The Python worker's custom band-power map: blue → sky → yellow → orange → red. */
export const blueRed = fromStops(
  ['#0000FF', '#4169E1', '#87CEEB', '#FFFF00', '#FFA500', '#FF0000'].map(hex)
);

export const viridis = fromStops(
  ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'].map(
    hex
  )
);

/** matplotlib RdYlBu_r: blue (low) → pale yellow → red (high) */
export const rdYlBuR = fromStops(
  ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#ffffbf', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026'].map(
    hex
  )
);

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

export const COLORMAPS = { blueRed, viridis, rdYlBuR, coolwarm, jet } as const;
export type ColormapName = keyof typeof COLORMAPS;

export const rgbCss = ([r, g, b]: RGB) => `rgb(${r},${g},${b})`;

/** CSS linear-gradient sampling the colormap (for HTML legends). */
export function cssGradient(cmap: Colormap, direction = 'to right', samples = 11): string {
  const stops = Array.from({ length: samples }, (_, i) => {
    const t = i / (samples - 1);
    return `${rgbCss(cmap(t))} ${(t * 100).toFixed(0)}%`;
  });
  return `linear-gradient(${direction}, ${stops.join(', ')})`;
}

/** Black or white text, whichever reads better on the given colour. */
export function contrastText([r, g, b]: RGB): string {
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111827' : '#ffffff';
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

// ── canvas rendering ───────────────────────────────────────────────────────
export interface DrawTopomapOptions {
  colormap?: Colormap;
  /** Defaults to the 2nd–98th percentile of `values`. */
  scale?: Scale | null;
  /** Number of contour lines; 0 to disable. */
  contours?: number;
  showSensors?: boolean;
  showLabels?: boolean;
  /** Vertical colorbar on the right with this label. */
  colorbar?: { label?: string; format?: (v: number) => string } | false;
  /** Interpolation grid resolution (pixels per side); default tracks the canvas size. */
  resolution?: number;
  /** Text colour for labels/axes. */
  ink?: string;
}

const COLORBAR_WIDTH = 78;

/**
 * Draws a scalp map into `canvas` using its current pixel size (caller sets width/height, e.g.
 * scaled by devicePixelRatio). The head fills the largest square that fits, leaving room for the
 * colorbar when requested. Returns the scale used.
 */
export function drawTopomap(
  canvas: HTMLCanvasElement,
  values: Record<string, number>,
  opts: DrawTopomapOptions = {}
): Scale | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const {
    colormap = blueRed,
    contours = 4,
    showSensors = true,
    showLabels = false,
    colorbar = false,
    ink = '#374151',
  } = opts;
  const unit = Math.min(W, H) / 200; // scale strokes and text with canvas size
  const cbW = colorbar ? COLORBAR_WIDTH * unit : 0;
  const side = Math.min(W - cbW, H);
  // margin for nose and ears
  const radius = side * 0.42;
  const cx = (W - cbW) / 2;
  const cy = H / 2 + side * 0.02;

  const electrodes = toElectrodes(values);
  const scale = opts.scale ?? percentileScale(electrodes.map((e) => e.value));
  if (electrodes.length === 0 || !scale) {
    ctx.fillStyle = ink;
    ctx.font = `${12 * unit}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No data', cx, cy);
    return null;
  }

  // 1) interpolated field over the head bounding square
  const n = opts.resolution ?? Math.max(48, Math.min(200, Math.round(radius * 2)));
  const grid = interpolateGrid(electrodes, n);
  const img = new ImageData(n, n);
  const levels = contours > 0 ? contours + 1 : 0;
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    if (Number.isNaN(v)) continue;
    const t = normalize(v, scale);
    let [r, g, b] = colormap(t);
    if (levels) {
      // contour: darken pixels where the quantized level changes toward a neighbour
      const q = Math.floor(t * levels);
      const col = i % n;
      const right = col + 1 < n ? grid[i + 1] : NaN;
      const below = i + n < grid.length ? grid[i + n] : NaN;
      const qr = Number.isNaN(right) ? q : Math.floor(normalize(right, scale) * levels);
      const qb = Number.isNaN(below) ? q : Math.floor(normalize(below, scale) * levels);
      if (qr !== q || qb !== q) {
        r = Math.round(r * 0.55);
        g = Math.round(g * 0.55);
        b = Math.round(b * 0.55);
      }
    }
    const o = i * 4;
    img.data[o] = r;
    img.data[o + 1] = g;
    img.data[o + 2] = b;
    img.data[o + 3] = 255;
  }
  const field = document.createElement('canvas');
  field.width = n;
  field.height = n;
  field.getContext('2d')?.putImageData(img, 0, 0);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(field, cx - radius, cy - radius, radius * 2, radius * 2);
  ctx.restore();

  // 2) head outline, nose, ears
  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = Math.max(1, 1.6 * unit);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  const noseW = radius * 0.1;
  ctx.beginPath();
  ctx.moveTo(cx - noseW, cy - radius * 0.995);
  ctx.lineTo(cx, cy - radius * 1.12);
  ctx.lineTo(cx + noseW, cy - radius * 0.995);
  ctx.stroke();
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + side * radius * 1.035, cy, radius * 0.05, radius * 0.17, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 3) sensors and labels
  if (showSensors || showLabels) {
    ctx.font = `${Math.max(8, 9 * unit)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const e of electrodes) {
      if (e.x * e.x + e.y * e.y > 1) continue;
      const px = cx + e.x * radius;
      const py = cy - e.y * radius;
      if (showSensors) {
        ctx.beginPath();
        ctx.arc(px, py, Math.max(1.5, 2 * unit), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(17,24,39,0.75)';
        ctx.fill();
      }
      if (showLabels) {
        ctx.fillStyle = '#111827';
        ctx.fillText(normalizeChannelName(e.name), px, py - 2.5 * unit);
      }
    }
  }

  // 4) colorbar
  if (colorbar) {
    const barX = W - cbW + 8 * unit;
    const barW = 10 * unit;
    const barTop = cy - radius;
    const barH = radius * 2;
    drawColorbar(ctx, { x: barX, y: barTop, w: barW, h: barH }, colormap, scale, {
      label: colorbar.label,
      format: colorbar.format,
      ink,
      fontPx: Math.max(8, 9 * unit),
    });
  }
  return scale;
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
