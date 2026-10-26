import { describe, it, expect } from 'vitest';
import {
  analyzedSegments,
  conditionFromFilename,
  labelColumns,
  labelSummary,
  labelsOf,
  labelsProblem,
  recordingCondition,
  resultsMatchLabels,
  wholeFile,
} from '@/lib/eeg-condition';

const cols = (eo: [number, number] | null, ec: [number, number] | null) => ({
  eo_start: eo?.[0] ?? null,
  eo_end: eo?.[1] ?? null,
  ec_start: ec?.[0] ?? null,
  ec_end: ec?.[1] ?? null,
});

describe('conditionFromFilename', () => {
  it('reads the token in the name shapes clinics use', () => {
    expect(conditionFromFilename('ChrisR qEEG 01.000.06 AGE 35 EO.edf')).toBe('EO');
    expect(conditionFromFilename('ChrisR qEEG 01.000.02 AGE 35 EC.edf')).toBe('EC');
    expect(conditionFromFilename('Client 01.000.02 AGE 45  EC.edf')).toBe('EC');
    expect(conditionFromFilename('Client qEEG AGE47EC.edf')).toBe('EC');
    expect(conditionFromFilename('ClientoAGE45EO.edf')).toBe('EO');
    expect(conditionFromFilename('EC_.edf')).toBe('EC');
    expect(conditionFromFilename('client_EO_2026.bdf')).toBe('EO');
    expect(conditionFromFilename('(EC).edf')).toBe('EC');
    expect(conditionFromFilename('Eyes_Closed_baseline.edf')).toBe('EC');
    expect(conditionFromFilename('eyes-open.csv')).toBe('EO');
    expect(conditionFromFilename('theraq_EO1.edf')).toBe('EO');
  });

  it('ignores the token inside words and in the extension', () => {
    expect(conditionFromFilename('SPEC.edf')).toBeNull();
    expect(conditionFromFilename('with EOG and ECG.edf')).toBeNull();
    expect(conditionFromFilename('Dec recording.edf')).toBeNull();
    expect(conditionFromFilename('recording.ec')).toBeNull();
    expect(conditionFromFilename('client_saveas_.edf')).toBeNull();
  });

  it('gives up when the name has both', () => {
    expect(conditionFromFilename('client EO EC.edf')).toBeNull();
    expect(conditionFromFilename('EO then eyes closed.edf')).toBeNull();
  });
});

describe('labels', () => {
  it('reads numeric or string columns and summarises them', () => {
    expect(labelsOf({ eo_start: '0.00', eo_end: '358.00', ec_start: null, ec_end: null })).toEqual({ eo: { start: 0, end: 358 }, ec: null });
    expect(labelSummary(labelsOf(cols([0, 300], null)))).toBe('EO');
    expect(labelSummary(labelsOf(cols(null, [0, 300])))).toBe('EC');
    expect(labelSummary(labelsOf(cols([0, 150], [150, 300])))).toBe('EO+EC');
    expect(labelSummary(labelsOf(cols(null, null)))).toBeNull();
  });

  it('stores whole-file labels with a matching condition_type', () => {
    expect(labelColumns(wholeFile('EC', 363))).toEqual({
      eo_start: null, eo_end: null, eo_label: null, ec_start: 0, ec_end: 363, ec_label: 'EC', condition_type: 'EC',
    });
    expect(labelColumns({ eo: { start: 0, end: 100 }, ec: { start: 100, end: 200 } }).condition_type).toBe('BOTH');
    expect(labelColumns({ eo: null, ec: null }).condition_type).toBe('BOTH');
  });

  it('rejects segments that are reversed, too short, overlapping or past the end', () => {
    expect(labelsProblem({ eo: { start: 0, end: 150 }, ec: { start: 150, end: 300 } }, 300)).toBeNull();
    expect(labelsProblem({ eo: { start: 50, end: 20 }, ec: null }, 300)).toMatch(/after it starts/);
    expect(labelsProblem({ eo: { start: 0, end: 5 }, ec: null }, 300)).toMatch(/10 s/);
    expect(labelsProblem({ eo: { start: 0, end: 200 }, ec: { start: 150, end: 300 } }, 300)).toMatch(/overlap/);
    expect(labelsProblem({ eo: null, ec: { start: 0, end: 400 } }, 300)).toMatch(/after the recording/);
  });
});

describe('recordingCondition', () => {
  it('comes from the stored labels, never the filename', () => {
    expect(recordingCondition({ ...cols(null, [0, 300]), condition_type: 'BOTH' })).toBe('EC');
    expect(recordingCondition({ ...cols([0, 150], [150, 300]), condition_type: 'BOTH' })).toBe('BOTH');
    expect(recordingCondition({ ...cols(null, null), condition_type: 'BOTH' })).toBe('BOTH');
  });
});

describe('resultsMatchLabels', () => {
  const rec = (eo: [number, number] | null, ec: [number, number] | null) => ({ ...cols(eo, ec), duration_seconds: 300 });

  it('compares the stored segments with what a run would use now', () => {
    expect(resultsMatchLabels({ segments: { ec: { start: 0, end: 300 } } }, rec(null, [0, 300]))).toBe(true);
    expect(resultsMatchLabels({ segments: { eo: { start: 0, end: 300 } } }, rec(null, [0, 300]))).toBe(false);
    expect(resultsMatchLabels({ segments: { eo: { start: 0, end: 150 }, ec: { start: 150, end: 300 } } }, rec([0, 140], [150, 300]))).toBe(false);
    // unlabelled recordings run as one eyes-open segment
    expect(resultsMatchLabels({ segments: { eo: { start: 0, end: 300 } } }, rec(null, null))).toBe(true);
  });

  it('falls back to the conditions present for analyses that did not store segments', () => {
    expect(resultsMatchLabels({ band_power: { ec: {} } }, rec(null, [0, 300]))).toBe(true);
    expect(resultsMatchLabels({ band_power: { eo: {} } }, rec([0, 150], [150, 300]))).toBe(false);
  });

  it('runs an unlabelled recording as one eyes-open segment', () => {
    expect(analyzedSegments({ eo: null, ec: null }, 300)).toEqual({ eo: { start: 0, end: 300 }, ec: null });
  });
});
