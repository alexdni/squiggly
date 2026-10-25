import { describe, it, expect } from 'vitest';
import type { BandPower, PsdData } from '@/lib/analysis-results';
import { computeMuIndicators } from '@/lib/mu-indicators';

const FREQS = Array.from({ length: 89 }, (_, i) => 1 + i * 0.5); // 1–45 Hz, 0.5 Hz steps

/** 1/f background with an optional Gaussian alpha bump (`db` above background at `hz`) and its harmonic. */
function spectrum(peak?: { hz: number; db: number; harmonicDb?: number }): number[] {
  return FREQS.map((f) => {
    let gain = 0;
    if (peak) {
      gain += peak.db * Math.exp(-((f - peak.hz) ** 2) / (2 * 0.6 ** 2));
      if (peak.harmonicDb) gain += peak.harmonicDb * Math.exp(-((f - 2 * peak.hz) ** 2) / (2 * 0.8 ** 2));
    }
    return (10 / f) * 10 ** (gain / 10);
  });
}

function psd(channels: Record<string, number[]>): PsdData {
  return { freqs: FREQS, channels };
}

/** Band power with alpha1 + alpha2 absolute = `alpha[ch]` (split evenly). */
function bandPower(alpha: Record<string, number>): BandPower {
  const zero = { absolute: 1, relative: 0.1 };
  return Object.fromEntries(
    Object.entries(alpha).map(([ch, a]) => [
      ch,
      {
        delta: zero, theta: zero, smr: zero, beta2: zero, hibeta: zero, lowgamma: zero,
        alpha1: { absolute: a / 2, relative: 0.2 },
        alpha2: { absolute: a / 2, relative: 0.2 },
      },
    ]),
  ) as BandPower;
}

const MU_PEAK = { hz: 10.5, db: 9, harmonicDb: 6 };
const PDR = { hz: 9.5, db: 8 };

