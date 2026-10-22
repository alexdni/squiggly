import { describe, it, expect } from 'vitest';
import { qualityBlock, isLegacyResults, worse, stepDown } from '@/lib/server/mcp/quality';
import type { QcReportSummary } from '@/lib/analysis-results';

function qc(over: Partial<QcReportSummary> = {}): QcReportSummary {
  return {
    artifact_mode: 'ica',
    artifact_rejection_rate: 5,
    final_epochs_eo: 60,
    final_epochs_ec: 60,
    bad_channels: [],
    ica_components_removed: 2,
    original_sfreq: 500,
    final_sfreq: 250,
    n_channels: 19,
    ...over,
  };
}

describe('qualityBlock', () => {
  it('grades a clean report high', () => {
    const q = qualityBlock(qc());
    expect(q.confidence).toBe('high');
    expect(q.reasons).toEqual([]);
    expect(q.rejection_pct).toBe(5);
    expect(q.epochs_kept).toEqual({ eo: 60, ec: 60 });
    expect(q.asr_applied).toBe(false);
    expect(q.interpolated_channels).toEqual([]);
    expect(q.ica_removed_labels).toEqual([]);
    expect(q.warnings).toEqual([]);
  });

  it('is low when more than 30% of epochs are rejected', () => {
    const q = qualityBlock(qc({ artifact_rejection_rate: 31 }));
    expect(q.confidence).toBe('low');
    expect(q.reasons.join(' ')).toContain('30%');
  });

  it('is not low at exactly 30%', () => {
    expect(qualityBlock(qc({ artifact_rejection_rate: 30 })).confidence).toBe('high');
  });

  it('is low when 3 of 19 channels are bad', () => {
    const q = qualityBlock(qc({ bad_channels: ['Fp1', 'Fz', 'O1'] }));
    expect(q.confidence).toBe('low');
    expect(q.bad_channels).toEqual(['Fp1', 'Fz', 'O1']);
  });

  it('is not low on the channel rule with 2 of 19 bad', () => {
    expect(qualityBlock(qc({ bad_channels: ['Fp1', 'Fz'] })).confidence).toBe('high');
  });

  it('skips the bad-channel rule when n_channels is 0', () => {
    expect(qualityBlock(qc({ n_channels: 0, bad_channels: ['Fp1'] })).confidence).toBe('high');
  });

  it('is moderate with fewer than 20 clean epochs', () => {
    const q = qualityBlock(qc({ final_epochs_eo: 18 }));
    expect(q.confidence).toBe('moderate');
    expect(q.reasons.length).toBe(1);
  });

  it('does not penalise an EO-only file for its empty EC side', () => {
    expect(qualityBlock(qc({ final_epochs_ec: 0 })).confidence).toBe('high');
  });

  it('with a condition, uses that condition rate and epochs only', () => {
    const r = qc({ artifact_rejection_rate: 5, eo_rejection_rate: 40, ec_rejection_rate: 2, final_epochs_ec: 10 });
    const eo = qualityBlock(r, 'eo');
    expect(eo.confidence).toBe('low');
    expect(eo.rejection_pct).toBe(40);
    expect(eo.epochs_kept).toEqual({ eo: 60 });
    const ec = qualityBlock(r, 'ec');
    expect(ec.confidence).toBe('moderate');
    expect(ec.rejection_pct).toBe(2);
    expect(ec.epochs_kept).toEqual({ ec: 10 });
  });

  it('falls back to the overall rate when the condition rate is missing', () => {
    expect(qualityBlock(qc({ artifact_rejection_rate: 12 }), 'eo').rejection_pct).toBe(12);
  });

  it('adds an ICA note above 5 components without changing confidence', () => {
    const q = qualityBlock(qc({ ica_components_removed: 6 }));
    expect(q.confidence).toBe('high');
    expect(q.reasons.some((r) => r.includes('ICA'))).toBe(true);
  });

  it('reports ASR and optional arrays', () => {
    const q = qualityBlock(
      qc({
        asr: { ran: true, k: 20, fraction_windows_modified: 0.1 },
        interpolated_channels: ['T3'],
        ica_removed_labels: ['eye-blink'],
        warnings: ['w'],
      }),
    );
    expect(q.asr_applied).toBe(true);
    expect(q.interpolated_channels).toEqual(['T3']);
    expect(q.ica_removed_labels).toEqual(['eye-blink']);
    expect(q.warnings).toEqual(['w']);
  });
});

describe('worse / stepDown', () => {
  it('picks the worse confidence', () => {
    expect(worse('high', 'low')).toBe('low');
    expect(worse('moderate', 'high')).toBe('moderate');
    expect(worse('high', 'high')).toBe('high');
  });
  it('steps down one level, flooring at low', () => {
    expect(stepDown('high')).toBe('moderate');
    expect(stepDown('moderate')).toBe('low');
    expect(stepDown('low')).toBe('low');
  });
});

describe('isLegacyResults', () => {
  it('is true for a Python-shaped result with visuals and no engine', () => {
    expect(
      isLegacyResults({
        qc_report: { final_epochs_eo: 40 },
        visuals: { topo: 'https://example.com/topo.png' },
        processing_metadata: { processing_time_seconds: 3 },
      }),
    ).toBe(true);
  });

  it('is true for coherence without connectivity', () => {
    expect(isLegacyResults({ coherence: {}, qc_report: { final_epochs_eo: 40 }, processing_metadata: {} })).toBe(true);
  });

  it('is true when final_epochs_eo is not a number and there is no engine', () => {
    expect(isLegacyResults({ qc_report: {}, processing_metadata: {} })).toBe(true);
  });

  it('is false for a modern result with an engine', () => {
    expect(
      isLegacyResults({
        qc_report: { final_epochs_eo: 60 },
        connectivity: { EO: null, EC: null },
        processing_metadata: { engine: 'hybrid-asr-ica@0.34.0-beta.0', processing_time_seconds: 1 },
      }),
    ).toBe(false);
  });

  it('is false for non-objects', () => {
    expect(isLegacyResults(null)).toBe(false);
    expect(isLegacyResults('x')).toBe(false);
  });
});
