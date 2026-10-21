// Wording and grouping for detected EEG events. Pure functions, shared by the Detected Events
// card and the EEG viewer. Labels describe signal patterns, never diagnoses.
import type {
  DetectedEventResult,
  EventCategory,
  EventDetectionSummary,
  EventHandling,
  EventReviewDecision,
} from '@/lib/analysis-results';

export const CATEGORY_ORDER: EventCategory[] = ['artifact', 'variant', 'epileptiform', 'rhythmic-periodic'];

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  artifact: 'Artifact',
  variant: 'Normal variant',
  epileptiform: 'Epileptiform pattern',
  'rhythmic-periodic': 'Rhythmic / periodic pattern',
};

/** Solid colour per category (chips, viewer band edges); bands use it at low alpha. */
export const CATEGORY_RGB: Record<EventCategory, string> = {
  artifact: '124, 58, 237', // violet: distinct from rejected-epoch red and manual-note yellow
  variant: '13, 148, 136',
  epileptiform: '37, 99, 235',
  'rhythmic-periodic': '234, 88, 12',
};

export function categoryColor(category: EventCategory, alpha = 1): string {
  return `rgba(${CATEGORY_RGB[category] ?? '107, 114, 128'}, ${alpha})`;
}

const PATTERN_NAMES: Record<string, string> = {
  'eye-blink': 'Eye blink',
  'eye-flutter': 'Eye flutter',
  'lateral-eye': 'Lateral eye movement',
  'electrode-pop': 'Electrode pop',
  'post-clean-rejection': 'Rejected after cleaning',
  'asr-repair': 'ASR repair',
  'extreme-transient': 'Extreme transient',
  'extreme-burst': 'Extreme burst',
  jump: 'Signal jump',
  'ica-component': 'ICA component',
  'bad-channel': 'Bad channel',
  muscle: 'Muscle',
  chewing: 'Chewing',
  movement: 'Movement',
  'ecg-artifact': 'ECG artifact',
  'pulse-artifact': 'Pulse artifact',
  'line-noise': 'Line noise',
};

export interface PatternNameOptions {
  /** the amplitude ceiling the analysis used (processing_metadata.config.rejection_threshold_uv) */
  amplitudeThresholdUv?: number;
}

/** Readable name for an engine pattern id; unknown patterns fall back to the raw id. */
export function patternName(pattern: string, opts: PatternNameOptions = {}): string {
  if (pattern === 'amplitude-ceiling') {
    const t = opts.amplitudeThresholdUv;
    return `Amplitude over ${t !== undefined && Number.isFinite(t) && t > 0 ? Math.round(t) : 160} µV`;
  }
  return PATTERN_NAMES[pattern] ?? pattern;
}

const DETECTOR_NAMES: Record<string, string> = {
  'eye-blink': 'Eye blinks',
  'eye-flutter': 'Eye flutter',
  'lateral-eye': 'Lateral eye movements',
  muscle: 'Muscle',
  'electrode-pop': 'Electrode pops',
  movement: 'Movement',
  chewing: 'Chewing',
  cardiac: 'Cardiac (ECG and pulse)',
  'line-noise': 'Line noise',
};

export function detectorName(name: string): string {
  return DETECTOR_NAMES[name] ?? PATTERN_NAMES[name] ?? name;
}

/** Why a detector did not run, in plain words. */
export function skippedReasonText(reason: string | undefined): string {
  if (!reason) return 'not run on this recording';
  const r = reason.trim();
  if (r === 'no ECG lead') return 'the recording has no usable ECG lead';
  if (r === 'no channel has a neighbouring electrode') return 'no channel has a neighbouring electrode to compare with';
  if (r === 'stageNotRun') return 'the cleaning stage it relies on did not run';
  const anyOf = /^needs one of (.+)$/.exec(r);
  if (anyOf) return `needs at least one of ${anyOf[1].split(/\s+or\s+/).join(', ')}`;
  return r;
}

export const TIER_TEXT: Record<EventDetectionSummary['coverage']['tier'], string> = {
  none: 'no detector could run on this montage',
  A: 'basic (any montage)',
  B: 'lateral frontal sites present',
  C: 'full 10-20 montage',
};

export function tierText(tier: EventDetectionSummary['coverage']['tier']): string {
  return TIER_TEXT[tier] ?? tier;
}

const STAGE_NAMES: Record<string, string> = {
  blinkRegression: 'blink regression',
  asr: 'ASR',
  transientRepair: 'transient repair',
  channelQc: 'channel checks',
  cleaning: 'cleaning',
};

