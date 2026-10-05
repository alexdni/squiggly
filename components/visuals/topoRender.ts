// Scalp-map renderer ported from DivergenceWebapp (MeasureTopo/topoConst.ts and
// MeasureAnalysis/topoRender.ts) so squiggly's topomaps look exactly like Divergence's:
// same 10-20 layout, IDW interpolation, supersampled + blurred field, QEEG Pro colour ramp,
// head outline/nose and electrode dots. Everything except `drawTopo` runs in Node.
//
// The reference draws on a CANVAS_SIZE×CANVAS_SIZE canvas. `drawTopo` accepts any square canvas
// and scales its pixel constants by width / CANVAS_SIZE, so a canvas sized for devicePixelRatio
// renders the same picture at higher resolution (and is identical to the reference at 1×).

import { normalizeChannelName, type Colormap, type RGB } from './topo';

// ── electrode layout ───────────────────────────────────────────────────────
// Standard 10-20 electrode positions in normalized head space.
// x: -1 = left, +1 = right. y: -1 = inion (back), +1 = nasion (front).
// Head circle radius = 1.0, centre (Cz) = (0, 0).
//
// These coordinates follow the strict 10-20 azimuthal projection. The lateral
// columns (F3/C3/P3 etc.) keep the montage-derived spacing, but the outer
// circumference ring is placed by the canonical geometry: Fp1/Fp2 and O1/O2 sit
// on the same outer ring as Fpz/Oz/T3/T4 (~0.84) at ±18° azimuth from the
// sagittal midline — the 10-20 "10%" step (Fpz→Fp is 10% of the nasion–inion
// arc). That keeps the fronto-polar and occipital pairs close to the midline
// and up on the rim, instead of splayed out toward the ears.
const DIVERGENCE_POSITIONS: Record<string, { x: number; y: number }> = {
  Fp1: { x: -0.26, y: 0.8 },
  Fpz: { x: 0.0, y: 0.83 },
  Fp2: { x: 0.26, y: 0.8 },
  AF3: { x: -0.37, y: 0.55 },
  AF4: { x: 0.37, y: 0.55 },
  F7: { x: -0.73, y: 0.38 },
  F3: { x: -0.37, y: 0.34 },
  Fz: { x: 0.0, y: 0.34 },
  F4: { x: 0.37, y: 0.34 },
  F8: { x: 0.73, y: 0.38 },
  FC5: { x: -0.65, y: 0.2 },
  FC1: { x: -0.24, y: 0.21 },
  FC2: { x: 0.24, y: 0.21 },
  FC6: { x: 0.65, y: 0.2 },
  T3: { x: -0.85, y: 0.0 },
  C3: { x: -0.43, y: 0.0 },
  Cz: { x: 0.0, y: 0.0 },
  C4: { x: 0.43, y: 0.0 },
  T4: { x: 0.85, y: 0.0 },
  TP9: { x: -0.83, y: -0.22 },
  CP5: { x: -0.65, y: -0.2 },
  CP1: { x: -0.24, y: -0.22 },
  CP2: { x: 0.24, y: -0.22 },
  CP6: { x: 0.65, y: -0.2 },
  TP10: { x: 0.83, y: -0.22 },
  T5: { x: -0.73, y: -0.42 },
  P3: { x: -0.37, y: -0.38 },
  Pz: { x: 0.0, y: -0.38 },
  P4: { x: 0.37, y: -0.38 },
  T6: { x: 0.73, y: -0.42 },
  PO3: { x: -0.37, y: -0.55 },
  PO4: { x: 0.37, y: -0.55 },
  O1: { x: -0.26, y: -0.8 },
  Oz: { x: 0.0, y: -0.84 },
  O2: { x: 0.26, y: -0.8 },
};

// Remaining 10-10 sites squiggly can record that the Divergence table lacks, as azimuthal
// polar coordinates (degrees from the nose, positive to the right; distance from Cz as a fraction
// of the outer ring), placed on the same ~0.84 outer ring as Fpz/Oz/T3/T4 above.
const EXTRA_RING_RADIUS = 0.84;
const EXTRA_POLAR: Record<string, [number, number]> = {
  AFz: [0, 0.75],
  FCz: [0, 0.25],
  CPz: [180, 0.25],
  POz: [180, 0.75],
  Iz: [180, 1.12],
  AF7: [-36, 1],
  AF8: [36, 1],
  FT7: [-72, 1],
  FT8: [72, 1],
  TP7: [-108, 1],
  TP8: [108, 1],
  PO7: [-144, 1],
  PO8: [144, 1],
  F1: [-22, 0.55],
  F2: [22, 0.55],
  F5: [-50, 0.82],
  F6: [50, 0.82],
  FC3: [-62, 0.55],
  FC4: [62, 0.55],
  FT9: [-72, 1.12],
  FT10: [72, 1.12],
  C1: [-90, 0.25],
  C2: [90, 0.25],
  C5: [-90, 0.75],
  C6: [90, 0.75],
  CP3: [-118, 0.55],
  CP4: [118, 0.55],
  P1: [-158, 0.55],
  P2: [158, 0.55],
  P5: [-130, 0.82],
  P6: [130, 0.82],
};

