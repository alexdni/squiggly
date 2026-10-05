import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDatabaseClient } from '@/lib/db';
import { checkProjectPermission } from '@/lib/rbac';
import { runInBackground } from '@/lib/server/background';
import { getServiceDatabaseClient } from '@/lib/server/serviceDb';
import { runTheraqJob } from '@/lib/server/eeg/runTheraqJob';
import { DEFAULT_ANALYSIS_CONFIG } from '@/lib/constants';
import { THERAQ_PHASES, type TheraqPhase } from '@/lib/theraq';

interface RecordingRow {
  id: string;
  filename: string;
  file_path: string;
  duration_seconds: number | null;
  phase: string | null;
  montage: string | null;
}

// The four-phase analysis runs after the response (see runInBackground); this budget covers it.
export const maxDuration = 300;

// GET /api/projects/[id]/theraq-analysis - list TheraQ analyses for a project
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hasPermission = await checkProjectPermission(params.id, user.id, 'analysis:read');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const db = getDatabaseClient();
    const { data: analyses } = await db
      .from('project_analyses')
      .select('*')
      .eq('project_id', params.id)
      .eq('kind', 'theraq')
      .order('created_at', { ascending: false })
      .execute();

    return NextResponse.json({ analyses: analyses || [] });
  } catch (error) {
    console.error('Error listing TheraQ analyses:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/projects/[id]/theraq-analysis - create and start a TheraQ four-phase analysis
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hasPermission = await checkProjectPermission(params.id, user.id, 'analysis:create');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const db = getDatabaseClient();

    // Gather the project's recordings and group them by phase
    const { data: recordings } = await db
      .from('recordings')
      .select('id, filename, file_path, duration_seconds, phase, montage')
      .eq('project_id', params.id)
      .execute();

    const rows = (recordings as RecordingRow[] | null) || [];

    // Eligibility gate: exactly one recording per phase role
    const byPhase = new Map<TheraqPhase, RecordingRow[]>();
    for (const phase of THERAQ_PHASES) byPhase.set(phase, []);
    for (const rec of rows) {
      if (rec.phase && (THERAQ_PHASES as readonly string[]).includes(rec.phase)) {
        byPhase.get(rec.phase as TheraqPhase)!.push(rec);
      }
    }

    const missing: TheraqPhase[] = [];
    const duplicated: TheraqPhase[] = [];
    for (const phase of THERAQ_PHASES) {
      const list = byPhase.get(phase)!;
      if (list.length === 0) missing.push(phase);
      else if (list.length > 1) duplicated.push(phase);
    }

    if (missing.length > 0 || duplicated.length > 0) {
      return NextResponse.json(
        {
          error: 'Project is not eligible for a TheraQ analysis',
          missingPhases: missing,
          duplicatedPhases: duplicated,
          message:
            missing.length > 0
              ? `Assign a recording to each phase. Missing: ${missing.join(', ')}.`
              : `Each phase must map to exactly one recording. Duplicated: ${duplicated.join(', ')}.`,
        },
        { status: 422 }
      );
    }

    // Build phase_map and worker inputs; require a usable file_path + duration per phase
    const phaseMap: Partial<Record<TheraqPhase, string>> = {};
    const phaseFiles: Partial<Record<TheraqPhase, string>> = {};
    const invalid: string[] = [];

    for (const phase of THERAQ_PHASES) {
      const rec = byPhase.get(phase)![0];
      if (!rec.file_path || !rec.duration_seconds || rec.duration_seconds <= 0) {
        invalid.push(`${phase} (${rec.filename})`);
        continue;
      }
      phaseMap[phase] = rec.id;
      phaseFiles[phase] = rec.file_path;
    }

    if (invalid.length > 0) {
      return NextResponse.json(
        {
          error: 'One or more phase recordings are missing a file or duration',
          invalidPhases: invalid,
        },
        { status: 422 }
      );
    }

    // Create the analysis row
    // Writes use the service role (RLS lets members read project_analyses but not write it);
    // the caller's analysis:create permission was checked above.
    const serviceDb = getServiceDatabaseClient();
    const { data: created, error: insertError } = await serviceDb
      .from('project_analyses')
      .insert({
        project_id: params.id,
        kind: 'theraq',
        status: 'pending',
        phase_map: phaseMap,
        config: DEFAULT_ANALYSIS_CONFIG,
      })
      .select('*')
      .single();

    if (insertError || !created) {
      console.error('Error creating TheraQ analysis:', insertError);
      return NextResponse.json(
        { error: 'Failed to create TheraQ analysis' },
        { status: 500 }
      );
    }

    const analysisId = (created as any).id as string;

    // Mark processing; the analysis itself runs in the background
    await serviceDb
      .from('project_analyses')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', analysisId)
      .execute();

    runInBackground(() =>
      runTheraqJob({
        projectAnalysisId: analysisId,
        phaseFiles,
        preprocessing: DEFAULT_ANALYSIS_CONFIG.preprocessing,
      })
    );

    return NextResponse.json(
      { success: true, analysis: { ...(created as any), status: 'processing' }, analysisId },
      { status: 202 }
    );
  } catch (error) {
    console.error('Error creating TheraQ analysis:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