describe('computeMuIndicators', () => {
  it('likely: central peak, central alpha near occipital with eyes open, and central alpha spared on eye opening', () => {
    const m = computeMuIndicators({
      eo: {
        band_power: bandPower({ C3: 8, C4: 8, O1: 10, O2: 10 }),
        psd: psd({ C3: spectrum(MU_PEAK), C4: spectrum(MU_PEAK), O1: spectrum(PDR), O2: spectrum(PDR) }),
      },
      ec: {
        band_power: bandPower({ C3: 10, C4: 10, O1: 40, O2: 40 }),
        psd: psd({ C3: spectrum(MU_PEAK), C4: spectrum(MU_PEAK), O1: spectrum(PDR), O2: spectrum(PDR) }),
      },
    });
    expect(m.verdict).toBe('likely');
    expect(m.condition).toBe('eo');
    expect(m.central_occipital_alpha_eo).toBe(0.8);
    // central EO/EC 0.8 ÷ occipital EO/EC 0.25
    expect(m.reactivity_selectivity).toBe(3.2);
    expect(m.sites.C3!.peak_hz).toBe(10.5);
    expect(m.sites.C3!.peak_db).toBeGreaterThan(8);
    expect(m.sites.C3!.harmonic_db).toBeGreaterThan(5);
    expect(m.occipital_peak_hz).toBe(9.5);
    expect(m.reasons.join(' ')).toMatch(/harmonic/);
    expect(m.reasons.join(' ')).toMatch(/differs from the posterior rhythm/);
  });

  it('diffuse alpha that blocks everywhere on eye opening is not mu', () => {
    const m = computeMuIndicators({
      eo: { band_power: bandPower({ C3: 3, C4: 3, O1: 10, O2: 10 }), psd: psd({ C3: spectrum(PDR), C4: spectrum(PDR), O1: spectrum(PDR), O2: spectrum(PDR) }) },
      ec: { band_power: bandPower({ C3: 12, C4: 12, O1: 40, O2: 40 }), psd: psd({ C3: spectrum(PDR), C4: spectrum(PDR), O1: spectrum(PDR), O2: spectrum(PDR) }) },
    });
    expect(m.reactivity_selectivity).toBe(1);
    expect(m.verdict).toBe('not_detected');
  });

  it('a harmonic alone does not make a verdict', () => {
    const m = computeMuIndicators({
      eo: {
        band_power: bandPower({ C3: 3, C4: 3, O1: 10, O2: 10 }),
        psd: psd({ C3: spectrum(MU_PEAK), C4: spectrum(MU_PEAK), O1: spectrum(PDR), O2: spectrum(PDR) }),
      },
    });
    expect(m.sites.C3!.harmonic_db).toBeGreaterThan(5);
    expect(m.verdict).toBe('not_detected');
  });

  it('possible with eyes-open data only, and says reactivity was not assessed', () => {
    const m = computeMuIndicators({
      eo: {
        band_power: bandPower({ C3: 8, C4: 8, O1: 10, O2: 10 }),
        psd: psd({ C3: spectrum(MU_PEAK), C4: spectrum(MU_PEAK), O1: spectrum(PDR), O2: spectrum(PDR) }),
      },
    });
    expect(m.verdict).toBe('possible');
    expect(m.reactivity_selectivity).toBeNull();
    expect(m.reasons.join(' ')).toMatch(/reactivity not assessed/);
  });

  it('not detected without a central peak above background', () => {
    const flat = spectrum();
    const m = computeMuIndicators({
      eo: { band_power: bandPower({ C3: 8, C4: 8, O1: 10, O2: 10 }), psd: psd({ C3: flat, C4: flat, O1: flat, O2: flat }) },
      ec: { band_power: bandPower({ C3: 10, C4: 10, O1: 40, O2: 40 }), psd: psd({ C3: flat, C4: flat, O1: flat, O2: flat }) },
    });
    expect(m.verdict).toBe('not_detected');
    expect(m.reasons[0]).toMatch(/no central alpha peak/);
  });

  it('insufficient data without a stored spectrum, even when band power alone looks like mu', () => {
    const m = computeMuIndicators({
      eo: { band_power: bandPower({ C3: 8, C4: 8, O1: 10, O2: 10 }) },
      ec: { band_power: bandPower({ C3: 10, C4: 10, O1: 40, O2: 40 }) },
    });
    expect(m.verdict).toBe('insufficient_data');
    expect(m.reasons[0]).toMatch(/Re-Analyze/);
  });

  it('insufficient data when C3/C4 are missing', () => {
    const m = computeMuIndicators({ eo: { band_power: bandPower({ O1: 10, O2: 10 }), psd: psd({ O1: spectrum(PDR), O2: spectrum(PDR) }) } });
    expect(m.verdict).toBe('insufficient_data');
    expect(m.reasons[0]).toMatch(/C3\/C4/);
  });

  it('arch-shaped trains in the waveform make mu likely even without eyes-open data', () => {
    const m = computeMuIndicators({
      ec: {
        band_power: bandPower({ C3: 10, C4: 10, O1: 40, O2: 40 }),
        psd: psd({ C3: spectrum(MU_PEAK), C4: spectrum(MU_PEAK), O1: spectrum(PDR), O2: spectrum(PDR) }),
        morphology: {
          analyzed_sec: 300,
          sites: {
            C3: { bursts: 20, bursts_per_min: 4, burst_time_pct: 6, median_burst_s: 1.2, sharpness_ratio: 1.5, rhythmic_trains: 40 },
            C4: { bursts: 0, bursts_per_min: 0, burst_time_pct: 0, median_burst_s: 0, sharpness_ratio: 1.1, rhythmic_trains: 30 },
          },
        },
      },
    });
    expect(m.verdict).toBe('likely');
    expect(m.waveform).toEqual({ assessed: true, bursts: 20, bursts_per_min: 4, sharpness_ratio: 1.5, sites: ['C3'] });
    expect(m.reasons.join(' ')).toMatch(/20 arch-shaped mu trains at C3/);
  });

  it('a spectral likely without arch-shaped trains drops to possible', () => {
    const none = { bursts: 0, bursts_per_min: 0, burst_time_pct: 0, median_burst_s: 0, sharpness_ratio: 1, rhythmic_trains: 12 };
    const m = computeMuIndicators({
      eo: {
        band_power: bandPower({ C3: 8, C4: 8, O1: 10, O2: 10 }),
        psd: psd({ C3: spectrum(MU_PEAK), C4: spectrum(MU_PEAK), O1: spectrum(PDR), O2: spectrum(PDR) }),
        morphology: { analyzed_sec: 300, sites: { C3: none, C4: none } },
      },
      ec: {
        band_power: bandPower({ C3: 10, C4: 10, O1: 40, O2: 40 }),
        psd: psd({ C3: spectrum(MU_PEAK), C4: spectrum(MU_PEAK), O1: spectrum(PDR), O2: spectrum(PDR) }),
      },
    });
    expect(m.verdict).toBe('possible');
    expect(m.reasons.join(' ')).toMatch(/no arch-shaped mu trains/);
  });

  it('analyses from before the waveform detector say shape was not assessed', () => {
    const m = computeMuIndicators({
      eo: {
        band_power: bandPower({ C3: 8, C4: 8, O1: 10, O2: 10 }),
        psd: psd({ C3: spectrum(MU_PEAK), C4: spectrum(MU_PEAK), O1: spectrum(PDR), O2: spectrum(PDR) }),
      },
    });
    expect(m.waveform).toBeNull();
    expect(m.reasons.join(' ')).toMatch(/waveform shape not assessed/);
  });
});
