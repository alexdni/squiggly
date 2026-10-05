import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDatabaseClient } from '@/lib/db';
import { checkProjectPermission } from '@/lib/rbac';
import { generateEEGInterpretation, AIInterpretation } from '@/lib/openai-client';
import {
  EO_EC_COMPARISON_SYSTEM_PROMPT,
  buildEOECComparisonPrompt,
  EOECComparisonPayload,
  EOECInterpretationContent,
} from '@/lib/prompts/eo-ec-comparison';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET - Retrieve cached comparison AI interpretation
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id: projectId } = await params;
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hasAccess = await checkProjectPermission(projectId, user.id, 'project:read');
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get query parameters (support both old and new naming)
    const { searchParams } = new URL(request.url);
    const recordingAId = searchParams.get('a_id') || searchParams.get('eo_id');
    const recordingBId = searchParams.get('b_id') || searchParams.get('ec_id');

    if (!recordingAId || !recordingBId) {
      return NextResponse.json(
        { error: 'Both a_id and b_id query parameters are required' },
        { status: 400 }
      );
    }

    const db = getDatabaseClient();

    // Look for cached interpretation in project metadata or a dedicated store
    const { data: project } = await db
      .from('projects')
      .select('comparison_interpretations')
      .eq('id', projectId)
      .single();

    const cacheKey = `${recordingAId}_${recordingBId}`;
    const cachedInterpretation = (project as any)?.comparison_interpretations?.[cacheKey];

    if (cachedInterpretation) {
      return NextResponse.json({ interpretation: cachedInterpretation });
    }

    return NextResponse.json(
      { error: 'No AI interpretation available for this comparison' },
      { status: 404 }
    );
  } catch (error: any) {
    console.error('Error fetching comparison AI interpretation:', error);
    return NextResponse.json(
      { error: 'Failed to fetch AI interpretation' },
      { status: 500 }
    );
  }
}