/** How the cleaning handled an event, e.g. "repaired by blink regression". */
export function handlingText(
  handling: EventHandling | string,
  handledBy?: string,
  rejects?: DetectedEventResult['rejects']
): string {
  switch (handling) {
    case 'rejected':
      return rejects?.scope === 'channel' ? 'excluded epochs (this channel)' : 'excluded epochs';
    case 'repaired':
      return handledBy && handledBy !== 'cleaning' ? `repaired by ${STAGE_NAMES[handledBy] ?? handledBy}` : 'repaired';
    case 'removed-component': {
      const label = handledBy?.replace(/^ica:/, '');
      return label ? `removed with ICA component (${label})` : 'removed with ICA component';
    }
    case 'channel-excluded':
      return 'channel left out';
    case 'interpolated':
      return 'channel rebuilt from neighbours';
    case 'noted':
      return 'noted';
    default:
      return String(handling);
  }
}

/**
 * Handling for one event. In labels-only mode detector events are 'noted', and what the cleaning
 * stages did over the same span is kept as evidence (stageHandling / stageHandledBy).
 */
export function eventHandlingText(e: DetectedEventResult): string {
  const base = handlingText(e.handling, e.handledBy, e.rejects);
  const stage = e.evidence?.stageHandling;
  if (e.handling === 'noted' && typeof stage === 'string') {
    const by = typeof e.evidence.stageHandledBy === 'string' ? e.evidence.stageHandledBy : undefined;
    return `noted (cleaning: ${handlingText(stage, by)})`;
  }
  return base;
}

/** Seconds → "m:ss.s" (e.g. 75.25 → "1:15.3"). */
export function formatClock(sec: number): string {
  const s = Math.max(0, sec);
  let m = Math.floor(s / 60);
  let rest = Math.round((s - m * 60) * 10) / 10;
  if (rest >= 60) {
    m += 1;
    rest -= 60;
  }
  return `${m}:${rest.toFixed(1).padStart(4, '0')}`;
}

export function formatRange(start: number, end: number): string {
  return `${formatClock(start)}–${formatClock(end)}`;
}

export function formatSeconds(sec: number): string {
  if (sec < 10) return `${sec.toFixed(1)} s`;
  if (sec < 120) return `${Math.round(sec)} s`;
  return `${Math.floor(sec / 60)} min ${Math.round(sec % 60)} s`;
}

/** Channels of a group: its specific channels, noting when some events were recording-wide. */
export function groupChannelsText(g: { channels: string[]; allChannels: boolean }, max = 8): string {
  if (!g.allChannels) return channelsText(g.channels, max);
  return g.channels.length > 0 ? `${channelsText(g.channels, max)}; some on all channels` : 'all channels';
}

export function channelsText(channels: string[], max = 8): string {
  if (channels.length === 0) return 'all channels';
  if (channels.length <= max) return channels.join(', ');
  return `${channels.slice(0, max).join(', ')} +${channels.length - max}`;
}

const EVIDENCE_LABELS: Record<string, string> = {
  maxUv: 'max µV',
  peakUv: 'peak µV',
  widthMs: 'width ms',
  count: 'count',
  reason: 'reason',
  reasons: 'reasons',
  residual: 'residual',
  posteriorRatio: 'posterior ratio',
  maxRobustZ: 'max robust z',
  maxPowerRatio: 'max power ratio',
  channelFraction: 'channel fraction',
  channelCount: 'channels',
  windows: 'windows',
  varianceFraction: 'variance fraction',
  label: 'label',
  confidence: 'confidence',
};

/** Evidence keys shown elsewhere (handling text) or internal. */
const HIDDEN_EVIDENCE = new Set(['stageHandling', 'stageHandledBy', 'index', 'outsideEpochs']);

function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a >= 1e5) return v.toExponential(1);
  if (a >= 100 || Number.isInteger(v)) return String(Math.round(v));
  if (a >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

/** Up to `max` evidence entries as "label value" strings. */
export function evidenceItems(evidence: DetectedEventResult['evidence'], max = 4): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(evidence ?? {})) {
    if (HIDDEN_EVIDENCE.has(k)) continue;
    const label = EVIDENCE_LABELS[k] ?? k.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    const value = typeof v === 'number' ? formatNumber(v) : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v).split(',').join(', ');
    out.push(`${label} ${value}`);
    if (out.length >= max) break;
  }
  return out;
}

