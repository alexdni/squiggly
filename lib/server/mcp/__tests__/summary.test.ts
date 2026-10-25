import { describe, it, expect } from 'vitest';
import { buildSessionSummary, sig3 } from '@/lib/server/mcp/summary';
import { GUIDANCE, GUIDANCE_SHORT } from '@/lib/server/mcp/guidance';
import type { Session } from '@/lib/server/mcp/sessions';
import { LEAKY_WARNINGS, SECRETS, makeEvent, makeInput, makeRecording, makeResults } from './fixtures';

function splitSession(eoId: string, ecId: string): Session {
  return { id: 'sess-split', recordingIds: { eo: eoId, ec: ecId }, date: '2026-10-01T10:00:00Z', pairing: 'filename' };
}
function singleSession(key: 'eo' | 'ec' | 'both', id: string): Session {
  return { id: 'sess-single', recordingIds: { [key]: id }, date: '2026-10-01T10:00:00Z', pairing: 'single' };
}

function split(eoOpts = {}, ecOpts = {}, inputOver: { eo?: object; ec?: object } = {}) {
  const eoRec = makeRecording({ condition_type: 'EO' });
  const ecRec = makeRecording({ condition_type: 'EC', filename: 'Anna_Smith_2026-10-01_EC.edf' });
  const eo = makeInput(eoRec, makeResults({ conditions: ['eo'], ...eoOpts }), inputOver.eo);
  const ec = makeInput(ecRec, makeResults({ conditions: ['ec'], ...ecOpts }), inputOver.ec);
  return { session: splitSession(eoRec.id, ecRec.id), eo, ec };
}

describe('sig3', () => {
  it('rounds to 3 significant figures', () => {
    expect(sig3(1234.5)).toBe(1230);
    expect(sig3(0.0123456)).toBe(0.0123);
    expect(sig3(2.71828)).toBe(2.72);
    expect(sig3(0)).toBe(0);
  });
});

