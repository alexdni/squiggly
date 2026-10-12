import { describe, expect, it } from 'vitest';
import { buildGrid, frameMax, peakVoxel, sliceCells, snapToAxis, voxelCell } from '../sliceRender';

/** A small 3×3×3 cube at 8 mm pitch, centred on the origin. */
const AXIS = [-8, 0, 8];
const COORDS: number[][] = [];
for (const x of AXIS) for (const y of AXIS) for (const z of AXIS) COORDS.push([x, y, z]);

const GRID = buildGrid(COORDS);
const indexOf = (x: number, y: number, z: number) =>
  COORDS.findIndex((c) => c[0] === x && c[1] === y && c[2] === z);

const zeros = () => new Float32Array(COORDS.length);
const noLowSensitivity = COORDS.map(() => false);

describe('buildGrid', () => {
  it('recovers the axes and the pitch', () => {
    expect(GRID.xs).toEqual(AXIS);
    expect(GRID.ys).toEqual(AXIS);
    expect(GRID.zs).toEqual(AXIS);
    expect(GRID.spacing).toBe(8);
  });

  it('indexes every voxel', () => {
    expect(GRID.index.size).toBe(COORDS.length);
    expect(GRID.index.get('0,0,0')).toBe(indexOf(0, 0, 0));
  });

  it('handles an irregular volume without inventing voxels', () => {
    // A grid with a hole in it: the missing voxel must simply be absent.
    const sparse = COORDS.filter((c) => !(c[0] === 0 && c[1] === 0 && c[2] === 0));
    const grid = buildGrid(sparse);
    expect(grid.index.has('0,0,0')).toBe(false);
    expect(grid.spacing).toBe(8);
  });
});

describe('snapToAxis', () => {
  it('snaps to the nearest plane', () => {
    expect(snapToAxis(AXIS, 3)).toBe(0);
    expect(snapToAxis(AXIS, 5)).toBe(8);
    expect(snapToAxis(AXIS, -100)).toBe(-8);
  });
});

describe('peakVoxel', () => {
  it('finds the largest value', () => {
    const values = zeros();
    values[indexOf(8, -8, 0)] = 5;
    expect(peakVoxel(values, null)).toBe(indexOf(8, -8, 0));
  });

  it('respects the mask, ignoring a larger value outside it', () => {
    const values = zeros();
    values[indexOf(8, -8, 0)] = 99;
    values[indexOf(-8, 8, 0)] = 5;

    const mask = new Uint8Array(COORDS.length);
    mask[indexOf(-8, 8, 0)] = 1;

    expect(peakVoxel(values, mask)).toBe(indexOf(-8, 8, 0));
  });

  it('returns -1 for a rejected window rather than pointing somewhere', () => {
    // core returns a zero-length array when gateState is 'closed'.
    expect(peakVoxel(new Float32Array(0), null)).toBe(-1);
    expect(frameMax(new Float32Array(0), null)).toBe(0);
  });

  it('returns -1 when the mask covers nothing', () => {
    expect(peakVoxel(zeros(), new Uint8Array(COORDS.length))).toBe(-1);
  });
});

describe('sliceCells', () => {
  const cut = (plane: 'axial' | 'coronal' | 'sagittal', coord: number, values = zeros()) =>
    sliceCells({
      grid: GRID,
      values,
      lowSensitivity: noLowSensitivity,
      mask: null,
      plane,
      coord,
    });

  it('cuts an axial plane spanning x by y', () => {
    const cells = cut('axial', 0);
    expect(cells.cols).toBe(3);
    expect(cells.rows).toBe(3);
    expect(cells.coord).toBe(0);
    expect(cells.colAxis).toBe('x');
    expect(cells.rowAxis).toBe('y');
  });

  it('snaps a coordinate that is between planes', () => {
    expect(cut('axial', 3).coord).toBe(0);
    expect(cut('axial', 6).coord).toBe(8);
  });

  it('puts anterior at the top and the subject left on the viewer left', () => {
    const values = zeros();
    values[indexOf(-8, 8, 0)] = 1; // left, anterior
    const cells = cut('axial', 0, values);

    // Row 0 is the top of the image, column 0 is the leftmost.
    expect(cells.values[0 * cells.cols + 0]).toBe(1);
  });

  it('puts superior at the top in a coronal cut', () => {
    const values = zeros();
    values[indexOf(0, 0, 8)] = 1; // midline, superior
    const cells = cut('coronal', 0, values);

    expect(cells.rowAxis).toBe('z');
    expect(cells.values[0 * cells.cols + 1]).toBe(1);
  });

  it('puts anterior to the right in a sagittal cut', () => {
    const values = zeros();
    values[indexOf(0, 8, 0)] = 1; // anterior, mid-height
    const cells = cut('sagittal', 0, values);

    expect(cells.colAxis).toBe('y');
    expect(cells.values[1 * cells.cols + 2]).toBe(1);
  });

  it('marks cells with no voxel as NaN rather than zero', () => {
    const sparse = COORDS.filter((c) => !(c[0] === 0 && c[1] === 0 && c[2] === 0));
    const cells = sliceCells({
      grid: buildGrid(sparse),
      values: new Float32Array(sparse.length),
      lowSensitivity: sparse.map(() => false),
      mask: null,
      plane: 'axial',
      coord: 0,
    });

    // Centre of a 3×3 image: absent, so NaN — an empty cell is not a zero value.
    expect(cells.values[1 * cells.cols + 1]).toBeNaN();
  });

  it('carries the low-sensitivity and mask flags through', () => {
    const low = COORDS.map((c) => c[2] === -8);
    const mask = new Uint8Array(COORDS.length);
    mask[indexOf(0, 0, -8)] = 1;

    const cells = sliceCells({
      grid: GRID,
      values: zeros(),
      lowSensitivity: low,
      mask,
      plane: 'axial',
      coord: -8,
    });

    const centre = 1 * cells.cols + 1;
    expect(cells.lowSensitivity[centre]).toBe(1);
    expect(cells.inMask[centre]).toBe(1);
    expect(cells.inMask[0]).toBe(0);
  });
});

describe('voxelCell', () => {
  it('maps a coordinate to the same cell the slice put it in', () => {
    const values = zeros();
    values[indexOf(8, -8, 0)] = 1;
    const cells = sliceCells({
      grid: GRID,
      values,
      lowSensitivity: noLowSensitivity,
      mask: null,
      plane: 'axial',
      coord: 0,
    });

    const at = voxelCell(GRID, 'axial', [8, -8, 0])!;
    expect(cells.values[at.row * cells.cols + at.col]).toBe(1);
  });

  it('agrees with the slice for every plane', () => {
    const mni = [-8, 8, 8];
    const idx = indexOf(mni[0], mni[1], mni[2]);
    const values = zeros();
    values[idx] = 42;

    for (const plane of ['axial', 'coronal', 'sagittal'] as const) {
      const coord = plane === 'axial' ? mni[2] : plane === 'coronal' ? mni[1] : mni[0];
      const cells = sliceCells({
        grid: GRID,
        values,
        lowSensitivity: noLowSensitivity,
        mask: null,
        plane,
        coord,
      });
      const at = voxelCell(GRID, plane, mni)!;
      expect(cells.values[at.row * cells.cols + at.col], plane).toBe(42);
    }
  });
});