/** Total time covered by a set of spans (overlaps counted once). */
export function coveredSeconds(spans: { startSec: number; endSec: number }[]): number {
  const sorted = [...spans].sort((a, b) => a.startSec - b.startSec);
  let total = 0;
  let curStart = -Infinity;
  let curEnd = -Infinity;
  for (const s of sorted) {
    if (s.startSec > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = s.startSec;
      curEnd = s.endSec;
    } else if (s.endSec > curEnd) {
      curEnd = s.endSec;
    }
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return total;
}

export interface EventGroup {
  pattern: string;
  category: EventCategory;
  events: DetectedEventResult[];
  /** union of the event spans, seconds */
  coveredSec: number;
  /** union of the events' specific channels */
  channels: string[];
  /** some event is recording-wide (no specific channels) */
  allChannels: boolean;
  /** distinct handling descriptions, most frequent first */
  handlings: string[];
  /** events an analyst can dismiss (handling 'rejected') */
  nDismissible: number;
}

/** One group per pattern, ordered by category then event count (largest first). */
export function groupEvents(events: DetectedEventResult[]): EventGroup[] {
  const byPattern = new Map<string, DetectedEventResult[]>();
  for (const e of events) {
    const list = byPattern.get(e.pattern);
    if (list) list.push(e);
    else byPattern.set(e.pattern, [e]);
  }
  const groups: EventGroup[] = [];
  for (const [pattern, list] of Array.from(byPattern.entries())) {
    list.sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
    const channels = new Set<string>();
    let allChannels = false;
    const handlingCounts = new Map<string, number>();
    let nDismissible = 0;
    for (const e of list) {
      if (e.channels.length === 0) allChannels = true;
      for (const c of e.channels) channels.add(c);
      const h = eventHandlingText(e);
      handlingCounts.set(h, (handlingCounts.get(h) ?? 0) + 1);
      if (e.handling === 'rejected') nDismissible++;
    }
    groups.push({
      pattern,
      category: list[0].category,
      events: list,
      coveredSec: coveredSeconds(list),
      channels: Array.from(channels),
      allChannels,
      handlings: Array.from(handlingCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([h]) => h),
      nDismissible,
    });
  }
  return groups.sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
      b.events.length - a.events.length ||
      a.pattern.localeCompare(b.pattern)
  );
}

export function countByCategory(events: DetectedEventResult[]): Partial<Record<EventCategory, number>> {
  const out: Partial<Record<EventCategory, number>> = {};
  for (const e of events) out[e.category] = (out[e.category] ?? 0) + 1;
  return out;
}

/** Decision shown for an event: the stored review wins; else the run's own dismissal flag. */
export function decisionFor(
  e: DetectedEventResult,
  reviews: Record<string, EventReviewDecision>
): EventReviewDecision | null {
  return reviews[e.id] ?? (e.dismissed ? 'dismissed' : null);
}

/**
 * True when stored dismissals differ from what the last run applied, i.e. a Re-Analyze would
 * change which epochs are excluded.
 */
export function hasUnappliedDismissals(
  events: DetectedEventResult[],
  reviews: Record<string, EventReviewDecision>
): boolean {
  for (const e of events) {
    if (e.handling !== 'rejected') continue;
    const wantDismissed = reviews[e.id] === 'dismissed';
    if (wantDismissed !== Boolean(e.dismissed)) return true;
  }
  return false;
}

/** Patterns that span the whole recording by construction; not drawn as viewer bands. */
export const RECORDING_WIDE_PATTERNS = new Set(['bad-channel', 'ica-component']);

export interface EventBand {
  id: string;
  pattern: string;
  category: EventCategory;
  startSec: number;
  endSec: number;
  channels: string[];
  allChannels: boolean;
  eventIds: string[];
}

/**
 * Viewer bands: events of the same pattern that overlap (or touch) in time merge into one band,
 * whatever their channels, so per-channel stage events do not stack up dozens of bands.
 */
export function mergeEventBands(events: DetectedEventResult[]): EventBand[] {
  const byPattern = new Map<string, DetectedEventResult[]>();
  for (const e of events) {
    if (RECORDING_WIDE_PATTERNS.has(e.pattern)) continue;
    const list = byPattern.get(e.pattern);
    if (list) list.push(e);
    else byPattern.set(e.pattern, [e]);
  }
  const bands: EventBand[] = [];
  for (const [pattern, list] of Array.from(byPattern.entries())) {
    const sorted = [...list].sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
    let cur: (EventBand & { chanSet: Set<string> }) | null = null;
    const flush = () => {
      if (!cur) return;
      const { chanSet, ...band } = cur;
      bands.push({ ...band, channels: band.allChannels ? [] : Array.from(chanSet) });
    };
    for (const e of sorted) {
      if (cur && e.startSec <= cur.endSec) {
        cur.endSec = Math.max(cur.endSec, e.endSec);
        cur.eventIds.push(e.id);
        if (e.channels.length === 0) cur.allChannels = true;
        for (const c of e.channels) cur.chanSet.add(c);
      } else {
        flush();
        cur = {
          id: `detected-${e.id}`,
          pattern,
          category: e.category,
          startSec: e.startSec,
          endSec: e.endSec,
          channels: [],
          allChannels: e.channels.length === 0,
          eventIds: [e.id],
          chanSet: new Set(e.channels),
        };
      }
    }
    flush();
  }
  return bands.sort((a, b) => a.startSec - b.startSec);
}
