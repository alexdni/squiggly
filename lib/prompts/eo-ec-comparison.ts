export const EO_EC_COMPARISON_SYSTEM_PROMPT = `You are an expert neurophysiologist and quantitative EEG (qEEG) specialist with over 20 years of clinical and research experience. Your role is to provide comprehensive, educational interpretations of EEG state changes from Eyes Open (EO) to Eyes Closed (EC) conditions.

IMPORTANT GUIDELINES:
1. This is for EDUCATIONAL purposes only - do not provide clinical diagnoses
2. Focus specifically on the TRANSITION and REACTIVITY patterns from EO to EC
3. Frame observations in terms of patterns commonly discussed in research literature
4. Reference well-known qEEG reactivity patterns and biomarkers from peer-reviewed literature
5. When discussing possible correlations with clinical conditions, emphasize these are PATTERNS seen in research, not diagnoses
6. Always recommend professional evaluation for any concerning patterns

KEY CONCEPTS FOR EO→EC ANALYSIS:
- Alpha Reactivity: The hallmark EEG change when eyes close is increased posterior alpha power (the "alpha blocking" effect in reverse - alpha appears with eyes closed)
- Typical healthy pattern: 50-100%+ increase in posterior alpha (O1, O2, P3, P4, Pz) from EO to EC
- Global vs Regional: Compare whole-brain vs posterior-specific changes
- Arousal Regulation: Beta/gamma changes may indicate arousal shifts
- Complexity Changes: LZC typically decreases slightly in EC (more rhythmic activity)
- Network Connectivity: wPLI measures phase-based connectivity between brain regions

CLINICAL CORRELATIONS (for educational discussion only):
- Reduced alpha reactivity (<30%): Associated with cognitive decline, depression, some neurodegenerative conditions
- Elevated theta/beta ratio: Research links to attention difficulties (ADHD phenotype), but not diagnostic
- Persistent high beta in EC: May indicate anxiety, hypervigilance, difficulty relaxing
- Slowed IAF (<9 Hz): Associated with cognitive processing concerns, aging, some neurological conditions
- Reduced connectivity/efficiency: May indicate integration difficulties seen in various conditions
- Elevated frontal theta: Can be associated with emotional regulation challenges
- Asymmetry patterns: FAA shifts associated with mood regulation in research literature

OUTPUT FORMAT:
Structure your response with the following sections (use ## headers):

## Summary
A brief 2-3 sentence overview of the key EO→EC transition findings and overall regulatory capacity.

## Alpha Reactivity
Detailed analysis of alpha power changes from EO to EC:
- Posterior alpha reactivity (O1, O2, P3, P4, Pz) - expected increase 50-100%+
- Global alpha reactivity (mean across all channels)
- Regional variations in alpha response
- Clinical implications of reduced (<30%) or absent alpha reactivity

## Arousal Shift
Analysis of changes in faster frequencies (beta2, high beta, low gamma):
- Overall arousal indicator changes EO→EC
- Expected: modest decrease in high frequencies with relaxation
- Aberrant patterns: persistent high beta/gamma in EC may indicate difficulty "powering down"

## Theta/Beta Dynamics
Interpretation of how theta/beta patterns shift between conditions:
- Frontal theta/beta ratio change
- Central theta/beta changes
- Implications for attention and arousal regulation

## Complexity Shift
If LZC data is available:
- Signal complexity change EO→EC
- Expected: slight decrease in complexity (more rhythmic alpha)
- Regional variations in complexity change

## Network Connectivity
If connectivity data is available:
- Global efficiency changes EO→EC (integration capacity)
- Clustering coefficient changes (local processing)
- Small-worldness (balance of integration and segregation)
- Interhemispheric connectivity (cross-hemisphere communication)
- Band-specific connectivity patterns (alpha connectivity often increases in EC)

## Alpha Topography
Analysis of the spatial distribution of alpha changes:
- Does the "center of mass" shift posteriorly in EC (as expected)?
- Anterior vs posterior alpha gradient
- Regional patterns that deviate from expected posterior dominance

## Individual Alpha Frequency
If alpha peak data is available:
- Compare dominant alpha peak frequency EO vs EC (posterior channels)
- Expected: IAF should be similar or slightly higher in EC
- Note any significant shift in peak frequency between conditions

## Possible Clinical Correlations
Based on the observed patterns, discuss what conditions or phenotypes these patterns have been ASSOCIATED with in research literature. Be clear that:
- These are correlations observed in research, NOT diagnoses
- Many patterns are non-specific and can appear in various conditions
- Individual variation is substantial
- Professional evaluation is essential for any clinical concerns

## Observations
Integration of all findings, overall assessment of EO→EC regulatory capacity, and any patterns warranting professional follow-up. Include the educational disclaimer that this analysis is for informational purposes only and does not constitute medical advice or diagnosis.`;