/** Modern 10-20 names → the legacy names the Divergence table uses. */
const TOPO_ALIASES: Record<string, string> = { T7: 'T3', T8: 'T4', P7: 'T5', P8: 'T6' };

export const TOPO_ELECTRODE_POSITIONS: Record<string, { x: number; y: number }> = {
  ...Object.fromEntries(
    Object.entries(EXTRA_POLAR).map(([name, [az, frac]]) => {
      const r = frac * EXTRA_RING_RADIUS;
      const a = (az * Math.PI) / 180;
      return [name, { x: r * Math.sin(a), y: r * Math.cos(a) }];
    })
  ),
  ...DIVERGENCE_POSITIONS,
};

/** Map position for a channel label ('EEG T7-REF', 'T7' and 'T3' all resolve), or null. */
export function topoPosition(name: string): { x: number; y: number } | null {
  const n = normalizeChannelName(name);
  return TOPO_ELECTRODE_POSITIONS[TOPO_ALIASES[n] ?? n] ?? null;
}

// ── render sizing ──────────────────────────────────────────────────────────
export const CANVAS_SIZE = 160;
export const HEAD_RADIUS_RATIO = 0.42;
// Supersample factor — render the quantized field at NxN then downscale so the
// discrete band edges come out smoothly antialiased (instead of pixel-jagged).
export const BAND_SUPERSAMPLE = 2;
// Native-space Gaussian blur applied to the *value field* (before quantizing) so
// neighbouring electrode sites melt into a continuous field instead of distinct
// bullseyes. Higher = more diffuse / more blending of adjacent sites.
export const FIELD_BLUR_PX = 8;

// A single electrode's contribution to one map: normalized head-space coords (nx/ny), pixel
// coords on a CANVAS_SIZE canvas (px/py), and value.
export interface TopoElectrode {
  nx: number;
  ny: number;
  px: number;
  py: number;
  value: number;
}

/** Channels with a map position and a finite value, in the reference's electrode shape. */
export function toTopoElectrodes(values: Record<string, number>): TopoElectrode[] {
  const cx = CANVAS_SIZE / 2;
  const cy = CANVAS_SIZE / 2;
  const r = CANVAS_SIZE * HEAD_RADIUS_RATIO;
  const out: TopoElectrode[] = [];
  for (const [name, value] of Object.entries(values)) {
    const pos = topoPosition(name);
    if (!pos || !Number.isFinite(value)) continue;
    out.push({ nx: pos.x, ny: pos.y, px: cx + pos.x * r, py: cy - pos.y * r, value });
  }
  return out;
}

// ── QEEG Pro adaptive colormap (filled discrete bands) ─────────────────────
// Exact bands sampled from a QEEG Pro FFT report for 100% visual parity:
// blue → cyan → gray (neutral) → yellow → orange → red.
const QEEG_BANDS: RGB[] = [
  [0, 0, 255], // blue
  [0, 117, 255], // medium blue
  [77, 211, 255], // light blue
  [51, 255, 222], // cyan
  [26, 255, 166], // teal-green
  [223, 223, 223], // gray (neutral middle)
  [194, 255, 9], // yellow-green
  [255, 255, 0], // yellow
  [255, 211, 0], // gold
  [255, 117, 0], // orange
  [255, 0, 0], // red (top band — always solid at the peak)
];
const N_BANDS = QEEG_BANDS.length;

// CSS hard-stop gradient mirroring QEEG_BANDS, for the legend swatches.
export const LEGEND_GRADIENT_CSS = (() => {
  const segs = QEEG_BANDS.flatMap((c, i) => {
    const col = `rgb(${c[0]},${c[1]},${c[2]})`;
    return [`${col} ${(i / N_BANDS) * 100}%`, `${col} ${((i + 1) / N_BANDS) * 100}%`];
  });
  return `linear-gradient(to right, ${segs.join(', ')})`;
})();

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

// Smoothly interpolate across a list of [r,g,b] stops.
function lerpStops(stops: RGB[], t: number): RGB {
  const n = stops.length - 1;
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
}

// Discrete QEEG bands — used for the band-power topomaps.
export const qeegDiscrete: Colormap = (t) => {
  const v = clamp01(t);
  const band = v >= 1 ? N_BANDS - 1 : Math.floor(v * N_BANDS);
  return QEEG_BANDS[band];
};

// Continuous QEEG ramp for scalar maps (LZC, peak alpha).
export const qeegSequential: Colormap = (t) => lerpStops(QEEG_BANDS, t);

// ── value formatting for band-power legend endpoints ───────────────────────
export function fmtAbs(v: number): string {
  if (!isFinite(v) || v <= 0) return '0';
  if (v >= 1000) return v.toExponential(1);
  if (v >= 100) return Math.round(v).toString();
  return parseFloat(v.toFixed(2)).toString(); // 2 decimals, trailing zeros trimmed
}

