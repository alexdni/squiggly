import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

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

    const { data: analysis, error } = await supabase
      .from('analyses')
      .select(
        `
        *,
        recording:recordings (
          id,
          filename,
          project_id,
          file_path
        )
      `
      )
      .eq('id', params.id)
      .single();

    if (error) {
      return NextResponse.json(
        { error: 'Analysis not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ analysis });
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
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

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

    // Use type assertion on the supabase client to bypass strict typing
    const { data: analysis, error } = await (supabase as any)
      .from('analyses')
      .update(updateData)
      .eq('id', params.id)
      .select()
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
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // This endpoint would trigger the analysis processing
    // For now, it just updates the status to 'processing'
    // In the future, this would enqueue a job to a worker queue

    const { data: analysis, error: fetchError } = await supabase
      .from('analyses')
      .select('*, recording:recordings(*)')
      .eq('id', params.id)
      .single();

    if (fetchError || !analysis) {
      return NextResponse.json(
        { error: 'Analysis not found' },
        { status: 404 }
      );
    }

    // Update status to processing
    const { error: updateError } = await (supabase as any)
      .from('analyses')
      .update({
        status: 'processing',
        started_at: new Date().toISOString(),
      })
      .eq('id', params.id);

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to start analysis' },
        { status: 500 }
      );
    }

    // TODO: Enqueue analysis job to worker queue
    // For now, return success
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
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const analysisId = params.id;

    // Fetch analysis to check permissions
    const { data: analysis, error: fetchError } = await supabase
      .from('analyses')
      .select('*, recording:recordings(project_id)')
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

    // Delete analysis from database
    const { error: deleteError } = await supabase
      .from('analyses')
      .delete()
      .eq('id', analysisId);

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
