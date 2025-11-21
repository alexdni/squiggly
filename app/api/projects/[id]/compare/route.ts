import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { checkProjectAccess } from '@/lib/rbac';
import type { ComparisonResult, Analysis } from '@/types/database';

/**
 * Compare EO and EC recordings within a project
 * GET /api/projects/:id/compare?eo_id=<recording_id>&ec_id=<recording_id>
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check project access
    const hasAccess = await checkProjectAccess(
      supabase,
      params.id,
      user.id,
      ['owner', 'collaborator', 'viewer']
    );

    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Forbidden: You do not have access to this project' },
        { status: 403 }
      );
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

    // Fetch analyses for both recordings
    const { data: eoAnalysis, error: eoError } = await (supabase as any)
      .from('analyses')
      .select(`
        *,
        recording:recordings!inner (
          id,
          project_id,
          condition_type
        )
      `)
      .eq('recording_id', eoRecordingId)
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

    const { data: ecAnalysis, error: ecError } = await (supabase as any)
      .from('analyses')
      .select(`
        *,
        recording:recordings!inner (
          id,
          project_id,
          condition_type
        )
      `)
      .eq('recording_id', ecRecordingId)
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

    // Compute comparison
    const comparison = computeComparison(eoAnalysis, ecAnalysis);

    return NextResponse.json({
      success: true,
      comparison,
    });
  } catch (error: any) {
    console.error('Error in GET /api/projects/:id/compare:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Compute comparison metrics between EO and EC analyses
 */
function computeComparison(
  eoAnalysis: Analysis,
  ecAnalysis: Analysis
): ComparisonResult {
  const eoResults = eoAnalysis.results;
  const ecResults = ecAnalysis.results;

  if (!eoResults || !ecResults) {
    throw new Error('Both analyses must have results');
  }

  // Compute power deltas
  const powerDeltas: ComparisonResult['power_deltas'] = {
    absolute: {},
    percent: {},
  };

  const bands = ['delta', 'theta', 'alpha1', 'alpha2', 'smr', 'beta2', 'hibeta', 'lowgamma'];

  // For each channel, compute power changes
  const channels = Object.keys(eoResults.features?.power?.absolute || {});

  channels.forEach((channel) => {
    powerDeltas.absolute[channel] = {};
    powerDeltas.percent[channel] = {};

    bands.forEach((band) => {
      const eoPower = eoResults.features?.power?.absolute?.[channel]?.[band] || 0;
      const ecPower = ecResults.features?.power?.absolute?.[channel]?.[band] || 0;

      const delta = ecPower - eoPower;
      const percentChange = eoPower !== 0 ? (delta / eoPower) * 100 : 0;

      powerDeltas.absolute[channel][band] = delta;
      powerDeltas.percent[channel][band] = percentChange;
    });
  });

  // Compute coherence deltas
  const coherenceDeltas: Record<string, Record<string, number>> = {};

  const coherencePairs = Object.keys(eoResults.features?.coherence?.magnitude_squared || {});

  coherencePairs.forEach((pairKey) => {
    coherenceDeltas[pairKey] = {};

    bands.forEach((band) => {
      const eoCoh = eoResults.features?.coherence?.magnitude_squared?.[pairKey]?.eo?.[band] || 0;
      const ecCoh = ecResults.features?.coherence?.magnitude_squared?.[pairKey]?.ec?.[band] || 0;

      coherenceDeltas[pairKey][band] = ecCoh - eoCoh;
    });
  });

  // Compute asymmetry deltas
  const asymmetryDeltas: ComparisonResult['asymmetry_deltas'] = {
    pai: {},
    faa: 0,
    alpha_gradient: 0,
  };

  // PAI deltas
  const paiPairs = Object.keys(eoResults.features?.asymmetry?.pai?.eo || {});
  paiPairs.forEach((pair) => {
    asymmetryDeltas.pai[pair] = {};

    bands.forEach((band) => {
      const eoPai = eoResults.features?.asymmetry?.pai?.eo?.[pair]?.[band] || 0;
      const ecPai = ecResults.features?.asymmetry?.pai?.ec?.[pair]?.[band] || 0;

      asymmetryDeltas.pai[pair][band] = ecPai - eoPai;
    });
  });

  // FAA shift
  const eoFaa = eoResults.features?.asymmetry?.faa?.eo || 0;
  const ecFaa = ecResults.features?.asymmetry?.faa?.ec || 0;
  asymmetryDeltas.faa = ecFaa - eoFaa;

  // Alpha gradient shift
  const eoGradient = eoResults.features?.asymmetry?.alpha_gradient?.eo || 0;
  const ecGradient = ecResults.features?.asymmetry?.alpha_gradient?.ec || 0;
  asymmetryDeltas.alpha_gradient = ecGradient - eoGradient;

  // Compute summary metrics
  let totalAlphaChange = 0;
  let alphaChannelCount = 0;

  channels.forEach((channel) => {
    const alpha1Change = powerDeltas.percent[channel]?.alpha1 || 0;
    const alpha2Change = powerDeltas.percent[channel]?.alpha2 || 0;

    if (alpha1Change !== 0 || alpha2Change !== 0) {
      totalAlphaChange += (alpha1Change + alpha2Change) / 2;
      alphaChannelCount++;
    }
  });

  const meanAlphaChangePercent = alphaChannelCount > 0
    ? totalAlphaChange / alphaChannelCount
    : 0;

  const alphaBlockingEo = eoResults.features?.power?.alpha_blocking
    ? Object.values(eoResults.features.power.alpha_blocking).reduce((a, b) => a + b, 0) /
      Object.values(eoResults.features.power.alpha_blocking).length
    : 0;

  const alphaBlockingEc = ecResults.features?.power?.alpha_blocking
    ? Object.values(ecResults.features.power.alpha_blocking).reduce((a, b) => a + b, 0) /
      Object.values(ecResults.features.power.alpha_blocking).length
    : 0;

  const thetaBetaEo = eoResults.features?.power?.ratios?.theta_beta?.Fz || 0;
  const thetaBetaEc = ecResults.features?.power?.ratios?.theta_beta?.Fz || 0;
  const thetaBetaChange = thetaBetaEc - thetaBetaEo;

  return {
    eo_recording_id: eoAnalysis.recording_id,
    ec_recording_id: ecAnalysis.recording_id,
    power_deltas: powerDeltas,
    coherence_deltas: coherenceDeltas,
    asymmetry_deltas: asymmetryDeltas,
    summary_metrics: {
      mean_alpha_change_percent: meanAlphaChangePercent,
      alpha_blocking_eo: alphaBlockingEo,
      alpha_blocking_ec: alphaBlockingEc,
      faa_shift: asymmetryDeltas.faa,
      theta_beta_change: thetaBetaChange,
    },
  };
}
