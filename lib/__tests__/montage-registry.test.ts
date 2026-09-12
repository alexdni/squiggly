import { describe, expect, it } from 'vitest';
import {
  ALL_EEG_CHANNELS,
  MONTAGE_10_20_19CH,
  MONTAGE_BRAINPRODUCTS_ACTICAP_64,
} from '../constants';
import {
  getMontageProfile,
  isKnownEEGChannel,
  normalizeEEGChannelName,
} from '../montage-registry';

describe('canonical montage registry', () => {
  it('preserves the existing 19-channel 10-20 montage', () => {
    expect(MONTAGE_10_20_19CH).toEqual([
      'Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8',
      'T7', 'C3', 'Cz', 'C4', 'T8',
      'P7', 'P3', 'Pz', 'P4', 'P8',
      'O1', 'O2',
    ]);
    expect(getMontageProfile('10-20-19').channels).toHaveLength(19);
  });

  it('includes the existing extended 10-10 channels in the known channel set', () => {
    for (const channel of ['FC1', 'FC2', 'CP1', 'CP2', 'Oz', 'PO7', 'PO8', 'FT9', 'FT10']) {
      expect(ALL_EEG_CHANNELS).toContain(channel);
    }
  });

  it('adds a 64-channel Brain Products actiCAP profile', () => {
    const profile = getMontageProfile('brainproducts-acticap-64');

    expect(profile.vendor).toBe('Brain Products');
    expect(profile.capModel).toBe('actiCAP');
    expect(profile.channels).toHaveLength(64);
    expect(new Set(profile.channels)).toHaveLength(64);
    expect(MONTAGE_BRAINPRODUCTS_ACTICAP_64).toEqual(profile.channels);

    for (const channel of ['Fp1', 'AFz', 'F1', 'FCz', 'C1', 'CPz', 'P1', 'POz', 'Oz', 'Iz']) {
      expect(profile.channels).toContain(channel);
      expect(ALL_EEG_CHANNELS).toContain(channel);
    }
  });

  it('normalizes common channel-name cases used by existing validators', () => {
    expect(normalizeEEGChannelName('FP1')).toBe('Fp1');
    expect(normalizeEEGChannelName('EEG FP1-LE')).toBe('Fp1');
    expect(normalizeEEGChannelName('T3')).toBe('T7');
    expect(normalizeEEGChannelName('T4')).toBe('T8');
    expect(normalizeEEGChannelName('T5')).toBe('P7');
    expect(normalizeEEGChannelName('T6')).toBe('P8');
    expect(normalizeEEGChannelName('M1')).toBe('A1');
    expect(normalizeEEGChannelName('M2')).toBe('A2');
  });

  it('recognizes synthetic actiCAP-like channel names', () => {
    const syntheticActicapChannels = getMontageProfile('brainproducts-acticap-64').channels;

    expect(syntheticActicapChannels).toHaveLength(64);
    for (const channel of syntheticActicapChannels) {
      expect(isKnownEEGChannel(channel)).toBe(true);
    }
  });
});
