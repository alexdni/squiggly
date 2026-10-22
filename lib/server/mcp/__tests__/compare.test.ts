import { describe, it, expect } from 'vitest';
import { buildSessionSummary, type SessionSummary } from '@/lib/server/mcp/summary';
import { compareSessions } from '@/lib/server/mcp/compare';
import type { Session } from '@/lib/server/mcp/sessions';
import { SECRETS, makeInput, makeRecording, makeResults } from './fixtures';

interface Opts {
  date?: string;
  conditions?: ('eo' | 'ec')[];
  results?: Record<string, unknown>;
  rec?: Record<string, unknown>;
}

/** A split EO/EC session (or EO-only / EC-only) built through the real summary builder. */
function make(o: Opts = {}): SessionSummary {
  const date = o.date ?? '2026-10-01T10:00:00Z';
  const conds = o.conditions ?? ['eo', 'ec'];
  const parts: Record<string, ReturnType<typeof makeInput>> = {};
  const ids: Record<string, string> = {};
  for (const c of conds) {
    const rec = makeRecording({ condition_type: c.toUpperCase() as 'EO' | 'EC', created_at: date, ...o.rec });
    parts[c] = makeInput(rec, makeResults({ conditions: [c], ...o.results }));
    ids[c] = rec.id;
  }
  const session: Session = { id: `sess-${date}`, recordingIds: ids, date, pairing: 'filename' };
  return buildSessionSummary(session, parts);
}

