import * as THREE from 'three';
import { BrainScene } from './brainScene';
import { sloretaColormap } from './sloretaColor';

// View B: the voxel grid drawn inside the fsaverage cortex mesh
// (public/models/brain.glb), which serves only as an orientation backdrop.
//
// An InstancedMesh rather than THREE.Points: it gives per-voxel size *and*
// colour with correct depth sorting, and a few thousand instances of a 20-face
// icosahedron is nothing. Size carries magnitude and colour carries it again —
// redundant on purpose, because a cloud encoded only by colour reads as noise.

/** Voxels below this fraction of the scale are hidden entirely. Drawing every
 *  voxel fills the volume with a solid block and hides the structure that is
 *  the point of the view. */
const VISIBILITY_FLOOR = 0.35;

/** Radius of a voxel at full scale, as a fraction of the grid pitch. Below 0.5
 *  neighbouring voxels never touch, so the lattice stays legible as a cloud
 *  instead of fusing into a solid mass — and it holds for any kernel's grid
 *  rather than assuming a spacing. */
const VOXEL_RADIUS_OF_PITCH = 0.45;

/** Leaves a hair of margin after fitting, so surface voxels sit just inside the
 *  cortex rather than z-fighting with it. */
const GRID_INSET = 0.98;

/** Enough for the gyral shading to read as a brain rather than as fog, while
 *  still letting the interior voxels through. The mesh is drawn double-sided
 *  (fsaverage winding is inconsistent), so every surface is blended twice —
 *  which is why this is much lower than it looks like it should be. */
const CORTEX_OPACITY = 0.22;

export type VoxelCloudUpdate = {
  values: Float32Array;
  /** Shared across conditions, so EO and EC compare on one scale. */
  scale: { min: number; max: number };
  mask: Uint8Array | null;
  lowSensitivity: boolean[];
};

export type VoxelCloud = {
  update: (update: VoxelCloudUpdate) => void;
  dispose: () => void;
};

const bounds = (points: ArrayLike<number>, count: number, stride: number) => {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      const v = points[i * stride + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return {
    centre: min.map((v, k) => (v + max[k]) / 2) as [number, number, number],
    size: min.map((v, k) => max[k] - v) as [number, number, number],
  };
};

/**
 * MNI millimetres → the cortex mesh's local space.
 *
 * Axes first: the mesh is +X the subject's LEFT, +Y superior, +Z anterior (the
 * convention brainScene's VIEW_DIRS are built on),
 * while MNI is +x right, +y anterior, +z superior — hence the swap and the
 * negation.
 *
 * Placement is a bounding-box fit against the mesh's real geometry rather than
 * a normalisation of the cloud alone. The two are NOT the same volume — the
 * mesh is a cortex-only pial surface, the kernel's source space is whole-brain
 * and takes in cerebellum and brainstem — so their proportions differ and no
 * transform makes them coincide. Fitting centre-to-centre with a single uniform
 * scale, chosen from the tightest axis, keeps the cloud inside the cortex and
 * keeps relative voxel positions undistorted. A per-axis stretch would fill the
 * mesh exactly but move voxels by up to ~10 mm against the anatomy, which is
 * not a trade a localization view can make.
 *
 * The mesh is a backdrop for orientation. The slice view, which works in MNI
 * millimetres directly, is what to read positions off.
 */
export function mniToMeshTransform(coordsMni: number[][], meshPositions: ArrayLike<number>) {
  // The cloud, already in mesh axes so both boxes are measured the same way.
  const inMeshAxes = new Float64Array(coordsMni.length * 3);
  coordsMni.forEach((mni, i) => {
    inMeshAxes[i * 3] = -mni[0];
    inMeshAxes[i * 3 + 1] = mni[2];
    inMeshAxes[i * 3 + 2] = mni[1];
  });

  const cloud = bounds(inMeshAxes, coordsMni.length, 3);
  const mesh = bounds(meshPositions, meshPositions.length / 3, 3);

  // Calibrate on left-right, the one dimension the two objects genuinely share:
  // both are bounded by the width of the same head. Fitting the tallest axis
  // instead would let the cerebellum — present in the source space, absent from
  // this cortex-only mesh — shrink the entire cloud and pull it away from the
  // occipital pole. Some voxels then sit slightly below the cortex, which is
  // where the cerebellum actually is.
  const scale = cloud.size[0] > 0 ? (mesh.size[0] / cloud.size[0]) * GRID_INSET : 1;

  const toMesh = (mni: number[]): [number, number, number] => [
    (-mni[0] - cloud.centre[0]) * scale + mesh.centre[0],
    (mni[2] - cloud.centre[1]) * scale + mesh.centre[1],
    (mni[1] - cloud.centre[2]) * scale + mesh.centre[2],
  ];

  return { toMesh, scale };
}

/** Smallest positive gap between coordinates along any axis — the grid pitch,
 *  in millimetres. Read from the data so a 5 mm and an 8 mm kernel both draw
 *  voxels at the right size. */
export function gridPitchMm(coordsMni: number[][]): number {
  let pitch = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const values = Array.from(new Set(coordsMni.map((c) => c[axis]))).sort((a, b) => a - b);
    for (let i = 1; i < values.length; i++) {
      const gap = values[i] - values[i - 1];
      if (gap > 0 && gap < pitch) pitch = gap;
    }
  }
  return Number.isFinite(pitch) ? pitch : 1;
}

