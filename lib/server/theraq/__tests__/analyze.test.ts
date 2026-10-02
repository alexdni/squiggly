import { describe, it, expect } from 'vitest';
import { adaptiveRejectEpochs, analyzeTheraq, TheraqAnalysisError } from '../analyze';

const epoch = (...p2p: number[]) => p2p.map((a) => Float64Array.from([0, a, -a / 2]));

describe('adaptiveRejectEpochs', () => {
  it('drops epochs above median + k*1.4826*MAD of the worst-channel peak-to-peak', () => {
    // worst-channel p2p (1.5 * a): 15, 16.5, 18, 15, 300
    const epochs = [epoch(10, 2), epoch(11), epoch(12, 1), epoch(10), epoch(9, 200)];
    const { keptIndices, threshold } = adaptiveRejectEpochs(epochs, 5);
    // median 16.5, MAD 1.5 -> 16.5 + 5*1.4826*1.5
    expect(threshold).toBeCloseTo(16.5 + 5 * 1.4826 * 1.5, 12);
    expect(keptIndices).toEqual([0, 1, 2, 3]);
  });

  it('keeps everything when MAD is zero', () => {
    const epochs = [epoch(10), epoch(10), epoch(10), epoch(99)];
    const res = adaptiveRejectEpochs(epochs);
    expect(res.kept).toHaveLength(4);
    expect(res.threshold).toBe(15);
  });

  it('handles no epochs', () => {
    expect(adaptiveRejectEpochs([]).threshold).toBeNull();
  });
});

describe('analyzeTheraq input validation', () => {
  it('requires all four phases, listed in phase order', () => {
    expect(() => analyzeTheraq({})).toThrow(TheraqAnalysisError);
    expect(() => analyzeTheraq({})).toThrow('Missing phase recordings: EO1, EC, EO2, TASK');
  });

  it('rejects a phase without epochs', () => {
    const empty = { sfreq: 128, channels: ['O1', 'Cz', 'F3', 'F4'], epochs: [] };
    expect(() => analyzeTheraq({ EO1: empty, EC: empty, EO2: empty, TASK: empty })).toThrow(
      'Phase EO1: no epochs could be formed from the recording',
    );
  });
});
