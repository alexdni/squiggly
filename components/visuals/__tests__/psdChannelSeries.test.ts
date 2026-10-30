import { describe, expect, it } from 'vitest';
import {
  BAND_PRESETS,
  GLOBAL,
  globalSpectrum,
  presetFor,
  psdCsv,
  seriesPoints,
} from '../psdChannelSeries';
import { snapAlphaPeak } from '../psdHeadMapLayout';

const spectra = {
  freqs: [1, 1.5, 2, 2.5],
  channels: { Fz: [4, 2, 1, 0], Cz: [2, NaN, 3, 1] },
};

describe('globalSpectrum', () => {
  it('averages the channels with a finite value at each bin', () => {
    expect(globalSpectrum(spectra)).toEqual([3, 2, 2, 0.5]);
  });

  it('is NaN where no channel has a value', () => {
    expect(globalSpectrum({ freqs: [1], channels: { Fz: [NaN] } })).toEqual([NaN]);
  });
});

describe('seriesPoints', () => {
  it('keeps the range and drops what a log axis cannot show', () => {
    expect(seriesPoints(spectra.freqs, spectra.channels.Fz, [1.5, 2.5])).toEqual([
      { x: 1.5, y: 2 },
      { x: 2, y: 1 },
    ]);
    expect(seriesPoints(spectra.freqs, spectra.channels.Cz, [1, 45]).map((p) => p.x)).toEqual([1, 2, 2.5]);
  });
});

describe('presets', () => {
  it('starts with the full stored range and names a matching band', () => {
    expect(BAND_PRESETS[0].range).toEqual([1, 45]);
    expect(presetFor([1, 45])).toBe('full');
    expect(presetFor([8, 10])).toBe('alpha1');
    expect(presetFor([7, 11])).toBe('custom');
  });
});

describe('psdCsv', () => {
  it('writes the frequency and each shown trace within the range', () => {
    expect(psdCsv(spectra, [GLOBAL, 'Cz'], [1.5, 2])).toBe(
      'Frequency (Hz),Global (µV²/Hz),Cz (µV²/Hz)\n1.5,2,\n2,2,3\n'
    );
  });
});

describe('snapAlphaPeak', () => {
  it('puts the peak on the highest bin near the reported frequency', () => {
    const freqs = [9, 9.5, 10, 10.5, 11];
    expect(snapAlphaPeak(freqs, [1, 5, 3, 9, 2], 10)).toEqual({ freq: 10.5, power: 9 });
    expect(snapAlphaPeak(freqs, [1, 5, 3, 9, 2], undefined)).toBeNull();
    expect(snapAlphaPeak(freqs, [1, 5, 3, 9, 2], 20)).toBeNull();
  });
});
