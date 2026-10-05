import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { checkProjectPermission } from '@/lib/rbac';
import { getStorageClient } from '@/lib/storage';

// POST /api/upload/init - Generate signed URL for upload
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

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

    // Use storage abstraction to generate signed URL
    const storage = getStorageClient();

    try {
      const signedUrlData = await storage.createSignedUploadUrl('recordings', filePath);

      return NextResponse.json({
        uploadUrl: signedUrlData.signedUrl,
        filePath: filePath,
        token: signedUrlData.token,
      });
    } catch (signedUrlError) {
      console.error('Error creating signed URL:', signedUrlError);
      return NextResponse.json(
        { error: 'Failed to generate upload URL' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error in upload init:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
