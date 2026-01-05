import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { checkProjectPermission } from '@/lib/rbac';
import { generateEEGInterpretation, AIInterpretation } from '@/lib/openai-client';
import {
  EO_EC_COMPARISON_SYSTEM_PROMPT,
  buildEOECComparisonPrompt,
  EOECComparisonPayload,
  EOECInterpretationContent,
} from '@/lib/prompts/eo-ec-comparison';

interface RouteParams {
  params: { id: string };
}

// GET - Retrieve cached comparison AI interpretation
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hasAccess = await checkProjectPermission(params.id, user.id, 'project:read');
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const eoRecordingId = searchParams.get('eo_id');
    const ecRecordingId = searchParams.get('ec_id');

    if (!eoRecordingId || !ecRecordingId) {
      return NextResponse.json(
        { error: 'Both eo_id and ec_id query parameters are required' },
        { status: 400 }
      );
    }

    // Look for cached interpretation in project metadata or a dedicated store
    // For now, we'll check if there's a cached interpretation stored in the project
    const { data: project } = await (supabase as any)
      .from('projects')
      .select('comparison_interpretations')
      .eq('id', params.id)
      .single();

    const cacheKey = `${eoRecordingId}_${ecRecordingId}`;
    const cachedInterpretation = project?.comparison_interpretations?.[cacheKey];

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
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hasAccess = await checkProjectPermission(params.id, user.id, 'project:read');
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

    // Get recording IDs from request body
    const body = await request.json();
    const { eo_id, ec_id } = body;

    if (!eo_id || !ec_id) {
      return NextResponse.json(
        { error: 'Both eo_id and ec_id are required in the request body' },
        { status: 400 }
      );
    }

    // Fetch EO analysis
    const { data: eoAnalysis, error: eoError } = await (supabase as any)
      .from('analyses')
      .select(`
        *,
        recording:recordings!inner (
          id,
          filename,
          project_id,
          duration_seconds,
          sampling_rate,
          n_channels,
          montage
        )
      `)
      .eq('recording_id', eo_id)
      .eq('recording.project_id', params.id)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (eoError || !eoAnalysis) {
      return NextResponse.json(
        { error: 'EO recording analysis not found or not completed' },
        { status: 404 }
      );
    }

    // Fetch EC analysis
    const { data: ecAnalysis, error: ecError } = await (supabase as any)
      .from('analyses')
      .select(`
        *,
        recording:recordings!inner (
          id,
          filename,
          project_id,
          duration_seconds,
          sampling_rate,
          n_channels,
          montage
        )
      `)
      .eq('recording_id', ec_id)
      .eq('recording.project_id', params.id)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (ecError || !ecAnalysis) {
      return NextResponse.json(
        { error: 'EC recording analysis not found or not completed' },
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
    const eoFaa = eoAnalysis.results?.asymmetry?.frontal_alpha || 0;
    const ecFaa = ecAnalysis.results?.asymmetry?.frontal_alpha || 0;
    const faaShift = ecFaa - eoFaa;

    // Theta/Beta change
    const eoThetaBeta = eoAnalysis.results?.band_ratios?.theta_beta_ratio?.frontal_avg || 0;
    const ecThetaBeta = ecAnalysis.results?.band_ratios?.theta_beta_ratio?.frontal_avg || 0;
    const thetaBetaChange = ecThetaBeta - eoThetaBeta;

    // Fetch project for client metadata
    const { data: project } = await (supabase as any)
      .from('projects')
      .select('client_metadata')
      .eq('id', params.id)
      .single();

    // Build the payload
    const payload: EOECComparisonPayload = {
      recording_info: {
        eo_filename: eoAnalysis.recording?.filename || 'Unknown',
        ec_filename: ecAnalysis.recording?.filename || 'Unknown',
        duration_seconds_eo: eoAnalysis.recording?.duration_seconds || 0,
        duration_seconds_ec: ecAnalysis.recording?.duration_seconds || 0,
        sampling_rate: eoAnalysis.recording?.sampling_rate || 250,
        n_channels: eoAnalysis.recording?.n_channels || 19,
        montage: eoAnalysis.recording?.montage || '10-20',
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
    if (eoAnalysis.results?.alpha_peak?.eo) {
      payload.eo_alpha_peak = eoAnalysis.results.alpha_peak.eo;
    }
    if (ecAnalysis.results?.alpha_peak?.ec) {
      payload.ec_alpha_peak = ecAnalysis.results.alpha_peak.ec;
    }

    // Add LZC data if available
    if (eoAnalysis.results?.lzc?.eo) {
      payload.eo_lzc = eoAnalysis.results.lzc.eo;
    }
    if (ecAnalysis.results?.lzc?.ec) {
      payload.ec_lzc = ecAnalysis.results.lzc.ec;
    }

    // Add client metadata if available
    if (project?.client_metadata) {
      payload.client_metadata = {
        age: project.client_metadata.age,
        gender: project.client_metadata.gender,
        primary_issue: project.client_metadata.primary_issue,
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
        alpha_reactivity: rawContent.amplitude_patterns || '',
        arousal_shift: rawContent.frequency_ratios || '',
        theta_beta_dynamics: rawContent.asymmetry_analysis || '',
        complexity_shift: rawContent.complexity_connectivity || '',
        alpha_topography: rawContent.peak_alpha_frequency || '',
        individual_alpha_frequency: '',
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
    const existingInterpretations = project?.comparison_interpretations || {};
    const updatedInterpretations = {
      ...existingInterpretations,
      [cacheKey]: interpretation,
    };

    await (supabase as any)
      .from('projects')
      .update({ comparison_interpretations: updatedInterpretations })
      .eq('id', params.id);

    return NextResponse.json({ interpretation });
  } catch (error: any) {
    console.error('Error generating comparison AI interpretation:', error);
    return NextResponse.json(
      { error: 'Failed to generate AI interpretation' },
      { status: 500 }
    );
  }
}
