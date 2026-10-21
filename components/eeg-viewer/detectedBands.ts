import { CATEGORY_RGB, patternName, type EventBand } from '@/components/visuals/detected-events/format';
import type { EEGAnnotation } from './types';

/**
 * Read-only annotations for the detected-event bands that overlap the visible window. The plugin
 * draws every annotation it is handed on each frame, so the window filter keeps a long recording
 * with hundreds of bands down to the few on screen.
 */
export function visibleBandAnnotations(
  bands: EventBand[],
  windowStart: number,
  windowEnd: number,
  opts: { amplitudeThresholdUv?: number; selectedId?: string | null } = {}
): EEGAnnotation[] {
  const visible = bands.filter((b) => b.endSec >= windowStart && b.startSec <= windowEnd);
  // One lane per pattern on screen, in a fixed (alphabetical) order so lanes do not reshuffle.
  const patterns = Array.from(new Set(visible.map((b) => b.pattern))).sort();
  const out: EEGAnnotation[] = [];
  for (const b of visible) {
    out.push({
      id: b.id,
      startTime: b.startSec,
      endTime: b.endSec,
      description: bandDescription(b, opts.amplitudeThresholdUv),
      type: 'detected',
      color: CATEGORY_RGB[b.category],
      readOnly: true,
      eventIds: b.eventIds,
      highlighted: b.id === opts.selectedId,
      lane: patterns.indexOf(b.pattern),
    });
  }
  return out;
}

/** Readable pattern name plus channels, e.g. "Muscle · T8, O2". */
export function bandDescription(b: EventBand, amplitudeThresholdUv?: number): string {
  const name = patternName(b.pattern, { amplitudeThresholdUv });
  if (b.allChannels || b.channels.length === 0) return name;
  const chans = b.channels.length <= 3 ? b.channels.join(', ') : `${b.channels.length} channels`;
  return `${name} · ${chans}`;
}

/** Bands under time `t`, shortest first (the most specific one wins a click). */
export function bandsAt(bands: EventBand[], t: number): EventBand[] {
  return bands
    .filter((b) => t >= b.startSec && t <= Math.max(b.endSec, b.startSec + 0.05))
    .sort((a, b) => a.endSec - a.startSec - (b.endSec - b.startSec));
}
