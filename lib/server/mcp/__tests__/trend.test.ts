import { describe, it, expect } from 'vitest';
import { buildSessionSummary, type SessionSummary } from '@/lib/server/mcp/summary';
import { TREND_METRICS, buildTrend } from '@/lib/server/mcp/trend';
import { makeInput, makeRecording, makeResults } from './fixtures';

function make(day: number, conditions: ('eo' | 'ec')[] = ['eo', 'ec'], results: Record<string, unknown> = {}): SessionSummary {
  const date = new Date(Date.UTC(2026, 0, day, 10)).toISOString();
  const parts: Record<string, ReturnType<typeof makeInput>> = {};
  const ids: Record<string, string> = {};
  for (const c of conditions) {
    const rec = makeRecording({ condition_type: c.toUpperCase() as 'EO' | 'EC', created_at: date });
    parts[c] = makeInput(rec, makeResults({ conditions: [c], ...results }));
    ids[c] = rec.id;
  }
  return buildSessionSummary({ id: `s${day}`, recordingIds: ids, date, pairing: 'filename' }, parts);
}

describe('buildTrend', () => {
  it('clamps lastN to 20 and keeps the most recent, ascending by date', () => {
    const sessions = Array.from({ length: 30 }, (_, i) => make(30 - i)); // given newest first
    const [t] = buildTrend(sessions, ['theta_beta_frontal'], 50);
    expect(t.points).toHaveLength(20);
    expect(t.points[0].session_id).toBe('s11');
    expect(t.points[19].session_id).toBe('s30');
  });

  it('clamps lastN below 1 to 1', () => {
    const [t] = buildTrend([make(1), make(2)], ['faa'], 0);
    expect(t.points.map((p) => p.session_id)).toEqual(['s2']);
  });

  it('a session missing EC has null alpha_peak_ec, and null reactivity', () => {
    const out = buildTrend([make(1, ['eo']), make(2)], ['alpha_peak_ec', 'alpha_reactivity'], 10);
    const [peak, react] = out;
    expect(peak.points[0].value).toBeNull();
    expect(peak.points[1].value).not.toBeNull();
    expect(react.points[0].value).toBeNull();
    expect(react.points[1].value).toBe(80);
  });

  it('reads ratios, FAA and rejection with confidence', () => {
    const s = make(1, ['eo', 'ec'], { rejection: { eo: 5, ec: 12 }, thetaBeta: { frontal_avg: 3 } });
    const out = Object.fromEntries(buildTrend([s], [...TREND_METRICS], 5).map((t) => [t.metric, t.points[0]]));
    expect(out.theta_beta_frontal.value).toBe(3);
    expect(out.faa.value).toBe(-0.123);
    expect(out.rejection_pct.value).toBe(12);
    expect(out.rejection_pct.confidence).toBe('high');
    expect(out.rel_alpha_occipital_ec.value).toBeGreaterThan(0);
    expect(out.rel_theta_frontal_eo.value).toBeGreaterThan(0);
    expect(out.lzc_mean_eo.value).toBeGreaterThan(0);
    expect(out.alpha_peak_eo.value).toBeGreaterThan(0);
  });

  it('EO-only session falls back to the EO source for ratios', () => {
    const out = buildTrend([make(1, ['eo'], { thetaBeta: { central_avg: 4 } })], ['theta_beta_central'], 5);
    expect(out[0].points[0].value).toBe(4);
  });
});
