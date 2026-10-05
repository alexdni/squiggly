import { describe, expect, it } from 'vitest';
import { computeOriginalOverlay, matchChannels, resampleAt } from '../originalOverlay';
import type { UnifiedSignalData } from '../types';

describe('matchChannels', () => {
  it('matches corrected labels to raw labels with prefixes, suffixes and old names', () => {
    expect(matchChannels(['Fp1', 'T7', 'O2', 'Cz'], ['EEG Fp1-LE', 'EEG T3-LE', 'EXG1', 'O2'])).toEqual([0, 1, 3, null]);
  });
});

describe('resampleAt', () => {
  it('interpolates linearly and clamps at the edges', () => {
    expect(resampleAt([0, 1, 2], [0, 10, 20], [-1, 0.5, 1.25, 3])).toEqual([0, 5, 12.5, 20]);
  });
});

describe('computeOriginalOverlay', () => {
  const fs = 500;
  const seconds = 20;
  const n = fs * seconds;
  const alpha = (i: number) => 20 * Math.sin((2 * Math.PI * 10 * i) / fs);
  // Raw at 500 Hz with a common 60 Hz hum and a DC offset on every channel, plus a channel-local
  // 10 Hz rhythm on O2 only.
  const raw: UnifiedSignalData = {
    sampleRate: fs,
    duration: seconds,
    fileType: 'edf',
    channelNames: ['EEG O1-LE', 'EEG O2-LE', 'EEG Cz-LE'],
    signals: [0, 1, 2].map((c) =>
      Array.from({ length: n }, (_, i) => (c === 1 ? alpha(i) : 0) + 50 * Math.sin((2 * Math.PI * 60 * i) / fs) + 300)
    ),
  };
  const targetTimes = Array.from({ length: 1000 }, (_, k) => 8 + (k * 2) / 1000); // 8–10 s at 500 points/s

  it('re-references, filters and aligns the matching raw channels to the corrected time axis', () => {
    const [o2, missing] = computeOriginalOverlay({
      raw,
      cleanedNames: ['O2', 'Fp1'],
      selected: [0, 1],
      timeStart: 8,
      windowSeconds: 2,
      filters: { highpassHz: 1, lowpassHz: 45, notchHz: 60 },
      targetTimes,
    });
    expect(missing).toBeNull();
    // Only O2 exists in the corrected recording, so the average reference is O2 itself and
    // everything cancels: the reference uses exactly the channels the pipeline kept.
    expect(Math.max(...o2!.map(Math.abs))).toBeLessThan(1);
  });

  it('averages over all corrected channels present in the raw file', () => {
    const [o2] = computeOriginalOverlay({
      raw,
      cleanedNames: ['O1', 'O2', 'Cz'],
      selected: [1],
      timeStart: 8,
      windowSeconds: 2,
      filters: { highpassHz: 1, lowpassHz: 45, notchHz: 60 },
      targetTimes,
    });
    let err = 0;
    targetTimes.forEach((t, k) => {
      err = Math.max(err, Math.abs(o2![k] - (2 / 3) * alpha(Math.round(t * fs))));
    });
    expect(err).toBeLessThan(0.5);
  });
});
