import { describe, expect, it } from 'vitest';
import { gridPitchMm, mniToMeshTransform } from '../voxelCloud';

// A stand-in cortex: a box in mesh axes (+X subject-left, +Y superior,
// +Z anterior), centred on the origin the way brainScene leaves its geometry.
const meshBox = (sx: number, sy: number, sz: number, centre = [0, 0, 0]) => {
  const out: number[] = [];
  for (const x of [-sx / 2, sx / 2]) {
    for (const y of [-sy / 2, sy / 2]) {
      for (const z of [-sz / 2, sz / 2]) out.push(x + centre[0], y + centre[1], z + centre[2]);
    }
  }
  return Float32Array.from(out);
};

/** An MNI grid at `pitch` mm over the given half-extents. */
const mniGrid = (pitch: number, hx: number, hy: number, hz: number, centre = [0, 0, 0]) => {
  const coords: number[][] = [];
  for (let x = -hx; x <= hx; x += pitch) {
    for (let y = -hy; y <= hy; y += pitch) {
      for (let z = -hz; z <= hz; z += pitch) {
        coords.push([x + centre[0], y + centre[1], z + centre[2]]);
      }
    }
  }
  return coords;
};

describe('gridPitchMm', () => {
  it('reads the pitch off the coordinates', () => {
    expect(gridPitchMm(mniGrid(5, 10, 10, 10))).toBe(5);
    expect(gridPitchMm(mniGrid(8, 16, 16, 16))).toBe(8);
  });

  it('falls back to 1 for a single voxel rather than returning Infinity', () => {
    expect(gridPitchMm([[0, 0, 0]])).toBe(1);
  });
});

describe('mniToMeshTransform', () => {
  const mesh = meshBox(1.5, 1.4, 1.9);
  // Deliberately a different shape from the mesh, as the real source space is.
  const coords = mniGrid(5, 75, 80, 70);
  const { toMesh } = mniToMeshTransform(coords, mesh);
  const mapped = coords.map(toMesh);

  const extent = (axis: number) => {
    const vs = mapped.map((m) => m[axis]);
    return { min: Math.min(...vs), max: Math.max(...vs) };
  };

  it('matches the mesh across left-right, the dimension both share', () => {
    const { min, max } = extent(0);
    // GRID_INSET leaves a hair of margin so surface voxels don't z-fight.
    expect(max - min).toBeCloseTo(1.5 * 0.98, 6);
  });

  it('lets a source space taller than the cortex extend past it', () => {
    // The kernel's source space takes in cerebellum and brainstem; this mesh is
    // cortex only. Those voxels belong below the cortex, so the fit must not
    // shrink the whole cloud to hide them — that is what pulled it away from
    // the occipital pole.
    const tall = mniGrid(5, 75, 80, 120); // 240 mm superior-inferior
    const points = tall.map(mniToMeshTransform(tall, mesh).toMesh);
    const ys = points.map((p) => p[1]);

    expect(Math.max(...ys)).toBeGreaterThan(1.4 / 2);
    // ...while left-right still matches the mesh exactly.
    const xs = points.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1.5 * 0.98, 6);
  });

  it('centres the cloud on the mesh', () => {
    for (let axis = 0; axis < 3; axis++) {
      const { min, max } = extent(axis);
      expect((min + max) / 2).toBeCloseTo(0, 6);
    }
  });

  it('scales uniformly, so relative voxel positions are undistorted', () => {
    // A 10 mm step must cover the same distance whichever axis it is on.
    const step = (a: number[], b: number[]) => {
      const [ax, ay, az] = toMesh(a);
      const [bx, by, bz] = toMesh(b);
      return Math.hypot(ax - bx, ay - by, az - bz);
    };
    const alongX = step([0, 0, 0], [10, 0, 0]);
    const alongY = step([0, 0, 0], [0, 10, 0]);
    const alongZ = step([0, 0, 0], [0, 0, 10]);

    expect(alongY).toBeCloseTo(alongX, 9);
    expect(alongZ).toBeCloseTo(alongX, 9);
  });

  it('maps MNI axes onto the mesh axes, including the left-right flip', () => {
    const origin = toMesh([0, 0, 0]);
    // MNI +x is the subject's right; the mesh's +X is the subject's LEFT.
    expect(toMesh([50, 0, 0])[0]).toBeLessThan(origin[0]);
    // MNI +y is anterior -> mesh +Z.
    expect(toMesh([0, 50, 0])[2]).toBeGreaterThan(origin[2]);
    // MNI +z is superior -> mesh +Y.
    expect(toMesh([0, 0, 50])[1]).toBeGreaterThan(origin[1]);
  });

  it('follows a mesh that is not centred on the origin', () => {
    const offset = meshBox(1.5, 1.4, 1.9, [0.3, -0.2, 0.1]);
    const shifted = mniToMeshTransform(coords, offset).toMesh;
    const points = coords.map(shifted);

    for (const [axis, expected] of [[0, 0.3], [1, -0.2], [2, 0.1]] as const) {
      const vs = points.map((p) => p[axis]);
      expect((Math.min(...vs) + Math.max(...vs)) / 2).toBeCloseTo(expected, 6);
    }
  });
});
