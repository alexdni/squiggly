import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDatabaseClient } from '@/lib/db';
import { checkProjectPermission } from '@/lib/rbac';

// GET /api/projects/[id]/theraq-analysis/[analysisId] - fetch a TheraQ analysis (status + results)
export async function GET(
  request: Request,
  { params }: { params: { id: string; analysisId: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hasPermission = await checkProjectPermission(params.id, user.id, 'analysis:read');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const db = getDatabaseClient();
    const { data: analysis, error } = await db
      .from('project_analyses')
      .select('*')
      .eq('id', params.analysisId)
      .single();

    if (error || !analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    // Ensure the analysis belongs to the project in the path
    if ((analysis as any).project_id !== params.id) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    return NextResponse.json({ analysis });
  } catch (error) {
    console.error('Error fetching TheraQ analysis:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