export interface EOECComparisonPayload {
  recording_info: {
    eo_filename: string;
    ec_filename: string;
    duration_seconds_eo: number;
    duration_seconds_ec: number;
    sampling_rate: number;
    n_channels: number;
    montage: string;
  };
  power_deltas: {
    percent: Record<string, Record<string, number>>;  // channel -> band -> percent change
  };
  summary_metrics: {
    mean_alpha_change_percent: number;
    faa_shift: number;
    theta_beta_change: number;
  };
  // Per-channel EO and EC values for computing additional metrics
  eo_band_power?: Record<string, Record<string, number>>;
  ec_band_power?: Record<string, Record<string, number>>;
  // Alpha peak frequency data
  eo_alpha_peak?: Record<string, number>;
  ec_alpha_peak?: Record<string, number>;
  // LZC complexity data
  eo_lzc?: Record<string, number>;
  ec_lzc?: Record<string, number>;
  // Network connectivity metrics by band
  eo_network_metrics?: Record<string, {
    global_efficiency: number;
    mean_clustering_coefficient: number;
    small_worldness: number;
    interhemispheric_connectivity: number;
  }>;
  ec_network_metrics?: Record<string, {
    global_efficiency: number;
    mean_clustering_coefficient: number;
    small_worldness: number;
    interhemispheric_connectivity: number;
  }>;
  client_metadata?: {
    age?: number;
    gender?: string;
    primary_issue?: string;
  };
}

export interface EOECInterpretationContent {
  summary: string;
  alpha_reactivity: string;
  arousal_shift: string;
  theta_beta_dynamics: string;
  complexity_shift: string;
  network_connectivity: string;
  alpha_topography: string;
  individual_alpha_frequency: string;
  possible_clinical_correlations: string;
  observations: string;
}

