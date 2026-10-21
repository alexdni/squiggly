'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EventReviewDecision } from '@/lib/analysis-results';

export type EventReviews = Record<string, EventReviewDecision>;

export const CONFLICT_MESSAGE = 'Someone else just changed this analysis; reload to see the latest.';
export const FORBIDDEN_MESSAGE = 'You do not have permission to review events in this project.';

/** Keep only well-formed entries of `analyses.config.event_reviews`. */
export function parseReviews(raw: unknown): EventReviews {
  const out: EventReviews = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, d] of Object.entries(raw as Record<string, unknown>)) {
    if (d === 'confirmed' || d === 'dismissed') out[id] = d;
  }
  return out;
}

export type SaveReviewResult = { ok: true; reviews: EventReviews } | { ok: false; error: string };

/** PUT one decision (null clears it). The response's `event_reviews` is the source of truth. */
export async function saveEventReview(
  analysisId: string,
  eventId: string,
  decision: EventReviewDecision | null,
  fetchImpl: typeof fetch = fetch
): Promise<SaveReviewResult> {
  let res: Response;
  try {
    res = await fetchImpl(`/api/analyses/${analysisId}/event-reviews`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId, decision }),
    });
  } catch {
    return { ok: false, error: 'Could not reach the server; check your connection and try again.' };
  }
  if (res.status === 409) return { ok: false, error: CONFLICT_MESSAGE };
  if (res.status === 403) return { ok: false, error: FORBIDDEN_MESSAGE };
  const body = (await res.json().catch(() => null)) as { event_reviews?: unknown; error?: unknown } | null;
  if (!res.ok || !body || !('event_reviews' in body)) {
    const msg = typeof body?.error === 'string' ? body.error : 'Could not save the decision.';
    return { ok: false, error: msg };
  }
  return { ok: true, reviews: parseReviews(body.event_reviews) };
}

export interface EventReviewState {
  reviews: EventReviews;
  canEdit: boolean;
  /** ids with a save in flight */
  pending: ReadonlySet<string>;
  /** last error, with the event it belongs to */
  error: { eventId: string; message: string } | null;
  setDecision: (eventId: string, decision: EventReviewDecision | null) => Promise<void>;
  clearError: () => void;
}

/**
 * Review decisions for one analysis. Owned by the analysis page and shared by the Detected Events
 * card and the EEG viewer so both show the same state.
 */
export function useEventReviews(analysisId: string, initialReviews: unknown, canEdit: boolean): EventReviewState {
  const initial = useMemo(() => parseReviews(initialReviews), [initialReviews]);
  const initialKey = JSON.stringify(initial);
  const [reviews, setReviews] = useState<EventReviews>(initial);
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<EventReviewState['error']>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The page reloads the analysis row after a run; take its stored reviews then.
  useEffect(() => {
    setReviews(JSON.parse(initialKey) as EventReviews);
  }, [initialKey]);

  const setDecision = useCallback(
    async (eventId: string, decision: EventReviewDecision | null) => {
      if (!canEdit) return;
      setError(null);
      setPending((p) => new Set(p).add(eventId));
      const result = await saveEventReview(analysisId, eventId, decision);
      if (!mounted.current) return;
      setPending((p) => {
        const next = new Set(p);
        next.delete(eventId);
        return next;
      });
      if (result.ok) setReviews(result.reviews);
      else setError({ eventId, message: result.error });
    },
    [analysisId, canEdit]
  );

  const clearError = useCallback(() => setError(null), []);

  return { reviews, canEdit, pending, error, setDecision, clearError };
}