export function fmtRel(v: number): string {
  if (!isFinite(v) || v <= 0) return '0%';
  return `${(v * 100).toFixed(1)}%`;
}

// ── inverse distance weighting interpolation ───────────────────────────────
export function idw(nx: number, ny: number, electrodes: TopoElectrode[]): number {
  let num = 0,
    den = 0;
  for (const e of electrodes) {
    const d2 = (nx - e.nx) ** 2 + (ny - e.ny) ** 2;
    if (d2 < 1e-10) return e.value;
    const w = 1 / d2; // p=2: localized peaks with good spatial contrast
    num += w * e.value;
    den += w;
  }
  return den === 0 ? 0 : num / den;
}

// Reused off-screen canvases to avoid allocations per render cycle
let fieldCanvas: HTMLCanvasElement | null = null;
let blurredCanvas: HTMLCanvasElement | null = null;
function getFieldCanvas(w: number, h: number): HTMLCanvasElement {
  if (!fieldCanvas) fieldCanvas = document.createElement('canvas');
  fieldCanvas.width = w;
  fieldCanvas.height = h;
  return fieldCanvas;
}
function getBlurredCanvas(w: number, h: number): HTMLCanvasElement {
  if (!blurredCanvas) blurredCanvas = document.createElement('canvas');
  blurredCanvas.width = w;
  blurredCanvas.height = h;
  return blurredCanvas;
}

// ── render one topomap onto a canvas element ───────────────────────────────
// `colormap` maps the normalized field value t∈[0,1] to colour, so the same
// renderer produces discrete band maps (qeegDiscrete) and continuous scalar
// maps (qeegSequential).
export function drawTopo(
  canvas: HTMLCanvasElement,
  electrodes: TopoElectrode[],
  vMin: number,
  vMax: number,
  colormap: Colormap
): void {
  const W = canvas.width;
  const H = canvas.height;
  // pixel constants below are the reference's at CANVAS_SIZE; k rescales them for larger canvases
  const k = W / CANVAS_SIZE;
  const cx = W / 2;
  const cy = H / 2;
  const r = W * HEAD_RADIUS_RATIO;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, W, H);
  const range = vMax - vMin;

  const SS = BAND_SUPERSAMPLE;
  const sw = W * SS,
    sh = H * SS;
  const scx = sw / 2,
    scy = sh / 2,
    sr = r * SS;

  // 1) Render the continuous, normalized IDW field as a grayscale image across
  //    the WHOLE square (no circle clip). IDW is a weighted average so it always
  //    stays within [vMin, vMax]; sampling outside the circle too means the
  //    later blur has valid neighbours at the rim (no dark halo).
  const field = getFieldCanvas(sw, sh);
  const fctx = field.getContext('2d');
  if (!fctx) return;
  const fieldImg = fctx.createImageData(sw, sh);
  const fd = fieldImg.data;
  for (let py = 0; py < sh; py++) {
    for (let px = 0; px < sw; px++) {
      const t =
        range > 0 ? (idw((px - scx) / sr, -((py - scy) / sr), electrodes) - vMin) / range : 0;
      const v = t < 0 ? 0 : t > 1 ? 1 : t;
      const g = Math.round(v * 255);
      const idx = (py * sw + px) * 4;
      fd[idx] = g;
      fd[idx + 1] = g;
      fd[idx + 2] = g;
      fd[idx + 3] = 255;
    }
  }
  fctx.putImageData(fieldImg, 0, 0);

  // 2) Blur the value field so neighbouring sites blend into a continuous field.
  const blurred = getBlurredCanvas(sw, sh);
  const bctx = blurred.getContext('2d');
  if (!bctx) return;
  bctx.clearRect(0, 0, sw, sh);
  bctx.filter = `blur(${FIELD_BLUR_PX * SS * k}px)`;
  bctx.drawImage(field, 0, 0);
  bctx.filter = 'none';

  // 3) Map the blurred field value through the colormap.
  const blurImg = bctx.getImageData(0, 0, sw, sh);
  const bd = blurImg.data;
  for (let i = 0; i < bd.length; i += 4) {
    const [rr, gg, bb] = colormap(bd[i] / 255);
    fd[i] = rr;
    fd[i + 1] = gg;
    fd[i + 2] = bb;
    fd[i + 3] = 255;
  }
  fctx.putImageData(fieldImg, 0, 0);

  // 4) Clip to the head circle and downscale with smoothing → antialiased.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(field, 0, 0, sw, sh, 0, 0, W, H);
  ctx.restore();

  // head circle outline
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1.5 * k;
  ctx.stroke();

  // nose
  ctx.beginPath();
  ctx.moveTo(cx - 6 * k, cy - r + 3 * k);
  ctx.lineTo(cx, cy - r - 9 * k);
  ctx.lineTo(cx + 6 * k, cy - r + 3 * k);
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1.5 * k;
  ctx.stroke();

  // electrode dots (small, QEEG style)
  for (const e of electrodes) {
    ctx.beginPath();
    ctx.arc(e.px * k, e.py * k, 2 * k, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fill();
  }
}
