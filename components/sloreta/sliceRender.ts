// View A: orthogonal slices through the voxel volume.
//
// Split deliberately into pure grid/slice maths and a thin canvas painter, so
// the parts that can be wrong in a way you cannot see — which voxel is the
// peak, which grid plane a coordinate lands on, where a voxel falls in the
// image — are unit-testable without a DOM.
//
// Orientation is the NEUROLOGICAL convention: the subject's left is on the
// viewer's left. Anterior is up in the axial view, superior is up in the
// coronal and sagittal views, and anterior is to the right in sagittal.

import { sloretaColormap } from './sloretaColor';

export type Plane = 'axial' | 'coronal' | 'sagittal';

export type VoxelGrid = {
  /** Sorted unique coordinates along each MNI axis. */
  xs: number[];
  ys: number[];
  zs: number[];
  spacing: number;
  /** "x,y,z" → voxel index. */
  index: Map<string, number>;
};

export type SliceCells = {
  cols: number;
  rows: number;
  /** Row-major, row 0 at the top of the image. NaN where the grid has no voxel. */
  values: Float32Array;
  /** Parallel to `values`: 1 where the voxel is flagged low-sensitivity. */
  lowSensitivity: Uint8Array;
  /** Parallel to `values`: 1 where the voxel is inside the active network mask. */
  inMask: Uint8Array;
  /** MNI coordinate this slice was cut at, snapped to the grid. */
  coord: number;
  /** Axis labels, for the caption. */
  colAxis: 'x' | 'y' | 'z';
  rowAxis: 'x' | 'y' | 'z';
};

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

const uniqueSorted = (values: number[]): number[] =>
  Array.from(new Set(values)).sort((a, b) => a - b);

/** Smallest positive gap between adjacent coordinates — the grid pitch. */
function inferSpacing(axes: number[][]): number {
  let spacing = Infinity;
  for (const axis of axes) {
    for (let i = 1; i < axis.length; i++) {
      const d = axis[i] - axis[i - 1];
      if (d > 0 && d < spacing) spacing = d;
    }
  }
  return Number.isFinite(spacing) ? spacing : 1;
}

export function buildGrid(coordsMni: number[][]): VoxelGrid {
  const xs = uniqueSorted(coordsMni.map((c) => c[0]));
  const ys = uniqueSorted(coordsMni.map((c) => c[1]));
  const zs = uniqueSorted(coordsMni.map((c) => c[2]));

  const index = new Map<string, number>();
  coordsMni.forEach((c, i) => index.set(key(c[0], c[1], c[2]), i));

  return { xs, ys, zs, spacing: inferSpacing([xs, ys, zs]), index };
}

/** Nearest grid plane to `coord` along an axis. */
export function snapToAxis(axis: number[], coord: number): number {
  if (!axis.length) return coord;
  let best = axis[0];
  let bestDist = Math.abs(axis[0] - coord);
  for (const v of axis) {
    const d = Math.abs(v - coord);
    if (d < bestDist) {
      bestDist = d;
      best = v;
    }
  }
  return best;
}

/**
 * Index of the largest value, restricted to the mask when one is given.
 * Returns -1 for an empty frame — including the zero-length array core returns
 * for a rejected window, which must never be presented as a location.
 */
export function peakVoxel(values: Float32Array, mask: Uint8Array | null): number {
  let peak = -1;
  let best = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (mask && !mask[i]) continue;
    if (values[i] > best) {
      best = values[i];
      peak = i;
    }
  }
  return peak;
}

/** Highest value present in a frame, honouring the mask. 0 for an empty frame. */
export function frameMax(values: Float32Array, mask: Uint8Array | null): number {
  const peak = peakVoxel(values, mask);
  return peak < 0 ? 0 : values[peak];
}

