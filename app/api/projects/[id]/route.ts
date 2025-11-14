import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { checkProjectPermission } from '@/lib/rbac';

// DELETE /api/projects/[id] - Delete a project and all its data
export async function DELETE(
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

    const projectId = params.id;

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
    const { data: recordings } = await supabase
      .from('recordings')
      .select('id, file_path')
      .eq('project_id', projectId);

    if (recordings && recordings.length > 0) {
      // Delete all analyses and their visual assets
      for (const recording of recordings) {
        const recordingId = recording.id as string;
        const { data: analyses } = await supabase
          .from('analyses')
          .select('id')
          .eq('recording_id', recordingId);

        if (analyses && analyses.length > 0) {
          // Delete visual assets from storage for each analysis
          for (const analysis of analyses) {
            const analysisId = analysis.id as string;
            try {
              const { data: files } = await supabase
                .storage
                .from('visuals')
                .list(analysisId);

              if (files && files.length > 0) {
                const filePaths = files.map(f => `${analysisId}/${f.name}`);
                await supabase.storage.from('visuals').remove(filePaths);
              }
            } catch (storageError) {
              console.error(`Error deleting visuals for analysis ${analysisId}:`, storageError);
              // Continue anyway
            }
          }

          // Delete analyses
          await supabase
            .from('analyses')
            .delete()
            .eq('recording_id', recordingId);
        }

        // Delete EDF file from storage
        const filePath = recording.file_path as string | null;
        if (filePath) {
          try {
            await supabase
              .storage
              .from('recordings')
              .remove([filePath]);
          } catch (storageError) {
            console.error(`Error deleting file ${filePath}:`, storageError);
            // Continue anyway
          }
        }
      }

      // Delete all recordings
      await supabase
        .from('recordings')
        .delete()
        .eq('project_id', projectId);
    }

    // Delete project members
    await supabase
      .from('project_members')
      .delete()
      .eq('project_id', projectId);

    // Delete project
    const { error: deleteError } = await supabase
      .from('projects')
      .delete()
      .eq('id', projectId);

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
