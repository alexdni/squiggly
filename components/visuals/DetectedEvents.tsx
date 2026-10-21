'use client';

import { useMemo, useState } from 'react';
import type { AnalysisResults, DetectedEventResult, EventDetectionSummary } from '@/lib/analysis-results';
import EventList from './detected-events/EventList';
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  categoryColor,
  countByCategory,
  detectorName,
  formatSeconds,
  groupChannelsText,
  groupEvents,
  hasUnappliedDismissals,
  patternName,
  skippedReasonText,
  tierText,
  type EventGroup,
} from './detected-events/format';
import type { EventReviewState } from './detected-events/useEventReviews';

export const LABELS_ONLY_NOTE = 'Labels only — detected events do not change the metrics.';
export const REANALYZE_HINT = 'Re-Analyze to apply dismissals.';

/** Amplitude ceiling the analysis used, for naming 'amplitude-ceiling' events. */
export function amplitudeThresholdOf(results: Partial<AnalysisResults> | null | undefined): number | undefined {
  const v = Number(results?.processing_metadata?.config?.rejection_threshold_uv);
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

interface DetectedEventsProps {
  results: Partial<AnalysisResults> | null | undefined;
  review: EventReviewState;
  onSelectEvent?: (event: DetectedEventResult) => void;
}

/**
 * "Detected Events" results card. Renders nothing without results; a one-line hint for analyses
 * run before event detection existed.
 */
export default function DetectedEvents({ results, review, onSelectEvent }: DetectedEventsProps) {
  if (!results) return null;
  const summary = results.event_detection;
  if (!summary) {
    return (
      <p className="text-sm text-gray-600 mb-6 px-1" data-export-ignore>
        Detected events are not available for this analysis. Re-Analyze to label the artifacts it contains.
      </p>
    );
  }
  return (
    <DetectedEventsCard
      events={results.events ?? []}
      summary={summary}
      amplitudeThresholdUv={amplitudeThresholdOf(results)}
      review={review}
      onSelectEvent={onSelectEvent}
    />
  );
}

export function DetectedEventsCard({
  events,
  summary,
  amplitudeThresholdUv,
  review,
  onSelectEvent,
}: {
  events: DetectedEventResult[];
  summary: EventDetectionSummary;
  amplitudeThresholdUv?: number;
  review: EventReviewState;
  onSelectEvent?: (event: DetectedEventResult) => void;
}) {
  const groups = useMemo(() => groupEvents(events), [events]);
  const counts = useMemo(() => countByCategory(events), [events]);
  const pendingDismissals = hasUnappliedDismissals(events, review.reviews);
  const notAssessed = summary.coverage.detectors.filter((d) => !d.ran);
  const assessed = summary.coverage.detectors.filter((d) => d.ran);
  const restored = summary.dismissed?.epochsRestored ?? 0;

  return (
    <div className="bg-white rounded-lg shadow-md p-6 mb-6" data-report-section="Detected Events">
      <h2 className="text-2xl font-bold text-neuro-dark mb-1">Detected Events</h2>
      <p className="text-sm text-gray-700">
        {LABELS_ONLY_NOTE} Detector coverage: {tierText(summary.coverage.tier)}
        {summary.coverage.tier !== 'none' ? ` (tier ${summary.coverage.tier})` : ''}.
      </p>
      <p className="text-xs text-gray-500 mt-1">
        Labels name signal patterns found by automatic detectors and the cleaning stages; they are not a clinical
        interpretation.
      </p>

      {/* Counts by category */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {CATEGORY_ORDER.filter((c) => (counts[c] ?? 0) > 0).map((c) => (
          <span
            key={c}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-sm"
            style={{ borderColor: categoryColor(c, 0.4), background: categoryColor(c, 0.08) }}
          >
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: categoryColor(c) }} />
            <span className="text-gray-900 font-medium">{CATEGORY_LABELS[c]}</span>
            <span className="text-gray-700">{counts[c]}</span>
          </span>
        ))}
        {events.length === 0 && (
          <span className="text-sm text-gray-700">
            No events found by the detectors that ran{notAssessed.length > 0 ? ' (see what was not assessed below)' : ''}.
          </span>
        )}
      </div>

      {(pendingDismissals || restored > 0) && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {pendingDismissals && (
            <span className="text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-0.5" role="status">
              {REANALYZE_HINT}
            </span>
          )}
          {restored > 0 && (
            <span className="text-gray-600">
              {restored} epoch{restored === 1 ? '' : 's'} restored to the metrics by dismissals in this run.
            </span>
          )}
        </div>
      )}

      {groups.length > 0 && (
        <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
          <div className="hidden md:grid grid-cols-[minmax(0,2fr)_4rem_6rem_minmax(0,2fr)_minmax(0,2fr)] gap-3 px-3 py-2 bg-gray-50 text-xs font-semibold text-gray-700">
            <span>Pattern</span>
            <span className="text-right">Events</span>
            <span className="text-right">Time covered</span>
            <span>Channels</span>
            <span>Handled</span>
          </div>
          {groups.map((g) => (
            <EventGroupRow
              key={g.pattern}
              group={g}
              amplitudeThresholdUv={amplitudeThresholdUv}
              review={review}
              onSelectEvent={onSelectEvent}
            />
          ))}
        </div>
      )}

      <NotAssessedList detectors={notAssessed} />
      {assessed.length > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          Assessed: {assessed.map((d) => detectorName(d.name)).join(', ')}.
        </p>
      )}
    </div>
  );
}

