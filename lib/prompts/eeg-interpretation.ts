export const EEG_INTERPRETATION_SYSTEM_PROMPT = `You are an expert neurophysiologist and quantitative EEG (qEEG) specialist with over 20 years of clinical and research experience. Your role is to provide comprehensive, educational interpretations of EEG analysis data.

IMPORTANT GUIDELINES:
1. This is for EDUCATIONAL purposes only - do not provide clinical diagnoses or treatment recommendations
2. Frame observations in terms of patterns commonly discussed in research literature
3. Be balanced - note both typical and atypical findings
4. Use professional but accessible language
5. Reference well-known qEEG patterns and biomarkers from peer-reviewed literature
6. When patterns suggest clinical significance, note that professional evaluation is needed

INTERPRETATION CONFIDENCE CONSTRAINTS:
- If artifact rejection rate > 30%: Flag as LOW CONFIDENCE - excessive artifact contamination may compromise data reliability
- If bad channels > 15% of total channels: Flag as LOW CONFIDENCE - significant channel loss affects spatial interpretation
- If final epochs < 20 for either condition: Flag as MODERATE CONFIDENCE - limited data for reliable spectral estimation
- If ICA components removed > 5: Note that aggressive artifact removal may have affected brain signal

When quality metrics indicate low confidence, explicitly state this limitation in your Summary and temper the certainty of your observations accordingly.

OUTPUT FORMAT:
Structure your response with the following sections (use ## headers):

## Summary
A brief 2-3 sentence overview of the key findings from this EEG analysis.

## Amplitude Patterns
Analysis of absolute and relative power across frequency bands (delta, theta, alpha, beta, gamma). Note any regional patterns, compare EO vs EC conditions, and discuss alpha reactivity.

KEY PATTERNS TO ASSESS:
- Frontal/Anterior slow wave excess: Elevated delta or theta in frontal regions (Fp1, Fp2, F3, F4, Fz) may suggest frontal slowing patterns associated with executive function challenges
- Cingulate region activity: Midline sites (Fz, Cz) can reflect anterior cingulate function - elevated slow waves here warrant attention
- High Beta patterns: Elevated high beta (20-30 Hz) especially in anterior/central regions may relate to hypervigilance, anxiety, or rumination patterns

## Frequency Ratios
Interpretation of theta/beta and alpha/theta ratios. Discuss what these ratios indicate based on research literature, including any frontal or regional variations.

KEY RATIOS TO ASSESS:
- Theta/Beta ratio: Elevated frontal theta/beta (>2.5-3.0) is discussed in attention research literature
- High Beta/Beta ratio: Elevated hibeta relative to beta2 in anterior regions may suggest overactivation patterns associated with hypervigilance or anxiety
- Alpha/Theta ratio: Low posterior alpha/theta may relate to cortical slowing patterns

## Peak Alpha Frequency
If alpha peak frequency data is available, assess the Individual Alpha Frequency (IAF):
- Normal adult IAF is typically 9.5-11 Hz
- Slowed IAF (<9 Hz) in posterior regions may suggest cognitive slowing or processing speed concerns
- Assess anterior-posterior alpha gradient (alpha should be maximal posteriorly)
- Note any regional variations in peak alpha that deviate from expected patterns

## Asymmetry Analysis
Interpretation of hemispheric asymmetry metrics including frontal alpha asymmetry (FAA) and other regional differences. Note any patterns associated with emotional processing or cognitive function.

## Complexity & Connectivity
If LZC (Lempel-Ziv Complexity) or coherence data is available, interpret signal complexity patterns across regions and conditions.

## Observations
Additional clinical observations, integration of findings across domains, and any patterns that warrant professional follow-up. Include the educational disclaimer.`;

export interface EEGDataPayload {
  recording_info: {
    duration_seconds: number;
    sampling_rate: number;
    n_channels: number;
    montage: string;
  };
  qc_report?: {
    artifact_rejection_rate: number;
    bad_channels?: string[];
    ica_components_removed: number;
    final_epochs_eo: number;
    final_epochs_ec: number;
  };
  band_power?: {
    eo?: Record<string, Record<string, number>>;
    ec?: Record<string, Record<string, number>>;
  };
  band_ratios?: {
    theta_beta_ratio?: { frontal_avg: number; central_avg: number };
    alpha_theta_ratio?: { occipital_avg: number; parietal_avg: number };
  };
  alpha_peak?: {
    eo?: Record<string, number>;  // channel -> peak frequency in Hz
    ec?: Record<string, number>;
  };
  asymmetry?: {
    frontal_alpha: number;
    parietal_alpha: number;
    frontal_theta: number;
  };
  lzc_values?: Record<string, Record<string, number>>;
  client_metadata?: {
    age?: number;
    gender?: string;
    primary_issue?: string;
  };
}

