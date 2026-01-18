import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { checkProjectPermission } from '@/lib/rbac';
import { getStorageClient, isLocalStorageMode } from '@/lib/storage';
import { getAuthClient } from '@/lib/auth';

// POST /api/upload/init - Generate signed URL for upload
export async function POST(request: Request) {
  try {
    // Get authenticated user (works for both Supabase and local auth)
    let userId: string;

    if (isLocalStorageMode()) {
      const authClient = getAuthClient();
      const { user, error } = await authClient.getUser();
      if (error || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      userId = user.id;
    } else {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      userId = user.id;
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
      userId,
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
