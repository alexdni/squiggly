import { describe, it, expect } from 'vitest';
import {
  STALE_PROCESSING_MS,
  buildPreprocessingConfig,
  clampSetting,
  isProcessingStale,
  settingsFromConfig,
} from '../analysis-settings';

describe('settingsFromConfig', () => {
  it('uses defaults for an empty config', () => {
    expect(settingsFromConfig(undefined)).toEqual({
      artifact_mode: 'pipeline',
      profile: 'full',
      rejection_threshold_uv: 160,
      asr_k: null,
      line_freq: 60,
    });
  });

  it('maps legacy ICA mode to the pipeline and keeps manual', () => {
    expect(settingsFromConfig({ artifact_mode: 'ica', ica_method: 'sobi' }).artifact_mode).toBe('pipeline');
    expect(settingsFromConfig({ artifact_mode: 'manual' }).artifact_mode).toBe('manual');
  });

  it('reads and clamps stored values, rejecting unknown profiles', () => {
    const s = settingsFromConfig({ profile: 'aggressive', rejection_threshold_uv: 9000, asr_k: 2, line_freq: 50 });
    expect(s).toMatchObject({ profile: 'aggressive', rejection_threshold_uv: 500, asr_k: 5, line_freq: 50 });
    expect(settingsFromConfig({ profile: 'sobi', line_freq: 55 })).toMatchObject({ profile: 'full', line_freq: 60 });
  });
});

describe('clampSetting', () => {
  it('clamps to limits and falls back on blanks', () => {
    expect(clampSetting('rejection_threshold_uv', 10)).toBe(20);
    expect(clampSetting('rejection_threshold_uv', NaN)).toBe(160);
    expect(clampSetting('asr_k', 150)).toBe(100);
    expect(clampSetting('asr_k', NaN)).toBeNull();
  });
});

describe('buildPreprocessingConfig', () => {
  it('drops legacy ICA/SOBI keys, keeps unrelated keys and applies settings', () => {
    const out = buildPreprocessingConfig(
      { artifact_mode: 'ica', ica_method: 'sobi', sobi_delta_threshold: 0.7, sobi_hf_threshold: 0.4, sobi_frontal_corr: 0.6, high_pass_hz: 0.5 },
      { artifact_mode: 'pipeline', profile: 'conservative', rejection_threshold_uv: 1000, asr_k: null, line_freq: 50 }
    );
    expect(out).not.toHaveProperty('ica_method');
    expect(out).not.toHaveProperty('sobi_delta_threshold');
    expect(out).toMatchObject({
      artifact_mode: 'pipeline',
      profile: 'conservative',
      rejection_threshold_uv: 500,
      asr_k: null,
      line_freq: 50,
      high_pass_hz: 0.5,
      epoch_duration: 2,
    });
  });
});

describe('isProcessingStale', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('flags processing rows older than 10 minutes', () => {
    expect(isProcessingStale({ status: 'processing', started_at: ago(STALE_PROCESSING_MS + 1000) }, now)).toBe(true);
    expect(isProcessingStale({ status: 'processing', started_at: ago(60_000) }, now)).toBe(false);
  });

  it('falls back to updated_at and ignores other statuses', () => {
    expect(isProcessingStale({ status: 'processing', started_at: null, updated_at: ago(STALE_PROCESSING_MS * 2) }, now)).toBe(true);
    expect(isProcessingStale({ status: 'processing' }, now)).toBe(false);
    expect(isProcessingStale({ status: 'failed', started_at: ago(STALE_PROCESSING_MS * 2) }, now)).toBe(false);
  });
});
