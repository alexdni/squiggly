import { describe, expect, it } from 'vitest';
import {
  maskedMean,
  maskSize,
  NETWORKS,
  networkById,
  networkMask,
  networksByIds,
} from '../networks';

/** An 8 mm grid over the same ellipsoid the dev kernel uses. */
function grid(): number[][] {
  const coords: number[][] = [];
  for (let x = -68; x <= 68; x += 8) {
    for (let y = -104; y <= 68; y += 8) {
      for (let z = -50; z <= 74; z += 8) {
        const dx = x / 68;
        const dy = (y + 18) / 86;
        const dz = (z - 12) / 62;
        if (dx * dx + dy * dy + dz * dz <= 1) coords.push([x, y, z]);
      }
    }
  }
  return coords;
}

describe('NETWORKS', () => {
  it('has unique ids and at least three seeds each', () => {
    const ids = NETWORKS.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const n of NETWORKS) {
      expect(n.seeds.length).toBeGreaterThanOrEqual(3);
      expect(n.source).not.toBe('');
    }
  });

  it('resolves by id and returns null for an unknown one', () => {
    expect(networkById('dmn')?.name).toBe('Default Mode');
    expect(networkById('nope')).toBeNull();
  });

  it('gives every network its own trace colour', () => {
    const colors = NETWORKS.map((n) => n.color);
    expect(new Set(colors).size).toBe(colors.length);
  });
});

describe('networksByIds', () => {
  it('resolves in NETWORKS order, not selection order', () => {
    expect(networksByIds(['visual', 'dmn']).map((n) => n.id)).toEqual(['dmn', 'visual']);
  });

  it('drops unknown ids rather than throwing on a stale selection', () => {
    expect(networksByIds(['dmn', 'retired-network']).map((n) => n.id)).toEqual(['dmn']);
    expect(networksByIds([])).toEqual([]);
  });
});

describe('networkMask', () => {
  it('returns null for the whole-brain selection', () => {
    expect(networkMask(grid(), [])).toBeNull();
  });

  it('marks a voxel sitting on a seed centre', () => {
    const dmn = networkById('dmn')!;
    // The precuneus seed, exactly.
    const coords = [dmn.seeds[0].mni as number[]];
    expect(Array.from(networkMask(coords, [dmn])!)).toEqual([1]);
  });

  it('marks a voxel inside the radius and not one outside it', () => {
    const dmn = networkById('dmn')!;
    const [x, y, z] = dmn.seeds[0].mni;
    const coords = [
      [x + 10, y, z], // 10 mm — inside the 15 mm radius
      [x + 40, y, z], // 40 mm — well outside every DMN seed
    ];
    expect(Array.from(networkMask(coords, [dmn])!)).toEqual([1, 0]);
  });

  it('covers a plausible slice of a realistic grid for every network', () => {
    const coords = grid();
    for (const network of NETWORKS) {
      const size = maskSize(networkMask(coords, [network]), coords.length);
      // Every network must land on some voxels, and none may swallow the brain.
      expect(size, `${network.name} covers no voxels`).toBeGreaterThan(0);
      expect(size / coords.length, `${network.name} covers too much`).toBeLessThan(0.35);
    }
  });

  it('unions several networks without double-counting shared voxels', () => {
    const coords = grid();
    const dmn = networkById('dmn')!;
    const cen = networkById('central-executive')!;

    const a = networkMask(coords, [dmn])!;
    const b = networkMask(coords, [cen])!;
    const union = networkMask(coords, [dmn, cen])!;

    // Every voxel is exactly the OR of the two — union, not sum.
    coords.forEach((_, i) => expect(union[i]).toBe(a[i] || b[i] ? 1 : 0));

    const sizeA = maskSize(a, coords.length);
    const sizeB = maskSize(b, coords.length);
    const sizeUnion = maskSize(union, coords.length);
    expect(sizeUnion).toBeGreaterThanOrEqual(Math.max(sizeA, sizeB));
    expect(sizeUnion).toBeLessThanOrEqual(sizeA + sizeB);
  });

  it('is order-independent', () => {
    const coords = grid();
    const ids = ['dmn', 'salience', 'visual'];
    const forward = networkMask(coords, networksByIds(ids))!;
    const reversed = networkMask(coords, networksByIds([...ids].reverse()))!;
    expect(Array.from(forward)).toEqual(Array.from(reversed));
  });

  it('is symmetric for networks with mirrored seeds', () => {
    const coords = grid();
    const mask = networkMask(coords, [networkById('visual')!])!;
    let left = 0;
    let right = 0;
    coords.forEach((c, i) => {
      if (!mask[i]) return;
      if (c[0] < 0) left++;
      if (c[0] > 0) right++;
    });
    expect(left).toBe(right);
  });
});

describe('maskedMean', () => {
  it('averages over the whole volume when unmasked', () => {
    expect(maskedMean(Float32Array.from([1, 2, 3, 4]), null)).toBe(2.5);
  });

  it('averages only the masked voxels', () => {
    const values = Float32Array.from([1, 100, 3, 100]);
    const mask = Uint8Array.from([1, 0, 1, 0]);
    expect(maskedMean(values, mask)).toBe(2);
  });

  it('returns 0 rather than NaN for an empty mask', () => {
    const values = Float32Array.from([1, 2, 3]);
    expect(maskedMean(values, new Uint8Array(3))).toBe(0);
  });

  it('returns 0 for an empty frame', () => {
    expect(maskedMean(new Float32Array(0), null)).toBe(0);
  });
});
