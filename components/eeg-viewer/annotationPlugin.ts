import type { Plugin, Chart } from 'chart.js';
import type { EEGAnnotation, AnnotationDragState } from './types';

interface AnnotationPluginOptions {
  annotations: EEGAnnotation[];
  dragState: AnnotationDragState;
}

const DEFAULT_DETECTED_RGB = '124, 58, 237';
const LANE_PX = 10;
const LANE_GAP_PX = 1;

/** Event-track lane under a point `px` pixels above the plot's bottom edge, or null above the track. */
export function detectedLaneAt(px: number, nLanes: number): number | null {
  if (px < 0) return null;
  const lane = Math.floor(px / (LANE_PX + LANE_GAP_PX));
  return lane < nLanes ? lane : null;
}

/**
 * Detected-event band: a bar in its pattern's lane of the event track along the bottom of the
 * plot, labelled inside when wide enough. Only the selected band also tints the traces, so many
 * overlapping events do not wash out the signal or the red rejected-epoch shading.
 */
function drawDetectedBand(
  ctx: CanvasRenderingContext2D,
  annotation: EEGAnnotation,
  left: number,
  right: number,
  area: { top: number; bottom: number }
) {
  const rgb = annotation.color || DEFAULT_DETECTED_RGB;
  const width = Math.max(right - left, 2);
  const lane = annotation.lane ?? 0;
  const y = area.bottom - (lane + 1) * (LANE_PX + LANE_GAP_PX);
  ctx.save();
  if (annotation.highlighted) {
    ctx.fillStyle = `rgba(${rgb}, 0.12)`;
    ctx.fillRect(left, area.top, width, area.bottom - area.top);
    ctx.strokeStyle = `rgba(${rgb}, 0.9)`;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(left + 0.75, area.top + 0.75, width - 1.5, area.bottom - area.top - 1.5);
  }
  ctx.fillStyle = `rgba(${rgb}, ${annotation.highlighted ? 0.95 : 0.6})`;
  ctx.fillRect(left, y, width, LANE_PX);
  const label = annotation.description;
  if (label) {
    ctx.font = 'bold 9px sans-serif';
    if (ctx.measureText(label).width + 6 <= width) {
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, left + 3, y + LANE_PX / 2 + 0.5);
    }
  }
  ctx.restore();
}

export const annotationPlugin: Plugin<'line'> = {
  id: 'eegAnnotations',

  afterDraw(chart: Chart<'line'>) {
    const options = (chart.options.plugins as any)?.eegAnnotations as
      | AnnotationPluginOptions
      | undefined;
    // Registered globally (ChartJS.register), so it also runs on unrelated charts such as the
    // network-metric bars; Chart.js hands those an empty options object.
    if (!options || !Array.isArray(options.annotations)) return;

    const { ctx } = chart;
    const xScale = chart.scales.x;
    const chartArea = chart.chartArea;

    if (!xScale || !chartArea) return;

    // Draw all annotations (manual + rejected) as overlays
    for (const annotation of options.annotations) {
      const x1 = xScale.getPixelForValue(annotation.startTime);
      const x2 = xScale.getPixelForValue(annotation.endTime);

      const left = Math.max(Math.min(x1, x2), chartArea.left);
      const right = Math.min(Math.max(x1, x2), chartArea.right);

      if (right <= chartArea.left || left >= chartArea.right) continue;

      if (annotation.type === 'detected') {
        drawDetectedBand(ctx, annotation, left, right, chartArea);
        continue;
      }

      const isRejected = annotation.type === 'rejected';

      ctx.save();
      // Rejected epochs: red tint; manual annotations: yellow
      ctx.fillStyle = isRejected
        ? 'rgba(239, 68, 68, 0.18)'
        : 'rgba(234, 179, 8, 0.25)';
      ctx.fillRect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top);

      // Draw label at the top
      ctx.fillStyle = isRejected
        ? 'rgba(185, 28, 28, 0.85)'
        : 'rgba(161, 98, 7, 0.8)';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      const labelX = (left + right) / 2;
      ctx.fillText(
        annotation.description || annotation.type,
        labelX,
        chartArea.top + 12
      );
      ctx.restore();
    }

    // Draw active drag selection
    if (options.dragState?.isDragging) {
      const x1 = options.dragState.startX;
      const x2 = options.dragState.endX;

      const left = Math.min(x1, x2);
      const right = Math.max(x1, x2);

      ctx.save();
      ctx.fillStyle = 'rgba(234, 179, 8, 0.15)';
      ctx.fillRect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top);

      ctx.strokeStyle = 'rgba(234, 179, 8, 0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 2]);
      ctx.strokeRect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top);
      ctx.restore();
    }
  },
};
