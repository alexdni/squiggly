import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDatabaseClient } from '@/lib/db';
import { checkProjectPermission } from '@/lib/rbac';
import { projectIdForRecording } from '@/lib/server/analysisProject';
import {
  EVENT_ID_RE,
  isEventReviewDecision,
  MAX_EVENT_REVIEWS,
  parseEventReviews,
  StoredConfigRejection,
  updateWithStoredConfig,
} from '@/lib/server/eventReviews';

/**
 * PUT /api/analyses/[id]/event-reviews - record one review decision on a detected event.
 *
 * Body `{ eventId, decision }` with decision 'confirmed' | 'dismissed', or null to clear it.
 * Merged into `analyses.config.event_reviews`; dismissals reach the engine on the next run.
 * Same edit permission as PATCH /api/analyses/[id] (owner or collaborator; viewers get 403).
 */
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { eventId, decision } = body as { eventId?: unknown; decision?: unknown };
    if (typeof eventId !== 'string' || !EVENT_ID_RE.test(eventId)) {
      return NextResponse.json({ error: 'eventId must be 16 lowercase hex characters' }, { status: 400 });
    }
    if (decision !== null && !isEventReviewDecision(decision)) {
      return NextResponse.json(
        { error: "decision must be 'confirmed', 'dismissed' or null" },
        { status: 400 }
      );
    }

    const db = getDatabaseClient();
    const { data: existing, error: fetchError } = await db
      .from('analyses')
      .select('id, recording_id, config, updated_at, results')
      .eq('id', params.id)
      .single();
    const current = existing as
      | { id: string; recording_id: string; config: unknown; updated_at?: unknown; results?: unknown }
      | null;
    if (fetchError || !current) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }
    const projectId = await projectIdForRecording(db, current.recording_id);
    if (!projectId || !(await checkProjectPermission(projectId, user.id, 'analysis:create'))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Only events this analysis detected can be reviewed (analyses run before detection have no
    // events list; then any well-formed id is accepted). Clearing a decision is always allowed.
    const events = (current.results as { events?: unknown } | null)?.events;
    if (decision !== null && Array.isArray(events)) {
      const known = events.some((e) => (e as { id?: unknown } | null)?.id === eventId);
      if (!known) return NextResponse.json({ error: 'unknown event' }, { status: 400 });
    }
    let result;
    try {
      result = await updateWithStoredConfig(
        db,
        params.id,
        { config: current.config, updated_at: current.updated_at },
        (stored) => {
          const reviews = parseEventReviews(stored.event_reviews);
          if (decision === null) delete reviews[eventId];
          else {
            if (!(eventId in reviews) && Object.keys(reviews).length >= MAX_EVENT_REVIEWS) {
              throw new StoredConfigRejection(`At most ${MAX_EVENT_REVIEWS} event reviews per analysis`);
            }
            reviews[eventId] = decision;
          }
          return { config: { ...stored, event_reviews: reviews } };
        },
        { returning: 'config' }
      );
    } catch (err) {
      if (err instanceof StoredConfigRejection) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
    const { row, error, conflict, refused } = result;
    if (refused) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (conflict) {
      return NextResponse.json({ error: 'Analysis changed while saving; please retry' }, { status: 409 });
    }
    if (error || !row) {
      return NextResponse.json({ error: 'Failed to save review' }, { status: 500 });
    }

    const saved = row.config as { event_reviews?: unknown } | null;
    return NextResponse.json({ event_reviews: parseEventReviews(saved?.event_reviews) });
  } catch (error) {
    console.error('Error saving event review:', error);
    return NextResponse.json({ error: 'Failed to save review' }, { status: 500 });
  }
}
