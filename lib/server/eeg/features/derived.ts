import {
  BAND_NAMES,
  type Asymmetry,
  type BandName,
  type BandPower,
  type BandRatios,
  type RiskPatterns,
} from '@/lib/analysis-results';
import { ASYMMETRY_PAIRS, CHANNEL_GROUPS } from './types';

// Ratios, asymmetry and risk flags derived from band power (ports of compute_band_ratios,
// compute_asymmetry and detect_risk_patterns).

function mean(v: number[]): number {
  return v.reduce((a, b) => a + b, 0) / v.length;
}

function regionalAverage(bp: BandPower, channels: readonly string[], band: BandName): number {
  const vals = channels.filter((ch) => bp[ch]?.[band] !== undefined).map((ch) => bp[ch][band].absolute);
  return vals.length ? mean(vals) : 0.0;
}

export function computeBandRatios(bp: BandPower): BandRatios {
  const ratio = (num: number, den: number) => (den > 0 ? num / den : 0);
  const g = CHANNEL_GROUPS;
  const frontalTbr = ratio(regionalAverage(bp, g.frontal, 'theta'), regionalAverage(bp, g.frontal, 'beta2'));
  const centralTbr = ratio(regionalAverage(bp, g.central, 'theta'), regionalAverage(bp, g.central, 'beta2'));
  const occAlpha = regionalAverage(bp, g.occipital, 'alpha1') + regionalAverage(bp, g.occipital, 'alpha2');
  const parAlpha = regionalAverage(bp, g.parietal, 'alpha1') + regionalAverage(bp, g.parietal, 'alpha2');
  return {
    theta_beta_ratio: { frontal_avg: frontalTbr, central_avg: centralTbr },
    alpha_theta_ratio: {
      occipital_avg: ratio(occAlpha, regionalAverage(bp, g.occipital, 'theta')),
      parietal_avg: ratio(parAlpha, regionalAverage(bp, g.parietal, 'theta')),
    },
  };
}

/** ln(right) - ln(left); alpha pairs use alpha2 (10-12 Hz), theta pairs use theta. */
export function computeAsymmetry(bp: BandPower): Asymmetry {
  const out: Asymmetry = {};
  for (const [name, [left, right]] of Object.entries(ASYMMETRY_PAIRS)) {
    const band: BandName | null = name.includes('alpha') ? 'alpha2' : name.includes('theta') ? 'theta' : null;
    if (!band) continue;
    if (bp[left] && bp[right]) {
      const l = bp[left][band].absolute;
      const r = bp[right][band].absolute;
      out[name] = l > 0 && r > 0 ? Math.log(r) - Math.log(l) : 0.0;
    } else {
      out[name] = 0.0;
    }
  }
  return out;
}

export function detectRiskPatterns(bp: BandPower, ratios: BandRatios, asymmetry: Asymmetry): RiskPatterns {
  const frontal = CHANNEL_GROUPS.frontal.filter((ch) => ch in bp);
  // np.mean([]) is NaN, which makes every comparison below false, as in Python
  const frontalBeta = mean(frontal.map((ch) => bp[ch].beta2.absolute));
  const frontalTotal = mean(frontal.map((ch) => BAND_NAMES.reduce((s, b) => s + bp[ch][b].absolute, 0)));
  const frontalBetaRatio = frontalTotal > 0 ? frontalBeta / frontalTotal : 0;
  const all = Object.keys(bp);
  return {
    adhd_like: ratios.theta_beta_ratio.frontal_avg > 2.5,
    anxiety_like: frontalBetaRatio > 0.25,
    depression_like: (asymmetry.frontal_alpha ?? 0) < -0.15,
    sleep_dysregulation: mean(all.map((ch) => bp[ch].delta.relative)) > 0.25,
    hyper_arousal: mean(all.map((ch) => bp[ch].hibeta.relative)) > 0.15,
  };
}
