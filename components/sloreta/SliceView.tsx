'use client';

import { useEffect, useRef } from 'react';
import { type Plane, sliceCells, sliceToImageData, snapToAxis, type VoxelGrid, voxelCell } from './sliceRender';

// View A: three orthogonal cuts through the volume with a crosshair. Cells are painted at grid
// resolution and scaled up with smoothing OFF: a 5 mm voxel is 5 mm of evidence, and
// interpolating it into a smooth blob would draw a spatial precision the method does not have.

/** Backing-store resolution of each panel; the panels themselves are fluid. */
const PANEL = 360;
const CROSSHAIR = '#5ec8ff';

export type SliceViewProps = {
  grid: VoxelGrid;
  values: Float32Array;
  lowSensitivity: boolean[];
  mask: Uint8Array | null;
  scale: { min: number; max: number };
  /** MNI mm the crosshair sits at. */
  crosshair: [number, number, number];
  onPick?: (mni: [number, number, number]) => void;
};

const PLANES: { plane: Plane; label: string; axis: 'x' | 'y' | 'z' }[] = [
  { plane: 'axial', label: 'Axial', axis: 'z' },
  { plane: 'coronal', label: 'Coronal', axis: 'y' },
  { plane: 'sagittal', label: 'Sagittal', axis: 'x' },
];

/** Neurological convention: the subject's left is on the viewer's left. */
const SIDE_LABELS: Partial<Record<Plane, [string, string]>> = {
  axial: ['L', 'R'],
  coronal: ['L', 'R'],
};

function SlicePanel({
  grid,
  values,
  lowSensitivity,
  mask,
  scale,
  crosshair,
  plane,
  label,
  axis,
  onPick,
}: SliceViewProps & { plane: Plane; label: string; axis: 'x' | 'y' | 'z' }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coord = crosshair[axis === 'x' ? 0 : axis === 'y' ? 1 : 2];

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const cells = sliceCells({ grid, values, lowSensitivity, mask, plane, coord });
    if (!cells.cols || !cells.rows) return;

    // Paint at cell resolution first, then blit up unsmoothed.
    const source = document.createElement('canvas');
    source.width = cells.cols;
    source.height = cells.rows;
    source.getContext('2d')!.putImageData(sliceToImageData(cells, scale), 0, 0);

    const fit = Math.min(PANEL / cells.cols, PANEL / cells.rows);
    const w = cells.cols * fit;
    const h = cells.rows * fit;
    const ox = (PANEL - w) / 2;
    const oy = (PANEL - h) / 2;

    ctx.fillStyle = '#0e1117';
    ctx.fillRect(0, 0, PANEL, PANEL);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, ox, oy, w, h);

    const at = voxelCell(grid, plane, crosshair);
    if (at) {
      const cx = ox + (at.col + 0.5) * fit;
      const cy = oy + (at.row + 0.5) * fit;
      ctx.strokeStyle = CROSSHAIR;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, oy);
      ctx.lineTo(cx, oy + h);
      ctx.moveTo(ox, cy);
      ctx.lineTo(ox + w, cy);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const sides = SIDE_LABELS[plane];
    if (sides) {
      ctx.fillStyle = '#7c8a9c';
      ctx.font = '10px sans-serif';
      ctx.fillText(sides[0], ox + 3, PANEL - 6);
      ctx.fillText(sides[1], ox + w - 10, PANEL - 6);
    }
  }, [grid, values, lowSensitivity, mask, scale, crosshair, plane, coord]);

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!onPick || !canvas) return;

    const cells = sliceCells({ grid, values, lowSensitivity, mask, plane, coord });
    const fit = Math.min(PANEL / cells.cols, PANEL / cells.rows);
    const rect = canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * PANEL - (PANEL - cells.cols * fit) / 2;
    const py = ((event.clientY - rect.top) / rect.height) * PANEL - (PANEL - cells.rows * fit) / 2;
    const col = Math.floor(px / fit);
    const row = Math.floor(py / fit);
    if (col < 0 || row < 0 || col >= cells.cols || row >= cells.rows) return;

    // Row 0 is the top of the image and both row axes increase upward.
    const colAxis = plane === 'sagittal' ? grid.ys : grid.xs;
    const rowAxis = plane === 'axial' ? grid.ys : grid.zs;
    const colValue = colAxis[col];
    const rowValue = rowAxis[rowAxis.length - 1 - row];

    const next: [number, number, number] = [...crosshair];
    if (plane === 'axial') {
      next[0] = colValue;
      next[1] = rowValue;
    } else if (plane === 'coronal') {
      next[0] = colValue;
      next[2] = rowValue;
    } else {
      next[1] = colValue;
      next[2] = rowValue;
    }
    onPick(next);
  };

  const fixedAxis = plane === 'axial' ? grid.zs : plane === 'coronal' ? grid.ys : grid.xs;
  return (
    <div className="flex flex-1 min-w-0 flex-col items-center gap-1">
      <canvas
        ref={canvasRef}
        width={PANEL}
        height={PANEL}
        onClick={handleClick}
        className="w-full h-auto rounded border border-slate-700"
        // CSS interpolation of the upscale would put the false spatial precision back.
        style={{ imageRendering: 'pixelated', cursor: onPick ? 'crosshair' : 'default' }}
      />
      <span className="text-[11px] text-gray-500">
        {label} · {axis} = {snapToAxis(fixedAxis, coord)} mm
      </span>
    </div>
  );
}

export default function SliceView(props: SliceViewProps) {
  return (
    <div className="flex w-full items-start gap-3">
      {PLANES.map((p) => (
        <SlicePanel key={p.plane} {...props} {...p} />
      ))}
    </div>
  );
}
