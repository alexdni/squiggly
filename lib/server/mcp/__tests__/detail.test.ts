import { describe, it, expect } from 'vitest';
import { buildDetail } from '@/lib/server/mcp/detail';
import { McpUserError } from '@/lib/server/mcp/errors';
import { LEAKY_WARNINGS, SECRETS, makeEvent, makeInput, makeRecording, makeResults } from './fixtures';

const rec = () => makeRecording({ condition_type: 'BOTH' });
const input = (opts = {}, over = {}) => makeInput(rec(), makeResults(opts), over);
const dump = (o: unknown) => JSON.stringify(o);

describe('buildDetail', () => {
  it('rejects an unknown section', () => {
    expect(() => buildDetail(input(), 'nope' as never, {})).toThrow(McpUserError);
    expect(() => buildDetail(input(), 'nope' as never, {})).toThrow(/Unknown section/);
  });

  it('refuses analyses that are not ready', () => {
    expect(() => buildDetail(input({}, { status: 'processing' }), 'psd', {})).toThrow(/still processing/);
    expect(() => buildDetail(input({}, { status: 'failed' }), 'psd', {})).toThrow(/failed/);
    expect(() => buildDetail(input({ legacy: true }), 'psd', {})).toThrow(/Re-Analyze in Squiggly/);
  });

  describe('band_power', () => {
    it('lists every channel and band for a condition, abs and rel', () => {
      const out = buildDetail(input(), 'band_power', { condition: 'ec' }) as any;
      expect(out.condition).toBe('ec');
      expect(Object.keys(out.channels)).toHaveLength(19);
      expect(Object.keys(out.channels.Fz)).toHaveLength(8);
      expect(out.channels.Fz.alpha1).toEqual({ abs: expect.any(Number), rel: expect.any(Number) });
    });
    it('defaults to ec and falls back to eo; filters by channel', () => {
      expect((buildDetail(input({ conditions: ['eo'] }), 'band_power', {}) as any).condition).toBe('eo');
      const out = buildDetail(input(), 'band_power', { channel: 'Cz' }) as any;
      expect(Object.keys(out.channels)).toEqual(['Cz']);
      expect(() => buildDetail(input(), 'band_power', { channel: 'Nope' })).toThrow(/Valid channels: .*Cz/);
      expect(() => buildDetail(input({ conditions: ['eo'] }), 'band_power', { condition: 'ec' })).toThrow(/ec/);
    });
    it('honors the band filter', () => {
      const out = buildDetail(input(), 'band_power', { band: 'theta' }) as any;
      expect(Object.keys(out.channels)).toHaveLength(19);
      for (const bands of Object.values(out.channels)) expect(Object.keys(bands as object)).toEqual(['theta']);
      expect(out.band).toBe('theta');
      expect(() => buildDetail(input(), 'band_power', { band: 'gamma9' })).toThrow(/Valid bands: .*alpha1/);
    });
    it('honors the region filter, alone or with a channel', () => {
      const out = buildDetail(input(), 'band_power', { region: 'occipital' }) as any;
      expect(Object.keys(out.channels).sort()).toEqual(['O1', 'O2']);
      expect(out.region).toBe('occipital');
      expect(Object.keys(out.channels.O1)).toHaveLength(8);
      const one = buildDetail(input(), 'band_power', { region: 'occipital', channel: 'O2', band: 'alpha1' }) as any;
      expect(one.channels).toEqual({ O2: { alpha1: expect.any(Object) } });
      expect(() => buildDetail(input(), 'band_power', { region: 'nowhere' })).toThrow(/Valid regions: .*frontal/);
      expect(() => buildDetail(input(), 'band_power', { region: 'occipital', channel: 'Fz' })).toThrow(/not in the occipital region/);
    });
  });

  describe('connectivity', () => {
    it('returns at most 200 pairs, sorted descending, default alpha', () => {
      const out = buildDetail(input({ connectivityPairs: 300 }), 'connectivity', {}) as any;
      expect(out.band).toBe('alpha');
      expect(out.total_pairs).toBe(300);
      expect(out.pairs).toHaveLength(200);
      const v = out.pairs.map((p: any) => p.value);
      expect([...v].sort((a, b) => b - a)).toEqual(v);
      expect(Object.keys(out.pairs[0]).sort()).toEqual(['ch1', 'ch2', 'value']);
    });
    it('rejects an unknown band, listing valid ones', () => {
      expect(() => buildDetail(input(), 'connectivity', { band: 'gamma' })).toThrow(/delta, theta, alpha, beta/);
    });
  });

  describe('psd', () => {
    it('averages 0.25 Hz data into 45 one-Hz bins starting at 1-2 Hz', () => {
      const out = buildDetail(input({ psdStepHz: 0.25 }), 'psd', { channel: 'Cz' }) as any;
      expect(out.bins).toHaveLength(45);
      expect(out.bins[0]).toMatchObject({ hz_lo: 1, hz_hi: 2 });
      expect(out.bins[44].hz_lo).toBe(45);
      // 1.0, 1.25, 1.5, 1.75 averaged: 10/(1+f) + 0.01 * channel index (Cz)
      expect(out.bins[0].power).toBeGreaterThan(out.bins[1].power);
    });
    it('averages a region over its channels', () => {
      const out = buildDetail(input(), 'psd', { region: 'occipital', condition: 'eo' }) as any;
      expect(out.region).toBe('occipital');
      expect(out.bins).toHaveLength(45);
      expect(() => buildDetail(input(), 'psd', { region: 'nowhere' })).toThrow(/frontal/);
    });
    it('needs a channel or region, and a known channel', () => {
      expect(() => buildDetail(input(), 'psd', {})).toThrow(McpUserError);
      expect(() => buildDetail(input(), 'psd', { channel: 'Nope' })).toThrow(/Valid channels/);
    });
  });

  describe('events', () => {
    it('pages 100 at a time, 1-based, with next_page', () => {
      const events = Array.from({ length: 250 }, () => makeEvent());
      const i = input({ events });
      const p0 = buildDetail(i, 'events', {}) as any;
      expect(p0.page).toBe(1);
      expect(p0.items).toHaveLength(100);
      expect(p0.next_page).toBe(2);
      expect(p0.total).toBe(250);
      expect(buildDetail(i, 'events', { page: 1 })).toEqual(p0);
      const p2 = buildDetail(i, 'events', { page: 2 }) as any;
      expect(p2.items).toHaveLength(100);
      expect(p2.items[0].id).not.toBe(p0.items[0].id);
      expect(p2.next_page).toBe(3);
      expect((buildDetail(i, 'events', { page: 3 }) as any).items).toHaveLength(50);
      expect((buildDetail(i, 'events', { page: 3 }) as any).next_page).toBeNull();
      expect(dump(p0)).not.toContain(SECRETS.evidence);
      expect(Object.keys(p0.items[0]).sort()).toEqual(
        ['category', 'channels', 'condition', 'confidence', 'end_s', 'handling', 'id', 'pattern', 'review', 'start_s'],
      );
    });
    it('page 1 with fewer than 100 events returns all of them', () => {
      const events = Array.from({ length: 7 }, () => makeEvent());
      const out = buildDetail(input({ events }), 'events', { page: 1 }) as any;
      expect(out.items).toHaveLength(7);
      expect(out.page).toBe(1);
      expect(out.next_page).toBeNull();
    });
    it('applies review decisions from config', () => {
      const e = makeEvent({ category: 'epileptiform' });
      const i = input({ events: [e] }, { config: { event_reviews: { [e.id]: 'confirmed' } } });
      expect((buildDetail(i, 'events', {}) as any).items[0].review).toBe('confirmed');
    });
  });

  describe('sloreta', () => {
    it('returns band stats per condition without engine internals', () => {
      const out = buildDetail(input({ sloreta: true }), 'sloreta', {}) as any;
      expect(Object.keys(out.conditions.eo)).toHaveLength(8);
      expect(out.conditions.ec.delta).toMatchObject({ max: 3.14, mean: 1.23, peak: { region: 'left frontal', mni: [-32.4, 18.6, 44.2] } });
      const s = dump(out);
      for (const bad of ['kernel_id', 'head_model_id', 'values_path', 'spectra_path', SECRETS.kernelId, SECRETS.headModelId, 'visuals/']) {
        expect(s).not.toContain(bad);
      }
    });
    it('explains when sLORETA is absent', () => {
      expect(() => buildDetail(input(), 'sloreta', {})).toThrow(McpUserError);
    });
  });

  describe('hrv', () => {
    it('gives the summary and downsamples each series to at most 120 points', () => {
      const out = buildDetail(input({ hrv: true, hrvSeriesLength: 1000 }), 'hrv', {}) as any;
      expect(out.summary.rmssd_ms).toBe(39.9);
      expect(out.series.nn_ms.t).toHaveLength(120);
      expect(out.series.nn_ms.v).toHaveLength(120);
      expect(out.series.nn_ms.t[0]).toBeLessThan(out.series.nn_ms.t[1]);
    });
    it('keeps short series as they are', () => {
      const out = buildDetail(input({ hrv: true }), 'hrv', {}) as any;
      expect(out.series.nn_ms).toEqual({ t: [0, 1, 2], v: [850, 860, 855] });
    });
  });

  describe('qc', () => {
    it('returns the quality block, capped spans and bad channels with reasons', () => {
      const spans: [number, number][] = Array.from({ length: 300 }, (_, k) => [k, k + 0.5]);
      const out = buildDetail(
        input({ warnings: LEAKY_WARNINGS, timeline: { spans, bad_channels: [{ label: 'T7', reasons: ['flat'], interpolated: true }] } }),
        'qc',
        {},
      ) as any;
      expect(out.quality.confidence).toBeDefined();
      expect(out.rejected_spans).toHaveLength(200);
      expect(out.rejected_spans_total).toBe(300);
      expect(out.bad_channels).toEqual([{ label: 'T7', reasons: ['flat'], interpolated: true }]);
      const s = dump(out);
      expect(s).not.toMatch(/https?:\/\//);
      expect(s).not.toContain(SECRETS.kernelId);
    });
    it('sanitizes and caps bad-channel labels and reasons', () => {
      const reasons = ['see https://storage.example.test/x.edf', '/var/task/x/KERN_SECRET.bin', 'x'.repeat(200), ...Array.from({ length: 20 }, (_, k) => `flat ${k}`)];
      const bad = [
        { label: 'T7', reasons, interpolated: true },
        { label: '../etc', reasons: ['flat'], interpolated: false },
        ...Array.from({ length: 80 }, (_, k) => ({ label: `C${k}`, reasons: [], interpolated: false })),
      ];
      const out = buildDetail(input({ timeline: { spans: [], bad_channels: bad } }), 'qc', {}) as any;
      expect(out.bad_channels).toHaveLength(64);
      expect(out.bad_channels.map((b: any) => b.label)).not.toContain('../etc');
      const t7 = out.bad_channels[0];
      expect(t7.reasons.length).toBeLessThanOrEqual(10);
      expect(t7.reasons.every((r: string) => r.length > 0 && r.length <= 80)).toBe(true);
      const s = dump(out.bad_channels);
      for (const bad of ['http', 'storage.example', '/var/task', 'KERN_SECRET', '../etc']) expect(s).not.toContain(bad);
    });
    it('works without a timeline', () => {
      const out = buildDetail(input(), 'qc', {}) as any;
      expect(out.rejected_spans).toEqual([]);
    });
  });

  it('never leaks identifying data from any section', () => {
    const i = input({ hrv: true, sloreta: true, events: [makeEvent()], warnings: LEAKY_WARNINGS });
    for (const section of ['band_power', 'connectivity', 'events', 'sloreta', 'hrv', 'qc'] as const) {
      const s = dump(buildDetail(i, section, {}));
      for (const v of Object.values(SECRETS)) expect(s).not.toContain(v);
    }
    expect(dump(buildDetail(i, 'psd', { channel: 'Fz' }))).not.toContain(SECRETS.filename);
  });
});
