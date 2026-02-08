import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDatabaseClient } from '@/lib/db';
import { canAccessRecording } from '@/lib/rbac';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const recordingId = params.id;

    const canAccess = await canAccessRecording(recordingId, user.id);
    if (!canAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const db = getDatabaseClient();
    const { data: annotations, error } = await db
      .from('eeg_annotations')
      .select('*')
      .eq('recording_id', recordingId)
      .order('start_time')
      .execute();

    if (error) {
      console.error('Error fetching annotations:', error);
      return NextResponse.json(
        { error: 'Failed to fetch annotations' },
        { status: 500 }
      );
    }

    return NextResponse.json({ annotations: annotations || [] });
  } catch (error) {
    console.error('Error in GET /api/recordings/[id]/annotations:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
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

    const recordingId = params.id;

    const canAccess = await canAccessRecording(recordingId, user.id);
    if (!canAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { startTime, endTime, type, description } = body;

    if (startTime == null || endTime == null || !type) {
      return NextResponse.json(
        { error: 'Missing required fields: startTime, endTime, type' },
        { status: 400 }
      );
    }

    if (!['artifact', 'event', 'note'].includes(type)) {
      return NextResponse.json(
        { error: 'Invalid type. Must be artifact, event, or note' },
        { status: 400 }
      );
    }

    const db = getDatabaseClient();
    const { data: annotation, error } = await db
      .from('eeg_annotations')
      .insert({
        recording_id: recordingId,
        start_time: startTime,
        end_time: endTime,
        type,
        description: description || null,
        created_by: user.id,
      })
      .select('*')
      .single();

    if (error) {
      console.error('Error creating annotation:', error);
      return NextResponse.json(
        { error: 'Failed to create annotation' },
        { status: 500 }
      );
    }

    return NextResponse.json({ annotation });
  } catch (error) {
    console.error('Error in POST /api/recordings/[id]/annotations:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
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

    const { searchParams } = new URL(request.url);
    const annotationId = searchParams.get('annotationId');

    if (!annotationId) {
      return NextResponse.json(
        { error: 'Missing annotationId query parameter' },
        { status: 400 }
      );
    }

    const db = getDatabaseClient();

    // Verify the annotation belongs to this recording and user owns it
    const { data: annotation, error: fetchError } = await db
      .from('eeg_annotations')
      .select('id, created_by')
      .eq('id', annotationId)
      .eq('recording_id', params.id)
      .single();

    if (fetchError || !annotation) {
      return NextResponse.json(
        { error: 'Annotation not found' },
        { status: 404 }
      );
    }

    const { error: deleteError } = await db
      .from('eeg_annotations')
      .delete()
      .eq('id', annotationId)
      .execute();

    if (deleteError) {
      console.error('Error deleting annotation:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete annotation' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE /api/recordings/[id]/annotations:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
