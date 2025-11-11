import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { checkProjectPermission } from '@/lib/rbac';

// POST /api/upload/init - Generate signed URL for upload
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { projectId, filename, fileSize } = body;

    if (!projectId || !filename || !fileSize) {
      return NextResponse.json(
        { error: 'projectId, filename, and fileSize are required' },
        { status: 400 }
      );
    }

    // Check if user has permission to upload to this project
    const hasPermission = await checkProjectPermission(
      projectId,
      user.id,
      'recording:create'
    );

    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Generate unique file path
    const timestamp = Date.now();
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filePath = `${projectId}/${timestamp}-${sanitizedFilename}`;

    // Generate signed URL for upload (valid for 1 hour)
    const { data: signedUrlData, error: signedUrlError } = await supabase
      .storage
      .from('recordings')
      .createSignedUploadUrl(filePath);

    if (signedUrlError) {
      console.error('Error creating signed URL:', signedUrlError);
      return NextResponse.json(
        { error: 'Failed to generate upload URL' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      uploadUrl: signedUrlData.signedUrl,
      filePath: filePath,
      token: signedUrlData.token,
    });
  } catch (error) {
    console.error('Error in upload init:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
