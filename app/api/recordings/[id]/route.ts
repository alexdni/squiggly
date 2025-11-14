import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { checkProjectPermission } from '@/lib/rbac';

// DELETE /api/recordings/[id] - Delete a recording
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

    const recordingId = params.id;

    // Fetch recording to get project_id and file_path
    const { data: recording, error: fetchError } = await supabase
      .from('recordings')
      .select('*, project_id, file_path')
      .eq('id', recordingId)
      .single();

    if (fetchError || !recording) {
      return NextResponse.json(
        { error: 'Recording not found' },
        { status: 404 }
      );
    }

    // Check permission
    const hasPermission = await checkProjectPermission(
      recording.project_id,
      user.id,
      'recording:delete'
    );

    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Delete associated analyses first (cascade should handle this, but being explicit)
    const { data: analyses } = await supabase
      .from('analyses')
      .select('id')
      .eq('recording_id', recordingId);

    if (analyses && analyses.length > 0) {
      // Delete visual assets from storage for each analysis
      for (const analysis of analyses) {
        try {
          const { data: files } = await supabase
            .storage
            .from('visuals')
            .list(analysis.id);

          if (files && files.length > 0) {
            const filePaths = files.map(f => `${analysis.id}/${f.name}`);
            await supabase.storage.from('visuals').remove(filePaths);
          }
        } catch (storageError) {
          console.error(`Error deleting visuals for analysis ${analysis.id}:`, storageError);
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
    if (recording.file_path) {
      try {
        const { error: storageError } = await supabase
          .storage
          .from('recordings')
          .remove([recording.file_path]);

        if (storageError) {
          console.error('Error deleting file from storage:', storageError);
          // Continue anyway - we still want to delete the DB record
        }
      } catch (storageError) {
        console.error('Error deleting file from storage:', storageError);
      }
    }

    // Delete recording from database
    const { error: deleteError } = await supabase
      .from('recordings')
      .delete()
      .eq('id', recordingId);

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
