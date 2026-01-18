import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDatabaseClient } from '@/lib/db';
import { getStorageClient } from '@/lib/storage';

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

    // Then fetch the recording
    const { data: recording } = await db
      .from('recordings')
      .select('id, filename, project_id, file_path')
      .eq('id', analysisData.recording_id)
      .single();

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

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { status, results, error_log } = body;

    const updateData: Record<string, any> = {};
    if (status) updateData.status = status;
    if (results) updateData.results = results;
    if (error_log) updateData.error_log = error_log;

    if (status === 'processing') {
      updateData.started_at = new Date().toISOString();
    }
    if (status === 'completed' || status === 'failed') {
      updateData.completed_at = new Date().toISOString();
    }

    const db = getDatabaseClient();
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

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = getDatabaseClient();

    // Fetch analysis
    const { data: analysis, error: fetchError } = await db
      .from('analyses')
      .select('*')
      .eq('id', params.id)
      .single();

    if (fetchError || !analysis) {
      return NextResponse.json(
        { error: 'Analysis not found' },
        { status: 404 }
      );
    }

    // Update status to processing
    const { error: updateError } = await db
      .from('analyses')
      .update({
        status: 'processing',
        started_at: new Date().toISOString(),
      })
      .eq('id', params.id)
      .execute();

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to start analysis' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: 'Analysis processing started',
      analysis_id: params.id,
    });
  } catch (error: any) {
    console.error('Error starting analysis:', error);
    return NextResponse.json(
      { error: 'Failed to start analysis' },
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
