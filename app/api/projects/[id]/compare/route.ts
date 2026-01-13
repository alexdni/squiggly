import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { checkProjectPermission } from '@/lib/rbac';
import type { ComparisonResult, Analysis } from '@/types/database';

/**
 * Compare any two recordings within a project
 * GET /api/projects/:id/compare?a_id=<recording_id>&b_id=<recording_id>
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
    const recordingAId = searchParams.get('a_id');
    const recordingBId = searchParams.get('b_id');

    if (!recordingAId || !recordingBId) {
      return NextResponse.json(
        { error: 'Both a_id and b_id query parameters are required' },
        { status: 400 }
      );
    }

    if (recordingAId === recordingBId) {
      return NextResponse.json(
        { error: 'Cannot compare a recording with itself' },
        { status: 400 }
      );
    }

    // Fetch analyses for both recordings
    const { data: analysisA, error: errorA } = await (supabase as any)
      .from('analyses')
      .select(`
        *,
        recording:recordings!inner (
          id,
          project_id,
          condition_type
        )
      `)
      .eq('recording_id', recordingAId)
      .eq('recording.project_id', params.id)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (errorA || !analysisA) {
      return NextResponse.json(
        { error: 'Recording A analysis not found or not completed' },
        { status: 404 }
      );
    }

    const { data: analysisB, error: errorB } = await (supabase as any)
      .from('analyses')
      .select(`
        *,
        recording:recordings!inner (
          id,
          project_id,
          condition_type
        )
      `)
      .eq('recording_id', recordingBId)
      .eq('recording.project_id', params.id)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (errorB || !analysisB) {
      return NextResponse.json(
        { error: 'Recording B analysis not found or not completed' },
        { status: 404 }
      );
    }

    // Compute comparison (B - A)
    const comparison = computeComparison(analysisA, analysisB);

    // Extract visual URLs from both analyses for side-by-side display
    const visualsA = (analysisA.results as any)?.visuals || {};
    const visualsB = (analysisB.results as any)?.visuals || {};

    return NextResponse.json({
      success: true,
      comparison,
      visuals: {
        a: visualsA,
        b: visualsB,
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
 * Compute comparison metrics between two analyses (B - A)
 */
function computeComparison(
  analysisA: Analysis,
  analysisB: Analysis
): ComparisonResult {
  const resultsA = analysisA.results;
  const resultsB = analysisB.results;

  if (!resultsA || !resultsB) {
    throw new Error('Both analyses must have results');
  }

  // Compute power deltas
  const powerDeltas: ComparisonResult['power_deltas'] = {
    absolute: {},
    percent: {},
  };

  const bands = ['delta', 'theta', 'alpha1', 'alpha2', 'smr', 'beta2', 'hibeta', 'lowgamma'];

  // Get band_power from the actual Python worker structure
  // Try to use the primary condition data (eo or ec) from each analysis
  const bandPowerA = (resultsA as any).band_power?.eo || (resultsA as any).band_power?.ec || {};
  const bandPowerB = (resultsB as any).band_power?.eo || (resultsB as any).band_power?.ec || {};

  // For each channel, compute power changes (B - A)
  const channelsA = Object.keys(bandPowerA);
  const channelsB = Object.keys(bandPowerB);
  const channels = [...new Set([...channelsA, ...channelsB])];

  channels.forEach((channel) => {
    powerDeltas.absolute[channel] = {};
    powerDeltas.percent[channel] = {};

    bands.forEach((band) => {
      const powerA = bandPowerA[channel]?.[band]?.absolute || 0;
      const powerB = bandPowerB[channel]?.[band]?.absolute || 0;

      const delta = powerB - powerA;
      const percentChange = powerA !== 0 ? (delta / powerA) * 100 : 0;

      powerDeltas.absolute[channel][band] = delta;
      powerDeltas.percent[channel][band] = percentChange;
    });
  });

  // Compute coherence deltas
  const coherenceDeltas: Record<string, Record<string, number>> = {};

  const coherenceA = (resultsA as any).coherence?.eo || (resultsA as any).coherence?.ec || [];
  const coherenceB = (resultsB as any).coherence?.eo || (resultsB as any).coherence?.ec || [];

  // Build a map for easy lookup
  const coherenceMap: Record<string, any> = {};
  coherenceA.forEach((item: any) => {
    const key = `${item.ch1}-${item.ch2}`;
    coherenceMap[key] = { a: item };
  });
  coherenceB.forEach((item: any) => {
    const key = `${item.ch1}-${item.ch2}`;
    if (coherenceMap[key]) {
      coherenceMap[key].b = item;
    } else {
      coherenceMap[key] = { b: item };
    }
  });

  Object.keys(coherenceMap).forEach((pairKey) => {
    coherenceDeltas[pairKey] = {};
    const a = coherenceMap[pairKey].a || {};
    const b = coherenceMap[pairKey].b || {};

    bands.forEach((band) => {
      const cohA = a[band] || 0;
      const cohB = b[band] || 0;
      coherenceDeltas[pairKey][band] = cohB - cohA;
    });
  });

  // Compute asymmetry deltas
  const asymmetryDeltas: ComparisonResult['asymmetry_deltas'] = {
    pai: {},
    faa: 0,
    alpha_gradient: 0,
  };

  // Get asymmetry from Python structure
  const asymmetryA = (resultsA as any).asymmetry || {};
  const asymmetryB = (resultsB as any).asymmetry || {};

  // Simple FAA and alpha gradient (these are single values in Python output)
  const faaA = asymmetryA.frontal_alpha || 0;
  const faaB = asymmetryB.frontal_alpha || 0;
  asymmetryDeltas.faa = faaB - faaA;

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

  // For alpha blocking, we could compute from occipital regions (O1, O2)
  const alphaBlockingA = 0;
  const alphaBlockingB = 0;

  // Theta/Beta ratio from band_ratios in Python output
  const ratiosA = (resultsA as any).band_ratios || {};
  const ratiosB = (resultsB as any).band_ratios || {};

  const thetaBetaA = ratiosA.theta_beta_ratio?.frontal_avg || 0;
  const thetaBetaB = ratiosB.theta_beta_ratio?.frontal_avg || 0;
  const thetaBetaChange = thetaBetaB - thetaBetaA;

  return {
    recording_a_id: analysisA.recording_id,
    recording_b_id: analysisB.recording_id,
    power_deltas: powerDeltas,
    coherence_deltas: coherenceDeltas,
    asymmetry_deltas: asymmetryDeltas,
    summary_metrics: {
      mean_alpha_change_percent: meanAlphaChangePercent,
      alpha_blocking_a: alphaBlockingA,
      alpha_blocking_b: alphaBlockingB,
      faa_shift: asymmetryDeltas.faa,
      theta_beta_change: thetaBetaChange,
    },
  };
}
