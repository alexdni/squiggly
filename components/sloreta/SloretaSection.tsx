'use client';

// sLORETA source maps for an analysis: orthogonal MNI slices and a 3D voxel cloud, either as the
// per-condition average or as a time lapse over the whole cleaned recording (2 s windows, 1 s
// hop), with functional-network seed masks. Values come from the server (the kernel never
// reaches the browser); this component only places, animates and colours them.

import { useEffect, useMemo, useState } from 'react';
import type { BandName, Condition, SloretaResults } from '@/lib/analysis-results';
import { BAND_LABELS, CONDITION_LABELS } from '@/components/visuals/data';
import CloudView from './CloudView';
import { maskSize, networkMask, NETWORKS, networksByIds } from './networks';
import SliceView from './SliceView';
import { buildGrid } from './sliceRender';
import { formatSourceValue, SLORETA_GRADIENT_CSS } from './sloretaColor';
import SloretaTransport, { type TransportTrace } from './SloretaTransport';
import { decodeFrame, frameSummaries, isRejected, isUsable, meanFrames } from './timelapse';
import { useBandFrames } from './useBandFrames';
import { useSmoothedValues } from './useSmoothedValues';

interface VoxelGridResponse {
  kernel_id: string;
  head_model_id: string;
  coords_mni: number[][];
  labels: string[];
  low_sensitivity: boolean[];
}

type View = 'slices' | 'cloud';
type Mode = 'timelapse' | 'average';

/** Playback speeds, in recording seconds per wall-clock second (one frame = one hop). */
const SPEEDS = [1, 2, 4, 8, 16];
const DEFAULT_SPEED = 4;
/** Frames averaged for display: removes frame-to-frame variance; easing removes the step. */
const SMOOTHING_FRAMES = 3;
const SMOOTHING_TAU_MS = 120;
const WHOLE_BRAIN_COLOR = '#546e7a';
const SEGMENT_COLORS: Record<Condition, string> = { eo: '#f59e0b', ec: '#6366f1' };

/** Strongest voxel inside the mask that the kernel supports well; -1 when there is none. */
function strongestVoxel(values: Float32Array | null, mask: Uint8Array | null, low: boolean[]): number {
  if (!values) return -1;
  let peak = -1;
  for (let i = 0; i < values.length; i++) {
    if ((mask && !mask[i]) || low[i]) continue;
    if (peak < 0 || values[i] > values[peak]) peak = i;
  }
  return peak;
}

/**
 * Fixed scale for the time lapse: the 98th percentile of the frame peaks rather than the single
 * largest, so a handful of outlier windows saturate instead of washing every other frame out.
 */
function robustMax(maxima: Float32Array | null): number {
  if (!maxima) return 0;
  const v = Array.from(maxima).filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.floor(0.98 * (v.length - 1)))] : 0;
}

function maxIn(values: Float32Array | null, mask: Uint8Array | null): number {
  if (!values) return 0;
  let max = 0;
  for (let i = 0; i < values.length; i++) if ((!mask || mask[i]) && values[i] > max) max = values[i];
  return max;
}

