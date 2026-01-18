import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDatabaseClient } from '@/lib/db';
import { getStorageClient } from '@/lib/storage';
import { checkProjectPermission } from '@/lib/rbac';

interface RecordingData {
  id: string;
  file_path: string | null;
}

interface AnalysisData {
  id: string;
}

// DELETE /api/projects/[id] - Delete a project and all its data
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const projectId = params.id;
    const db = getDatabaseClient();
    const storage = getStorageClient();

    // Check if user is owner (only owners can delete projects)
    const hasPermission = await checkProjectPermission(
      projectId,
      user.id,
      'project:delete'
    );

    if (!hasPermission) {
      return NextResponse.json(
        { error: 'Only project owners can delete projects' },
        { status: 403 }
      );
    }

    // Fetch all recordings in this project
    const { data: recordings } = await db
      .from('recordings')
      .select('id, file_path')
      .eq('project_id', projectId)
      .execute();

    const typedRecordings = recordings as RecordingData[] | null;

    if (typedRecordings && typedRecordings.length > 0) {
      // Delete all analyses and their visual assets
      for (const recording of typedRecordings) {
        const recordingId = recording.id;
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

            // Delete analysis
            await db.from('analyses').delete().eq('id', analysisId).execute();
          }
        }

        // Delete EDF file from storage
        if (recording.file_path) {
          try {
            await storage.remove('recordings', [recording.file_path]);
          } catch (storageError) {
            console.error(`Error deleting file ${recording.file_path}:`, storageError);
            // Continue anyway
          }
        }

        // Delete recording
        await db.from('recordings').delete().eq('id', recordingId).execute();
      }
    }

    // Delete project members
    await db
      .from('project_members')
      .delete()
      .eq('project_id', projectId)
      .execute();

    // Delete project
    const { error: deleteError } = await db
      .from('projects')
      .delete()
      .eq('id', projectId)
      .execute();

    if (deleteError) {
      console.error('Error deleting project:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete project' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE /api/projects/[id]:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
