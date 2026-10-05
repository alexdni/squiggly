import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDatabaseClient } from '@/lib/db';
import { checkProjectPermission } from '@/lib/rbac';
import { runInBackground } from '@/lib/server/background';
import { getServiceDatabaseClient } from '@/lib/server/serviceDb';
import { runAnalysisJob } from '@/lib/server/eeg/runAnalysisJob';

// The analysis itself runs after the response (see runInBackground); this budget covers it.
export const maxDuration = 300;

/**
 * Start EEG analysis.
 *
 * Validates access, marks the analysis `processing`, and runs the server-side pipeline in the
 * background. Responds 202 immediately; the client polls GET /api/analyses/[id] for the outcome.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDatabaseClient();

  const { data: analysis, error: fetchError } = await db
    .from('analyses')
    .select('*')
    .eq('id', params.id)
    .single();
  if (fetchError || !analysis) {
    return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
  }
  const analysisData = analysis as any;

  const { data: recording, error: recordingError } = await db
    .from('recordings')
    .select('id, project_id, file_path, duration_seconds, eo_start, eo_end, ec_start, ec_end')
    .eq('id', analysisData.recording_id)
    .single();
  if (recordingError || !recording) {
    return NextResponse.json({ error: 'Recording not found' }, { status: 400 });
  }
  const rec = recording as any;
  if (!rec.file_path) {
    return NextResponse.json({ error: 'Recording file path not found' }, { status: 400 });
  }

  if (!(await checkProjectPermission(rec.project_id, user.id, 'analysis:create'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // A run that has been `processing` this long died with its server instance; allow a retry.
  const STALE_MS = 10 * 60 * 1000;
  const lastStartMs = analysisData.started_at ? Date.parse(analysisData.started_at) : 0;
  if (analysisData.status === 'processing' && Date.now() - lastStartMs < STALE_MS) {
    return NextResponse.json({ error: 'Analysis is already running' }, { status: 409 });
  }

  // Segments; with no labels the whole recording is analyzed as EO (baseline).
  const segments: { eo?: { start: number; end: number }; ec?: { start: number; end: number } } = {};
  if (rec.eo_start != null && rec.eo_end != null) {
    segments.eo = { start: Number(rec.eo_start), end: Number(rec.eo_end) };
  }
  if (rec.ec_start != null && rec.ec_end != null) {
    segments.ec = { start: Number(rec.ec_start), end: Number(rec.ec_end) };
  }
  if (!segments.eo && !segments.ec) {
    segments.eo = { start: 0, end: Number(rec.duration_seconds) || Number.MAX_SAFE_INTEGER };
  }

  const preprocessing = analysisData.config?.preprocessing ?? {};
  let manualArtifacts: { start: number; end: number }[] = [];
  if (preprocessing.artifact_mode === 'manual') {
    const { data: annotations } = await db
      .from('eeg_annotations')
      .select('start_time, end_time')
      .eq('recording_id', analysisData.recording_id)
      .eq('type', 'artifact')
      .order('start_time')
      .execute();
    manualArtifacts = ((annotations as any[]) ?? []).map((a) => ({
      start: Number(a.start_time),
      end: Number(a.end_time),
    }));
  }

  // The job writes its outcome with the service role; fail now rather than leave the row stuck.
  try {
    getServiceDatabaseClient();
  } catch (err) {
    console.error('Analysis engine is not configured:', err);
    return NextResponse.json(
      { error: 'Analysis is not configured on this server (missing service credentials)' },
      { status: 500 }
    );
  }

  // Compare-and-swap on the state we read, so two concurrent starts cannot both win. The new
  // started_at doubles as the run token the job checks before writing results.
  const startedAt = new Date().toISOString();
  let claim = db
    .from('analyses')
    .update({ status: 'processing', error_log: null, started_at: startedAt, completed_at: null })
    .eq('id', params.id)
    .eq('status', analysisData.status);
  if (analysisData.started_at) claim = claim.eq('started_at', analysisData.started_at);
  const { data: claimed, error: updateError } = await claim.select('id').execute();
  if (updateError) {
    return NextResponse.json({ error: 'Could not start analysis' }, { status: 500 });
  }
  const claimedRows = Array.isArray(claimed) ? claimed : claimed ? [claimed] : [];
  if (claimedRows.length === 0) {
    return NextResponse.json({ error: 'Analysis is already running' }, { status: 409 });
  }

  runInBackground(() =>
    runAnalysisJob({
      analysisId: params.id,
      startedAt,
      filePath: rec.file_path,
      segments,
      preprocessing,
      manualArtifacts,
    })
  );

  return NextResponse.json(
    { success: true, status: 'processing', analysis_id: params.id },
    { status: 202 }
  );
}