describe('buildSessionSummary', () => {
  it('split session: both conditions present and reactivity matches the hand-computed value', () => {
    const { session, eo, ec } = split();
    const s = buildSessionSummary(session, { eo, ec });
    expect(s.conditions.eo).toBeDefined();
    expect(s.conditions.ec).toBeDefined();
    // Fixture: alpha1+alpha2 abs at channel i = 7*(1+0.1i); EC gain 1.8 occipital, 1.3 parietal.
    // Occipital (O1,O2): +80%. Parietal sum 84, occipital 38.5 → EC 109.2 + 69.3 = 178.5 vs 122.5 → +45.7%.
    expect(s.eo_ec_reactivity).toEqual({ occipital_alpha_change_pct: 80, posterior_alpha_change_pct: 45.7 });
    expect(s.session.recordings).toHaveLength(2);
    expect(s.session.recordings.map((r) => r.condition).sort()).toEqual(['EC', 'EO']);
    expect(s.session.pairing).toBe('filename');
    expect(s.quality.eo).toBeDefined();
    expect(s.quality.ec).toBeDefined();
    expect(s.quality.confidence).toBe('high');
    // ratios / asymmetry / risk_patterns keyed per source analysis
    expect(Object.keys(s.ratios!).sort()).toEqual(['ec', 'eo']);
    expect(s.ratios!.eo!.theta_beta_ratio.frontal_avg).toBe(2.72);
    expect(s.asymmetry!.ec!.frontal_alpha).toBe(-0.123);
    expect(s.risk_patterns!.label).toBe('heuristic screens, not diagnoses');
    expect(s.risk_patterns!.eo!.adhd_like).toBe(true);
    expect(s.interpretation_guidance).toBe(GUIDANCE_SHORT);
    expect(s.unavailable).toBeUndefined();
  });

  it('carries mu indicators computed from both conditions', () => {
    const { session, eo, ec } = split();
    const mu = buildSessionSummary(session, { eo, ec }).mu_indicators!;
    expect(mu.condition).toBe('eo');
    expect(['likely', 'possible', 'not_detected']).toContain(mu.verdict);
    expect(mu.reactivity_selectivity).not.toBeNull();
    expect(Object.keys(mu.sites).sort()).toEqual(['C3', 'C4']);
  });

  it('condition summary: regions, channels, alpha peak, lzc and connectivity, rounded', () => {
    const { session, eo, ec } = split();
    const c = buildSessionSummary(session, { eo, ec }).conditions.eo!;
    expect(Object.keys(c.band_power.by_region).sort()).toEqual(['central', 'frontal', 'occipital', 'parietal', 'temporal']);
    expect(Object.keys(c.band_power.by_channel)).toHaveLength(19);
    // O1 is channel 17: delta abs = 1 * 2.7
    expect(c.band_power.by_channel.O1.delta[0]).toBe(2.7);
    // occipital theta abs mean = 2 * (2.7 + 2.8) / 2 = 5.5
    expect(c.band_power.by_region.occipital!.theta.abs).toBe(5.5);
    expect(c.band_power.by_region.occipital!.theta.rel).toBeCloseTo(2 / 36, 3);
    expect(c.alpha_peak.by_channel.Fp1).toBe(9.8);
    expect(typeof c.alpha_peak.mean_hz).toBe('number');
    expect(typeof c.lzc.mean_normalized).toBe('number');
    const alpha = c.connectivity.alpha!;
    expect(alpha.strongest).toHaveLength(5);
    expect(alpha.weakest).toHaveLength(5);
    expect(alpha.strongest[0].value).toBeGreaterThanOrEqual(alpha.strongest[4].value);
    expect(alpha.weakest[0].value).toBeLessThanOrEqual(alpha.weakest[4].value);
    expect(alpha.global_efficiency).toBe(0.432);
    expect(alpha.small_worldness).toBe(1.43);
  });

  it('EO-only single session: no reactivity and no EC condition', () => {
    const rec = makeRecording({ condition_type: 'EO' });
    const s = buildSessionSummary(singleSession('eo', rec.id), { eo: makeInput(rec, makeResults({ conditions: ['eo'] })) });
    expect(s.conditions.eo).toBeDefined();
    expect(s.conditions.ec).toBeUndefined();
    expect(s.eo_ec_reactivity).toBeUndefined();
    expect(s.quality.ec).toBeUndefined();
  });

  it('BOTH session reads both conditions from one analysis, keyed "both"', () => {
    const rec = makeRecording({ condition_type: 'BOTH' });
    const s = buildSessionSummary(singleSession('both', rec.id), {
      both: makeInput(rec, makeResults({ conditions: ['eo', 'ec'], hrv: true, sloreta: true })),
    });
    expect(s.conditions.eo).toBeDefined();
    expect(s.conditions.ec).toBeDefined();
    expect(s.eo_ec_reactivity?.occipital_alpha_change_pct).toBe(80);
    expect(Object.keys(s.ratios!)).toEqual(['both']);
    expect(Object.keys(s.hrv!)).toEqual(['both']);
    expect(Object.keys(s.sloreta!.both!).sort()).toEqual(['ec', 'eo']);
  });

  it('missing hrv, sloreta and events → keys absent, no throw', () => {
    const { session, eo, ec } = split();
    const s = buildSessionSummary(session, { eo, ec });
    expect('hrv' in s).toBe(false);
    expect('sloreta' in s).toBe(false);
    expect('events' in s).toBe(false);
    expect(s.clinical_flags).toEqual([]);
  });

  it('hrv summary without series; sloreta peaks per condition and band', () => {
    const { session, eo, ec } = split({ hrv: true, sloreta: true }, { sloreta: true });
    const s = buildSessionSummary(session, { eo, ec });
    expect(s.hrv!.eo).toEqual({
      reliable: true,
      coverage_pct: 97.1,
      beats: 352,
      summary: expect.objectContaining({ mean_hr_bpm: 70.5, lf_hf: 1.25 }),
    });
    expect(JSON.stringify(s.hrv)).not.toContain('series');
    expect(Object.keys(s.sloreta!.eo!)).toEqual(['eo']);
    expect(Object.keys(s.sloreta!.ec!)).toEqual(['ec']);
    expect(s.sloreta!.ec!.ec!.alpha1).toEqual({ max: 5.14, mean: 1.43, peak: { mni: [-32.4, 18.6, 44.2], region: 'left frontal', value: 5.14 } });
  });

  it('a confirmed epileptiform event is a clinical flag with review "confirmed"', () => {
    const ev = makeEvent({ category: 'epileptiform', pattern: 'spike-wave', channels: ['T7'], handling: 'noted' });
    const { session, eo, ec } = split({}, { events: [ev] }, { ec: { config: { event_reviews: { [ev.id]: 'confirmed' } } } });
    const s = buildSessionSummary(session, { eo, ec });
    expect(s.clinical_flags).toHaveLength(1);
    expect(s.clinical_flags[0]).toMatchObject({ id: ev.id, category: 'epileptiform', review: 'confirmed', condition: 'ec', channels: ['T7'] });
    expect(s.clinical_flags[0]).not.toHaveProperty('evidence');
    expect(s.events!.counts.epileptiform).toBe(1);
  });

  it('an unreviewed rhythmic-periodic event is a clinical flag with review "unreviewed"', () => {
    const ev = makeEvent({ category: 'rhythmic-periodic', pattern: 'LPD', handling: 'noted' });
    const { session, eo, ec } = split({ events: [ev] });
    const s = buildSessionSummary(session, { eo, ec });
    expect(s.clinical_flags).toHaveLength(1);
    expect(s.clinical_flags[0]).toMatchObject({ id: ev.id, review: 'unreviewed', condition: 'eo' });
  });

  it('a dismissed clinical event is not flagged', () => {
    const ev = makeEvent({ category: 'epileptiform', handling: 'noted' });
    const { session, eo, ec } = split({ events: [ev] }, {}, { eo: { config: { event_reviews: { [ev.id]: 'dismissed' } } } });
    const s = buildSessionSummary(session, { eo, ec });
    expect(s.clinical_flags).toEqual([]);
    expect(s.events!.dismissed.map((e) => e.id)).toEqual([ev.id]);
  });

  it('a dismissed artifact is listed under events.dismissed and not counted', () => {
    const kept = makeEvent({ category: 'artifact', pattern: 'muscle' });
    const gone = makeEvent({ category: 'artifact', pattern: 'eye-blink', dismissed: true });
    const { session, eo, ec } = split({ events: [kept, gone] });
    const s = buildSessionSummary(session, { eo, ec });
    expect(s.events!.counts).toEqual({ artifact: 1, variant: 0, epileptiform: 0, 'rhythmic-periodic': 0 });
    expect(s.events!.items.map((e) => e.id)).toEqual([kept.id]);
    expect(s.events!.dismissed).toHaveLength(1);
    expect(s.events!.dismissed[0]).toMatchObject({ id: gone.id, review: 'dismissed' });
  });

  it('config review overrides the results dismissed flag', () => {
    const ev = makeEvent({ dismissed: true });
    const { session, eo, ec } = split({ events: [ev] }, {}, { eo: { config: { event_reviews: { [ev.id]: 'confirmed' } } } });
    const s = buildSessionSummary(session, { eo, ec });
    expect(s.events!.items[0].review).toBe('confirmed');
  });

  it('detectors that did not run are listed as not assessed', () => {
    const { session, eo, ec } = split({
      events: [],
      detectors: [
        { name: 'eye-blink', ran: true },
        { name: 'spike-wave', ran: false, skippedReason: 'needs temporal chain' },
      ],
    });
    const s = buildSessionSummary(session, { eo, ec });
    expect(s.events!.not_assessed).toEqual([{ detector: 'spike-wave', reason: 'needs temporal chain' }]);
  });

  it('a processing analysis is unavailable and its condition absent', () => {
    const { session, eo, ec } = split({}, {}, { ec: { status: 'processing' } });
    const s = buildSessionSummary(session, { eo, ec: { ...ec, results: null } });
    expect(s.unavailable).toEqual([{ analysisId: ec.analysisId, condition: 'ec', reason: 'processing' }]);
    expect(s.status_note).toMatch(/EC .*processing/);
    expect(s.conditions.ec).toBeUndefined();
    expect(s.quality.ec).toBeUndefined();
    expect(s.conditions.eo).toBeDefined();
    expect(s.eo_ec_reactivity).toBeUndefined();
    expect(s.session.recordings.find((r) => r.analysis?.id === ec.analysisId)?.analysis?.status).toBe('processing');
  });

  it('legacy results are unavailable with reason "legacy"', () => {
    const { session, eo, ec } = split({}, { legacy: true });
    const s = buildSessionSummary(session, { eo, ec });
    expect(s.unavailable).toEqual([{ analysisId: ec.analysisId, condition: 'ec', reason: 'legacy' }]);
    expect(s.conditions.ec).toBeUndefined();
    expect(s.status_note).toMatch(/EC .*older engine.*Re-Analyze in Squiggly/);
  });

  it('a pending analysis gets a status note', () => {
    const { session, eo, ec } = split({}, {}, { eo: { status: 'pending' } });
    const s = buildSessionSummary(session, { eo: { ...eo, results: null }, ec });
    expect(s.unavailable).toEqual([{ analysisId: eo.analysisId, condition: 'eo', reason: 'pending' }]);
    expect(s.status_note).toMatch(/EO .*pending/);
  });

  it('lists a recording that has no analysis yet, with analysis null and a status note', () => {
    const { session, eo, ec } = split();
    const s = buildSessionSummary(session, { eo }, [eo.recording, ec.recording]);
    expect(s.session.recordings).toHaveLength(2);
    const missing = s.session.recordings.find((r) => r.id === ec.recording.id)!;
    expect(missing.analysis).toBeNull();
    expect(missing.condition).toBe('EC');
    expect(s.unavailable).toEqual([{ analysisId: null, condition: 'ec', reason: 'not_analyzed' }]);
    expect(s.status_note).toMatch(/EC .*not analyzed yet/);
    expect(JSON.stringify(s)).not.toContain('Anna');
  });

  it('has no status note when everything is available', () => {
    const { session, eo, ec } = split();
    expect(buildSessionSummary(session, { eo, ec }, [eo.recording, ec.recording]).status_note).toBeUndefined();
  });

  it('31% rejection on the EC side → low confidence', () => {
    const { session, eo, ec } = split({}, { rejection: { ec: 31 } });
    const s = buildSessionSummary(session, { eo, ec });
    expect(s.quality.ec!.confidence).toBe('low');
    expect(s.quality.eo!.confidence).toBe('high');
    expect(s.quality.confidence).toBe('low');
  });

  it('a condition with null band power is omitted', () => {
    const { session, eo, ec } = split();
    ec.results!.band_power.ec = null;
    const s = buildSessionSummary(session, { eo, ec });
    expect(s.conditions.ec).toBeUndefined();
  });

  it('serializes under 32 000 chars for the 19-channel fixture and leaks nothing', () => {
    const events = [
      ...Array.from({ length: 30 }, () => makeEvent()),
      makeEvent({ category: 'epileptiform', handling: 'noted' }),
    ];
    const { session, eo, ec } = split({ hrv: true, sloreta: true, events }, { sloreta: true, events: [makeEvent()] });
    const json = JSON.stringify(buildSessionSummary(session, { eo, ec }));
    expect(json.length).toBeLessThan(32_000);
    for (const secret of Object.values(SECRETS)) expect(json).not.toContain(secret);
    for (const key of ['client_metadata', 'name', 'filename', 'file_path', 'email', 'kernel_id', 'head_model_id', 'processing_metadata', 'config', 'evidence', 'visuals', 'cleaned_file_url']) {
      expect(json).not.toContain(`"${key}":`);
    }
    expect(json).not.toMatch(/_path"/);
    expect(json).not.toMatch(/https?:\/\//);
    expect(json).not.toContain('Anna');
  });
});

describe('buildSessionSummary: leaks and caps', () => {
  it('QC warnings reach the summary sanitized, keeping the readable prefix', () => {
    const { session, eo, ec } = split({}, { warnings: LEAKY_WARNINGS });
    const s = buildSessionSummary(session, { eo, ec });
    const json = JSON.stringify(s);
    for (const bad of ['https://', 'storage.example', '/var/task', 'KERN_SECRET']) expect(json).not.toContain(bad);
    expect(s.quality.ec!.warnings).toContain('Source localization unavailable.');
    expect(s.quality.ec!.warnings).toContain('HRV could not be computed from ECG.');
  });

  it('clinical events are listed once: in clinical_flags, not again in events.items', () => {
    const flag = makeEvent({ category: 'epileptiform', handling: 'noted' });
    const blink = makeEvent();
    const { session, eo, ec } = split({ events: [flag, blink] });
    const s = buildSessionSummary(session, { eo, ec });
    expect(s.clinical_flags.map((e) => e.id)).toEqual([flag.id]);
    expect(s.events!.items.map((e) => e.id)).toEqual([blink.id]);
    expect(s.events!.counts.epileptiform).toBe(1);
  });

  it('caps clinical_flags at 20, confirmed first, counts the rest, and stays under 32 000 chars', () => {
    const events = Array.from({ length: 200 }, () => makeEvent({ category: 'epileptiform', pattern: 'spike-wave', handling: 'noted' }));
    const confirmed = events.slice(150, 155).map((e) => e.id);
    const reviews = Object.fromEntries(confirmed.map((id) => [id, 'confirmed']));
    const { session, eo, ec } = split({ events, hrv: true, sloreta: true }, { sloreta: true }, { eo: { config: { event_reviews: reviews } } });
    const s = buildSessionSummary(session, { eo, ec });
    expect(s.clinical_flags).toHaveLength(20);
    expect(s.clinical_flags.slice(0, 5).map((e) => e.id).sort()).toEqual([...confirmed].sort());
    expect(s.clinical_flags.slice(0, 5).every((e) => e.review === 'confirmed')).toBe(true);
    expect(s.events!.omitted?.clinical_flags).toBe(180);
    expect(s.events!.items).toEqual([]);
    expect(s.events!.counts.epileptiform).toBe(200);
    expect(JSON.stringify(s).length).toBeLessThan(32_000);
  });
});

describe('guidance', () => {
  it('ends with the exact closing line and keeps the short text under 400 chars', () => {
    expect(GUIDANCE.trimEnd().endsWith('Pattern-level interpretation from EEG features — not a diagnosis.')).toBe(true);
    expect(GUIDANCE_SHORT.length).toBeLessThanOrEqual(400);
    expect(GUIDANCE_SHORT).toContain('not a diagnosis');
    expect(GUIDANCE).toMatch(/status_note/);
    expect(GUIDANCE).toMatch(/Re-Analyze/);
  });
});
