import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDatabaseClient } from '@/lib/db';
import { getStorageClient } from '@/lib/storage';
import { checkProjectPermission } from '@/lib/rbac';

/** Project that owns an analysis (via its recording), or null. */
async function projectIdForRecording(
  db: ReturnType<typeof getDatabaseClient>,
  recordingId: string
): Promise<string | null> {
  const { data } = await db.from('recordings').select('project_id').eq('id', recordingId).single();
  return (data as { project_id?: string } | null)?.project_id ?? null;
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = getDatabaseClient();

    // First fetch the analysis
    const { data: analysis, error } = await db
      .from('analyses')
      .select('*')
      .eq('id', params.id)
      .single();

    if (error || !analysis) {
      return NextResponse.json(
        { error: 'Analysis not found' },
        { status: 404 }
      );
    }

    const analysisData = analysis as any;

    // Then fetch the recording (include all fields needed by the UI)
    const { data: recording } = await db
      .from('recordings')
      .select('*')
      .eq('id', analysisData.recording_id)
      .single();

    const projectId = (recording as { project_id?: string } | null)?.project_id;
    if (!projectId || !(await checkProjectPermission(projectId, user.id, 'analysis:read'))) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    // Combine the data
    const result = {
      ...analysisData,
      recording: recording || null,
    };

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Error fetching analysis:', error);
    return NextResponse.json(
      { error: 'Failed to fetch analysis' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/analyses/[id] - update settings or reset an analysis for a re-run.
 *
 * Accepts `config` and `status: 'pending'` (which clears error_log/started_at/completed_at).
 * Status transitions to processing/completed/failed and `results` are written only by the
 * server-side analysis job, never by clients.
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { status, config } = body as { status?: unknown; config?: unknown };
    if (status !== undefined && status !== 'pending') {
      return NextResponse.json(
        { error: "Only status 'pending' (reset for a re-run) can be set by clients" },
        { status: 400 }
      );
    }
    if (config !== undefined && (typeof config !== 'object' || config === null || Array.isArray(config))) {
      return NextResponse.json({ error: 'config must be an object' }, { status: 400 });
    }

    const db = getDatabaseClient();
    const { data: existing, error: fetchError } = await db
      .from('analyses')
      .select('id, recording_id, status, started_at')
      .eq('id', params.id)
      .single();
    const current = existing as
      | { id: string; recording_id: string; status: string; started_at: string | null }
      | null;
    if (fetchError || !current) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }
    const projectId = await projectIdForRecording(db, current.recording_id);
    if (!projectId || !(await checkProjectPermission(projectId, user.id, 'analysis:create'))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // A run in progress owns the row until it finishes or goes stale (instance recycled).
    const STALE_MS = 10 * 60 * 1000;
    const startedAt = current.started_at ? Date.parse(current.started_at) : 0;
    if (current.status === 'processing' && Date.now() - startedAt < STALE_MS) {
      return NextResponse.json({ error: 'Analysis is running' }, { status: 409 });
    }

    const updateData: Record<string, unknown> = {};
    if (config !== undefined) updateData.config = config;
    if (status === 'pending') {
      updateData.status = 'pending';
      updateData.error_log = null;
      updateData.started_at = null;
      updateData.completed_at = null;
    }
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const { data: analysis, error } = await db
      .from('analyses')
      .update(updateData)
      .eq('id', params.id)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json(
        { error: 'Failed to update analysis' },
        { status: 500 }
      );
    }

    return NextResponse.json({ analysis });
  } catch (error: any) {
    console.error('Error updating analysis:', error);
    return NextResponse.json(
      { error: 'Failed to update analysis' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const analysisId = params.id;
    const db = getDatabaseClient();
    const storage = getStorageClient();

    // Fetch analysis to check it exists
    const { data: analysis, error: fetchError } = await db
      .from('analyses')
      .select('*')
      .eq('id', analysisId)
      .single();

    if (fetchError || !analysis) {
      return NextResponse.json(
        { error: 'Analysis not found' },
        { status: 404 }
      );
    }

    const projectId = await projectIdForRecording(db, (analysis as any).recording_id);
    if (!projectId || !(await checkProjectPermission(projectId, user.id, 'recording:delete'))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Delete visual assets from storage
    try {
      const files = await storage.list('visuals', analysisId);

      if (files && files.length > 0) {
        const filePaths = files.map(f => `${analysisId}/${f.name}`);
        await storage.remove('visuals', filePaths);
      }
    } catch (storageError) {
      console.error(`Error deleting visuals for analysis ${analysisId}:`, storageError);
      // Continue anyway
    }

    // Delete analysis from database
    const { error: deleteError } = await db
      .from('analyses')
      .delete()
      .eq('id', analysisId)
      .execute();

    if (deleteError) {
      console.error('Error deleting analysis:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete analysis' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in DELETE /api/analyses/[id]:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