export function buildUserPrompt(data: EEGDataPayload): string {
  let prompt = `Please analyze the following quantitative EEG data and provide your expert interpretation.\n\n`;

  // Client context if available
  if (data.client_metadata) {
    const meta = data.client_metadata;
    prompt += `## Client Context\n`;
    if (meta.age) prompt += `- Age: ${meta.age} years\n`;
    if (meta.gender) prompt += `- Gender: ${meta.gender}\n`;
    if (meta.primary_issue) prompt += `- Primary concern: ${meta.primary_issue}\n`;
    prompt += `\n`;
  }

  // Recording info
  prompt += `## Recording Information\n`;
  prompt += `- Duration: ${Math.round(data.recording_info.duration_seconds)} seconds\n`;
  prompt += `- Sampling rate: ${data.recording_info.sampling_rate} Hz\n`;
  prompt += `- Channels: ${data.recording_info.n_channels}\n`;
  prompt += `- Montage: ${data.recording_info.montage}\n\n`;

  // QC Report with confidence assessment
  if (data.qc_report) {
    prompt += `## Quality Control\n`;
    prompt += `- Artifact rejection rate: ${data.qc_report.artifact_rejection_rate}%\n`;
    prompt += `- ICA components removed: ${data.qc_report.ica_components_removed}\n`;
    prompt += `- Final epochs (EO/EC): ${data.qc_report.final_epochs_eo} / ${data.qc_report.final_epochs_ec}\n`;

    const badChannelCount = data.qc_report.bad_channels?.length || 0;
    const badChannelPct = (badChannelCount / data.recording_info.n_channels) * 100;
    if (badChannelCount > 0) {
      prompt += `- Bad channels: ${data.qc_report.bad_channels!.join(', ')} (${badChannelPct.toFixed(1)}% of total)\n`;
    }

    // Compute confidence flags
    const confidenceFlags: string[] = [];
    if (data.qc_report.artifact_rejection_rate > 30) {
      confidenceFlags.push('HIGH artifact rejection (>30%)');
    }
    if (badChannelPct > 15) {
      confidenceFlags.push('HIGH bad channel rate (>15%)');
    }
    if (data.qc_report.final_epochs_eo < 20 || data.qc_report.final_epochs_ec < 20) {
      confidenceFlags.push('LOW epoch count (<20)');
    }
    if (data.qc_report.ica_components_removed > 5) {
      confidenceFlags.push('Aggressive ICA removal (>5 components)');
    }

    if (confidenceFlags.length > 0) {
      prompt += `\n**⚠️ CONFIDENCE FLAGS:** ${confidenceFlags.join('; ')}\n`;
      prompt += `Please account for these quality limitations in your interpretation.\n`;
    } else {
      prompt += `\n**✓ Data quality: GOOD** - metrics within acceptable ranges\n`;
    }
    prompt += `\n`;
  }

  // Band Power
  if (data.band_power) {
    prompt += `## Band Power (absolute, μV²/Hz)\n`;
    const bands = ['delta', 'theta', 'alpha1', 'alpha2', 'smr', 'beta2', 'hibeta', 'lowgamma'];
    const bandLabels: Record<string, string> = {
      delta: 'Delta (1-4 Hz)',
      theta: 'Theta (4-8 Hz)',
      alpha1: 'Alpha1 (8-10 Hz)',
      alpha2: 'Alpha2 (10-12 Hz)',
      smr: 'SMR (12-15 Hz)',
      beta2: 'Beta2 (15-20 Hz)',
      hibeta: 'High Beta (20-30 Hz)',
      lowgamma: 'Low Gamma (30-45 Hz)',
    };

    for (const condition of ['eo', 'ec'] as const) {
      const conditionData = data.band_power[condition];
      if (!conditionData) continue;

      const conditionLabel = condition === 'eo' ? 'Eyes Open' : 'Eyes Closed';
      prompt += `\n### ${conditionLabel}\n`;

      // Group channels by region for cleaner output
      const regions: Record<string, string[]> = {
        Frontal: ['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8'],
        Central: ['C3', 'Cz', 'C4'],
        Temporal: ['T7', 'T8'],
        Parietal: ['P7', 'P3', 'Pz', 'P4', 'P8'],
        Occipital: ['O1', 'O2'],
      };

      for (const [region, channels] of Object.entries(regions)) {
        const regionData: string[] = [];
        for (const ch of channels) {
          if (conditionData[ch]) {
            const chData = conditionData[ch];
            const values = bands
              .map(b => {
                const val = typeof chData[b] === 'number' ? chData[b] : (chData[b] as any)?.absolute;
                return val ? `${b}:${val.toFixed(1)}` : null;
              })
              .filter(Boolean)
              .join(', ');
            if (values) regionData.push(`${ch}: ${values}`);
          }
        }
        if (regionData.length > 0) {
          prompt += `**${region}**: ${regionData.join(' | ')}\n`;
        }
      }
    }
    prompt += `\n`;
  }

  // Band Ratios
  if (data.band_ratios) {
    prompt += `## Frequency Band Ratios\n`;
    if (data.band_ratios.theta_beta_ratio) {
      prompt += `- Theta/Beta Ratio (Frontal avg): ${data.band_ratios.theta_beta_ratio.frontal_avg.toFixed(2)}\n`;
      prompt += `- Theta/Beta Ratio (Central avg): ${data.band_ratios.theta_beta_ratio.central_avg.toFixed(2)}\n`;
    }
    if (data.band_ratios.alpha_theta_ratio) {
      prompt += `- Alpha/Theta Ratio (Occipital avg): ${data.band_ratios.alpha_theta_ratio.occipital_avg.toFixed(2)}\n`;
      prompt += `- Alpha/Theta Ratio (Parietal avg): ${data.band_ratios.alpha_theta_ratio.parietal_avg.toFixed(2)}\n`;
    }
    prompt += `\n`;
  }

  // Compute derived metrics from band power if available
  if (data.band_power) {
    prompt += `## Derived Regional Metrics\n`;

    const frontalChannels = ['Fp1', 'Fp2', 'F3', 'F4', 'Fz', 'F7', 'F8'];
    const cingulateChannels = ['Fz', 'Cz'];  // Midline approximation for ACC
    const anteriorChannels = ['Fp1', 'Fp2', 'F3', 'F4', 'Fz'];

    for (const condition of ['eo', 'ec'] as const) {
      const conditionData = data.band_power[condition];
      if (!conditionData) continue;

      const conditionLabel = condition === 'eo' ? 'Eyes Open' : 'Eyes Closed';
      prompt += `\n### ${conditionLabel}\n`;

      // Compute frontal slow wave (delta + theta) average
      let frontalSlowWaveSum = 0;
      let frontalSlowWaveCount = 0;
      for (const ch of frontalChannels) {
        if (conditionData[ch]) {
          const delta = typeof conditionData[ch].delta === 'number' ? conditionData[ch].delta : 0;
          const theta = typeof conditionData[ch].theta === 'number' ? conditionData[ch].theta : 0;
          if (delta > 0 || theta > 0) {
            frontalSlowWaveSum += delta + theta;
            frontalSlowWaveCount++;
          }
        }
      }
      if (frontalSlowWaveCount > 0) {
        prompt += `- Frontal Slow Wave (Delta+Theta) avg: ${(frontalSlowWaveSum / frontalSlowWaveCount).toFixed(2)} μV²/Hz\n`;
      }

      // Compute cingulate/midline slow wave average
      let cingulateSlowWaveSum = 0;
      let cingulateSlowWaveCount = 0;
      for (const ch of cingulateChannels) {
        if (conditionData[ch]) {
          const delta = typeof conditionData[ch].delta === 'number' ? conditionData[ch].delta : 0;
          const theta = typeof conditionData[ch].theta === 'number' ? conditionData[ch].theta : 0;
          if (delta > 0 || theta > 0) {
            cingulateSlowWaveSum += delta + theta;
            cingulateSlowWaveCount++;
          }
        }
      }
      if (cingulateSlowWaveCount > 0) {
        prompt += `- Midline/Cingulate Slow Wave (Fz, Cz) avg: ${(cingulateSlowWaveSum / cingulateSlowWaveCount).toFixed(2)} μV²/Hz\n`;
      }

      // Compute anterior High Beta / Beta2 ratio (hypervigilance marker)
      let hiBetaSum = 0;
      let beta2Sum = 0;
      let betaRatioCount = 0;
      for (const ch of anteriorChannels) {
        if (conditionData[ch]) {
          const hibeta = typeof conditionData[ch].hibeta === 'number' ? conditionData[ch].hibeta : 0;
          const beta2 = typeof conditionData[ch].beta2 === 'number' ? conditionData[ch].beta2 : 0;
          if (hibeta > 0 && beta2 > 0) {
            hiBetaSum += hibeta;
            beta2Sum += beta2;
            betaRatioCount++;
          }
        }
      }
      if (betaRatioCount > 0 && beta2Sum > 0) {
        const hiBetaBetaRatio = hiBetaSum / beta2Sum;
        prompt += `- Anterior High Beta/Beta2 Ratio: ${hiBetaBetaRatio.toFixed(2)}`;
        if (hiBetaBetaRatio > 1.5) {
          prompt += ` (ELEVATED - may indicate hypervigilance pattern)`;
        }
        prompt += `\n`;
      }
    }
    prompt += `\n`;
  }

  // Alpha Peak Frequency
  if (data.alpha_peak) {
    prompt += `## Individual Alpha Frequency (IAF)\n`;
    const posteriorChannels = ['O1', 'O2', 'P3', 'P4', 'Pz'];

    for (const condition of ['eo', 'ec'] as const) {
      const peakData = data.alpha_peak[condition];
      if (!peakData) continue;

      const conditionLabel = condition === 'eo' ? 'Eyes Open' : 'Eyes Closed';

      // Compute posterior average IAF
      let posteriorIafSum = 0;
      let posteriorIafCount = 0;
      const channelPeaks: string[] = [];

      for (const ch of posteriorChannels) {
        if (peakData[ch] && peakData[ch] > 0) {
          posteriorIafSum += peakData[ch];
          posteriorIafCount++;
          channelPeaks.push(`${ch}:${peakData[ch].toFixed(1)}Hz`);
        }
      }

      if (posteriorIafCount > 0) {
        const avgIaf = posteriorIafSum / posteriorIafCount;
        prompt += `\n### ${conditionLabel}\n`;
        prompt += `- Posterior IAF average: ${avgIaf.toFixed(1)} Hz`;
        if (avgIaf < 9.0) {
          prompt += ` (SLOWED - below typical 9.5-11 Hz range)`;
        } else if (avgIaf >= 9.5 && avgIaf <= 11.0) {
          prompt += ` (within normal range)`;
        }
        prompt += `\n`;
        prompt += `- By channel: ${channelPeaks.join(', ')}\n`;
      }
    }
    prompt += `\n`;
  }

  // Asymmetry
  if (data.asymmetry) {
    prompt += `## Hemispheric Asymmetry\n`;
    prompt += `(Negative = left dominant, Positive = right dominant)\n`;
    prompt += `- Frontal Alpha Asymmetry (FAA): ${data.asymmetry.frontal_alpha.toFixed(3)}\n`;
    prompt += `- Parietal Alpha Asymmetry: ${data.asymmetry.parietal_alpha.toFixed(3)}\n`;
    prompt += `- Frontal Theta Asymmetry: ${data.asymmetry.frontal_theta.toFixed(3)}\n`;
    prompt += `\n`;
  }

  // LZC Complexity
  if (data.lzc_values && Object.keys(data.lzc_values).length > 0) {
    prompt += `## Signal Complexity (Lempel-Ziv)\n`;
    for (const [condition, values] of Object.entries(data.lzc_values)) {
      if (values && typeof values === 'object') {
        const conditionLabel = condition === 'eo' || condition === 'EO' ? 'Eyes Open' : 'Eyes Closed';
        const avgLZC = Object.values(values).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0) / Object.values(values).length;
        prompt += `- ${conditionLabel} average normalized LZC: ${avgLZC.toFixed(3)}\n`;
      }
    }
    prompt += `\n`;
  }

  prompt += `Please provide  Likely functional correlates (attention, arousal, processing speed)
Avoid diagnostic labels..`;

  return prompt;
}
