import { describe, expect, it } from 'vitest';
import {
  canDismiss,
  coveredSeconds,
  eventHandlingText,
  evidenceItems,
  formatClock,
  groupEvents,
  handlingText,
  hasUnappliedDismissals,
  mergeEventBands,
  patternName,
  skippedReasonText,
  tierText,
  traceHighlights,
} from '../format';
import { ev } from './fixtures';

describe('pattern names', () => {
  it('reads known patterns in plain words', () => {
    expect(patternName('eye-blink')).toBe('Eye blink');
    expect(patternName('lateral-eye')).toBe('Lateral eye movement');
    expect(patternName('electrode-pop')).toBe('Electrode pop');
    expect(patternName('post-clean-rejection')).toBe('Rejected after cleaning');
    expect(patternName('asr-repair')).toBe('ASR repair');
    expect(patternName('ecg-artifact')).toBe('ECG artifact');
  });

  it('names the amplitude ceiling with the configured threshold, 160 µV by default', () => {
    expect(patternName('amplitude-ceiling')).toBe('Amplitude over 160 µV');
    expect(patternName('amplitude-ceiling', { amplitudeThresholdUv: 120 })).toBe('Amplitude over 120 µV');
  });

  it('falls back to the raw name for unknown patterns', () => {
    expect(patternName('posterior-slow-wave')).toBe('posterior-slow-wave');
  });
});

describe('handling wording', () => {
  it('says what the cleaning did', () => {
    expect(handlingText('repaired', 'blinkRegression')).toBe('repaired by blink regression');
    expect(handlingText('repaired', 'asr')).toBe('repaired by ASR');
    expect(handlingText('removed-component', 'eye-blink')).toBe('removed with ICA component (eye-blink)');
    expect(handlingText('removed-component', 'ica:muscle')).toBe('removed with ICA component (muscle)');
    expect(handlingText('rejected')).toBe('excluded epochs');
    expect(handlingText('rejected', undefined, { scope: 'channel', firstEpoch: 0, lastEpoch: 2 })).toBe(
      'excluded epochs (this channel)'
    );
    expect(handlingText('channel-excluded', 'channelQc')).toBe('channel left out');
    expect(handlingText('interpolated', 'channelQc')).toBe('channel rebuilt from neighbours');
    expect(handlingText('noted')).toBe('noted');
  });

  it('adds what the stages did for labels-only detector events', () => {
    const e = ev({
      pattern: 'eye-blink',
      source: 'detector',
      evidence: { peakUv: 114, stageHandling: 'repaired', stageHandledBy: 'transientRepair' },
    });
    expect(eventHandlingText(e)).toBe('noted (cleaning: repaired by transient repair)');
  });

  it('describes skipped detectors and coverage tiers in plain words', () => {
    expect(skippedReasonText('no ECG lead')).toBe('the recording has no usable ECG lead');
    expect(skippedReasonText('needs one of Fp1 or Fp2 or Fpz')).toBe('needs at least one of Fp1, Fp2, Fpz');
    expect(skippedReasonText('something new')).toBe('something new');
    expect(skippedReasonText(undefined)).toBe('not run on this recording');
    expect(tierText('A')).toBe('basic (any montage)');
    expect(tierText('B')).toBe('lateral frontal sites present');
    expect(tierText('C')).toBe('full 10-20 montage');
  });

  it('formats evidence and times', () => {
    expect(evidenceItems({ maxUv: 52529.24, count: 61, stageHandling: 'repaired' })).toEqual([
      'max µV 52529',
      'count 61',
    ]);
    expect(formatClock(75.25)).toBe('1:15.3');
    expect(formatClock(3.04)).toBe('0:03.0');
    expect(formatClock(59.96)).toBe('1:00.0');
  });
});

describe('grouping', () => {
  it('makes one row per pattern with count, covered time, channels and handling', () => {
    const events = [
      ev({ pattern: 'post-clean-rejection', startSec: 0, endSec: 4, channels: ['O1'], handling: 'rejected' }),
      ev({ pattern: 'post-clean-rejection', startSec: 2, endSec: 6, channels: ['O2'], handling: 'rejected' }),
      ev({ pattern: 'post-clean-rejection', startSec: 10, endSec: 12, channels: ['O1'], handling: 'rejected' }),
      ev({ pattern: 'muscle', startSec: 1, endSec: 2, channels: ['T8'], source: 'detector' }),
      ev({ pattern: 'asr-repair', startSec: 3, endSec: 4, handling: 'repaired', handledBy: 'asr' }),
    ];
    const groups = groupEvents(events);
    expect(groups.map((g) => g.pattern)).toEqual(['post-clean-rejection', 'asr-repair', 'muscle']);
    const pcr = groups[0];
    expect(pcr.events).toHaveLength(3);
    expect(pcr.coveredSec).toBeCloseTo(8); // 0–6 and 10–12, overlap counted once
    expect(pcr.channels.sort()).toEqual(['O1', 'O2']);
    expect(pcr.handlings).toEqual(['excluded epochs']);
    expect(pcr.nDismissible).toBe(3);
    const asr = groups.find((g) => g.pattern === 'asr-repair')!;
    expect(asr.allChannels).toBe(true);
    expect(asr.handlings).toEqual(['repaired by ASR']);
  });

  it('counts covered time once for overlapping spans', () => {
    expect(coveredSeconds([{ startSec: 0, endSec: 2 }, { startSec: 1, endSec: 3 }, { startSec: 5, endSec: 6 }])).toBe(4);
  });
});

