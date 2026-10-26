import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDatabaseClient } from '@/lib/db';
import { checkProjectPermission } from '@/lib/rbac';
import type { ComparisonResult, Analysis } from '@/types/database';
import { withRecordingCondition } from '@/lib/server/relabel';

/**
 * Compare any two recordings within a project
 * GET /api/projects/:id/compare?a_id=<recording_id>&b_id=<recording_id>
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check project access
    const hasAccess = await checkProjectPermission(
      projectId,
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

    const db = getDatabaseClient();

    // Verify recording A belongs to this project
    const { data: recordingA } = await db
      .from('recordings')
      .select('id, project_id, condition_type, filename, eo_start, eo_end, ec_start, ec_end')
      .eq('id', recordingAId)
      .eq('project_id', projectId)
      .single();

    if (!recordingA) {
      return NextResponse.json(
        { error: 'Recording A not found in this project' },
        { status: 404 }
      );
    }

    // Verify recording B belongs to this project
    const { data: recordingB } = await db
      .from('recordings')
      .select('id, project_id, condition_type, filename, eo_start, eo_end, ec_start, ec_end')
      .eq('id', recordingBId)
      .eq('project_id', projectId)
      .single();

    if (!recordingB) {
      return NextResponse.json(
        { error: 'Recording B not found in this project' },
        { status: 404 }
      );
    }

    // Fetch completed analysis for recording A
    const { data: analysesA } = await db
      .from('analyses')
      .select('*')
      .eq('recording_id', recordingAId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .execute();

    const analysisA = analysesA?.[0] as Analysis | undefined;
    if (!analysisA) {
      return NextResponse.json(
        { error: 'Recording A analysis not found or not completed' },
        { status: 404 }
      );
    }

    // Fetch completed analysis for recording B
    const { data: analysesB } = await db
      .from('analyses')
      .select('*')
      .eq('recording_id', recordingBId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .execute();

    const analysisB = analysesB?.[0] as Analysis | undefined;
    if (!analysisB) {
      return NextResponse.json(
        { error: 'Recording B analysis not found or not completed' },
        { status: 404 }
      );
    }

    // Results of unlabelled runs filed under the other condition are read under the recording's own
    const relabelledA = withRecordingCondition(analysisA, recordingA as never);
    const relabelledB = withRecordingCondition(analysisB, recordingB as never);
    (relabelledA as any).recording = recordingA;
    (relabelledB as any).recording = recordingB;

    // Compute comparison (B - A)
    const comparison = computeComparison(relabelledA, relabelledB);

    // Extract visual URLs from both analyses for side-by-side display
    const visualsA = (relabelledA.results as any)?.visuals || {};
    const visualsB = (relabelledB.results as any)?.visuals || {};

    return NextResponse.json({
      success: true,
      comparison,
      // Legacy PNG URLs (Python-era analyses); new analyses render from `results`.
      visuals: {
        a: visualsA,
        b: visualsB,
      },
      results: {
        a: relabelledA.results ?? null,
        b: relabelledB.results ?? null,
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
 * The condition each side is compared under: the same one when both have it (EO first), else
 * each side's own.
 */
function comparisonConditions(resultsA: any, resultsB: any): { a: 'eo' | 'ec' | null; b: 'eo' | 'ec' | null } {
  const has = (r: any, c: 'eo' | 'ec') => Boolean(r?.band_power?.[c] && Object.keys(r.band_power[c]).length);
  for (const c of ['eo', 'ec'] as const) if (has(resultsA, c) && has(resultsB, c)) return { a: c, b: c };
  const own = (r: any) => (has(r, 'eo') ? 'eo' : has(r, 'ec') ? 'ec' : null);
  return { a: own(resultsA), b: own(resultsB) };
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

  // Like with like: the same condition on both sides when both have it
  const conditions = comparisonConditions(resultsA, resultsB);
  const bandPowerA = (conditions.a && (resultsA as any).band_power?.[conditions.a]) || {};
  const bandPowerB = (conditions.b && (resultsB as any).band_power?.[conditions.b]) || {};

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

  // wPLI per channel pair, under the same condition as the band-power deltas above. `coherence` is
  // the pre-wPLI field some early analyses carried.
  const pairsOf = (r: any, c: 'eo' | 'ec' | null): any[] =>
    (c && (r?.connectivity?.[c]?.pair_data || r?.coherence?.[c])) || [];
  const coherenceA = pairsOf(resultsA, conditions.a);
  const coherenceB = pairsOf(resultsB, conditions.b);

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

    const pairBands = Object.keys({ ...a, ...b }).filter(
      (k) => !['ch1', 'ch2', 'type', 'region'].includes(k)
    );
    pairBands.forEach((band) => {
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
    conditions,
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
