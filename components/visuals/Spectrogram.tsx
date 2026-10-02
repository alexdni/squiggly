'use client';

import { useEffect, useMemo, useRef } from 'react';
import { SPECTROGRAM_CHANNELS, type Condition, type SpectrogramData } from '@/lib/analysis-results';
import { drawColorbar, formatTick, jet, type Scale } from './topo';
import { useElementWidth } from './Topomap';
import { CONDITIONS, CONDITION_LABELS, orderChannels, spectrogramPixels, spectrogramScale } from './data';

const MARGIN = { left: 40, right: 74, top: 8, bottom: 30 };
const INK = '#374151';

function niceStep(span: number, target: number): number {
  const raw = span / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  return (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
}

function drawSpectrogram(canvas: HTMLCanvasElement, data: SpectrogramData, scale: Scale, cssW: number, cssH: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = canvas.width / cssW;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const plot = {
    x: MARGIN.left,
    y: MARGIN.top,
    w: cssW - MARGIN.left - MARGIN.right,
    h: cssH - MARGIN.top - MARGIN.bottom,
  };
  if (plot.w <= 10 || plot.h <= 10) return;

  const { width, height, pixels } = spectrogramPixels(data, scale, jet);
  if (width === 0 || height === 0) return;
  const off = document.createElement('canvas');
  off.width = width;
  off.height = height;
  const img = new ImageData(width, height);
  img.data.set(pixels);
  off.getContext('2d')?.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, plot.x, plot.y, plot.w, plot.h);
  ctx.strokeStyle = '#6b7280';
  ctx.lineWidth = 1;
  ctx.strokeRect(plot.x + 0.5, plot.y + 0.5, plot.w - 1, plot.h - 1);

  ctx.fillStyle = INK;
  ctx.font = '10px system-ui, sans-serif';

  // frequency axis (bins are centres; image spans first..last)
  const f0 = data.freqs[0];
  const f1 = data.freqs[data.freqs.length - 1];
  const fy = (f: number) => plot.y + plot.h * (1 - (f - f0) / (f1 - f0 || 1));
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const fStep = niceStep(f1 - f0, plot.h / 28);
  for (let f = Math.ceil(f0 / fStep) * fStep; f <= f1 + 1e-9; f += fStep) {
    const y = fy(f);
    ctx.fillRect(plot.x - 3, y, 3, 1);
    ctx.fillText(String(Math.round(f * 10) / 10), plot.x - 5, y);
  }
  ctx.save();
  ctx.translate(10, plot.y + plot.h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText('Frequency (Hz)', 0, 0);
  ctx.restore();

  // time axis
  const t0 = data.times[0];
  const t1 = data.times[data.times.length - 1];
  const tx = (t: number) => plot.x + plot.w * ((t - t0) / (t1 - t0 || 1));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const tStep = niceStep(t1 - t0, plot.w / 60);
  for (let t = Math.ceil(t0 / tStep) * tStep; t <= t1 + 1e-9; t += tStep) {
    const x = tx(t);
    ctx.fillRect(x, plot.y + plot.h, 1, 3);
    ctx.fillText(String(Math.round(t)), x, plot.y + plot.h + 4);
  }
  ctx.fillText('Time (s)', plot.x + plot.w / 2, plot.y + plot.h + 17);

  drawColorbar(ctx, { x: plot.x + plot.w + 8, y: plot.y, w: 10, h: plot.h }, jet, scale, {
    label: 'Power (dB)',
    format: (v) => v.toFixed(0),
    ink: INK,
    fontPx: 10,
  });
}

export interface SpectrogramProps {
  data: SpectrogramData;
  /** Accessible description, e.g. 'Fz spectrogram, Eyes Open'. */
  label: string;
  height?: number;
}

/** Time-frequency heatmap (jet, 5th–95th percentile dB) with axes and a colorbar. */
export function Spectrogram({ data, label, height = 180 }: SpectrogramProps) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scale = useMemo(() => spectrogramScale(data), [data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || !scale) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    drawSpectrogram(canvas, data, scale, width, height);
  }, [data, scale, width, height]);

  const hasData = data?.power_db?.length > 0 && data?.freqs?.length > 1;
  const desc = hasData && scale
    ? `${label}. ${data.times.length} time bins over ${formatTick(data.times[data.times.length - 1] - data.times[0])} s, ` +
      `${data.freqs[0]}–${data.freqs[data.freqs.length - 1]} Hz, colour scale ${scale.vmin.toFixed(0)} to ${scale.vmax.toFixed(0)} dB.`
    : `${label}: no data`;

  return (
    <div ref={wrapRef} className="w-full">
      {!hasData || !scale ? (
        <p className="text-sm text-gray-600">No spectrogram data.</p>
      ) : (
        width > 0 && (
          <canvas ref={canvasRef} role="img" aria-label={desc} style={{ width, height }} className="block" />
        )
      )}
    </div>
  );
}

export interface SpectrogramGridProps {
  spectrograms: Partial<Record<Condition, Record<string, SpectrogramData> | null>> | null | undefined;
  /** Only render this condition (otherwise every available one, each in its own block). */
  condition?: Condition;
}

/** One spectrogram per available channel (Fp1/Fz/Cz/Pz/O1 first) for each condition. */
export default function SpectrogramGrid({ spectrograms, condition }: SpectrogramGridProps) {
  const conditions = (condition ? [condition] : CONDITIONS).filter(
    (c) => spectrograms?.[c] && Object.keys(spectrograms[c]!).length > 0
  );
  if (conditions.length === 0) {
    return <p className="text-sm text-gray-600">No spectrogram data available.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-6">
      {conditions.map((c) => {
        const byChannel = spectrograms![c]!;
        const channels = orderChannels(Object.keys(byChannel), SPECTROGRAM_CHANNELS);
        return (
          <section key={c} className="border border-gray-200 rounded-lg p-4" aria-label={`Spectrograms, ${CONDITION_LABELS[c]}`}>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">{CONDITION_LABELS[c]}</h3>
            <div className="space-y-4">
              {channels.map((ch) => (
                <div key={ch}>
                  <div className="text-sm font-medium text-gray-900 mb-1">{ch}</div>
                  <Spectrogram data={byChannel[ch]} label={`${ch} spectrogram, ${CONDITION_LABELS[c]}`} />
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
