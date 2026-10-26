'use client';

// Dialog for a recording's EO/EC labels: the whole file is eyes open or eyes closed, or it holds
// both as timed segments, or it is unlabelled (analyzed as eyes open). Saving stores the labels;
// the caller re-runs the analysis so every graph uses them.

import { useState } from 'react';
import {
  conditionFromFilename,
  labelsOf,
  labelsProblem,
  wholeFile,
  type ConditionLabels,
  type SegmentColumns,
} from '@/lib/eeg-condition';

export interface LabelledRecording extends SegmentColumns {
  id: string;
  filename: string;
  duration_seconds: number | null;
}

type Mode = 'EO' | 'EC' | 'BOTH' | 'NONE';

function modeOf(labels: ConditionLabels, duration: number | null): Mode {
  const whole = (s: { start: number; end: number }) => s.start < 0.5 && (duration === null || s.end >= duration - 1);
  if (labels.eo && labels.ec) return 'BOTH';
  if (labels.eo) return whole(labels.eo) ? 'EO' : 'BOTH';
  if (labels.ec) return whole(labels.ec) ? 'EC' : 'BOTH';
  return 'NONE';
}

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

export default function ConditionLabelEditor({
  recording,
  onSaved,
  onCancel,
}: {
  recording: LabelledRecording;
  /** called with the stored row after a successful save */
  onSaved: (updated: LabelledRecording & Record<string, unknown>) => void | Promise<void>;
  onCancel: () => void;
}) {
  const duration = recording.duration_seconds !== null ? Number(recording.duration_seconds) : null;
  const current = labelsOf(recording);
  const [mode, setMode] = useState<Mode>(modeOf(current, duration));
  const half = duration ? Math.round(duration / 2) : 0;
  const [eo, setEo] = useState({ start: current.eo?.start ?? 0, end: current.eo?.end ?? half });
  const [ec, setEc] = useState({ start: current.ec?.start ?? half, end: current.ec?.end ?? duration ?? 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suggested = conditionFromFilename(recording.filename);

  const labels = (): ConditionLabels => {
    if (mode === 'NONE') return { eo: null, ec: null };
    if (mode === 'BOTH') return { eo: { ...eo }, ec: { ...ec } };
    return wholeFile(mode, duration ?? 0);
  };
  const problem = mode === 'BOTH' ? labelsProblem(labels(), duration) : null;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/recordings/${recording.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ labels: labels() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save labels');
      await onSaved(data.recording);
    } catch (e: any) {
      setError(e.message);
      setSaving(false);
    }
  };

  const option = (value: Mode, title: string, hint: string) => (
    <label className="flex items-start gap-3 rounded-md border border-gray-200 p-3 cursor-pointer hover:bg-gray-50">
      <input type="radio" name="eoec" className="mt-1" checked={mode === value} onChange={() => setMode(value)} />
      <span>
        <span className="block text-sm font-medium text-gray-900">
          {title}
          {suggested === value && <span className="ml-2 text-xs font-normal text-neuro-primary">matches filename</span>}
        </span>
        <span className="block text-xs text-gray-600">{hint}</span>
      </span>
    </label>
  );

  const secondsInput = (label: string, value: number, onChange: (v: number) => void) => (
    <label className="flex flex-col text-xs text-gray-700">
      {label}
      <input
        type="number"
        min={0}
        max={duration ?? undefined}
        step={1}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-24 rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
      />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="eoec-title">
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
        <h2 id="eoec-title" className="text-lg font-semibold text-gray-900">
          EO/EC labels
        </h2>
        <p className="mt-1 truncate text-sm text-gray-700" title={recording.filename}>
          {recording.filename}
          {duration !== null && <span className="text-gray-500"> · {fmt(duration)}</span>}
        </p>

        <div className="mt-4 space-y-2">
          {option('EO', 'Eyes open (whole file)', 'The entire recording is eyes open.')}
          {option('EC', 'Eyes closed (whole file)', 'The entire recording is eyes closed.')}
          {option('BOTH', 'Both, by time', 'The file holds an eyes-open and an eyes-closed segment.')}
          {mode === 'BOTH' && (
            <div className="ml-8 space-y-2 rounded-md bg-gray-50 p-3">
              <div className="flex items-end gap-3">
                <span className="w-8 text-sm font-medium text-gray-900">EO</span>
                {secondsInput('start (s)', eo.start, (v) => setEo((p) => ({ ...p, start: v })))}
                {secondsInput('end (s)', eo.end, (v) => setEo((p) => ({ ...p, end: v })))}
              </div>
              <div className="flex items-end gap-3">
                <span className="w-8 text-sm font-medium text-gray-900">EC</span>
                {secondsInput('start (s)', ec.start, (v) => setEc((p) => ({ ...p, start: v })))}
                {secondsInput('end (s)', ec.end, (v) => setEc((p) => ({ ...p, end: v })))}
              </div>
              {problem && <p className="text-xs text-red-700">{problem}</p>}
            </div>
          )}
          {option('NONE', 'Not labeled', 'Analyzed as one eyes-open segment.')}
        </div>

        <p className="mt-4 text-xs text-gray-600">
          Saving re-runs the analysis, so every graph and report uses the new labels.
        </p>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onCancel} disabled={saving} className="rounded-md px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || Boolean(problem)}
            className="rounded-md bg-neuro-primary px-4 py-2 text-sm font-medium text-white hover:bg-neuro-accent disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save and re-analyze'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Re-runs the recording's latest analysis after a label change, when it has run before (completed
 * or failed). A pending analysis picks the labels up when it is started; a running one is left
 * alone. Returns the analysis id it started, or null.
 */
export async function reanalyzeAfterRelabel(recordingId: string): Promise<string | null> {
  const res = await fetch(`/api/recordings?recording_id=${recordingId}&include_analyses=true`);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const latest = data?.recordings?.[0]?.analyses?.[0] as { id: string; status: string } | undefined;
  if (!latest || (latest.status !== 'completed' && latest.status !== 'failed')) return null;
  const run = await fetch(`/api/analyses/${latest.id}/process`, { method: 'POST' });
  if (!run.ok) {
    const body = await run.json().catch(() => ({}));
    throw new Error(body.error || 'Labels saved, but the re-analysis did not start');
  }
  return latest.id;
}
