import { describe, expect, it } from 'vitest';
import type { EventBand } from '@/components/visuals/detected-events/format';
import { bandDescription, bandsAt, visibleBandAnnotations } from '../detectedBands';

const band = (over: Partial<EventBand>): EventBand => ({
  id: 'detected-x',
  pattern: 'muscle',
  category: 'artifact',
  startSec: 0,
  endSec: 1,
  channels: [],
  allChannels: false,
  eventIds: ['x'],
  ...over,
});

describe('detected-event bands in the viewer', () => {
  const bands = [
    band({ id: 'a', startSec: 1, endSec: 2, channels: ['T8'] }),
    band({ id: 'b', startSec: 12, endSec: 14, pattern: 'amplitude-ceiling', channels: ['O1', 'O2', 'Pz', 'P3'] }),
    band({ id: 'c', startSec: 30, endSec: 31, allChannels: true, pattern: 'asr-repair' }),
  ];

  it('builds read-only annotations only for bands in the visible window', () => {
    const anns = visibleBandAnnotations(bands, 10, 20, { amplitudeThresholdUv: 100, selectedId: 'b' });
    expect(anns).toHaveLength(1);
    expect(anns[0]).toMatchObject({
      id: 'b',
      type: 'detected',
      readOnly: true,
      startTime: 12,
      endTime: 14,
      highlighted: true,
      description: 'Amplitude over 100 µV · 4 channels',
    });
    expect(anns[0].color).toMatch(/^\d+, \d+, \d+$/);
  });

  it('describes a band by pattern and channels', () => {
    expect(bandDescription(bands[0])).toBe('Muscle · T8');
    expect(bandDescription(bands[2])).toBe('ASR repair');
  });

  it('finds the bands under a click, shortest first', () => {
    const wide = band({ id: 'wide', startSec: 0, endSec: 20 });
    expect(bandsAt([wide, ...bands], 13).map((b) => b.id)).toEqual(['b', 'wide']);
    expect(bandsAt(bands, 25)).toEqual([]);
  });
});
