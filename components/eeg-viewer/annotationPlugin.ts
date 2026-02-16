import type { Plugin, Chart } from 'chart.js';
import type { EEGAnnotation, AnnotationDragState } from './types';

interface AnnotationPluginOptions {
  annotations: EEGAnnotation[];
  dragState: AnnotationDragState;
}

export const annotationPlugin: Plugin<'line'> = {
  id: 'eegAnnotations',

  afterDraw(chart: Chart<'line'>) {
    const options = (chart.options.plugins as any)?.eegAnnotations as
      | AnnotationPluginOptions
      | undefined;
    if (!options) return;

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
    if (options.dragState.isDragging) {
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
