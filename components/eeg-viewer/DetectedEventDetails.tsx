'use client';

import type { DetectedEventResult } from '@/lib/analysis-results';
import EventList from '@/components/visuals/detected-events/EventList';
import {
  categoryColor,
  channelsText,
  formatRange,
  patternName,
  type EventBand,
} from '@/components/visuals/detected-events/format';
import type { EventReviewState } from '@/components/visuals/detected-events/useEventReviews';

/** Details of a clicked detected-event band, with the same review controls as the card. */
export default function DetectedEventDetails({
  band,
  events,
  review,
  amplitudeThresholdUv,
  onClose,
}: {
  band: EventBand;
  events: DetectedEventResult[];
  review: EventReviewState;
  amplitudeThresholdUv?: number;
  onClose: () => void;
}) {
  return (
    <div
      className="mt-3 border rounded-lg overflow-hidden"
      style={{ borderColor: categoryColor(band.category, 0.4) }}
      role="region"
      aria-label="Detected event details"
    >
      <div
        className="flex flex-wrap items-start justify-between gap-2 px-3 py-2"
        style={{ background: categoryColor(band.category, 0.08) }}
      >
        <div className="text-sm">
          <div className="font-semibold text-gray-900">
            {patternName(band.pattern, { amplitudeThresholdUv })}
            <span className="ml-2 font-normal text-gray-600 font-mono text-xs">
              {formatRange(band.startSec, band.endSec)}
            </span>
          </div>
          <div className="text-xs text-gray-700">
            {channelsText(band.channels)} · {events.length} event{events.length === 1 ? '' : 's'} · label only, not
            a clinical interpretation
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-medium text-gray-600 hover:text-gray-900"
          aria-label="Close event details"
        >
          Close
        </button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        <EventList events={events} review={review} showHandling />
      </div>
    </div>
  );
}
