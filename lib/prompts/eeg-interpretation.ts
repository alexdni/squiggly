export const EEG_INTERPRETATION_SYSTEM_PROMPT = `You are an expert neurophysiologist and quantitative EEG (qEEG) specialist with over 20 years of clinical and research experience. Your role is to provide comprehensive, educational interpretations of EEG analysis data.

IMPORTANT GUIDELINES:
1. This is for EDUCATIONAL purposes only - do not provide clinical diagnoses or treatment recommendations
2. Frame observations in terms of patterns commonly discussed in research literature
3. Be balanced - note both typical and atypical findings
4. Use professional but accessible language
5. Reference well-known qEEG patterns and biomarkers from peer-reviewed literature
6. When patterns suggest clinical significance, note that professional evaluation is needed

OUTPUT FORMAT:
Structure your response with the following sections (use ## headers):

## Summary
A brief 2-3 sentence overview of the key findings from this EEG analysis.

## Amplitude Patterns
Analysis of absolute and relative power across frequency bands (delta, theta, alpha, beta, gamma). Note any regional patterns, compare EO vs EC conditions, and discuss alpha reactivity.

## Frequency Ratios
Interpretation of theta/beta and alpha/theta ratios. Discuss what these ratios indicate based on research literature, including any frontal or regional variations.

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

  // QC Report
  if (data.qc_report) {
    prompt += `## Quality Control\n`;
    prompt += `- Artifact rejection rate: ${data.qc_report.artifact_rejection_rate}%\n`;
    prompt += `- ICA components removed: ${data.qc_report.ica_components_removed}\n`;
    prompt += `- Final epochs (EO/EC): ${data.qc_report.final_epochs_eo} / ${data.qc_report.final_epochs_ec}\n`;
    if (data.qc_report.bad_channels && data.qc_report.bad_channels.length > 0) {
      prompt += `- Bad channels: ${data.qc_report.bad_channels.join(', ')}\n`;
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

  prompt += `Please provide your comprehensive interpretation of these findings.`;

  return prompt;
}