/** Cut one plane out of the volume at an MNI coordinate. */
export function sliceCells(params: {
  grid: VoxelGrid;
  values: Float32Array;
  lowSensitivity: boolean[];
  mask: Uint8Array | null;
  plane: Plane;
  coord: number;
}): SliceCells {
  const { grid, values, lowSensitivity, mask, plane, coord } = params;

  // Which MNI axes span the image, and which is held fixed.
  const layout = {
    axial: { fixed: grid.zs, col: grid.xs, row: grid.ys, colAxis: 'x', rowAxis: 'y' },
    coronal: { fixed: grid.ys, col: grid.xs, row: grid.zs, colAxis: 'x', rowAxis: 'z' },
    sagittal: { fixed: grid.xs, col: grid.ys, row: grid.zs, colAxis: 'y', rowAxis: 'z' },
  }[plane] as {
    fixed: number[];
    col: number[];
    row: number[];
    colAxis: 'x' | 'y' | 'z';
    rowAxis: 'x' | 'y' | 'z';
  };

  const at = snapToAxis(layout.fixed, coord);
  const cols = layout.col.length;
  const rows = layout.row.length;

  const out = new Float32Array(cols * rows).fill(NaN);
  const low = new Uint8Array(cols * rows);
  const inMask = new Uint8Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    // Row 0 is the top of the image, and both row axes (y anterior, z superior)
    // increase upward — so walk the axis backwards.
    const rowValue = layout.row[rows - 1 - r];
    for (let c = 0; c < cols; c++) {
      const colValue = layout.col[c];
      const k =
        plane === 'axial'
          ? key(colValue, rowValue, at)
          : plane === 'coronal'
            ? key(colValue, at, rowValue)
            : key(at, colValue, rowValue);

      const voxel = grid.index.get(k);
      if (voxel === undefined) continue;

      const cell = r * cols + c;
      out[cell] = values[voxel];
      low[cell] = lowSensitivity[voxel] ? 1 : 0;
      inMask[cell] = mask ? mask[voxel] : 1;
    }
  }

  return {
    cols,
    rows,
    values: out,
    lowSensitivity: low,
    inMask,
    coord: at,
    colAxis: layout.colAxis,
    rowAxis: layout.rowAxis,
  };
}

/** Where a voxel's MNI coordinate lands in a slice image, in cell units. */
export function voxelCell(
  grid: VoxelGrid,
  plane: Plane,
  mni: number[]
): { col: number; row: number } | null {
  const [x, y, z] = mni;
  const axes =
    plane === 'axial'
      ? { col: grid.xs, row: grid.ys, colValue: x, rowValue: y }
      : plane === 'coronal'
        ? { col: grid.xs, row: grid.zs, colValue: x, rowValue: z }
        : { col: grid.ys, row: grid.zs, colValue: y, rowValue: z };

  const col = axes.col.indexOf(snapToAxis(axes.col, axes.colValue));
  const rowFromBottom = axes.row.indexOf(snapToAxis(axes.row, axes.rowValue));
  if (col < 0 || rowFromBottom < 0) return null;

  return { col, row: axes.row.length - 1 - rowFromBottom };
}

// ── canvas painting ─────────────────────────────────────────────────────────

const EMPTY_RGB = 14; // near-black background for cells outside the volume
const LOW_SENSITIVITY_ALPHA = 0.35;
const OUT_OF_MASK_ALPHA = 0.12;

/**
 * Paint one slice into an ImageData-sized buffer at cell resolution. The caller
 * scales it up with `imageSmoothingEnabled = false` so voxels stay voxels
 * rather than being interpolated into a smoothness the data does not have.
 */
export function sliceToImageData(
  cells: SliceCells,
  scale: { min: number; max: number }
): ImageData {
  const { cols, rows, values, lowSensitivity, inMask } = cells;
  const data = new Uint8ClampedArray(cols * rows * 4);
  const span = scale.max - scale.min;

  for (let i = 0; i < values.length; i++) {
    const p = i * 4;
    const v = values[i];

    if (!Number.isFinite(v)) {
      data[p] = EMPTY_RGB;
      data[p + 1] = EMPTY_RGB;
      data[p + 2] = EMPTY_RGB;
      data[p + 3] = 255;
      continue;
    }

    const t = span > 0 ? (v - scale.min) / span : 0;
    const [r, g, b] = sloretaColormap(t);

    // Dim low-sensitivity voxels — at those the estimate is largely prior, not
    // data, and core ships the flag precisely so it can drive treatment like
    // this. Out-of-mask voxels fade further so the selected network reads.
    let alpha = 1;
    if (!inMask[i]) alpha = OUT_OF_MASK_ALPHA;
    else if (lowSensitivity[i]) alpha = LOW_SENSITIVITY_ALPHA;

    data[p] = r * alpha + EMPTY_RGB * (1 - alpha);
    data[p + 1] = g * alpha + EMPTY_RGB * (1 - alpha);
    data[p + 2] = b * alpha + EMPTY_RGB * (1 - alpha);
    data[p + 3] = 255;
  }

  return new ImageData(data, cols, rows);
}
