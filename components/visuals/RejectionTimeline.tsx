'use client';

// Per-channel artifact timeline (same drawing as the Divergence webapp's Measure QC card): one
// row per EEG channel plus a whole-recording row, with rejected spans shaded at their position
// over the recording. Bad channels are hatched. Canvas-drawn so it prints with the report.

import { useEffect, useRef } from 'react';
import type { RejectionTimeline as Timeline, TimeSpan } from '@/lib/analysis-results';

const LABEL_W = 48;
const ROW_H = 14;
const HEADER_H = 16;
const AXIS_H = 18;
const WIDTH = 900;

const REJECT_FILL = 'rgba(220, 53, 69, 0.75)';
const ALL_FILL = 'rgba(180, 20, 40, 0.85)';
const ROW_BG = '#f1f3f5';
const BAD_BG = '#dcdcdc';

const fmtClock = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

function drawSpans(
  ctx: CanvasRenderingContext2D,
  spans: TimeSpan[],
  y: number,
  h: number,
  t0: number,
  t1: number,
  fill: string
) {
  const scale = (WIDTH - LABEL_W) / Math.max(1e-9, t1 - t0);
  ctx.fillStyle = fill;
  for (const [start, end] of spans) {
    const x0 = LABEL_W + (Math.max(start, t0) - t0) * scale;
    const x1 = LABEL_W + (Math.min(end, t1) - t0) * scale;
    ctx.fillRect(x0, y, Math.max(1, x1 - x0), h);
  }
}

function hatch(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  for (let i = -h; i < w + h; i += 6) {
    ctx.beginPath();
    ctx.moveTo(x + i, y);
    ctx.lineTo(x + i + h, y + h);
    ctx.stroke();
  }
  ctx.restore();
}

/** Axis tick spacing in seconds for a recording of `duration` seconds. */
export function tickSeconds(duration: number): number {
  return duration > 600 ? 120 : duration > 180 ? 60 : 30;
}

export function drawRejectionTimeline(canvas: HTMLCanvasElement, timeline: Timeline) {
  const labels = timeline.labels;
  const rows = labels.length + 1;
  canvas.width = WIDTH;
  canvas.height = HEADER_H + rows * ROW_H + AXIS_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const t0 = 0;
  const t1 = timeline.duration_sec;
  const bad = new Set(timeline.bad_channels.map((b) => b.label));

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '10px sans-serif';
  ctx.textBaseline = 'middle';

  // whole-recording row
  let y = HEADER_H;
  ctx.fillStyle = ROW_BG;
  ctx.fillRect(LABEL_W, y, WIDTH - LABEL_W, ROW_H - 2);
  ctx.fillStyle = '#222';
  ctx.textAlign = 'right';
  ctx.fillText('All', LABEL_W - 6, y + ROW_H / 2 - 1);
  drawSpans(ctx, timeline.spans, y, ROW_H - 2, t0, t1, ALL_FILL);

  labels.forEach((label, i) => {
    y = HEADER_H + (i + 1) * ROW_H;
    const isBad = bad.has(label);
    ctx.fillStyle = isBad ? BAD_BG : ROW_BG;
    ctx.fillRect(LABEL_W, y, WIDTH - LABEL_W, ROW_H - 2);
    if (isBad) hatch(ctx, LABEL_W, y, WIDTH - LABEL_W, ROW_H - 2);
    ctx.fillStyle = isBad ? '#888' : '#222';
    ctx.textAlign = 'right';
    ctx.fillText(label, LABEL_W - 6, y + ROW_H / 2 - 1);
    if (!isBad) drawSpans(ctx, timeline.channel_spans[label] ?? [], y, ROW_H - 2, t0, t1, REJECT_FILL);
  });

  // time axis
  const axisY = HEADER_H + rows * ROW_H + 4;
  ctx.strokeStyle = '#999';
  ctx.beginPath();
  ctx.moveTo(LABEL_W, axisY);
  ctx.lineTo(WIDTH, axisY);
  ctx.stroke();
  const duration = t1 - t0;
  const tick = tickSeconds(duration);
  ctx.fillStyle = '#555';
  ctx.textAlign = 'center';
  for (let t = 0; t <= duration; t += tick) {
    const x = LABEL_W + (t / Math.max(1e-9, duration)) * (WIDTH - LABEL_W);
    ctx.beginPath();
    ctx.moveTo(x, axisY);
    ctx.lineTo(x, axisY + 4);
    ctx.stroke();
    ctx.fillText(fmtClock(t), Math.min(WIDTH - 14, Math.max(LABEL_W + 14, x)), axisY + 11);
  }
}

/** Seconds of the recording rejected by the whole-recording decision. */
export function rejectedSeconds(spans: TimeSpan[]): number {
  return spans.reduce((sum, [s, e]) => sum + Math.max(0, e - s), 0);
}

export default function RejectionTimeline({ timeline }: { timeline: Timeline }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (ref.current) drawRejectionTimeline(ref.current, timeline);
  }, [timeline]);

  const rejected = rejectedSeconds(timeline.spans);
  const pct = timeline.duration_sec > 0 ? (100 * rejected) / timeline.duration_sec : 0;

  return (
    <div className="mt-4 pt-4 border-t border-gray-200">
      <h4 className="text-sm font-semibold text-gray-900">Rejected artifacts over time</h4>
      <p className="text-xs text-gray-600 mb-2">
        Red = rejected data ({rejected.toFixed(1)} s, {pct.toFixed(1)}% of the recording). Top row:
        whole-recording decision used for the metrics; channel rows: per-channel decision. Hatched =
        bad channel. Spans begin where the 5 s peak-to-peak gate tripped, i.e. at an artifact&apos;s
        peak, so a blink&apos;s rising edge sits just before its span.
      </p>
      <div className="overflow-x-auto">
        <canvas
          ref={ref}
          className="w-full min-w-[600px] block"
          role="img"
          aria-label={`Rejected data timeline: ${timeline.spans.length} rejected spans over ${fmtClock(timeline.duration_sec)}`}
        />
      </div>
    </div>
  );
}
