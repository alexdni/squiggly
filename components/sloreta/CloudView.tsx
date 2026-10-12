'use client';

import { useEffect, useRef, useState } from 'react';
import { type BrainScene, type BrainView, createBrainScene } from './brainScene';
import { createVoxelCloud, type VoxelCloud, type VoxelCloudUpdate } from './voxelCloud';

// View B: the voxel cloud inside the fsaverage cortex mesh. The mesh is an orientation backdrop;
// positions are read off the slice view, which works in MNI millimetres directly.

const BRAIN_MODEL_URL = '/models/brain.glb';

const VIEWS: [BrainView, string][] = [
  ['left', 'Left'],
  ['right', 'Right'],
  ['top', 'Top'],
  ['front', 'Front'],
];

export default function CloudView({ coordsMni, update }: { coordsMni: number[][]; update: VoxelCloudUpdate }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<BrainScene | null>(null);
  const cloudRef = useRef<VoxelCloud | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<BrainView>('left');

  // Rebuild only when the voxel grid itself changes, i.e. a different kernel.
  useEffect(() => {
    let alive = true;
    const el = containerRef.current;
    if (!el || !coordsMni.length) return undefined;

    createBrainScene(el, BRAIN_MODEL_URL).then((scene) => {
      if (!alive) {
        scene.dispose();
        return;
      }
      sceneRef.current = scene;
      cloudRef.current = createVoxelCloud(scene, coordsMni);
      scene.setView('left');
      setReady(true);
    });

    return () => {
      alive = false;
      setReady(false);
      cloudRef.current?.dispose();
      cloudRef.current = null;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [coordsMni]);

  useEffect(() => {
    if (ready) cloudRef.current?.update(update);
  }, [ready, update]);

  useEffect(() => {
    sceneRef.current?.setView(view);
  }, [view]);

  // The canvas is fluid, so the renderer and camera aspect follow the container.
  useEffect(() => {
    const el = containerRef.current;
    if (!ready || !el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth && el.clientHeight) sceneRef.current?.resize(el.clientWidth, el.clientHeight);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ready]);

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <div className="flex gap-1">
        {VIEWS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setView(value)}
            className={`rounded px-3 py-1 text-xs font-medium ${
              view === value ? 'bg-neuro-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        ref={containerRef}
        className="w-full rounded-lg border border-gray-300 cursor-grab"
        style={{ height: 520, background: '#0e1117' }}
      />
      <span className="text-[11px] text-gray-500">
        Drag to orbit. Voxel size and colour both carry magnitude; weakly-supported deep voxels are drawn smaller.
      </span>
    </div>
  );
}