describe('dismissals', () => {
  it('flags dismissals the last run did not apply, and withdrawn ones', () => {
    const rej = ev({ pattern: 'amplitude-ceiling', handling: 'rejected' });
    const noted = ev({ pattern: 'muscle' });
    expect(hasUnappliedDismissals([rej, noted], {})).toBe(false);
    expect(hasUnappliedDismissals([rej, noted], { [rej.id]: 'dismissed' })).toBe(true);
    expect(hasUnappliedDismissals([{ ...rej, dismissed: true }], { [rej.id]: 'dismissed' })).toBe(false);
    expect(hasUnappliedDismissals([{ ...rej, dismissed: true }], {})).toBe(true);
    expect(hasUnappliedDismissals([rej], { [rej.id]: 'confirmed' })).toBe(false);
  });
});

describe('viewer bands', () => {
  it('merges per-channel events of one pattern that overlap in time', () => {
    const a = ev({ pattern: 'post-clean-rejection', startSec: 0, endSec: 4, channels: ['O1'] });
    const b = ev({ pattern: 'post-clean-rejection', startSec: 2, endSec: 6, channels: ['O2'] });
    const c = ev({ pattern: 'post-clean-rejection', startSec: 6, endSec: 7, channels: ['O1'] }); // touches b
    const d = ev({ pattern: 'post-clean-rejection', startSec: 9, endSec: 10, channels: ['Fz'] });
    const m = ev({ pattern: 'muscle', startSec: 1, endSec: 3, channels: ['T8'] });
    const bands = mergeEventBands([d, c, b, a, m]);
    expect(bands).toHaveLength(3);
    const first = bands.find((x) => x.pattern === 'post-clean-rejection' && x.startSec === 0)!;
    expect(first.endSec).toBe(7);
    expect(first.eventIds.sort()).toEqual([a.id, b.id, c.id].sort());
    expect(first.channels.sort()).toEqual(['O1', 'O2']);
    expect(bands.find((x) => x.pattern === 'muscle')!.eventIds).toEqual([m.id]);
    expect(bands.find((x) => x.startSec === 9)!.channels).toEqual(['Fz']);
  });

  it('leaves out recording-wide patterns and marks all-channel bands', () => {
    const bands = mergeEventBands([
      ev({ pattern: 'bad-channel', startSec: 0, endSec: 120, channels: ['T7'], handling: 'interpolated' }),
      ev({ pattern: 'ica-component', startSec: 0, endSec: 120, handling: 'removed-component' }),
      ev({ pattern: 'asr-repair', startSec: 2, endSec: 3 }),
      ev({ pattern: 'asr-repair', startSec: 2.5, endSec: 4, channels: ['Fz'] }),
    ]);
    expect(bands).toHaveLength(1);
    expect(bands[0].allChannels).toBe(true);
    expect(bands[0].channels).toEqual([]);
  });
});

describe('mu rhythm events', () => {
  const mu = (startSec: number, channels: string[]) =>
    ev({ pattern: 'mu-rhythm', category: 'variant', source: 'detector', startSec, endSec: startSec + 1.5, channels });

  it('are named and can be dismissed although they reject nothing', () => {
    expect(patternName('mu-rhythm')).toBe('Mu rhythm');
    expect(canDismiss(mu(0, ['C3']))).toBe(true);
    expect(canDismiss(ev({ pattern: 'muscle' }))).toBe(false);
    expect(canDismiss(ev({ pattern: 'muscle', handling: 'rejected' }))).toBe(true);
  });

  it('highlight their own channel inside the window, skipping dismissed ones', () => {
    const a = mu(10, ['C3']);
    const b = mu(12, ['C4']);
    const outside = mu(40, ['C3']);
    const other = ev({ pattern: 'muscle', startSec: 10, endSec: 11, channels: ['T7'] });
    expect(traceHighlights([a, b, outside, other], {}, 9, 20)).toEqual([
      { channel: 'C3', startSec: 10, endSec: 11.5, category: 'variant' },
      { channel: 'C4', startSec: 12, endSec: 13.5, category: 'variant' },
    ]);
    expect(traceHighlights([a, b], { [b.id]: 'dismissed' }, 9, 20).map((h) => h.channel)).toEqual(['C3']);
  });
});
