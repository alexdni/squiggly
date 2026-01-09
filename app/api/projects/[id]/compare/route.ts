import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { checkProjectPermission } from '@/lib/rbac';
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
    const hasAccess = await checkProjectPermission(
      params.id,
      user.id,
      'project:read'
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

    // Extract visual URLs from both analyses for side-by-side display
    const eoVisuals = (eoAnalysis.results as any)?.visuals || {};
    const ecVisuals = (ecAnalysis.results as any)?.visuals || {};

    return NextResponse.json({
      success: true,
      comparison,
      visuals: {
        eo: eoVisuals,
        ec: ecVisuals,
      },
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

  // Get band_power from the actual Python worker structure
  const eoBandPower = (eoResults as any).band_power?.eo || {};
  const ecBandPower = (ecResults as any).band_power?.ec || {};

  // For each channel, compute power changes
  const channels = Object.keys(eoBandPower);

  channels.forEach((channel) => {
    powerDeltas.absolute[channel] = {};
    powerDeltas.percent[channel] = {};

    bands.forEach((band) => {
      const eoPower = eoBandPower[channel]?.[band]?.absolute || 0;
      const ecPower = ecBandPower[channel]?.[band]?.absolute || 0;

      const delta = ecPower - eoPower;
      const percentChange = eoPower !== 0 ? (delta / eoPower) * 100 : 0;

      powerDeltas.absolute[channel][band] = delta;
      powerDeltas.percent[channel][band] = percentChange;
    });
  });

  // Compute coherence deltas
  const coherenceDeltas: Record<string, Record<string, number>> = {};

  const eoCoherence = (eoResults as any).coherence?.eo || [];
  const ecCoherence = (ecResults as any).coherence?.ec || [];

  // Build a map for easy lookup
  const coherenceMap: Record<string, any> = {};
  eoCoherence.forEach((item: any) => {
    const key = `${item.ch1}-${item.ch2}`;
    coherenceMap[key] = { eo: item };
  });
  ecCoherence.forEach((item: any) => {
    const key = `${item.ch1}-${item.ch2}`;
    if (coherenceMap[key]) {
      coherenceMap[key].ec = item;
    } else {
      coherenceMap[key] = { ec: item };
    }
  });

  Object.keys(coherenceMap).forEach((pairKey) => {
    coherenceDeltas[pairKey] = {};
    const eo = coherenceMap[pairKey].eo || {};
    const ec = coherenceMap[pairKey].ec || {};

    bands.forEach((band) => {
      const eoCoh = eo[band] || 0;
      const ecCoh = ec[band] || 0;
      coherenceDeltas[pairKey][band] = ecCoh - eoCoh;
    });
  });

  // Compute asymmetry deltas
  const asymmetryDeltas: ComparisonResult['asymmetry_deltas'] = {
    pai: {},
    faa: 0,
    alpha_gradient: 0,
  };

  // Get asymmetry from Python structure
  const eoAsymmetry = (eoResults as any).asymmetry || {};
  const ecAsymmetry = (ecResults as any).asymmetry || {};

  // Simple FAA and alpha gradient (these are single values in Python output)
  const eoFaa = eoAsymmetry.frontal_alpha || 0;
  const ecFaa = ecAsymmetry.frontal_alpha || 0;
  asymmetryDeltas.faa = ecFaa - eoFaa;

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

  // For alpha blocking and theta/beta, we need to compute from band power
  // Alpha blocking is typically measured in occipital regions (O1, O2)
  const alphaBlockingEo = 0;  // Would need to calculate from occipital alpha power EO
  const alphaBlockingEc = 0;  // Would need to calculate from occipital alpha power EC

  // Theta/Beta ratio from band_ratios in Python output
  const eoRatios = (eoResults as any).band_ratios || {};
  const ecRatios = (ecResults as any).band_ratios || {};

  const thetaBetaEo = eoRatios.theta_beta_ratio?.frontal_avg || 0;
  const thetaBetaEc = ecRatios.theta_beta_ratio?.frontal_avg || 0;
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
