// Analyst review decisions on detected EEG events, stored in `analyses.config.event_reviews` as
// { [eventId]: 'confirmed' | 'dismissed' }. Event ids are deterministic, so decisions carry over
// Re-Analyze; dismissed ids are handed to the engine on the next run.

import type { EventReviewDecision } from '@/lib/analysis-results';
import type { DatabaseClient } from '@/lib/db/types';

/** Engine event ids: the first 16 hex chars of a hash of the event's identity. */
export const EVENT_ID_RE = /^[0-9a-f]{16}$/;

/** Upper bound on stored decisions per analysis, so a client cannot grow the config without limit. */
export const MAX_EVENT_REVIEWS = 5000;

const DECISIONS: readonly string[] = ['confirmed', 'dismissed'] satisfies EventReviewDecision[];

/**
 * The valid entries of a stored `event_reviews` value. Configs are client-influenced JSON, so
 * anything that is not a well-formed id mapped to a known decision is dropped.
 */
export function parseEventReviews(value: unknown): Record<string, EventReviewDecision> {
  const out: Record<string, EventReviewDecision> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [id, decision] of Object.entries(value as Record<string, unknown>)) {
    if (EVENT_ID_RE.test(id) && typeof decision === 'string' && DECISIONS.includes(decision)) {
      out[id] = decision as EventReviewDecision;
    }
  }
  return out;
}

/** Ids the analyst dismissed, from an analysis config. */
export function dismissedEventIds(config: unknown): string[] {
  const reviews = parseEventReviews(
    config && typeof config === 'object' ? (config as { event_reviews?: unknown }).event_reviews : undefined
  );
  return Object.keys(reviews).filter((id) => reviews[id] === 'dismissed');
}

export function isEventReviewDecision(value: unknown): value is EventReviewDecision {
  return typeof value === 'string' && DECISIONS.includes(value);
}

type JsonObject = Record<string, unknown>;

export const asObject = (v: unknown): JsonObject =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {};

/** Thrown from a `build` callback to abort the write with a client error. */
export class StoredConfigRejection extends Error {}

export interface StoredConfigUpdate {
  row: JsonObject | null;
  error: Error | null;
  /** both compare-and-swap attempts lost a race */
  conflict?: boolean;
  /** the row did not change but the update matched nothing: the database refused it (RLS) */
  refused?: boolean;
  /** `recheck` failed on the re-read row; the message to return */
  blocked?: string;
}

/**
 * Update an analysis row whose new values depend on its stored `config`, without losing a
 * concurrent write (two quick review clicks, or a review during a settings save). Compare-and-swap
 * on `updated_at`, which the `update_analyses_updated_at` trigger bumps on every update. On a miss
 * the row is re-read (config, updated_at and `recheckColumns`):
 * - unchanged updated_at → the update was refused (RLS), not raced: `refused`;
 * - `recheck` on the fresh row returns a message (e.g. the run started meanwhile) → `blocked`;
 * - otherwise the values are rebuilt and the write tried once more; a second miss → `conflict`.
 *
 * Only a string `updated_at` (Supabase/PostgREST, microsecond ISO text) is used as the token; a
 * driver that returns Date objects (direct Postgres mode) would truncate it to milliseconds and
 * never match, so there the write is unconditional.
 */
export async function updateWithStoredConfig(
  db: DatabaseClient,
  analysisId: string,
  initial: { config: unknown; updated_at?: unknown },
  build: (storedConfig: JsonObject) => JsonObject,
  options: { returning?: string; recheckColumns?: string[]; recheck?: (row: JsonObject) => string | null } = {}
): Promise<StoredConfigUpdate> {
  const returning = options.returning ?? '*';
  const rereadColumns = ['config', 'updated_at', ...(options.recheckColumns ?? [])].join(', ');
  let current: JsonObject = initial;
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = typeof current.updated_at === 'string' ? current.updated_at : null;
    let q = db.from('analyses').update(build(asObject(current.config))).eq('id', analysisId);
    if (token) q = q.eq('updated_at', token);
    const { data, error } = await q.select(returning).execute();
    if (error) return { row: null, error };
    const rows = (Array.isArray(data) ? data : data ? [data] : []) as JsonObject[];
    if (rows.length > 0) return { row: rows[0], error: null };
    if (!token) return { row: null, error: new Error('Analysis not found') };
    const { data: fresh, error: readError } = await db
      .from('analyses')
      .select(rereadColumns)
      .eq('id', analysisId)
      .single();
    if (readError || !fresh) return { row: null, error: readError ?? new Error('Analysis not found') };
    current = fresh as JsonObject;
    if (current.updated_at === token) return { row: null, error: null, refused: true };
    const blocked = options.recheck?.(current);
    if (blocked) return { row: null, error: null, blocked };
  }
  return { row: null, error: null, conflict: true };
}
