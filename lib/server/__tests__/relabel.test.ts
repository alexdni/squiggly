import { describe, it, expect } from 'vitest';
import { relabelToCondition } from '@/lib/server/relabel';
import type { AnalysisResults } from '@/lib/analysis-results';
import { makeResults } from '@/lib/server/mcp/__tests__/fixtures';

const withSloreta = (r: AnalysisResults): AnalysisResults =>
  ({
    ...r,
    sloreta: { conditions: ['eo'], epochs_used: { eo: 40 }, stats: { eo: { alpha: { max: 1, mean: 0.5, peak: null } } } },
  }) as unknown as AnalysisResults;

describe('relabelToCondition', () => {
  it('moves whole-recording eo results to ec for an EC recording', () => {
    const r = withSloreta(makeResults({ conditions: ['eo'] }));
    const out = relabelToCondition(r, 'EC')!;
    expect(out.band_power.ec).toEqual(r.band_power.eo);
    expect(out.band_power.eo).toBeNull();
    for (const k of ['connectivity', 'lzc', 'alpha_peak', 'psd'] as const) {
      expect((out[k] as Record<string, unknown>).ec).toEqual((r[k] as Record<string, unknown>).eo);
      expect((out[k] as Record<string, unknown>).eo ?? null).toBeNull();
    }
    expect(out.qc_report.final_epochs_ec).toBe(r.qc_report.final_epochs_eo);
    expect(out.qc_report.final_epochs_eo).toBe(0);
    expect(out.qc_report.ec_rejection_rate).toBe(r.qc_report.eo_rejection_rate);
    expect('eo_rejection_rate' in out.qc_report).toBe(false);
    expect(out.rejected_epochs[0].condition).toBe('ec');
    expect(out.sloreta!.conditions).toEqual(['ec']);
    expect(out.sloreta!.epochs_used).toEqual({ ec: 40 });
    expect(Object.keys(out.sloreta!.stats)).toEqual(['ec']);
    // input untouched
    expect(r.band_power.eo).not.toBeNull();
  });

  it('moves the analyzed segments and the sLORETA time-lapse segments too', () => {
    const base = withSloreta(makeResults({ conditions: ['eo'] }));
    const r = {
      ...base,
      segments: { eo: { start: 0, end: 300 } },
      sloreta: { ...base.sloreta!, timeline: { window_sec: 2, hop_sec: 1, n_windows: 299, rejected: [], segments: { eo: { start: 0, end: 300 } } } },
    } as AnalysisResults;
    const out = relabelToCondition(r, 'EC')!;
    expect(out.segments).toEqual({ ec: { start: 0, end: 300 } });
    expect(out.sloreta!.timeline!.segments).toEqual({ ec: { start: 0, end: 300 } });
  });

  it('leaves results alone when they already match, for BOTH, and when both conditions exist', () => {
    const eoOnly = makeResults({ conditions: ['eo'] });
    expect(relabelToCondition(eoOnly, 'EO')).toBe(eoOnly);
    expect(relabelToCondition(eoOnly, 'BOTH')).toBe(eoOnly);
    const both = makeResults({ conditions: ['eo', 'ec'] });
    expect(relabelToCondition(both, 'EC')).toBe(both);
    expect(relabelToCondition(null, 'EC')).toBeNull();
  });
});
