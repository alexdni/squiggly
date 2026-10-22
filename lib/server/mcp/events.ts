// Event output shared by the session summary and the events detail section. Built from
// allowlisted fields: `evidence`, `rejects` and `source` of the engine's events are never copied.

import type { AnalysisResults, DetectedEventResult, EventCategory, EventHandling } from '@/lib/analysis-results';
import { parseEventReviews } from '@/lib/server/eventReviews';
import { round2, sig3 } from './num';

export type EventReview = 'confirmed' | 'dismissed' | 'unreviewed';
export type EventSource = 'eo' | 'ec' | 'both';

export interface EventOut {
  id: string;
  category: EventCategory;
  pattern: string;
  start_s: number;
  end_s: number;
  channels: string[];
  confidence: number;
  handling: EventHandling;
  review: EventReview;
  /** which analysis (file) the event came from */
  condition: EventSource;
}

export const EVENT_CATEGORIES: EventCategory[] = ['epileptiform', 'rhythmic-periodic', 'variant', 'artifact'];
export const CLINICAL: EventCategory[] = ['epileptiform', 'rhythmic-periodic'];

export function eventOut(e: DetectedEventResult, review: EventReview, condition: EventSource): EventOut {
  return {
    id: String(e.id),
    category: e.category,
    pattern: String(e.pattern),
    start_s: round2(Number(e.startSec)),
    end_s: round2(Number(e.endSec)),
    channels: Array.isArray(e.channels) ? e.channels.map(String) : [],
    confidence: sig3(Number(e.confidence)),
    handling: e.handling,
    review,
    condition,
  };
}

/** Clinical categories first, confirmed before unreviewed, then by time. */
export function eventOrder(a: EventOut, b: EventOut): number {
  return (
    EVENT_CATEGORIES.indexOf(a.category) - EVENT_CATEGORIES.indexOf(b.category) ||
    Number(b.review === 'confirmed') - Number(a.review === 'confirmed') ||
    a.start_s - b.start_s
  );
}

/** Review decision from the analysis config, else the engine's own dismissed flag. */
export function eventReview(e: DetectedEventResult, reviews: ReturnType<typeof parseEventReviews>): EventReview {
  return reviews[e.id] ?? (e.dismissed === true ? 'dismissed' : 'unreviewed');
}

/** All events of one analysis as output rows (every review state, unsorted). */
export function analysisEvents(input: { results: AnalysisResults | null; config: unknown }, source: EventSource): EventOut[] {
  const cfg = input.config && typeof input.config === 'object' ? (input.config as { event_reviews?: unknown }) : {};
  const reviews = parseEventReviews(cfg.event_reviews);
  const out: EventOut[] = [];
  for (const e of input.results?.events ?? []) {
    if (!e || !EVENT_CATEGORIES.includes(e.category)) continue;
    out.push(eventOut(e, eventReview(e, reviews), source));
  }
  return out;
}
