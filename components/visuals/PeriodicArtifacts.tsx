'use client';

import type { AlphaPeak, Condition, PeriodicArtifact, PeriodicArtifacts } from '@/lib/analysis-results';
import { CONDITIONS, CONDITION_LABELS } from './data';

/** The analysis range; harmonics above it are listed only as a count. */
const MAX_HZ = 45;
/** An alpha peak this close to a line probably is the line */
const ON_LINE_HZ = 0.3;

const hz = (f: number) => `${f.toFixed(f < 10 ? 2 : 1)} Hz`;
const percent = (v: number) => `${Math.round(v * 100)}%`;

/** Channels whose alpha peak sits on one of the artifact's lines, per condition. */
export function alphaPeaksOnLines(
  artifact: PeriodicArtifact,
  alphaPeak: Partial<Record<Condition, AlphaPeak | null>> | null | undefined
): { condition: Condition; channels: string[] }[] {
  return CONDITIONS.flatMap((condition) => {
    const peaks = alphaPeak?.[condition];
    if (!peaks) return [];
    const channels = Object.entries(peaks)
      .filter(([, p]) => artifact.frequencies.some((f) => Math.abs(p.peak_frequency - f) <= ON_LINE_HZ))
      .map(([channel]) => channel);
    return channels.length ? [{ condition, channels }] : [];
  });
}

interface Props {
  periodic: PeriodicArtifacts;
  alphaPeak?: Partial<Record<Condition, AlphaPeak | null>> | null;
  /** re-runs the analysis with removal on or off; absent for viewers who can't edit */
  onSetRemoval?: (remove: boolean) => void;
  busy?: boolean;
  error?: string | null;
}

/** Periodic artifacts found in the raw EEG, and a way to remove them (or put them back). */
export default function PeriodicArtifactsCard({ periodic, alphaPeak, onSetRemoval, busy, error }: Props) {
  const { artifacts, removed } = periodic;
  if (!artifacts.length) return null;

  return (
    <div className="bg-white rounded-lg shadow-md p-6 mb-6" data-report-section="Periodic Artifacts">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
        <h2 className="text-2xl font-bold text-neuro-dark">Periodic Artifacts</h2>
        <span
          className={`text-xs font-medium px-2 py-1 rounded ${
            removed ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'
          }`}
        >
          {removed ? 'Removed before cleaning' : 'Not removed'}
        </span>
      </div>
      <p className="text-sm text-gray-800 mb-4">
        A device or environment source (a stimulator, pump, display or the amplifier&apos;s own packet clock) can put
        sharp lines at a fundamental frequency and its harmonics. They are not brain activity, and band power at
        those frequencies is inflated until they are removed. Removal subtracts each line only where it was found,
        so a rhythm at the same frequency keeps all but a ~0.25 Hz slice.
      </p>

      <div className="space-y-4">
        {artifacts.map((artifact) => {
          const inRange = artifact.frequencies
            .map((f, i) => ({ f, k: artifact.harmonics[i] }))
            .filter(({ f }) => f <= MAX_HZ);
          const above = artifact.frequencies.length - inRange.length;
          const onAlpha = alphaPeaksOnLines(artifact, alphaPeak);
          return (
            <div key={artifact.fundamental} className="border border-gray-200 rounded-lg p-4">
              <h3 className="text-base font-semibold text-gray-900">
                {hz(artifact.fundamental)} fundamental
              </h3>
              <p className="text-sm text-gray-800 mt-1">
                Lines at{' '}
                {inRange.length
                  ? inRange.map(({ f, k }) => `${hz(f)} (×${k})`).join(', ')
                  : `none below ${MAX_HZ} Hz`}
                {above > 0 && `, and ${above} above ${MAX_HZ} Hz`}
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2" aria-label="Channels with this artifact">
                {artifact.channels.map((c) => (
                  <span
                    key={c.label}
                    className="text-xs px-2 py-0.5 rounded border border-gray-300 bg-gray-50 text-gray-800"
                    title={`${c.label}: lines ×${c.harmonics.join(', ×')}, up to ${Math.max(...c.prominence_db)} dB above the background`}
                  >
                    {c.label} · {percent(c.coverage)} of the recording
                  </span>
                ))}
              </div>
              {onAlpha.length > 0 && !removed && (
                <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2 mt-3">
                  The alpha peak on{' '}
                  {onAlpha
                    .map(({ condition, channels }) => `${channels.join(', ')} (${CONDITION_LABELS[condition]})`)
                    .join('; ')}{' '}
                  sits on one of these lines, so it may be the artifact rather than alpha.
                </p>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <p className="text-sm text-red-800 mt-3" role="alert">
          {error}
        </p>
      )}
      {onSetRemoval && (
        <div className="mt-4 flex flex-wrap items-center gap-3" data-export-ignore>
          <button
            type="button"
            onClick={() => onSetRemoval(!removed)}
            disabled={busy}
            className={
              removed
                ? 'px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 disabled:opacity-50'
                : 'px-4 py-2 text-sm font-medium rounded-lg bg-neuro-primary text-white hover:bg-neuro-accent disabled:opacity-50'
            }
          >
            {busy ? 'Starting…' : removed ? 'Keep them and re-analyze' : 'Remove and re-analyze'}
          </button>
          <span className="text-xs text-gray-600">Re-runs the analysis with the current settings.</span>
        </div>
      )}
    </div>
  );
}
