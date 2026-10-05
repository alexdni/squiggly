'use client';

import { useEffect, useRef, useState } from 'react';
import { blueRed, cssGradient, formatTick, type Colormap, type Scale, drawTopomap } from './topo';

/** Tracks an element's content width (CSS px) with a ResizeObserver. */
export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      setWidth((prev) => (prev === w ? prev : w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export interface TopomapProps {
  values: Record<string, number>;
  /** Fixed scale; defaults to the 2nd–98th percentile of `values`. */
  scale?: Scale | null;
  colormap?: Colormap;
  /** Accessible description of the map. */
  label: string;
  /** Maximum rendered width in CSS px; the map shrinks with its container. */
  maxSize?: number;
  contours?: number;
  showSensors?: boolean;
  showLabels?: boolean;
  /** Draw a vertical colorbar inside the canvas. */
  colorbar?: { label?: string; format?: (v: number) => string };
  className?: string;
}

/** Responsive square scalp map drawn on a canvas. */
export default function Topomap({
  values,
  scale,
  colormap = blueRed,
  label,
  maxSize = 320,
  contours = 4,
  showSensors = true,
  showLabels = false,
  colorbar,
  className = '',
}: TopomapProps) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cssW = Math.min(width, maxSize);

  const hasColorbar = Boolean(colorbar);
  const colorbarLabel = colorbar?.label;
  const colorbarFormat = colorbar?.format;
  const cssH = hasColorbar ? Math.round(cssW * 0.78) : cssW;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || cssW <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    drawTopomap(canvas, values, {
      scale,
      colormap,
      contours,
      showSensors,
      showLabels,
      colorbar: hasColorbar ? { label: colorbarLabel, format: colorbarFormat } : false,
    });
  }, [values, scale, colormap, contours, showSensors, showLabels, hasColorbar, colorbarLabel, colorbarFormat, cssW, cssH]);

  return (
    <div ref={wrapRef} className={`w-full ${className}`}>
      {cssW > 0 && (
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={label}
          style={{ width: cssW, height: cssH }}
          className="block mx-auto"
        />
      )}
    </div>
  );
}

/** Horizontal HTML colour legend: gradient bar with min/max (and mid) labels. */
export function ColorLegend({
  scale,
  colormap = blueRed,
  label,
  format = formatTick,
  className = '',
}: {
  scale: Scale | null | undefined;
  colormap?: Colormap;
  label?: string;
  format?: (v: number) => string;
  className?: string;
}) {
  if (!scale) return null;
  const mid = (scale.vmin + scale.vmax) / 2;
  return (
    <div className={`w-full ${className}`}>
      <div
        className="h-2.5 w-full rounded-sm border border-gray-300"
        style={{ background: cssGradient(colormap) }}
        aria-hidden="true"
      />
      <div className="flex justify-between text-[10px] leading-tight text-gray-700 mt-0.5 font-mono">
        <span>{format(scale.vmin)}</span>
        <span>{format(mid)}</span>
        <span>{format(scale.vmax)}</span>
      </div>
      {label && <div className="text-[10px] text-gray-600 text-center">{label}</div>}
    </div>
  );
}
