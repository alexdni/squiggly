import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDatabaseClient } from '@/lib/db';
import { getStorageClient } from '@/lib/storage';
import { checkProjectPermission } from '@/lib/rbac';
import { THERAQ_PHASES } from '@/lib/theraq';
import { getServiceDatabaseClient } from '@/lib/server/serviceDb';
import { labelColumns, labelsProblem, type Segment } from '@/lib/eeg-condition';

interface RecordingData {
  id: string;
  project_id: string;
  file_path: string | null;
}

interface AnalysisData {
  id: string;
}

/** `{ start, end }` in seconds, or null. */
function parseSegment(v: unknown): Segment | null | undefined {
  if (v === null) return null;
  if (!v || typeof v !== 'object') return undefined;
  const { start, end } = v as { start?: unknown; end?: unknown };
  if (typeof start !== 'number' || typeof end !== 'number') return undefined;
  return { start, end };
}

// PATCH /api/recordings/[id] - Update editable recording fields: the TheraQ phase role and the
// EO/EC labels ({ labels: { eo: { start, end } | null, ec: { start, end } | null } }). New labels
// leave the existing analysis stale; the caller re-runs it.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || (!('phase' in body) && !('labels' in body))) {
      return NextResponse.json({ error: 'Request body must include "phase" or "labels"' }, { status: 400 });
    }
    const updates: Record<string, unknown> = {};
    if ('phase' in body) {
      const phase = (body as { phase: unknown }).phase;
      if (phase !== null && !(THERAQ_PHASES as readonly unknown[]).includes(phase)) {
        return NextResponse.json(
          { error: `phase must be one of ${THERAQ_PHASES.join(', ')} or null` },
          { status: 400 }
        );
      }
      updates.phase = phase;
    }

    const db = getDatabaseClient();
    const { data: recording, error: fetchError } = await db
      .from('recordings')
      .select('id, project_id, duration_seconds')
      .eq('id', params.id)
      .single();
    const typed = recording as { id: string; project_id: string; duration_seconds: number | null } | null;
    if (fetchError || !typed) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }
    if (!(await checkProjectPermission(typed.project_id, user.id, 'recording:create'))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if ('labels' in body) {
      const raw = (body as { labels: unknown }).labels;
      const eo = raw && typeof raw === 'object' ? parseSegment((raw as { eo?: unknown }).eo ?? null) : undefined;
      const ec = raw && typeof raw === 'object' ? parseSegment((raw as { ec?: unknown }).ec ?? null) : undefined;
      if (eo === undefined || ec === undefined) {
        return NextResponse.json(
          { error: 'labels must be { eo: { start, end } | null, ec: { start, end } | null } in seconds' },
          { status: 400 }
        );
      }
      const labels = { eo, ec };
      const duration = typed.duration_seconds !== null ? Number(typed.duration_seconds) : null;
      const problem = labelsProblem(labels, duration);
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
      Object.assign(updates, labelColumns(labels));
    }

    // recordings has no UPDATE policy for end users; write with the service role now that the
    // caller's recording:create permission on this project has been checked.
    const { data: updated, error } = await getServiceDatabaseClient()
      .from('recordings')
      .update(updates)
      .eq('id', params.id)
      .select('*')
      .single();
    if (error) {
      console.error('Error updating recording:', error);
      return NextResponse.json({ error: 'Failed to update recording' }, { status: 500 });
    }
    return NextResponse.json({ recording: updated });
  } catch (error) {
    console.error('Error updating recording:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/recordings/[id] - Delete a recording
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const recordingId = params.id;
    const db = getDatabaseClient();
    const storage = getStorageClient();

    // Fetch recording to get project_id and file_path
    const { data: recording, error: fetchError } = await db
      .from('recordings')
      .select('id, project_id, file_path')
      .eq('id', recordingId)
      .single();

    const typedRecording = recording as RecordingData | null;

    if (fetchError || !typedRecording) {
      return NextResponse.json(
        { error: 'Recording not found' },
        { status: 404 }
      );
    }

    // Check permission
    const hasPermission = await checkProjectPermission(
      typedRecording.project_id,
      user.id,
      'recording:delete'
    );

    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Delete associated analyses first
    const { data: analyses } = await db
      .from('analyses')
      .select('id')
      .eq('recording_id', recordingId)
      .execute();

    const typedAnalyses = analyses as AnalysisData[] | null;

    if (typedAnalyses && typedAnalyses.length > 0) {
      // Delete visual assets from storage for each analysis
      for (const analysis of typedAnalyses) {
        const analysisId = analysis.id;
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
      }

      // Delete analyses
      for (const analysis of typedAnalyses) {
        await db.from('analyses').delete().eq('id', analysis.id).execute();
      }
    }

    // Delete EDF file from storage
    if (typedRecording.file_path) {
      try {
        const { error: storageError } = await storage.remove(
          'recordings',
          [typedRecording.file_path]
        );

        if (storageError) {
          console.error('Error deleting file from storage:', storageError);
          // Continue anyway - we still want to delete the DB record
        }
      } catch (storageError) {
        console.error('Error deleting file from storage:', storageError);
      }
    }

    // Delete recording from database
    const { error: deleteError } = await db
      .from('recordings')
      .delete()
      .eq('id', recordingId)
      .execute();

    if (deleteError) {
      console.error('Error deleting recording:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete recording' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE /api/recordings/[id]:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
