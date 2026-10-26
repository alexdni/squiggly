import { redirect } from 'next/navigation';
import AnalysisDetailsClient from '@/components/AnalysisDetailsClient';
import { getCurrentUser } from '@/lib/auth';
import { getDatabaseClient } from '@/lib/db';
import { checkProjectPermission } from '@/lib/rbac';
import { withRecordingCondition } from '@/lib/server/relabel';

interface AnalysisPageProps {
  params: {
    id: string;
  };
}

export default async function AnalysisPage({ params }: AnalysisPageProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/login?expired=1');
  }

  const db = getDatabaseClient();

  // Fetch analysis
  const { data: analysis, error: analysisError } = await db
    .from('analyses')
    .select('*')
    .eq('id', params.id)
    .single();

  if (analysisError || !analysis) {
    redirect('/projects');
  }

  // Fetch recording data separately
  const analysisRecord = analysis as Record<string, unknown>;
  const { data: recording } = await db
    .from('recordings')
    .select('*')
    .eq('id', analysisRecord.recording_id)
    .single();

  // Same edit permission as PATCH /api/analyses/[id] and the event-reviews route: owners and
  // collaborators may review detected events; viewers only see the decisions.
  const projectId = (recording as { project_id?: string } | null)?.project_id;
  const canEdit = projectId ? await checkProjectPermission(projectId, user.id, 'analysis:create') : false;

  // Combine the data in the format expected by the client component
  // Results of an unlabelled run filed under the other condition are shown under the recording's own
  const analysisWithRecording = {
    ...withRecordingCondition(analysis as Record<string, unknown>, recording as never),
    recording: recording || null,
  } as any;

  return <AnalysisDetailsClient analysis={analysisWithRecording} user={user as any} canEdit={canEdit} />;
}
