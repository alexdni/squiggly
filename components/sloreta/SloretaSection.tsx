'use client';

// sLORETA source maps for an analysis: orthogonal MNI slices and a 3D voxel cloud, per condition
// and band, with functional-network seed masks. Values come from the server (the kernel never
// reaches the browser); this component only places and colours them.

import { useEffect, useMemo, useState } from 'react';
import type { BandName, Condition, SloretaResults } from '@/lib/analysis-results';
import { BAND_LABELS, CONDITION_LABELS } from '@/components/visuals/data';
import CloudView from './CloudView';
import { maskSize, networkMask, NETWORKS, networksByIds } from './networks';
import SliceView from './SliceView';
import { buildGrid } from './sliceRender';
import { formatSourceValue, SLORETA_GRADIENT_CSS } from './sloretaColor';

interface VoxelGridResponse {
  kernel_id: string;
  head_model_id: string;
  coords_mni: number[][];
  labels: string[];
  low_sensitivity: boolean[];
}

type View = 'slices' | 'cloud';

/** Strongest voxel inside the mask that the kernel supports well; -1 when there is none. */
function strongestVoxel(values: Float32Array, mask: Uint8Array | null, low: boolean[]): number {
  let peak = -1;
  for (let i = 0; i < values.length; i++) {
    if ((mask && !mask[i]) || low[i]) continue;
    if (peak < 0 || values[i] > values[peak]) peak = i;
  }
  return peak;
}

