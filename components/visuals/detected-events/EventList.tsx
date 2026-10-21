'use client';

import { useState } from 'react';
import type { DetectedEventResult } from '@/lib/analysis-results';
import EventReviewControls from './EventReviewControls';
import { channelsText, eventHandlingText, evidenceItems, formatRange } from './format';
import type { EventReviewState } from './useEventReviews';

export const EVENT_PAGE_SIZE = 50;

/** Events of one group, at most EVENT_PAGE_SIZE at a time with "Show more". */
export default function EventList({
  events,
  review,
  onSelectEvent,
  showHandling = false,
}: {
  events: DetectedEventResult[];
  review: EventReviewState;
  onSelectEvent?: (event: DetectedEventResult) => void;
  /** show each event's handling (when a group mixes several) */
  showHandling?: boolean;
}) {
  const [limit, setLimit] = useState(EVENT_PAGE_SIZE);
  const shown = events.slice(0, limit);
  const remaining = events.length - shown.length;

  return (
    <div>
      <ul className="divide-y divide-gray-100">
        {shown.map((e) => (
          <li
            key={e.id}
            className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-3 py-1.5 text-xs ${
              onSelectEvent ? 'cursor-pointer hover:bg-gray-50' : ''
            }`}
            onClick={onSelectEvent ? () => onSelectEvent(e) : undefined}
            data-event-id={e.id}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                {onSelectEvent ? (
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onSelectEvent(e);
                    }}
                    className="font-mono text-neuro-primary hover:underline"
                    title="Show in the EEG viewer"
                  >
                    {formatRange(e.startSec, e.endSec)}
                  </button>
                ) : (
                  <span className="font-mono text-gray-900">{formatRange(e.startSec, e.endSec)}</span>
                )}
                <span className="text-gray-800">{channelsText(e.channels)}</span>
                <span className="text-gray-500">confidence {Math.round(e.confidence * 100)}%</span>
                {showHandling && <span className="text-gray-600">{eventHandlingText(e)}</span>}
              </div>
              {evidenceItems(e.evidence).length > 0 && (
                <div className="text-gray-500 mt-0.5 break-words">{evidenceItems(e.evidence).join(' · ')}</div>
              )}
            </div>
            <EventReviewControls event={e} review={review} />
          </li>
        ))}
      </ul>
      {remaining > 0 && (
        <div className="px-3 py-2" data-export-ignore>
          <button
            type="button"
            onClick={() => setLimit((l) => l + EVENT_PAGE_SIZE)}
            className="text-xs font-medium text-neuro-primary hover:underline"
          >
            Show more ({remaining} more)
          </button>
        </div>
      )}
    </div>
  );
}
