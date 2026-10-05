import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDatabaseClient } from '@/lib/db';
import { checkProjectPermission } from '@/lib/rbac';
import { getStorageClient } from '@/lib/storage';

/** Long enough to fetch a 200 MB recording, short enough that a leaked link soon dies. */
const URL_TTL_SECONDS = 600;

/**
 * GET /api/recordings/[id]/download — short-lived signed URL for the recording file, for the
 * in-browser EEG viewer. Works with Supabase and local storage. The path comes from the database
 * row, never from the client.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDatabaseClient();
  const { data, error } = await db
    .from('recordings')
    .select('id, project_id, file_path')
    .eq('id', params.id)
    .single();
  const recording = data as { id: string; project_id: string; file_path: string | null } | null;
  if (error || !recording?.file_path) {
    return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
  }
  if (!(await checkProjectPermission(recording.project_id, user.id, 'recording:read'))) {
    return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
  }

  try {
    const { signedUrl } = await getStorageClient().createSignedUrl(
      'recordings',
      recording.file_path,
      URL_TTL_SECONDS
    );
    return NextResponse.json({ signedUrl, expiresIn: URL_TTL_SECONDS });
  } catch (err) {
    console.error('Error creating recording download URL:', err);
    return NextResponse.json({ error: 'Could not create download URL' }, { status: 500 });
  }
}
