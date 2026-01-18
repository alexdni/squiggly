import { redirect } from 'next/navigation';
import AnalysisDetailsClient from '@/components/AnalysisDetailsClient';
import { getCurrentUser } from '@/lib/auth';
import { getDatabaseClient } from '@/lib/db';

interface AnalysisPageProps {
  params: {
    id: string;
  };
}

export default async function AnalysisPage({ params }: AnalysisPageProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/login');
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

  // Combine the data in the format expected by the client component
  const analysisWithRecording = {
    ...(analysis as Record<string, unknown>),
    recording: recording || null,
  } as any;

  return <AnalysisDetailsClient analysis={analysisWithRecording} user={user as any} />;
}
