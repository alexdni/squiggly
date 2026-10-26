'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  /**
   * Analyses with a spectrograms file: its channels (recording order) and the analysis to fetch
   * them from. Without it, only the channels stored inline (five on older analyses) are offered.
   */
  channels?: string[];
  analysisId?: string;
}

type PerCondition = Partial<Record<Condition, SpectrogramData | null>>;

/**
 * Spectrograms for the first channel, plus any the user adds one at a time. Channels outside the
 * inline results are fetched from /api/analyses/[id]/spectrograms.
 */
export default function SpectrogramGrid({ spectrograms, condition, channels, analysisId }: SpectrogramGridProps) {
  const conditions = (condition ? [condition] : CONDITIONS).filter(
    (c) => spectrograms?.[c] && Object.keys(spectrograms[c]!).length > 0
  );
  const inlineChannels = useMemo(
    () => orderChannels([...new Set(CONDITIONS.flatMap((c) => Object.keys(spectrograms?.[c] ?? {})))], SPECTROGRAM_CHANNELS),
    [spectrograms]
  );
  const available = channels?.length && analysisId ? channels : inlineChannels;
  const [selected, setSelected] = useState<string[]>(() => (available[0] ? [available[0]] : []));
  const [fetched, setFetched] = useState<Record<string, PerCondition | 'loading' | { error: string }>>({});

  const dataFor = (ch: string, c: Condition): SpectrogramData | null | undefined => {
    const inline = spectrograms?.[c]?.[ch];
    if (inline) return inline;
    const f = fetched[ch];
    return f && f !== 'loading' && !('error' in f) ? (f as PerCondition)[c] ?? null : undefined;
  };

  const add = async (ch: string) => {
    if (!ch || selected.includes(ch)) return;
    setSelected((prev) => [...prev, ch]);
    if (inlineChannels.includes(ch) || !analysisId || fetched[ch]) return;
    setFetched((prev) => ({ ...prev, [ch]: 'loading' }));
    try {
      const res = await fetch(`/api/analyses/${analysisId}/spectrograms?channel=${encodeURIComponent(ch)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not load this channel');
      setFetched((prev) => ({ ...prev, [ch]: body as PerCondition }));
    } catch (e) {
      setFetched((prev) => ({ ...prev, [ch]: { error: (e as Error).message } }));
    }
  };

  if (conditions.length === 0) {
    return <p className="text-sm text-gray-600">No spectrogram data available.</p>;
  }
  const addable = available.filter((ch) => !selected.includes(ch));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {selected.map((ch) => (
          <span key={ch} className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-gray-50 px-3 py-1 text-sm text-gray-900">
            {ch}
            {selected.length > 1 && (
              <button
                onClick={() => setSelected((prev) => prev.filter((x) => x !== ch))}
                className="ml-1 text-gray-500 hover:text-gray-900"
                aria-label={`Remove ${ch}`}
                title={`Remove ${ch}`}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {addable.length > 0 && (
          <select
            value=""
            onChange={(e) => add(e.target.value)}
            aria-label="Add a channel"
            className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
          >
            <option value="">+ Add channel</option>
            {addable.map((ch) => (
              <option key={ch} value={ch}>
                {ch}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="grid grid-cols-1 gap-6">
        {conditions.map((c) => (
          <section key={c} className="border border-gray-200 rounded-lg p-4" aria-label={`Spectrograms, ${CONDITION_LABELS[c]}`}>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">{CONDITION_LABELS[c]}</h3>
            <div className="space-y-4">
              {selected.map((ch) => {
                const d = dataFor(ch, c);
                const f = fetched[ch];
                return (
                  <div key={ch}>
                    <div className="text-sm font-medium text-gray-900 mb-1">{ch}</div>
                    {d ? (
                      <Spectrogram data={d} label={`${ch} spectrogram, ${CONDITION_LABELS[c]}`} />
                    ) : f === 'loading' ? (
                      <p className="text-sm text-gray-600">Loading…</p>
                    ) : f && typeof f === 'object' && 'error' in f ? (
                      <p className="text-sm text-red-700">{(f as { error: string }).error}</p>
                    ) : (
                      <p className="text-sm text-gray-600">No spectrogram for {ch} in this condition.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