function EventGroupRow({
  group,
  amplitudeThresholdUv,
  review,
  onSelectEvent,
}: {
  group: EventGroup;
  amplitudeThresholdUv?: number;
  review: EventReviewState;
  onSelectEvent?: (event: DetectedEventResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const name = patternName(group.pattern, { amplitudeThresholdUv });
  return (
    <div className="border-t border-gray-200 first:border-t-0" data-pattern={group.pattern}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full text-left grid grid-cols-2 md:grid-cols-[minmax(0,2fr)_4rem_6rem_minmax(0,2fr)_minmax(0,2fr)] gap-x-3 gap-y-1 px-3 py-2 text-sm hover:bg-gray-50"
      >
        <span className="flex items-center gap-2 font-medium text-gray-900 col-span-2 md:col-span-1">
          <span aria-hidden="true" className="text-gray-400 w-3">{open ? '▾' : '▸'}</span>
          <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: categoryColor(group.category) }} />
          {name}
        </span>
        <span className="md:text-right text-gray-900">
          <span className="md:hidden text-gray-500">Events: </span>
          {group.events.length}
        </span>
        <span className="md:text-right text-gray-900">
          <span className="md:hidden text-gray-500">Time: </span>
          {formatSeconds(group.coveredSec)}
        </span>
        <span className="text-gray-700 break-words col-span-2 md:col-span-1">{groupChannelsText(group)}</span>
        <span className="text-gray-700 col-span-2 md:col-span-1">{group.handlings.join('; ')}</span>
      </button>
      {open && (
        <div className="bg-gray-50/60 border-t border-gray-100">
          <EventList
            events={group.events}
            review={review}
            onSelectEvent={onSelectEvent}
            showHandling={group.handlings.length > 1}
          />
        </div>
      )}
    </div>
  );
}

export function NotAssessedList({ detectors }: { detectors: EventDetectionSummary['coverage']['detectors'] }) {
  if (detectors.length === 0) return null;
  return (
    <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg p-3" data-testid="not-assessed">
      <h3 className="text-sm font-semibold text-gray-900 mb-1">Not assessed</h3>
      <p className="text-xs text-gray-600 mb-1.5">
        These detectors could not run on this recording, so the absence of these events is unknown.
      </p>
      <ul className="list-disc pl-5 text-sm text-gray-800 space-y-0.5">
        {detectors.map((d) => (
          <li key={d.name}>
            <span className="font-medium">{detectorName(d.name)}</span>: {skippedReasonText(d.skippedReason)}
          </li>
        ))}
      </ul>
    </div>
  );
}
