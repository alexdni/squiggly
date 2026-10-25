'use client';

import type { DetectedEventResult } from '@/lib/analysis-results';
import { canDismiss, decisionFor } from './format';
import type { EventReviewState } from './useEventReviews';

export const DISMISS_TOOLTIP = 'Puts these epochs back into the metrics on the next Re-Analyze';
export const DISMISS_LABEL_TOOLTIP = 'Marks this label as wrong; the metrics are unaffected';

const DECISION_STYLE = {
  confirmed: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  dismissed: 'bg-gray-100 text-gray-700 border-gray-300',
} as const;

/** Decision badge, plus Confirm/Dismiss buttons for users who can edit. */
export default function EventReviewControls({
  event,
  review,
}: {
  event: DetectedEventResult;
  review: EventReviewState;
}) {
  const decision = decisionFor(event, review.reviews);
  const busy = review.pending.has(event.id);
  const dismissible = canDismiss(event);
  const rejection = event.handling === 'rejected';
  // A stored dismissal the last run did not apply yet (or an applied one since withdrawn).
  const unapplied = rejection && (review.reviews[event.id] === 'dismissed') !== Boolean(event.dismissed);
  const error = review.error?.eventId === event.id ? review.error.message : null;

  const toggle = (next: 'confirmed' | 'dismissed') => {
    void review.setDecision(event.id, decision === next ? null : next);
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {decision && (
          <span
            className={`px-1.5 py-0.5 rounded border text-[11px] font-medium ${DECISION_STYLE[decision]}`}
            data-decision={decision}
          >
            {decision === 'confirmed' ? 'Confirmed' : 'Dismissed'}
            {unapplied ? ' (pending Re-Analyze)' : ''}
          </span>
        )}
        {review.canEdit && (
          <span className="flex items-center gap-1" data-export-ignore>
            <button
              type="button"
              disabled={busy}
              aria-pressed={decision === 'confirmed'}
              onClick={(e) => {
                e.stopPropagation();
                toggle('confirmed');
              }}
              className={`px-2 py-0.5 rounded border text-[11px] font-medium transition-colors disabled:opacity-50 ${
                decision === 'confirmed'
                  ? 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
              title={decision === 'confirmed' ? 'Clear the confirmation' : 'Confirm this label'}
            >
              Confirm
            </button>
            {dismissible && (
              <button
                type="button"
                disabled={busy}
                aria-pressed={decision === 'dismissed'}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle('dismissed');
                }}
                className={`px-2 py-0.5 rounded border text-[11px] font-medium transition-colors disabled:opacity-50 ${
                  decision === 'dismissed'
                    ? 'bg-gray-700 border-gray-700 text-white hover:bg-gray-800'
                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
                title={decision === 'dismissed' ? 'Clear the dismissal' : rejection ? DISMISS_TOOLTIP : DISMISS_LABEL_TOOLTIP}
              >
                Dismiss
              </button>
            )}
          </span>
        )}
      </div>
      {error && (
        <p className="text-[11px] text-red-700 text-right" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
