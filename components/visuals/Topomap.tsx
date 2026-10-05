'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cssGradient, formatTick, type Colormap, type Scale } from './topo';
import { CANVAS_SIZE, drawTopo, qeegSequential, toTopoElectrodes } from './topoRender';

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

/**
 * Min — gradient — max strip under a map, as DivergenceWebapp's TopoMap/BinLegend. `gradient` is
 * a CSS background (the hard-stop band legend for band power, a sampled ramp otherwise).
 */
export function MapLegend({
  vmin,
  vmax,
  gradient,
  format,
  unit = '',
  maxWidth = CANVAS_SIZE,
}: {
  vmin: number;
  vmax: number;
  gradient: string;
  format: (v: number) => string;
  unit?: string;
  maxWidth?: number;
}) {
  return (
    <div className="flex items-center w-full" style={{ maxWidth, marginTop: 3, gap: 4 }}>
      <span className="whitespace-nowrap" style={{ fontSize: 9, color: '#333' }}>
        {format(vmin)}
        {unit}
      </span>
      <div
        aria-hidden="true"
        style={{ flex: 1, height: 8, borderRadius: 1, background: gradient, border: '1px solid #bbb' }}
      />
      <span className="whitespace-nowrap" style={{ fontSize: 9, color: '#333' }}>
        {format(vmax)}
        {unit}
      </span>
    </div>
  );
}

export interface TopomapProps {
  values: Record<string, number>;
  /** Shared vMin/vMax; defaults to the min/max of this map's own values. */
  scale?: Scale | null;
  colormap?: Colormap;
  /** Accessible description of the map. */
  ariaLabel: string;
  /** Bold caption above the map. */
  label?: string;
  /** Small grey line under the caption. */
  sublabel?: string;
  /** Legend under the map; omit to hide it. */
  legend?: { format: (v: number) => string; unit?: string; gradient?: string };
  /** Maximum rendered width in CSS px; the map shrinks with its container. */
  maxSize?: number;
}

/**
 * One scalp map laid out as DivergenceWebapp's TopoMap: caption, sublabel, canvas (drawn by the
 * ported `drawTopo`) and a min–max legend.
 */
export default function Topomap({
  values,
  scale,
  colormap = qeegSequential,
  ariaLabel,
  label,
  sublabel,
  legend,
  maxSize = CANVAS_SIZE,
}: TopomapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const electrodes = useMemo(() => toTopoElectrodes(values), [values]);
  const vmin = scale?.vmin ?? Math.min(...electrodes.map((e) => e.value));
  const vmax = scale?.vmax ?? Math.max(...electrodes.map((e) => e.value));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !electrodes.length) return;
    // backing store at device resolution; drawTopo scales its pixel constants to match
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.round(maxSize * dpr);
    canvas.width = size;
    canvas.height = size;
    drawTopo(canvas, electrodes, vmin, vmax, colormap);
  }, [electrodes, vmin, vmax, colormap, maxSize]);

  return (
    <div className="flex flex-col items-center">
      {label !== undefined && <span className="text-xs font-semibold leading-snug">{label}</span>}
      {(label !== undefined || sublabel !== undefined) && (
        <span style={{ marginBottom: 2, fontSize: 9, color: '#888', minHeight: 12 }}>{sublabel ?? ''}</span>
      )}
      {electrodes.length ? (
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={ariaLabel}
          width={maxSize}
          height={maxSize}
          className="block"
          style={{ width: '100%', maxWidth: maxSize, borderRadius: 4 }}
        />
      ) : (
        <div
          role="img"
          aria-label={`${ariaLabel}: no data`}
          className="flex items-center justify-center text-xs text-gray-500 w-full aspect-square"
          style={{ maxWidth: maxSize }}
        >
          No data
        </div>
      )}
      {legend && electrodes.length > 0 && (
        <MapLegend
          vmin={vmin}
          vmax={vmax}
          gradient={legend.gradient ?? cssGradient(colormap)}
          format={legend.format}
          unit={legend.unit}
          maxWidth={maxSize}
        />
      )}
    </div>
  );
}

/** Horizontal HTML colour legend: gradient bar with min/max (and mid) labels. */
export function ColorLegend({
  scale,
  colormap,
  label,
  format = formatTick,
  className = '',
}: {
  scale: Scale | null | undefined;
  colormap: Colormap;
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
