// "Original vs corrected" overlay for the EEG viewer. When the viewer shows the analysis's
// noise-corrected recording, this produces the matching window of the ORIGINAL recording,
// prepared the same way the pipeline prepared its input apart from artifact correction:
// same channels, common average reference over those channels, the pipeline's filter band and
// mains notch. What differs between the two traces is then what ASR/ICA/repair changed, not
// filtering or referencing.

import { canonicalLabel } from '@/lib/eeg-labels';
import { filterEeg } from '@/lib/dsp/zeroPhase';
import { filterPaddingSeconds } from '@/lib/eeg-filters';
import type { UnifiedSignalData } from './types';

export interface PipelineFilterSettings {
  highpassHz: number;
  lowpassHz: number;
  notchHz: number;
}

/** Map each corrected channel to the raw channel with the same canonical 10-20 label. */
export function matchChannels(cleanedNames: string[], rawNames: string[]): (number | null)[] {
  const rawByLabel = new Map<string, number>();
  rawNames.forEach((name, i) => {
    const label = canonicalLabel(name);
    if (label && !rawByLabel.has(label)) rawByLabel.set(label, i);
  });
  return cleanedNames.map((name) => {
    const label = canonicalLabel(name) ?? name;
    return rawByLabel.get(label) ?? null;
  });
}

/** Linear interpolation of (srcTimes, values) at dstTimes; outside the source range → edge value. */
export function resampleAt(srcTimes: ArrayLike<number>, values: ArrayLike<number>, dstTimes: ArrayLike<number>): number[] {
  const out = new Array<number>(dstTimes.length);
  const n = srcTimes.length;
  if (n === 0) return out.fill(0);
  let j = 0;
  for (let k = 0; k < dstTimes.length; k++) {
    const t = dstTimes[k];
    while (j < n - 2 && srcTimes[j + 1] < t) j++;
    if (t <= srcTimes[0]) out[k] = values[0];
    else if (t >= srcTimes[n - 1]) out[k] = values[n - 1];
    else {
      const t0 = srcTimes[j];
      const t1 = srcTimes[j + 1];
      const w = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
      out[k] = values[j] + w * (values[j + 1] - values[j]);
    }
  }
  return out;
}

/**
 * Original-signal traces for the selected corrected channels, sampled at `targetTimes`
 * (seconds, the corrected traces' x values). Entries are null where no raw channel matches.
 */
export function computeOriginalOverlay(params: {
  raw: UnifiedSignalData;
  cleanedNames: string[];
  /** indices into cleanedNames, in display order */
  selected: number[];
  timeStart: number;
  windowSeconds: number;
  filters: PipelineFilterSettings;
  targetTimes: number[];
}): (number[] | null)[] {
  const { raw, cleanedNames, selected, timeStart, windowSeconds, filters, targetTimes } = params;
  const fs = raw.sampleRate;
  const match = matchChannels(cleanedNames, raw.channelNames);
  const used = Array.from(new Set(match.filter((m): m is number => m !== null)));
  if (used.length === 0 || targetTimes.length === 0) return selected.map(() => null);

  const total = raw.signals[used[0]]?.length ?? 0;
  const pad = Math.floor(filterPaddingSeconds(filters.highpassHz) * fs);
  const start = Math.max(0, Math.floor(timeStart * fs) - pad);
  const end = Math.min(total, Math.ceil((timeStart + windowSeconds) * fs) + pad);
  const n = end - start;
  if (n < 10) return selected.map(() => null);

  // common average over every channel the pipeline kept (= every corrected channel present)
  const avg = new Float64Array(n);
  for (const c of used) {
    const sig = raw.signals[c];
    for (let i = 0; i < n; i++) avg[i] += sig[start + i];
  }
  for (let i = 0; i < n; i++) avg[i] /= used.length;

  const times = Float64Array.from({ length: n }, (_, i) => (start + i) / fs);
  return selected.map((cleanedIdx) => {
    const c = match[cleanedIdx];
    if (c === null || c === undefined) return null;
    const sig = raw.signals[c];
    const ref = Float64Array.from({ length: n }, (_, i) => sig[start + i] - avg[i]);
    const filtered = filterEeg(ref, fs, filters);
    return resampleAt(times, filtered, targetTimes);
  });
}
