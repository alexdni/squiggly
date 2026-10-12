import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDatabaseClient } from '@/lib/db';
import { getStorageClient } from '@/lib/storage';
import { checkProjectPermission } from '@/lib/rbac';
import type { SloretaResults } from '@/lib/analysis-results';

/**
 * GET /api/analyses/[id]/sloreta - the analysis's sLORETA values as little-endian Float32,
 * laid out [condition][band][voxel] as described by results.sloreta.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const db = getDatabaseClient();
    const { data: analysis } = await db
      .from('analyses')
      .select('recording_id, results')
      .eq('id', params.id)
      .single();
    const row = analysis as { recording_id: string; results?: { sloreta?: SloretaResults } } | null;
    if (!row) return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });

    const { data: recording } = await db.from('recordings').select('project_id').eq('id', row.recording_id).single();
    const projectId = (recording as { project_id?: string } | null)?.project_id;
    if (!projectId || !(await checkProjectPermission(projectId, user.id, 'analysis:read'))) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    const valuesPath = row.results?.sloreta?.values_path;
    if (!valuesPath) return NextResponse.json({ error: 'No source localization for this analysis' }, { status: 404 });

    const file = await getStorageClient().download('visuals', valuesPath);
    return new NextResponse(new Uint8Array(file), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Error fetching sLORETA values:', error);
    return NextResponse.json({ error: 'Failed to fetch source localization' }, { status: 500 });
  }
}