export default function SloretaSection({ analysisId, sloreta }: { analysisId: string; sloreta: SloretaResults }) {
  const [grid, setGrid] = useState<VoxelGridResponse | null>(null);
  const [all, setAll] = useState<Float32Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [condition, setCondition] = useState<Condition>(sloreta.conditions.includes('ec') ? 'ec' : sloreta.conditions[0]);
  const [band, setBand] = useState<BandName>('alpha2');
  const [view, setView] = useState<View>('slices');
  const [networkIds, setNetworkIds] = useState<string[]>([]);
  const [crosshair, setCrosshair] = useState<[number, number, number]>([0, -20, 20]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch('/api/sloreta/voxels').then((r) => (r.ok ? r.json() : Promise.reject(new Error(`voxel grid: HTTP ${r.status}`)))),
      fetch(`/api/analyses/${analysisId}/sloreta`).then((r) =>
        r.ok ? r.arrayBuffer() : Promise.reject(new Error(`values: HTTP ${r.status}`))
      ),
    ])
      .then(([g, buf]: [VoxelGridResponse, ArrayBuffer]) => {
        if (!alive) return;
        if (g.kernel_id !== sloreta.kernel_id) throw new Error(`computed with ${sloreta.kernel_id}, server has ${g.kernel_id}`);
        const values = new Float32Array(buf);
        if (values.length !== sloreta.conditions.length * sloreta.bands.length * sloreta.voxel_count) {
          throw new Error('values file does not match the analysis metadata');
        }
        setGrid(g);
        setAll(values);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [analysisId, sloreta]);

  const voxelGrid = useMemo(() => (grid ? buildGrid(grid.coords_mni) : null), [grid]);
  const networks = useMemo(() => networksByIds(networkIds), [networkIds]);
  const mask = useMemo(() => (grid ? networkMask(grid.coords_mni, networks) : null), [grid, networks]);

  const bandIndex = Math.max(0, sloreta.bands.findIndex((b) => b.name === band));
  const values = useMemo(() => {
    if (!all) return null;
    const ci = sloreta.conditions.indexOf(condition);
    const n = sloreta.voxel_count;
    const offset = (ci * sloreta.bands.length + bandIndex) * n;
    return all.subarray(offset, offset + n);
  }, [all, sloreta, condition, bandIndex]);

  // One scale per band across conditions, so EO and EC are directly comparable.
  const scale = useMemo(() => {
    const max = Math.max(0, ...sloreta.conditions.map((c) => sloreta.stats[c]?.[band]?.max ?? 0));
    return { min: 0, max };
  }, [sloreta, band]);

  const peak = useMemo(() => {
    if (!values || !grid) return -1;
    return strongestVoxel(values, mask, grid.low_sensitivity);
  }, [values, grid, mask]);

  // Re-centre on the peak whenever the map or the network selection changes.
  useEffect(() => {
    if (grid && peak >= 0) setCrosshair(grid.coords_mni[peak] as [number, number, number]);
  }, [grid, peak]);

  const cloudUpdate = useMemo(
    () => (values && grid ? { values, scale, mask, lowSensitivity: grid.low_sensitivity } : null),
    [values, grid, scale, mask]
  );

  const toggleNetwork = (id: string) =>
    setNetworkIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const pill = (active: boolean) =>
    `rounded px-3 py-1 text-xs font-medium ${active ? 'bg-neuro-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`;

  const epochs = sloreta.conditions.map((c) => `${sloreta.epochs_used[c] ?? 0} ${c.toUpperCase()}`).join(' / ');

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
        <span className="mt-0.5 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">Beta</span>
        <p>
          Computed only from the cleaned epochs the artifact pipeline kept ({epochs} × {sloreta.epoch_sec} s), averaged per
          condition. <strong>Template head model</strong> ({sloreta.head_model_id}), not this person&apos;s anatomy;
          skull thickness varies roughly two-fold between people. Values are <strong>dimensionless</strong> standardized
          current density, not µV, and not comparable to the band-power maps. Low localization error for a single source
          does not mean a sharp image, and simultaneous sources blur together. Region names are a coarse hemisphere × lobe
          partition. Not for clinical diagnosis.
          {sloreta.channels_interpolated.length > 0 &&
            ` Interpolated channels (${sloreta.channels_interpolated.join(', ')}) add no information; effective rank ${sloreta.effective_rank}.`}
          {sloreta.resampled_from_hz && ` Resampled from ${sloreta.resampled_from_hz} Hz to ${sloreta.design_sample_rate} Hz.`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex gap-1">
          {sloreta.conditions.map((c) => (
            <button key={c} type="button" className={pill(condition === c)} onClick={() => setCondition(c)}>
              {CONDITION_LABELS[c]}
            </button>
          ))}
        </div>
        <select
          value={band}
          onChange={(e) => setBand(e.target.value as BandName)}
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        >
          {sloreta.bands.map((b) => (
            <option key={b.name} value={b.name}>
              {BAND_LABELS[b.name]} ({b.f_lo}–{b.f_hi} Hz)
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          <button type="button" className={pill(view === 'slices')} onClick={() => setView('slices')}>
            Slices
          </button>
          <button type="button" className={pill(view === 'cloud')} onClick={() => setView('cloud')}>
            3D
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500">Networks (seed regions):</span>
        <button type="button" className={pill(networkIds.length === 0)} onClick={() => setNetworkIds([])}>
          Whole brain
        </button>
        {NETWORKS.map((n) => (
          <button
            key={n.id}
            type="button"
            title={n.source}
            className={pill(networkIds.includes(n.id))}
            onClick={() => toggleNetwork(n.id)}
          >
            {n.name}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">Source localization could not be loaded: {error}</p>}
      {!error && (!grid || !values || !voxelGrid) && <p className="text-sm text-gray-500">Loading source maps…</p>}

      {grid && values && voxelGrid && cloudUpdate && (
        <>
          {view === 'slices' ? (
            <SliceView
              grid={voxelGrid}
              values={values}
              lowSensitivity={grid.low_sensitivity}
              mask={mask}
              scale={scale}
              crosshair={crosshair}
              onPick={setCrosshair}
            />
          ) : (
            <CloudView coordsMni={grid.coords_mni} update={cloudUpdate} />
          )}

          <div className="flex flex-col items-center gap-1 text-xs text-gray-600">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500">{formatSourceValue(scale.min)}</span>
              <div className="h-2.5 w-52 rounded-sm border border-gray-300" style={{ background: SLORETA_GRADIENT_CSS }} />
              <span className="text-[10px] text-gray-500">{formatSourceValue(scale.max)}</span>
              <span className="ml-1 text-[10px] text-gray-500">standardized current density (dimensionless)</span>
            </div>
            {peak >= 0 ? (
              <span>
                Peak{networks.length ? ' in selection' : ''}: <strong>{grid.labels[peak]}</strong> · MNI{' '}
                {grid.coords_mni[peak].map((v) => v + 0).join(', ')} mm · {formatSourceValue(values[peak])}
              </span>
            ) : (
              <span>No well-supported voxel in this selection.</span>
            )}
            {networks.length > 0 && (
              <span className="text-gray-500">
                {maskSize(mask, sloreta.voxel_count)} of {sloreta.voxel_count} voxels in{' '}
                {networks.map((n) => n.name).join(' + ')}
              </span>
            )}
            <span className="text-gray-500">Dimmed voxels are weakly supported by the head model (largely prior, not data).</span>
          </div>
        </>
      )}
    </div>
  );
}