export function buildEOECComparisonPrompt(data: EOECComparisonPayload): string {
  let prompt = `Please analyze the following EO→EC (Eyes Open to Eyes Closed) transition data and provide your expert interpretation of regulatory capacity and state changes.\n\n`;

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
  prompt += `- EO Recording: ${data.recording_info.eo_filename}\n`;
  prompt += `- EC Recording: ${data.recording_info.ec_filename}\n`;
  prompt += `- Sampling rate: ${data.recording_info.sampling_rate} Hz\n`;
  prompt += `- Channels: ${data.recording_info.n_channels}\n`;
  prompt += `- Montage: ${data.recording_info.montage}\n\n`;

  // Summary metrics
  prompt += `## Summary Metrics\n`;
  prompt += `- Mean Alpha Change (EC vs EO): ${data.summary_metrics.mean_alpha_change_percent.toFixed(1)}%\n`;
  prompt += `- FAA Shift: ${data.summary_metrics.faa_shift.toFixed(3)}\n`;
  prompt += `- Theta/Beta Ratio Change: ${data.summary_metrics.theta_beta_change.toFixed(3)}\n\n`;

  // Per-channel percent changes
  if (data.power_deltas?.percent) {
    prompt += `## Power Changes by Channel (EC - EO, percent change)\n`;
    const bands = ['delta', 'theta', 'alpha1', 'alpha2', 'smr', 'beta2', 'hibeta', 'lowgamma'];
    const bandLabels: Record<string, string> = {
      delta: 'Delta',
      theta: 'Theta',
      alpha1: 'Alpha1',
      alpha2: 'Alpha2',
      smr: 'SMR',
      beta2: 'Beta2',
      hibeta: 'HiBeta',
      lowgamma: 'LowGamma',
    };

    // Group channels by region
    const regions: Record<string, string[]> = {
      Frontal: ['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8'],
      Central: ['C3', 'Cz', 'C4'],
      Temporal: ['T7', 'T8'],
      Parietal: ['P7', 'P3', 'Pz', 'P4', 'P8'],
      Occipital: ['O1', 'O2'],
    };

    for (const [region, channels] of Object.entries(regions)) {
      const regionLines: string[] = [];
      for (const ch of channels) {
        if (data.power_deltas.percent[ch]) {
          const chData = data.power_deltas.percent[ch];
          const values = bands
            .map(b => {
              const val = chData[b];
              if (typeof val === 'number') {
                const sign = val >= 0 ? '+' : '';
                return `${bandLabels[b]}:${sign}${val.toFixed(1)}%`;
              }
              return null;
            })
            .filter(Boolean)
            .join(', ');
          if (values) regionLines.push(`  ${ch}: ${values}`);
        }
      }
      if (regionLines.length > 0) {
        prompt += `\n**${region}:**\n${regionLines.join('\n')}\n`;
      }
    }
    prompt += `\n`;
  }

  // Compute derived regulation markers
  prompt += `## Regulation Markers\n`;

  // Posterior alpha reactivity
  const posteriorChannels = ['O1', 'O2', 'P3', 'P4', 'Pz'];
  if (data.power_deltas?.percent) {
    let posteriorAlphaSum = 0;
    let posteriorAlphaCount = 0;
    for (const ch of posteriorChannels) {
      const alpha1 = data.power_deltas.percent[ch]?.alpha1;
      const alpha2 = data.power_deltas.percent[ch]?.alpha2;
      if (typeof alpha1 === 'number') {
        posteriorAlphaSum += alpha1;
        posteriorAlphaCount++;
      }
      if (typeof alpha2 === 'number') {
        posteriorAlphaSum += alpha2;
        posteriorAlphaCount++;
      }
    }
    if (posteriorAlphaCount > 0) {
      const posteriorAlphaReactivity = posteriorAlphaSum / posteriorAlphaCount;
      prompt += `- **Posterior Alpha Reactivity**: ${posteriorAlphaReactivity.toFixed(1)}%`;
      if (posteriorAlphaReactivity < 30) {
        prompt += ` (REDUCED - typical healthy response is 50-100%+)`;
      } else if (posteriorAlphaReactivity >= 50) {
        prompt += ` (within expected range)`;
      }
      prompt += `\n`;
    }

    // Global alpha reactivity
    let globalAlphaSum = 0;
    let globalAlphaCount = 0;
    for (const ch of Object.keys(data.power_deltas.percent)) {
      const alpha1 = data.power_deltas.percent[ch]?.alpha1;
      const alpha2 = data.power_deltas.percent[ch]?.alpha2;
      if (typeof alpha1 === 'number') {
        globalAlphaSum += alpha1;
        globalAlphaCount++;
      }
      if (typeof alpha2 === 'number') {
        globalAlphaSum += alpha2;
        globalAlphaCount++;
      }
    }
    if (globalAlphaCount > 0) {
      const globalAlphaReactivity = globalAlphaSum / globalAlphaCount;
      prompt += `- **Global Alpha Reactivity**: ${globalAlphaReactivity.toFixed(1)}%\n`;
    }

    // Arousal shift (beta2, hibeta, lowgamma average change)
    let arousalSum = 0;
    let arousalCount = 0;
    for (const ch of Object.keys(data.power_deltas.percent)) {
      const beta2 = data.power_deltas.percent[ch]?.beta2;
      const hibeta = data.power_deltas.percent[ch]?.hibeta;
      const lowgamma = data.power_deltas.percent[ch]?.lowgamma;
      if (typeof beta2 === 'number') { arousalSum += beta2; arousalCount++; }
      if (typeof hibeta === 'number') { arousalSum += hibeta; arousalCount++; }
      if (typeof lowgamma === 'number') { arousalSum += lowgamma; arousalCount++; }
    }
    if (arousalCount > 0) {
      const arousalShift = arousalSum / arousalCount;
      prompt += `- **Arousal Shift (high freq avg)**: ${arousalShift.toFixed(1)}%`;
      if (arousalShift > 10) {
        prompt += ` (ELEVATED in EC - may indicate difficulty "powering down")`;
      } else if (arousalShift < -20) {
        prompt += ` (decreased as expected with relaxation)`;
      }
      prompt += `\n`;
    }

    // Topography shift - compare anterior vs posterior alpha change
    const anteriorChannels = ['Fp1', 'Fp2', 'F3', 'F4', 'Fz'];
    let anteriorAlphaSum = 0;
    let anteriorAlphaCount = 0;
    for (const ch of anteriorChannels) {
      const alpha1 = data.power_deltas.percent[ch]?.alpha1;
      const alpha2 = data.power_deltas.percent[ch]?.alpha2;
      if (typeof alpha1 === 'number') { anteriorAlphaSum += alpha1; anteriorAlphaCount++; }
      if (typeof alpha2 === 'number') { anteriorAlphaSum += alpha2; anteriorAlphaCount++; }
    }
    if (anteriorAlphaCount > 0 && posteriorAlphaCount > 0) {
      const anteriorAlpha = anteriorAlphaSum / anteriorAlphaCount;
      const posteriorAlpha = posteriorAlphaSum / posteriorAlphaCount;
      const topographyGradient = posteriorAlpha - anteriorAlpha;
      prompt += `- **Topography Gradient (post - ant alpha)**: ${topographyGradient.toFixed(1)}%`;
      if (topographyGradient > 20) {
        prompt += ` (expected posterior-dominant pattern)`;
      } else if (topographyGradient < 0) {
        prompt += ` (ATYPICAL - anterior alpha increase greater than posterior)`;
      }
      prompt += `\n`;
    }
  }
  prompt += `\n`;

  // LZC Complexity comparison
  if (data.eo_lzc && data.ec_lzc) {
    prompt += `## Complexity Comparison (Lempel-Ziv)\n`;
    const eoValues = Object.values(data.eo_lzc).filter(v => typeof v === 'number');
    const ecValues = Object.values(data.ec_lzc).filter(v => typeof v === 'number');

    if (eoValues.length > 0 && ecValues.length > 0) {
      const eoAvg = eoValues.reduce((a, b) => a + b, 0) / eoValues.length;
      const ecAvg = ecValues.reduce((a, b) => a + b, 0) / ecValues.length;
      const lzcChange = ((ecAvg - eoAvg) / eoAvg) * 100;

      prompt += `- EO average LZC: ${eoAvg.toFixed(3)}\n`;
      prompt += `- EC average LZC: ${ecAvg.toFixed(3)}\n`;
      prompt += `- **LZC Shift**: ${lzcChange.toFixed(1)}%`;
      if (lzcChange < -5) {
        prompt += ` (decreased complexity in EC - expected with increased rhythmic alpha)`;
      } else if (lzcChange > 5) {
        prompt += ` (INCREASED complexity in EC - atypical pattern)`;
      }
      prompt += `\n\n`;
    }
  }

  // Network Connectivity comparison
  if (data.eo_network_metrics || data.ec_network_metrics) {
    prompt += `## Network Connectivity Metrics (wPLI-based)\n`;
    const connectivityBands = ['delta', 'theta', 'alpha', 'beta'];

    for (const band of connectivityBands) {
      const eoMetrics = data.eo_network_metrics?.[band];
      const ecMetrics = data.ec_network_metrics?.[band];

      if (eoMetrics || ecMetrics) {
        prompt += `\n**${band.charAt(0).toUpperCase() + band.slice(1)} Band:**\n`;

        if (eoMetrics && ecMetrics) {
          // Both conditions available - show comparison
          const geChange = ((ecMetrics.global_efficiency - eoMetrics.global_efficiency) / eoMetrics.global_efficiency * 100) || 0;
          const ccChange = ((ecMetrics.mean_clustering_coefficient - eoMetrics.mean_clustering_coefficient) / eoMetrics.mean_clustering_coefficient * 100) || 0;
          const swChange = ((ecMetrics.small_worldness - eoMetrics.small_worldness) / eoMetrics.small_worldness * 100) || 0;
          const ihChange = ((ecMetrics.interhemispheric_connectivity - eoMetrics.interhemispheric_connectivity) / eoMetrics.interhemispheric_connectivity * 100) || 0;

          prompt += `- Global Efficiency: EO=${eoMetrics.global_efficiency.toFixed(3)}, EC=${ecMetrics.global_efficiency.toFixed(3)} (${geChange >= 0 ? '+' : ''}${geChange.toFixed(1)}%)\n`;
          prompt += `- Clustering Coef: EO=${eoMetrics.mean_clustering_coefficient.toFixed(3)}, EC=${ecMetrics.mean_clustering_coefficient.toFixed(3)} (${ccChange >= 0 ? '+' : ''}${ccChange.toFixed(1)}%)\n`;
          prompt += `- Small-worldness: EO=${eoMetrics.small_worldness.toFixed(2)}, EC=${ecMetrics.small_worldness.toFixed(2)} (${swChange >= 0 ? '+' : ''}${swChange.toFixed(1)}%)\n`;
          prompt += `- Interhemispheric: EO=${eoMetrics.interhemispheric_connectivity.toFixed(3)}, EC=${ecMetrics.interhemispheric_connectivity.toFixed(3)} (${ihChange >= 0 ? '+' : ''}${ihChange.toFixed(1)}%)\n`;
        } else if (eoMetrics) {
          // Only EO
          prompt += `- Global Efficiency (EO): ${eoMetrics.global_efficiency.toFixed(3)}\n`;
          prompt += `- Clustering Coef (EO): ${eoMetrics.mean_clustering_coefficient.toFixed(3)}\n`;
          prompt += `- Small-worldness (EO): ${eoMetrics.small_worldness.toFixed(2)}\n`;
          prompt += `- Interhemispheric (EO): ${eoMetrics.interhemispheric_connectivity.toFixed(3)}\n`;
        } else if (ecMetrics) {
          // Only EC
          prompt += `- Global Efficiency (EC): ${ecMetrics.global_efficiency.toFixed(3)}\n`;
          prompt += `- Clustering Coef (EC): ${ecMetrics.mean_clustering_coefficient.toFixed(3)}\n`;
          prompt += `- Small-worldness (EC): ${ecMetrics.small_worldness.toFixed(2)}\n`;
          prompt += `- Interhemispheric (EC): ${ecMetrics.interhemispheric_connectivity.toFixed(3)}\n`;
        }
      }
    }

    // Add interpretation guidance
    prompt += `\n**Interpretation Notes:**\n`;
    prompt += `- Global Efficiency: Higher = better integration across brain regions\n`;
    prompt += `- Clustering Coefficient: Higher = stronger local processing\n`;
    prompt += `- Small-worldness: >1 indicates optimal balance of integration and segregation\n`;
    prompt += `- Interhemispheric: Connectivity between left and right hemisphere\n`;
    prompt += `- Alpha connectivity typically increases in EC (relaxed, synchronized state)\n\n`;
  }

  // Alpha Peak Frequency comparison
  if (data.eo_alpha_peak && data.ec_alpha_peak) {
    prompt += `## Individual Alpha Frequency (IAF) Comparison\n`;

    let eoIafSum = 0, eoIafCount = 0;
    let ecIafSum = 0, ecIafCount = 0;
    const peakComparisons: string[] = [];

    for (const ch of posteriorChannels) {
      const eoPeak = data.eo_alpha_peak[ch];
      const ecPeak = data.ec_alpha_peak[ch];

      if (typeof eoPeak === 'number' && eoPeak > 0) {
        eoIafSum += eoPeak;
        eoIafCount++;
      }
      if (typeof ecPeak === 'number' && ecPeak > 0) {
        ecIafSum += ecPeak;
        ecIafCount++;
      }
      if (typeof eoPeak === 'number' && typeof ecPeak === 'number' && eoPeak > 0 && ecPeak > 0) {
        peakComparisons.push(`${ch}: EO=${eoPeak.toFixed(1)}Hz → EC=${ecPeak.toFixed(1)}Hz`);
      }
    }

    if (eoIafCount > 0 && ecIafCount > 0) {
      const eoIaf = eoIafSum / eoIafCount;
      const ecIaf = ecIafSum / ecIafCount;
      const iafShift = ecIaf - eoIaf;

      prompt += `- **EO Posterior IAF**: ${eoIaf.toFixed(1)} Hz\n`;
      prompt += `- **EC Posterior IAF**: ${ecIaf.toFixed(1)} Hz\n`;
      prompt += `- **IAF Shift (EC - EO)**: ${iafShift.toFixed(1)} Hz`;
      if (Math.abs(iafShift) > 1.0) {
        prompt += ` (notable shift between conditions)`;
      }
      prompt += `\n`;

      if (peakComparisons.length > 0) {
        prompt += `- By channel: ${peakComparisons.join(', ')}\n`;
      }

      // Flag slowed IAF
      if (ecIaf < 9.0) {
        prompt += `- **Note**: EC IAF is slowed (<9 Hz) - may indicate cognitive processing concerns\n`;
      }
    }
    prompt += `\n`;
  }

  prompt += `Please provide your expert interpretation focusing on EO→EC regulatory capacity, alpha reactivity patterns, arousal regulation, network connectivity changes, and any atypical findings. When discussing possible clinical correlations, be clear these are research associations, not diagnoses, and recommend professional evaluation for any concerning patterns.`;

  return prompt;
}
