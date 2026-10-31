// Periodic artifacts: a device or environment source (a stimulator, a pump, a display, packetization)
// that puts sharp lines at a fundamental and its harmonics. Detection is biofeedback-core's harmonic
// comb, run on every analysis so the results can show what was found; the lines are subtracted from
// the raw EEG, before cleaning, only when preprocessing.remove_periodic_artifacts is on.

import {
  detectRecordingLineArtifacts,
  removeLineArtifacts,
  type LineArtifact,
} from '@divergentneuro/biofeedback-core';
import type { PeriodicArtifact } from '@/lib/analysis-results';
import type { LoadedEeg } from '../io/loadRecording';

/** Channels' artifacts with fundamentals within this fraction are the same source */
const SAME_SOURCE = 0.015;

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const round = (v: number, digits: number) => Number(v.toFixed(digits));

/**
 * Each channel's periodic artifacts. `notched` is the EEG with mains notched, so hum and its
 * harmonics are not reported (they are notched anyway).
 */
export function detectPeriodicArtifacts(notched: Float64Array[], sampleRate: number, lineHz: number): LineArtifact[][] {
  const mains = Array.from({ length: Math.floor(sampleRate / 2 / lineHz) }, (_, i) => (i + 1) * lineHz);
  return detectRecordingLineArtifacts(notched, sampleRate, { ignore: mains });
}

/**
 * The EEG with each channel's artifacts subtracted where they were found. Every harmonic the source
 * has on any channel is removed on each channel it was found on: after the average reference a
 * line left on one channel would leak into all of them.
 */
export function removePeriodicArtifacts(
  eeg: LoadedEeg,
  found: LineArtifact[][],
  sources: PeriodicArtifact[]
): Float64Array[] {
  return eeg.data.map((d, i) => {
    if (!found[i]?.length) return d;
    const lines = found[i].map((a) => withAllHarmonics(a, sources));
    return Float64Array.from(removeLineArtifacts(Array.from(d), eeg.sampleRate, lines));
  });
}

/** A channel's artifact extended to its source's harmonics, placed as the source's lines usually sit. */
function withAllHarmonics(a: LineArtifact, sources: PeriodicArtifact[]): LineArtifact {
  const source = sources.find((s) => Math.abs(a.fundamental / s.fundamental - 1) <= SAME_SOURCE);
  if (!source) return a;
  const ratio = (k: number) => source.frequencies[source.harmonics.indexOf(k)] / source.fundamental;
  return {
    ...a,
    harmonics: source.harmonics,
    track: a.track.map((span) => ({
      ...span,
      frequencies: source.harmonics.map((k) => {
        const j = a.harmonics.indexOf(k);
        return j >= 0 ? span.frequencies[j] : ratio(k) * span.fundamental;
      }),
    })),
  };
}

/** One entry per source across channels, strongest-covered first. */
export function summarizePeriodicArtifacts(labels: string[], found: LineArtifact[][]): PeriodicArtifact[] {
  const all = found.flatMap((artifacts, i) => artifacts.map((a) => ({ label: labels[i], a })));
  const groups: (typeof all)[] = [];
  [...all]
    .sort((x, y) => x.a.fundamental - y.a.fundamental)
    .forEach((entry) => {
      const group = groups.find(
        (g) => Math.abs(entry.a.fundamental / median(g.map((e) => e.a.fundamental)) - 1) <= SAME_SOURCE
      );
      if (group) group.push(entry);
      else groups.push([entry]);
    });

  return groups
    .map((group) => {
      const harmonics = [...new Set(group.flatMap((e) => e.a.harmonics))].sort((x, y) => x - y);
      // A line's usual place: the median of where it was measured, over every channel and block
      const frequencies = harmonics.map((k) =>
        median(
          group.flatMap(({ a }) => {
            const j = a.harmonics.indexOf(k);
            return j < 0 ? [] : a.track.map((span) => span.frequencies[j]);
          })
        )
      );
      return {
        fundamental: round(median(group.map((e) => e.a.fundamental)), 3),
        harmonics,
        frequencies: frequencies.map((f) => round(f, 2)),
        channels: group.map(({ label, a }) => ({
          label,
          harmonics: a.harmonics,
          prominence_db: a.prominenceDb.map((p) => round(p, 1)),
          coverage: round(a.coverage, 2),
        })),
      };
    })
    .sort((x, y) => y.channels.length - x.channels.length || x.fundamental - y.fundamental);
}