export default function SloretaSection({ analysisId, sloreta }: { analysisId: string; sloreta: SloretaResults }) {
  const timeline = sloreta.timeline?.spectra_path ? sloreta.timeline : null;
  const [grid, setGrid] = useState<VoxelGridResponse | null>(null);
  const [all, setAll] = useState<Float32Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(timeline ? 'timelapse' : 'average');
  const [condition, setCondition] = useState<Condition>(sloreta.conditions.includes('ec') ? 'ec' : sloreta.conditions[0]);
  const [band, setBand] = useState<BandName>('alpha2');
  const [view, setView] = useState<View>('slices');
  const [networkIds, setNetworkIds] = useState<string[]>([]);
  const [crosshair, setCrosshair] = useState<[number, number, number]>([0, -20, 20]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [autoscale, setAutoscale] = useState(false);

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
  const networkMasks = useMemo(
    () => (grid ? networks.map((n) => ({ network: n, mask: networkMask(grid.coords_mni, [n]) })) : []),
    [grid, networks]
  );

  // ── condition average ──────────────────────────────────────────────────────
  const bandIndex = Math.max(0, sloreta.bands.findIndex((b) => b.name === band));
  const average = useMemo(() => {
    if (!all) return null;
    const ci = sloreta.conditions.indexOf(condition);
    const n = sloreta.voxel_count;
    const offset = (ci * sloreta.bands.length + bandIndex) * n;
    return all.subarray(offset, offset + n);
  }, [all, sloreta, condition, bandIndex]);
  // One scale per band across conditions, so EO and EC are directly comparable.
  const averageMax = Math.max(0, ...sloreta.conditions.map((c) => sloreta.stats[c]?.[band]?.max ?? 0));
  const averagePeak = useMemo(
    () => (grid ? strongestVoxel(average, mask, grid.low_sensitivity) : -1),
    [average, grid, mask]
  );

  // Re-centre the slices on the average map's peak when the band, condition or selection changes.
  useEffect(() => {
    if (grid && averagePeak >= 0) setCrosshair(grid.coords_mni[averagePeak] as [number, number, number]);
  }, [grid, averagePeak]);

  // ── time lapse ─────────────────────────────────────────────────────────────
  const nFrames = timeline?.n_windows ?? 0;
  const { frames, loaded, error: framesError } = useBandFrames({
    analysisId,
    band: mode === 'timelapse' && timeline ? band : null,
    nFrames,
    nVox: sloreta.voxel_count,
  });

  useEffect(() => {
    if (!playing || nFrames < 2) return undefined;
    const timer = setInterval(() => {
      setFrameIndex((i) => {
        const next = i + 1 >= nFrames ? 0 : i + 1;
        return next < loaded || loaded >= nFrames ? next : i; // wait for frames still loading
      });
    }, 1000 / (speed / (timeline?.hop_sec ?? 1)));
    return () => clearInterval(timer);
  }, [playing, nFrames, loaded, speed, timeline]);

  // Start on the first clean window: recordings often begin with a rejected stretch.
  useEffect(() => {
    if (!frames || playing || frameIndex !== 0 || isUsable(frames, 0)) return;
    for (let i = 1; i < frames.loaded; i++) {
      if (isUsable(frames, i)) {
        setFrameIndex(i);
        return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames, loaded]);

  const frameIdx = Math.min(frameIndex, Math.max(0, nFrames - 1));
  // True frame for the readout; smoothed frames only for what is drawn.
  const rawFrame = useMemo(
    () => (frames && loaded > frameIdx ? decodeFrame(frames, frameIdx) : null),
    [frames, loaded, frameIdx]
  );
  const target = useMemo(
    () => (frames && loaded > 0 ? meanFrames(frames, frameIdx, SMOOTHING_FRAMES) : null),
    [frames, loaded, frameIdx]
  );
  const smoothed = useSmoothedValues(mode === 'timelapse' ? target : null, SMOOTHING_TAU_MS);

  const summaries = useMemo(() => {
    if (!frames || mode !== 'timelapse') return null;
    const masks = networkMasks.length ? [...networkMasks.map((n) => n.mask), null] : [null];
    return frameSummaries(frames, masks, mask);
    // `loaded` stands in for the frames buffer being filled in place
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames, loaded, networkMasks, mask, mode]);

  const traces = useMemo<TransportTrace[]>(() => {
    if (!summaries) return [];
    const wholeBrain = summaries.means[summaries.means.length - 1];
    const whole = { id: 'whole-brain', label: 'Whole brain', color: WHOLE_BRAIN_COLOR, values: wholeBrain };
    if (!networkMasks.length) return [whole];
    return [
      ...networkMasks.map(({ network }, i) => ({ id: network.id, label: network.name, color: network.color, values: summaries.means[i] })),
      { ...whole, reference: true },
    ];
  }, [summaries, networkMasks]);

  const rejected = useMemo(
    () => (frames ? Array.from({ length: nFrames }, (_, i) => isRejected(frames, i)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frames, loaded, nFrames]
  );

  const segments = useMemo(
    () =>
      timeline
        ? (Object.entries(timeline.segments) as [Condition, { start: number; end: number }][]).map(([c, s]) => ({
            label: CONDITION_LABELS[c],
            from: Math.max(0, s.start / timeline.hop_sec),
            to: Math.min(nFrames - 1, (s.end - timeline.window_sec) / timeline.hop_sec),
            color: SEGMENT_COLORS[c],
          }))
        : [],
    [timeline, nFrames]
  );

  // ── what is drawn ──────────────────────────────────────────────────────────
  const timelapse = mode === 'timelapse' && !!timeline;
  const displayValues = timelapse ? smoothed ?? rawFrame : average;
  const scaleMax = timelapse
    ? autoscale
      ? maxIn(displayValues, mask)
      : robustMax(summaries?.maxima ?? null)
    : averageMax;
  const scale = useMemo(() => ({ min: 0, max: scaleMax > 0 ? scaleMax : 1 }), [scaleMax]);
  const readout = timelapse ? rawFrame : average;
  const peak = useMemo(
    () => (grid ? strongestVoxel(readout, mask, grid.low_sensitivity) : -1),
    [readout, grid, mask]
  );

  const cloudUpdate = useMemo(
    () => (displayValues && grid ? { values: displayValues, scale, mask, lowSensitivity: grid.low_sensitivity } : null),
    [displayValues, grid, scale, mask]
  );

  const toggleNetwork = (id: string) =>
    setNetworkIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const pill = (active: boolean) =>
    `rounded px-3 py-1 text-xs font-medium ${active ? 'bg-neuro-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`;

  const epochs = sloreta.conditions.map((c) => `${sloreta.epochs_used[c] ?? 0} ${c.toUpperCase()}`).join(' / ');
  const frameRejected = timelapse && frames ? isRejected(frames, frameIdx) : false;
  const loading = timelapse && loaded < nFrames;
  const loadError = error ?? (timelapse ? framesError : null);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
        <span className="mt-0.5 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">Beta</span>
        <p>
          Computed only from cleaned EEG: windows overlapping data the artifact pipeline rejected are marked and never
          localized; condition averages use {epochs} kept {sloreta.epoch_sec} s epochs. <strong>Template head model</strong>{' '}
          ({sloreta.head_model_id}), not this person&apos;s anatomy; skull thickness varies roughly two-fold between people.
          Values are <strong>dimensionless</strong> standardized current density, not µV, and not comparable to the
          band-power maps. Low localization error for a single source does not mean a sharp image, and simultaneous
          sources blur together. Region names are a coarse hemisphere × lobe partition. Not for clinical diagnosis.
          {sloreta.channels_interpolated.length > 0 &&
            ` Interpolated channels (${sloreta.channels_interpolated.join(', ')}) add no information; effective rank ${sloreta.effective_rank}.`}
          {sloreta.resampled_from_hz && ` Resampled from ${sloreta.resampled_from_hz} Hz to ${sloreta.design_sample_rate} Hz.`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        {timeline && (
          <div className="flex gap-1">
            <button type="button" className={pill(mode === 'timelapse')} onClick={() => setMode('timelapse')}>
              Animation over time
            </button>
            <button
              type="button"
              className={pill(mode === 'average')}
              onClick={() => {
                setMode('average');
                setPlaying(false);
              }}
            >
              Condition average
            </button>
          </div>
        )}
        {!timelapse && (
          <div className="flex gap-1">
            {sloreta.conditions.map((c) => (
              <button key={c} type="button" className={pill(condition === c)} onClick={() => setCondition(c)}>
                {CONDITION_LABELS[c]}
              </button>
            ))}
          </div>
        )}
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
        {timelapse && (
          <label className="flex items-center gap-1 text-xs text-gray-600">
            <input type="checkbox" checked={autoscale} onChange={(e) => setAutoscale(e.target.checked)} />
            Autoscale each frame
          </label>
        )}
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

      {loadError && <p className="text-sm text-red-600">Source localization could not be loaded: {loadError}</p>}
      {!loadError && (!grid || !voxelGrid || (!timelapse && !displayValues)) && (
        <p className="text-sm text-gray-500">Loading source maps…</p>
      )}

      {grid && voxelGrid && (timelapse || displayValues) && (
        <>
          {timelapse && (
            <div className="flex h-5 items-center gap-3 text-xs">
              {frameRejected && (
                <span className="rounded bg-red-100 px-2 py-0.5 font-medium text-red-700">
                  Window rejected as artifact — showing the neighbouring clean windows
                </span>
              )}
              {loading && (
                <span className="text-gray-500">
                  Computing frames… {Math.round((loaded / nFrames) * 100)}%
                </span>
              )}
            </div>
          )}

          {!displayValues || !cloudUpdate ? (
            <div
              className="flex w-full items-center justify-center rounded-lg text-sm text-gray-400"
              style={{ height: 320, background: '#0e1117' }}
            >
              {timelapse && frames && loaded > frameIdx ? 'Window rejected as artifact' : 'Loading frames…'}
            </div>
          ) : view === 'slices' ? (
            <SliceView
              grid={voxelGrid}
              values={displayValues}
              lowSensitivity={grid.low_sensitivity}
              mask={mask}
              scale={scale}
              crosshair={crosshair}
              onPick={setCrosshair}
            />
          ) : (
            <CloudView coordsMni={grid.coords_mni} update={cloudUpdate} />
          )}

          {timelapse && timeline && (
            <SloretaTransport
              frameCount={nFrames}
              frameIndex={frameIdx}
              playing={playing}
              speed={speed}
              speeds={SPEEDS}
              traces={traces}
              rejected={rejected}
              segments={segments}
              windowSec={timeline.window_sec}
              hopSec={timeline.hop_sec}
              onSeek={(i) => setFrameIndex(Math.max(0, Math.min(nFrames - 1, i)))}
              onTogglePlay={() => setPlaying((p) => !p)}
              onSpeed={setSpeed}
            />
          )}

          <div className="flex flex-col items-center gap-1 text-xs text-gray-600">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500">{formatSourceValue(scale.min)}</span>
              <div className="h-2.5 w-52 rounded-sm border border-gray-300" style={{ background: SLORETA_GRADIENT_CSS }} />
              <span className="text-[10px] text-gray-500">{formatSourceValue(scale.max)}</span>
              <span className="ml-1 text-[10px] text-gray-500">
                standardized current density (dimensionless){timelapse && !autoscale ? ', fixed across the recording (98th percentile of window peaks)' : ''}
              </span>
            </div>
            {peak >= 0 && readout ? (
              <span>
                Peak{networks.length ? ' in selection' : ''}{timelapse ? ' in this window' : ''}:{' '}
                <strong>{grid.labels[peak]}</strong> · MNI {grid.coords_mni[peak].map((v) => v + 0).join(', ')} mm ·{' '}
                {formatSourceValue(readout[peak])}
              </span>
            ) : (
              <span>{timelapse ? 'No peak: this window was rejected.' : 'No well-supported voxel in this selection.'}</span>
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
