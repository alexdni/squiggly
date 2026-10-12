// Functional-network masks over the kernel's voxel grid.
//
// These are seed-region masks, NOT a parcellation. Each network is a handful of
// spheres centred on coordinates commonly reported for that network's nodes,
// resolved against the voxels' own `coordsMni`. That deliberately sidesteps the
// kernel's `labels`, which biofeedback-core documents as a placeholder — its
// own follow-ups say "the atlas is a placeholder… ROI output means little until
// this is replaced". Coordinates are real data; those labels are not yet.
//
// Coordinates below are approximate peak coordinates, rounded, from the studies
// each network cites. They are a reasonable index into the volume, not a
// subject-specific anatomical claim. When a real atlas ships in core, this file
// is the only one that changes.

export type NetworkSeed = {
  label: string;
  /** MNI millimetres, [x right, y anterior, z superior]. */
  mni: [number, number, number];
};

export type Network = {
  id: string;
  name: string;
  /** Radius applied to every seed in this network, in millimetres. */
  radiusMm: number;
  seeds: NetworkSeed[];
  source: string;
  /** Trace colour when several networks are compared on one plot. Chosen to
   *  avoid the transport's red (rejected windows) and orange (playhead). */
  color: string;
};

export const WHOLE_BRAIN_ID = 'whole-brain';

/** 15 mm is a conventional seed-ROI radius and, at a 5 mm grid, takes in
 *  enough voxels per node for the mean to mean something. */
const SEED_RADIUS_MM = 15;

export const NETWORKS: Network[] = [
  {
    id: 'dmn',
    color: '#7b1fa2',
    name: 'Default Mode',
    radiusMm: SEED_RADIUS_MM,
    source: 'Fox et al. 2005; Raichle 2015',
    seeds: [
      { label: 'Posterior cingulate / precuneus', mni: [-5, -49, 40] },
      { label: 'Medial prefrontal', mni: [-1, 47, -4] },
      { label: 'Left lateral parietal', mni: [-45, -67, 36] },
      { label: 'Right lateral parietal', mni: [45, -67, 36] },
    ],
  },
  {
    id: 'salience',
    color: '#00838f',
    name: 'Salience',
    radiusMm: SEED_RADIUS_MM,
    source: 'Seeley et al. 2007',
    seeds: [
      { label: 'Left anterior insula', mni: [-38, 26, -10] },
      { label: 'Right anterior insula', mni: [38, 26, -10] },
      { label: 'Dorsal anterior cingulate', mni: [-2, 22, 34] },
    ],
  },
  {
    id: 'central-executive',
    color: '#2e7d32',
    name: 'Central Executive',
    radiusMm: SEED_RADIUS_MM,
    source: 'Seeley et al. 2007',
    seeds: [
      { label: 'Left dorsolateral prefrontal', mni: [-44, 36, 20] },
      { label: 'Right dorsolateral prefrontal', mni: [44, 36, 20] },
      { label: 'Left posterior parietal', mni: [-52, -52, 46] },
      { label: 'Right posterior parietal', mni: [52, -52, 46] },
    ],
  },
  {
    id: 'dorsal-attention',
    color: '#1565c0',
    name: 'Dorsal Attention',
    radiusMm: SEED_RADIUS_MM,
    source: 'Fox et al. 2006',
    seeds: [
      { label: 'Left frontal eye field', mni: [-26, -12, 52] },
      { label: 'Right frontal eye field', mni: [26, -12, 52] },
      { label: 'Left intraparietal sulcus', mni: [-26, -58, 48] },
      { label: 'Right intraparietal sulcus', mni: [26, -58, 48] },
    ],
  },
  {
    id: 'sensorimotor',
    color: '#ad1457',
    name: 'Sensorimotor',
    radiusMm: SEED_RADIUS_MM,
    source: 'Biswal et al. 1995; Yeo et al. 2011',
    seeds: [
      { label: 'Left primary motor', mni: [-39, -26, 56] },
      { label: 'Right primary motor', mni: [39, -26, 56] },
      { label: 'Supplementary motor area', mni: [0, -8, 60] },
    ],
  },
  {
    id: 'visual',
    color: '#6d4c41',
    name: 'Visual',
    radiusMm: SEED_RADIUS_MM,
    source: 'Yeo et al. 2011',
    seeds: [
      { label: 'Calcarine', mni: [0, -88, 4] },
      { label: 'Left extrastriate', mni: [-28, -92, 4] },
      { label: 'Right extrastriate', mni: [28, -92, 4] },
    ],
  },
];

export const networkById = (id: string): Network | null =>
  NETWORKS.find((n) => n.id === id) ?? null;

/** Resolve a selection to networks, in NETWORKS order rather than click order,
 *  so the legend and the trace colours stay in a stable sequence. Unknown ids
 *  are dropped — a persisted selection must not be able to break the view. */
export const networksByIds = (ids: string[]): Network[] =>
  NETWORKS.filter((n) => ids.includes(n.id));

/**
 * 1 for voxels inside any seed sphere of any selected network, 0 elsewhere.
 *
 * The union is deliberate: several networks share nodes at this resolution
 * (DMN and central-executive parietal seeds sit ~15 mm apart), so counting an
 * overlapping voxel once is the only thing that keeps the combined mask size
 * and the combined mean honest.
 *
 * Returns null for the whole-brain selection so callers can skip masking
 * entirely rather than allocating an all-ones array they then ignore.
 */
export function networkMask(coordsMni: number[][], networks: Network[]): Uint8Array | null {
  if (!networks.length) return null;

  const mask = new Uint8Array(coordsMni.length);

  for (const network of networks) {
    const r2 = network.radiusMm * network.radiusMm;
    for (let i = 0; i < coordsMni.length; i++) {
      if (mask[i]) continue;
      const [x, y, z] = coordsMni[i];
      for (const seed of network.seeds) {
        const dx = x - seed.mni[0];
        const dy = y - seed.mni[1];
        const dz = z - seed.mni[2];
        if (dx * dx + dy * dy + dz * dz <= r2) {
          mask[i] = 1;
          break;
        }
      }
    }
  }
  return mask;
}

/** Mean value over the masked voxels; over all voxels when mask is null.
 *  An empty mask means "no voxels in this grid fall inside the network", which
 *  is a real answer — 0 — not an error, and not NaN leaking into a chart. */
export function maskedMean(values: Float32Array, mask: Uint8Array | null): number {
  if (!values.length) return 0;

  let sum = 0;
  let count = 0;
  if (!mask) {
    for (let i = 0; i < values.length; i++) sum += values[i];
    count = values.length;
  } else {
    for (let i = 0; i < values.length; i++) {
      if (mask[i]) {
        sum += values[i];
        count++;
      }
    }
  }
  return count ? sum / count : 0;
}

/** How many voxels a network actually covers on this grid — surfaced in the UI
 *  so a network that lands on nothing is visible rather than silently empty. */
export function maskSize(mask: Uint8Array | null, total: number): number {
  if (!mask) return total;
  let count = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) count++;
  return count;
}
