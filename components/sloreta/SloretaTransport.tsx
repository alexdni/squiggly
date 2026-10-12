'use client';

import { formatSourceValue } from './sloretaColor';

// Time-lapse transport: play / pause / scrub across the recording, with EO/EC segments shaded,
// rejected windows marked, and the selected networks' means drawn underneath so a rise and fall
// is visible without stepping frame by frame. Every trace is drawn against ONE shared maximum:
// normalising each to its own peak would make a network carrying a tenth of the power look
// identical to the dominant one.

const TRACK_HEIGHT = 40;

export type TransportTrace = {
  id: string;
  label: string;
  color: string;
  /** mean per frame, NaN where rejected or not loaded */
  values: Float32Array;
  /** drawn dashed: context for the network traces rather than a subject of the comparison */
  reference?: boolean;
};

export type SloretaTransportProps = {
  frameCount: number;
  frameIndex: number;
  playing: boolean;
  speed: number;
  speeds: number[];
  traces: TransportTrace[];
  rejected: boolean[];
  /** shaded spans, as frame indices */
  segments: { label: string; from: number; to: number; color: string }[];
  windowSec: number;
  hopSec: number;
  onSeek: (index: number) => void;
  onTogglePlay: () => void;
  onSpeed: (speed: number) => void;
};

const clock = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const seriesMax = (values: Float32Array) => values.reduce((m, v) => (Number.isFinite(v) && v > m ? v : m), 0);

/** Polyline points, broken into runs at missing values so gaps are not bridged. */
function runs(values: Float32Array, x: (i: number) => number, y: (v: number) => number): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  values.forEach((v, i) => {
    if (Number.isFinite(v)) cur.push(`${x(i)},${y(v)}`);
    else if (cur.length) {
      out.push(cur.join(' '));
      cur = [];
    }
  });
  if (cur.length) out.push(cur.join(' '));
  return out;
}

export default function SloretaTransport({
  frameCount,
  frameIndex,
  playing,
  speed,
  speeds,
  traces,
  rejected,
  segments,
  windowSec,
  hopSec,
  onSeek,
  onTogglePlay,
  onSpeed,
}: SloretaTransportProps) {
  if (frameCount < 2) return null;
  const max = traces.reduce((m, t) => Math.max(m, seriesMax(t.values)), 0);
  const x = (i: number) => (i / (frameCount - 1)) * 100;
  const y = (v: number) => TRACK_HEIGHT - (max > 0 ? v / max : 0) * (TRACK_HEIGHT - 2) - 1;
  const t0 = frameIndex * hopSec;
  const nRejected = rejected.filter(Boolean).length;

  return (
    <div className="w-full">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onTogglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-neuro-primary text-white hover:opacity-90"
        >
          {playing ? (
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
              <rect x="3" y="2" width="3.5" height="12" />
              <rect x="9.5" y="2" width="3.5" height="12" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
              <path d="M4 2l10 6-10 6z" />
            </svg>
          )}
        </button>
        <input
          type="range"
          min={0}
          max={frameCount - 1}
          step={1}
          value={frameIndex}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label="Window"
          className="flex-1 accent-indigo-600"
        />
        <span className="min-w-[110px] text-right text-xs tabular-nums text-gray-600">
          {clock(t0)}–{clock(t0 + windowSec)} / {clock((frameCount - 1) * hopSec + windowSec)}
        </span>
        <select
          value={speed}
          onChange={(e) => onSpeed(Number(e.target.value))}
          className="rounded border border-gray-300 px-1 py-0.5 text-xs"
          aria-label="Playback speed"
        >
          {speeds.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </div>

      <svg
        viewBox={`0 0 100 ${TRACK_HEIGHT}`}
        preserveAspectRatio="none"
        className="mt-1 block w-full rounded bg-gray-50"
        style={{ height: TRACK_HEIGHT }}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onSeek(Math.round(((e.clientX - r.left) / r.width) * (frameCount - 1)));
        }}
      >
        {segments.map((s) => (
          <rect key={s.label} x={x(s.from)} y={0} width={Math.max(0, x(s.to) - x(s.from))} height={TRACK_HEIGHT} fill={s.color} opacity={0.12} />
        ))}
        {/* Windows the pipeline rejected: shown, not silently skipped. */}
        {rejected.map((bad, i) =>
          bad ? <rect key={i} x={x(i) - 0.15} y={0} width={0.3 + 100 / frameCount} height={TRACK_HEIGHT} fill="#dc2626" opacity={0.3} /> : null
        )}
        {traces.map((trace) =>
          runs(trace.values, x, y).map((points, k) => (
            <polyline
              key={`${trace.id}-${k}`}
              points={points}
              fill="none"
              stroke={trace.color}
              strokeWidth={1.25}
              strokeDasharray={trace.reference ? '3 3' : undefined}
              opacity={trace.reference ? 0.6 : 1}
              vectorEffect="non-scaling-stroke"
            />
          ))
        )}
        <line x1={x(frameIndex)} x2={x(frameIndex)} y1={0} y2={TRACK_HEIGHT} stroke="#ea580c" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
        {segments.map((s) => (
          <span key={s.label} className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded-sm" style={{ background: s.color, opacity: 0.35 }} />
            {s.label}
          </span>
        ))}
        {traces.map((trace) => (
          <span key={trace.id} className="flex items-center gap-1">
            <span
              className="inline-block w-3"
              style={{ borderTop: `2px ${trace.reference ? 'dashed' : 'solid'} ${trace.color}` }}
            />
            {trace.label} · peak {formatSourceValue(seriesMax(trace.values))}
          </span>
        ))}
        {nRejected > 0 && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded-sm bg-red-600 opacity-40" />
            {nRejected} of {frameCount} windows rejected as artifact
          </span>
        )}
      </div>
    </div>
  );
}
