import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AnalysisResults, EventDetectionSummary } from '@/lib/analysis-results';
import DetectedEvents, { DetectedEventsCard, LABELS_ONLY_NOTE, NotAssessedList, REANALYZE_HINT } from '../../DetectedEvents';
import EventList from '../EventList';
import { DISMISS_TOOLTIP } from '../EventReviewControls';
import type { EventReviewState } from '../useEventReviews';
import { ev } from './fixtures';

function review(over: Partial<EventReviewState> = {}): EventReviewState {
  return {
    reviews: {},
    canEdit: true,
    pending: new Set(),
    error: null,
    setDecision: async () => {},
    clearError: () => {},
    ...over,
  };
}

const summary: EventDetectionSummary = {
  coverage: {
    tier: 'A',
    detectors: [
      { name: 'eye-blink', ran: false, skippedReason: 'needs one of Fp1 or Fp2' },
      { name: 'muscle', ran: true },
      { name: 'cardiac', ran: false, skippedReason: 'no ECG lead' },
    ],
  },
  counts: { artifact: 2, variant: 0, epileptiform: 0, 'rhythmic-periodic': 0 },
  nRejectedEpochsAdded: 0,
  nRejectedEpochsNet: 0,
  retainedEpochFractionRemoved: 0,
  dismissed: { applied: 0, unknownIds: 0, notDismissible: 0, epochsRestored: 0 },
};

const count = (html: string, text: string) => html.split(text).length - 1;

describe('EventList review controls', () => {
  const rejected = ev({ pattern: 'amplitude-ceiling', handling: 'rejected', rejects: { scope: 'epoch', firstEpoch: 0, lastEpoch: 1 } });
  const repaired = ev({ pattern: 'asr-repair', handling: 'repaired', handledBy: 'asr' });

  it('offers Confirm on every event and Dismiss only on rejections', () => {
    const html = renderToStaticMarkup(<EventList events={[rejected, repaired]} review={review()} />);
    expect(count(html, '>Confirm</button>')).toBe(2);
    expect(count(html, '>Dismiss</button>')).toBe(1);
    expect(html).toContain(DISMISS_TOOLTIP);
    expect(html).toContain('data-export-ignore');
  });

  it('shows decisions but no buttons to viewers', () => {
    const html = renderToStaticMarkup(
      <EventList
        events={[rejected, repaired]}
        review={review({ canEdit: false, reviews: { [rejected.id]: 'dismissed', [repaired.id]: 'confirmed' } })}
      />
    );
    expect(html).not.toContain('<button');
    expect(html).toContain('data-decision="dismissed"');
    expect(html).toContain('data-decision="confirmed"');
    expect(html).toContain('Dismissed (pending Re-Analyze)');
  });

  it('shows the save error next to its event', () => {
    const html = renderToStaticMarkup(
      <EventList events={[rejected, repaired]} review={review({ error: { eventId: repaired.id, message: 'Nope' } })} />
    );
    expect(count(html, 'Nope')).toBe(1);
  });

  it('renders at most 50 events with a Show more control', () => {
    const many = Array.from({ length: 120 }, (_, i) => ev({ pattern: 'jump', startSec: i, endSec: i + 0.5 }));
    const html = renderToStaticMarkup(<EventList events={many} review={review()} />);
    expect(count(html, 'data-event-id=')).toBe(50);
    expect(html).toContain('Show more (70 more)');
  });
});

describe('Detected Events card', () => {
  it('renders nothing without results and a hint for analyses run before detection', () => {
    expect(renderToStaticMarkup(<DetectedEvents results={null} review={review()} />)).toBe('');
    const html = renderToStaticMarkup(<DetectedEvents results={{ qc_report: {} } as unknown as Partial<AnalysisResults>} review={review()} />);
    expect(html).toContain('Re-Analyze');
    expect(html).not.toContain('data-report-section');
  });

  it('states labels-only, coverage, counts by category, groups and what was not assessed', () => {
    const events = [
      ev({ pattern: 'amplitude-ceiling', handling: 'rejected', channels: ['O1'] }),
      ev({ pattern: 'muscle', source: 'detector', channels: ['T8'] }),
    ];
    const html = renderToStaticMarkup(
      <DetectedEventsCard events={events} summary={summary} amplitudeThresholdUv={150} review={review()} />
    );
    expect(html).toContain('data-report-section="Detected Events"');
    expect(html).not.toContain('data-visual');
    expect(html).toContain(LABELS_ONLY_NOTE);
    expect(html).toContain('basic (any montage)');
    expect(html).toContain('Artifact');
    expect(html).not.toContain('Epileptiform');
    expect(html).toContain('Amplitude over 150 µV');
    expect(html).toContain('Muscle');
    expect(html).toContain('Not assessed');
    expect(html).toContain('Eye blinks');
    expect(html).toContain('the recording has no usable ECG lead');
    expect(html).not.toContain(REANALYZE_HINT);
  });

  it('asks for a Re-Analyze when there are dismissals newer than the run', () => {
    const rej = ev({ pattern: 'amplitude-ceiling', handling: 'rejected' });
    const html = renderToStaticMarkup(
      <DetectedEventsCard events={[rej]} summary={summary} review={review({ reviews: { [rej.id]: 'dismissed' } })} />
    );
    expect(html).toContain(REANALYZE_HINT);
  });

  it('never reads as "nothing found" when detectors did not run', () => {
    const html = renderToStaticMarkup(<DetectedEventsCard events={[]} summary={summary} review={review()} />);
    expect(html).toContain('No events found by the detectors that ran');
    expect(html).toContain('Not assessed');
  });
});

describe('NotAssessedList', () => {
  it('lists each detector that did not run with its reason', () => {
    const html = renderToStaticMarkup(
      <NotAssessedList
        detectors={[
          { name: 'electrode-pop', ran: false, skippedReason: 'no channel has a neighbouring electrode' },
          { name: 'lateral-eye', ran: false, skippedReason: 'needs one of F7 or AF7' },
        ]}
      />
    );
    expect(count(html, '<li')).toBe(2);
    expect(html).toContain('Electrode pops');
    expect(html).toContain('needs at least one of F7, AF7');
    expect(renderToStaticMarkup(<NotAssessedList detectors={[]} />)).toBe('');
  });
});