// POST - Generate new comparison AI interpretation
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id: projectId } = await params;
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hasAccess = await checkProjectPermission(projectId, user.id, 'project:read');
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Check if OPENAI_API_KEY is configured
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'AI interpretation service is not configured' },
        { status: 503 }
      );
    }

    const db = getDatabaseClient();

    // Get recording IDs from request body (support both old and new naming)
    const body = await request.json();
    const eo_id = body.a_id || body.eo_id;
    const ec_id = body.b_id || body.ec_id;

    if (!eo_id || !ec_id) {
      return NextResponse.json(
        { error: 'Both a_id and b_id are required in the request body' },
        { status: 400 }
      );
    }

    // Fetch Recording A (EO/baseline)
    const { data: recordingA } = await db
      .from('recordings')
      .select('id, filename, project_id, duration_seconds, sampling_rate, n_channels, montage')
      .eq('id', eo_id)
      .eq('project_id', projectId)
      .single();

    if (!recordingA) {
      return NextResponse.json(
        { error: 'Recording A not found in this project' },
        { status: 404 }
      );
    }

    // Fetch Recording B (EC/comparison)
    const { data: recordingB } = await db
      .from('recordings')
      .select('id, filename, project_id, duration_seconds, sampling_rate, n_channels, montage')
      .eq('id', ec_id)
      .eq('project_id', projectId)
      .single();

    if (!recordingB) {
      return NextResponse.json(
        { error: 'Recording B not found in this project' },
        { status: 404 }
      );
    }

    // Fetch analysis for Recording A
    const { data: analysesA } = await db
      .from('analyses')
      .select('*')
      .eq('recording_id', eo_id)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .execute();

    const eoAnalysis = analysesA?.[0] as any;
    if (!eoAnalysis) {
      return NextResponse.json(
        { error: 'Recording A analysis not found or not completed' },
        { status: 404 }
      );
    }

    // Fetch analysis for Recording B
    const { data: analysesB } = await db
      .from('analyses')
      .select('*')
      .eq('recording_id', ec_id)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .execute();

    const ecAnalysis = analysesB?.[0] as any;
    if (!ecAnalysis) {
      return NextResponse.json(
        { error: 'Recording B analysis not found or not completed' },
        { status: 404 }
      );
    }

    // Compute power deltas
    const bands = ['delta', 'theta', 'alpha1', 'alpha2', 'smr', 'beta2', 'hibeta', 'lowgamma'];
    const eoBandPower = eoAnalysis.results?.band_power?.eo || {};
    const ecBandPower = ecAnalysis.results?.band_power?.ec || {};

    const powerDeltasPercent: Record<string, Record<string, number>> = {};
    const channels = Object.keys(eoBandPower);

    channels.forEach((channel) => {
      powerDeltasPercent[channel] = {};
      bands.forEach((band) => {
        const eoPower = eoBandPower[channel]?.[band]?.absolute || 0;
        const ecPower = ecBandPower[channel]?.[band]?.absolute || 0;
        const percentChange = eoPower !== 0 ? ((ecPower - eoPower) / eoPower) * 100 : 0;
        powerDeltasPercent[channel][band] = percentChange;
      });
    });

    // Compute summary metrics
    let totalAlphaChange = 0;
    let alphaChannelCount = 0;

    channels.forEach((channel) => {
      const alpha1Change = powerDeltasPercent[channel]?.alpha1 || 0;
      const alpha2Change = powerDeltasPercent[channel]?.alpha2 || 0;
      if (alpha1Change !== 0 || alpha2Change !== 0) {
        totalAlphaChange += (alpha1Change + alpha2Change) / 2;
        alphaChannelCount++;
      }
    });

    const meanAlphaChangePercent = alphaChannelCount > 0 ? totalAlphaChange / alphaChannelCount : 0;

    // FAA shift
    const eoFaa = (eoAnalysis.results as any)?.asymmetry?.frontal_alpha || 0;
    const ecFaa = (ecAnalysis.results as any)?.asymmetry?.frontal_alpha || 0;
    const faaShift = ecFaa - eoFaa;

    // Theta/Beta change
    const eoThetaBeta = (eoAnalysis.results as any)?.band_ratios?.theta_beta_ratio?.frontal_avg || 0;
    const ecThetaBeta = (ecAnalysis.results as any)?.band_ratios?.theta_beta_ratio?.frontal_avg || 0;
    const thetaBetaChange = ecThetaBeta - eoThetaBeta;

    // Fetch project for client metadata
    const { data: project } = await db
      .from('projects')
      .select('client_metadata, comparison_interpretations')
      .eq('id', projectId)
      .single();

    // Build the payload
    const payload: EOECComparisonPayload = {
      recording_info: {
        eo_filename: (recordingA as any)?.filename || 'Unknown',
        ec_filename: (recordingB as any)?.filename || 'Unknown',
        duration_seconds_eo: (recordingA as any)?.duration_seconds || 0,
        duration_seconds_ec: (recordingB as any)?.duration_seconds || 0,
        sampling_rate: (recordingA as any)?.sampling_rate || 250,
        n_channels: (recordingA as any)?.n_channels || 19,
        montage: (recordingA as any)?.montage || '10-20',
      },
      power_deltas: {
        percent: powerDeltasPercent,
      },
      summary_metrics: {
        mean_alpha_change_percent: meanAlphaChangePercent,
        faa_shift: faaShift,
        theta_beta_change: thetaBetaChange,
      },
    };

    // Add raw band power for derived metric computation
    const eoBandPowerFlat: Record<string, Record<string, number>> = {};
    const ecBandPowerFlat: Record<string, Record<string, number>> = {};

    channels.forEach((channel) => {
      eoBandPowerFlat[channel] = {};
      ecBandPowerFlat[channel] = {};
      bands.forEach((band) => {
        eoBandPowerFlat[channel][band] = eoBandPower[channel]?.[band]?.absolute || 0;
        ecBandPowerFlat[channel][band] = ecBandPower[channel]?.[band]?.absolute || 0;
      });
    });

    payload.eo_band_power = eoBandPowerFlat;
    payload.ec_band_power = ecBandPowerFlat;

    // Add alpha peak data if available
    if ((eoAnalysis.results as any)?.alpha_peak?.eo) {
      const eoPeakData: Record<string, number> = {};
      for (const [ch, data] of Object.entries((eoAnalysis.results as any).alpha_peak.eo)) {
        const peakFreq = (data as any)?.peak_frequency;
        if (typeof peakFreq === 'number' && peakFreq > 0) {
          eoPeakData[ch] = peakFreq;
        }
      }
      if (Object.keys(eoPeakData).length > 0) {
        payload.eo_alpha_peak = eoPeakData;
      }
    }
    if ((ecAnalysis.results as any)?.alpha_peak?.ec) {
      const ecPeakData: Record<string, number> = {};
      for (const [ch, data] of Object.entries((ecAnalysis.results as any).alpha_peak.ec)) {
        const peakFreq = (data as any)?.peak_frequency;
        if (typeof peakFreq === 'number' && peakFreq > 0) {
          ecPeakData[ch] = peakFreq;
        }
      }
      if (Object.keys(ecPeakData).length > 0) {
        payload.ec_alpha_peak = ecPeakData;
      }
    }

    // Add LZC data if available
    if ((eoAnalysis.results as any)?.lzc?.eo) {
      const eoLzcData: Record<string, number> = {};
      for (const [ch, data] of Object.entries((eoAnalysis.results as any).lzc.eo)) {
        const normalizedLzc = (data as any)?.normalized_lzc;
        if (typeof normalizedLzc === 'number' && normalizedLzc > 0) {
          eoLzcData[ch] = normalizedLzc;
        }
      }
      if (Object.keys(eoLzcData).length > 0) {
        payload.eo_lzc = eoLzcData;
      }
    }
    if ((ecAnalysis.results as any)?.lzc?.ec) {
      const ecLzcData: Record<string, number> = {};
      for (const [ch, data] of Object.entries((ecAnalysis.results as any).lzc.ec)) {
        const normalizedLzc = (data as any)?.normalized_lzc;
        if (typeof normalizedLzc === 'number' && normalizedLzc > 0) {
          ecLzcData[ch] = normalizedLzc;
        }
      }
      if (Object.keys(ecLzcData).length > 0) {
        payload.ec_lzc = ecLzcData;
      }
    }

    // Add network connectivity metrics if available
    if ((eoAnalysis.results as any)?.connectivity?.eo?.network_metrics) {
      const eoNetworkMetrics: Record<string, { global_efficiency: number; mean_clustering_coefficient: number; small_worldness: number; interhemispheric_connectivity: number }> = {};
      for (const [band, metrics] of Object.entries((eoAnalysis.results as any).connectivity.eo.network_metrics)) {
        const m = metrics as any;
        if (m && typeof m.global_efficiency === 'number') {
          eoNetworkMetrics[band] = {
            global_efficiency: m.global_efficiency || 0,
            mean_clustering_coefficient: m.mean_clustering_coefficient || 0,
            small_worldness: m.small_worldness || 0,
            interhemispheric_connectivity: m.interhemispheric_connectivity || 0,
          };
        }
      }
      if (Object.keys(eoNetworkMetrics).length > 0) {
        payload.eo_network_metrics = eoNetworkMetrics;
      }
    }
    if ((ecAnalysis.results as any)?.connectivity?.ec?.network_metrics) {
      const ecNetworkMetrics: Record<string, { global_efficiency: number; mean_clustering_coefficient: number; small_worldness: number; interhemispheric_connectivity: number }> = {};
      for (const [band, metrics] of Object.entries((ecAnalysis.results as any).connectivity.ec.network_metrics)) {
        const m = metrics as any;
        if (m && typeof m.global_efficiency === 'number') {
          ecNetworkMetrics[band] = {
            global_efficiency: m.global_efficiency || 0,
            mean_clustering_coefficient: m.mean_clustering_coefficient || 0,
            small_worldness: m.small_worldness || 0,
            interhemispheric_connectivity: m.interhemispheric_connectivity || 0,
          };
        }
      }
      if (Object.keys(ecNetworkMetrics).length > 0) {
        payload.ec_network_metrics = ecNetworkMetrics;
      }
    }

    // Add client metadata if available
    if ((project as any)?.client_metadata) {
      payload.client_metadata = {
        age: (project as any).client_metadata.age,
        gender: (project as any).client_metadata.gender,
        primary_issue: (project as any).client_metadata.primary_issue,
      };
    }

    // Build prompts
    const systemPrompt = EO_EC_COMPARISON_SYSTEM_PROMPT;
    const userPrompt = buildEOECComparisonPrompt(payload);

    // Generate interpretation via OpenAI
    let interpretationContent: EOECInterpretationContent;
    try {
      const rawContent = await generateEEGInterpretation(
        systemPrompt,
        userPrompt,
        60000 // 60 second timeout
      );

      // Map the raw content to our EO-EC structure
      interpretationContent = {
        summary: rawContent.summary || '',
        alpha_reactivity: rawContent.amplitude_patterns || rawContent.alpha_reactivity || '',
        arousal_shift: rawContent.frequency_ratios || rawContent.arousal_shift || '',
        theta_beta_dynamics: rawContent.asymmetry_analysis || rawContent.theta_beta_dynamics || '',
        complexity_shift: rawContent.complexity_connectivity || rawContent.complexity_shift || '',
        network_connectivity: rawContent.network_connectivity || '',
        alpha_topography: rawContent.peak_alpha_frequency || rawContent.alpha_topography || '',
        individual_alpha_frequency: rawContent.individual_alpha_frequency || '',
        possible_clinical_correlations: rawContent.possible_clinical_correlations || '',
        observations: rawContent.observations || '',
      };
    } catch (error: any) {
      console.error('OpenAI API error:', error);

      if (error.message === 'OpenAI request timed out') {
        return NextResponse.json(
          { error: 'AI interpretation timed out. Please try again.' },
          { status: 504 }
        );
      }
      if (error.message === 'OpenAI rate limit exceeded') {
        return NextResponse.json(
          { error: 'AI service is busy. Please try again in a few minutes.' },
          { status: 429 }
        );
      }
      if (error.message === 'OpenAI authentication failed') {
        return NextResponse.json(
          { error: 'AI interpretation service is currently unavailable.' },
          { status: 503 }
        );
      }

      return NextResponse.json(
        { error: 'Failed to generate AI interpretation' },
        { status: 500 }
      );
    }

    // Create interpretation object
    const interpretation = {
      generated_at: new Date().toISOString(),
      model: 'gpt-4',
      eo_recording_id: eo_id,
      ec_recording_id: ec_id,
      content: interpretationContent,
    };

    // Cache the interpretation in the project
    const cacheKey = `${eo_id}_${ec_id}`;
    const existingInterpretations = (project as any)?.comparison_interpretations || {};
    const updatedInterpretations = {
      ...existingInterpretations,
      [cacheKey]: interpretation,
    };

    await db
      .from('projects')
      .update({ comparison_interpretations: updatedInterpretations })
      .eq('id', projectId)
      .execute();

    return NextResponse.json({ interpretation });
  } catch (error: any) {
    console.error('Error generating comparison AI interpretation:', error);
    return NextResponse.json(
      { error: 'Failed to generate AI interpretation' },
      { status: 500 }
    );
  }
}