export function createVoxelCloud(scene: BrainScene, coordsMni: number[][]): VoxelCloud {
  const count = coordsMni.length;
  const geometry = new THREE.IcosahedronGeometry(1, 0);

  // vertexColors is required for instance colours to reach the fragment shader,
  // and it makes the shader read a per-vertex `color` attribute. Without one
  // the attribute defaults to black and multiplies every instance colour to
  // zero, so give the geometry an explicit white one.
  geometry.setAttribute(
    'color',
    new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 3).fill(1), 3)
  );

  const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;

  const { toMesh, scale } = mniToMeshTransform(
    coordsMni,
    (scene.mesh.geometry.attributes.position as THREE.BufferAttribute).array
  );
  const positions = coordsMni.map(toMesh);
  const maxVoxelRadius = gridPitchMm(coordsMni) * scale * VOXEL_RADIUS_OF_PITCH;

  // Created eagerly rather than lazily by setColorAt, so the shader program is
  // compiled with instancing colour from the very first render.
  const colors = new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3);
  colors.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = colors;

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scaleVec = new THREE.Vector3();

  // Fade the cortex so the interior is visible. The surface stays as a spatial
  // reference, not a subject of its own.
  const cortex = scene.mesh.material as THREE.MeshStandardMaterial;
  const previousOpacity = cortex.opacity;
  const previousTransparent = cortex.transparent;
  const previousDepthWrite = cortex.depthWrite;
  cortex.transparent = true;
  cortex.opacity = CORTEX_OPACITY;
  cortex.depthWrite = false;
  cortex.needsUpdate = true;

  scene.scene.add(mesh);

  const update = ({ values, scale, mask, lowSensitivity }: VoxelCloudUpdate) => {
    const span = scale.max - scale.min;

    for (let i = 0; i < count; i++) {
      const raw = i < values.length ? values[i] : NaN;
      const t = Number.isFinite(raw) && span > 0 ? (raw - scale.min) / span : 0;
      const masked = mask ? mask[i] === 1 : true;

      // Low-sensitivity voxels are shown smaller, never at the same weight as
      // cortical ones: there the estimate is largely prior rather than data.
      const weight = masked ? (lowSensitivity[i] ? 0.45 : 1) : 0;
      const visible = masked && t >= VISIBILITY_FLOOR;
      const radius = visible ? maxVoxelRadius * weight * (0.35 + 0.65 * t) : 0;

      const [px, py, pz] = positions[i];
      position.set(px, py, pz);
      scaleVec.set(radius, radius, radius);
      matrix.compose(position, quaternion, scaleVec);
      mesh.setMatrixAt(i, matrix);

      const [r, g, b] = sloretaColormap(t);
      colors.setXYZ(i, r / 255, g / 255, b / 255);
    }

    mesh.instanceMatrix.needsUpdate = true;
    colors.needsUpdate = true;
    scene.renderOnce();
  };

  const dispose = () => {
    scene.scene.remove(mesh);
    geometry.dispose();
    material.dispose();
    mesh.dispose();
    cortex.opacity = previousOpacity;
    cortex.transparent = previousTransparent;
    cortex.depthWrite = previousDepthWrite;
    cortex.needsUpdate = true;
  };

  return { update, dispose };
}