describe('compareSessions', () => {
  it('A has EO+EC, B has EO only: EC deltas omitted and a caveat names it', () => {
    const c = compareSessions(make(), make({ conditions: ['eo'], date: '2026-10-11T10:00:00Z' }), {});
    expect(c.conditions.eo).toBeDefined();
    expect(c.conditions.ec).toBeUndefined();
    expect(c.caveats).toContain('EC missing in B, EC deltas omitted');
    expect(c.days_between).toBe(10);
    expect(c.a.conditions).toEqual(['eo', 'ec']);
    expect(c.b.conditions).toEqual(['eo']);
  });

  it('engine versions differ: caveat, confidence stepped down once, bare versions', () => {
    const c = compareSessions(make(), make({ date: '2026-11-01T10:00:00Z' }), {
      a: 'hybrid-asr-ica@0.33.0',
      b: 'hybrid-asr-ica@0.34.0-beta.0',
    });
    expect(c.caveats).toContain('engine version differs (0.33.0 vs 0.34.0-beta.0)');
    expect(c.confidence).toBe('moderate');
    expect(c.engine_versions).toEqual({ a: '0.33.0', b: '0.34.0-beta.0' });
    expect(JSON.stringify(c)).not.toContain('hybrid-asr-ica');
  });

  it('identical engines: no engine_versions, confidence not stepped down', () => {
    const c = compareSessions(make(), make({ date: '2026-11-01T10:00:00Z' }), { a: 'e@1', b: 'e@1' });
    expect(c.engine_versions).toBeUndefined();
    expect(c.confidence).toBe('high');
  });

  it('several mismatches step down only once and each adds a caveat', () => {
    const c = compareSessions(
      make(),
      make({ conditions: ['eo'], rec: { montage: '10-10', sampling_rate: 500 } }),
      { a: 'x@1', b: 'x@2' },
    );
    expect(c.caveats).toEqual(
      expect.arrayContaining([
        'engine version differs (1 vs 2)',
        'montage differs',
        'sampling rate differs',
        'EC missing in B, EC deltas omitted',
      ]),
    );
    expect(c.confidence).toBe('moderate');
  });

  it('confidence is the worse of the two sides', () => {
    const c = compareSessions(make(), make({ results: { rejection: { overall: 40 } } }), {});
    expect(c.confidence).toBe('low');
  });

  it('FAA crossing the threshold shows up as a risk pattern flip', () => {
    const a = make({ results: { risk: { depression_like: false } } });
    const b = make({ results: { risk: { depression_like: true } }, date: '2026-11-01T10:00:00Z' });
    const c = compareSessions(a, b, {});
    expect(c.risk_pattern_flips).toContainEqual({ pattern: 'depression_like', from: false, to: true, condition: 'eo' });
    expect(c.risk_pattern_flips.every((f) => f.pattern !== 'adhd_like')).toBe(true);
  });

  it('top_channel_changes: 10 entries sorted by |abs_pct|', () => {
    const b = make({ results: { channelScale: { Fp1: 2, F3: 0.5, Cz: 1.3, O1: 0.8, P3: 1.1, T7: 1.6, Fz: 0.9 } } });
    const c = compareSessions(make(), b, {});
    const top = c.conditions.eo!.top_channel_changes;
    expect(top).toHaveLength(10);
    const mags = top.map((t) => Math.abs(t.abs_pct));
    expect([...mags].sort((x, y) => y - x)).toEqual(mags);
    expect(top[0]).toMatchObject({ channel: 'Fp1', abs_pct: 100 });
  });

  it('region deltas are B minus A with percent change and relative delta', () => {
    const b = make({ results: { channelScale: Object.fromEntries(['O1', 'O2'].map((k) => [k, 2])) } });
    const c = compareSessions(make(), b, {});
    const occ = c.conditions.eo!.region_deltas.occipital!;
    expect(occ.theta!.abs_pct).toBe(100);
    expect(occ.theta!.rel_delta).toBe(0);
    expect(c.conditions.eo!.region_deltas.frontal!.theta!.abs_pct).toBe(0);
  });

  it('alpha peak and LZC deltas are B minus A', () => {
    const c = compareSessions(make(), make(), {});
    expect(c.conditions.eo!.alpha_peak_delta_hz).toBe(0);
    expect(c.conditions.eo!.lzc_delta).toBe(0);
  });

  it('ratio and asymmetry deltas are keyed by condition and B minus A', () => {
    const b = make({
      results: { thetaBeta: { frontal_avg: 3.71828 }, asymmetry: { frontal_alpha: 0.1, parietal_alpha: 0.054321, frontal_theta: 0.011111 } },
    });
    const c = compareSessions(make(), b, {});
    expect(c.ratio_deltas.eo!.theta_beta_frontal).toBe(1);
    expect(c.ratio_deltas.ec).toBeDefined();
    expect(c.asymmetry_deltas.eo!.frontal_alpha).toBeCloseTo(0.223, 3);
  });

  it('a combined file matches a single-condition file with a caveat', () => {
    const rec = makeRecording({ condition_type: undefined, filename: 'scan.edf' });
    const both = buildSessionSummary(
      { id: 's', recordingIds: { both: rec.id }, date: '2026-10-01T10:00:00Z', pairing: 'single' },
      { both: makeInput(rec, makeResults()) },
    );
    const c = compareSessions(both, make({ conditions: ['ec'] }), {});
    expect(c.ratio_deltas.ec).toBeDefined();
    expect(c.caveats).toContain('ratios compared across a combined EO/EC file and a single-condition file');
  });

  it('percent changes omit entries where A is zero (never Infinity/NaN)', () => {
    const a = make();
    a.conditions.eo!.band_power.by_channel.Fp1.delta = [0, 0.1];
    const c = compareSessions(a, make(), {});
    expect(c.conditions.eo!.top_channel_changes.some((t) => t.channel === 'Fp1' && t.band === 'delta')).toBe(false);
    expect(JSON.stringify(c)).not.toMatch(/Infinity|NaN|null/);
  });

  it('reactivity delta present when both sessions have it', () => {
    const c = compareSessions(make(), make({ results: { ecAlphaGain: { occipital: 2.8 } } }), {});
    expect(c.reactivity_delta).toMatchObject({ occipital_alpha_change_pct: 100 });
  });

  it('A more recent than B is still B minus A, with a caveat', () => {
    const c = compareSessions(make({ date: '2026-11-01T10:00:00Z' }), make({ date: '2026-10-01T10:00:00Z' }), {});
    expect(c.days_between).toBe(31);
    expect(c.caveats).toContain('A is more recent than B');
  });

  it('output carries no identifying data', () => {
    const c = JSON.stringify(compareSessions(make(), make(), { a: 'hybrid-asr-ica@0.33.0', b: 'hybrid-asr-ica@0.34.0' }));
    for (const v of Object.values(SECRETS)) expect(c).not.toContain(v);
    expect(c).not.toMatch(/https?:\/\//);
  });
});
