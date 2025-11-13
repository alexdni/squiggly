import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import AnalysisDetailsClient from '@/components/AnalysisDetailsClient';

interface AnalysisPageProps {
  params: {
    id: string;
  };
}

export default async function AnalysisPage({ params }: AnalysisPageProps) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch analysis with recording and project data
  const { data: analysis, error } = await supabase
    .from('analyses')
    .select(`
      *,
      recording:recordings (
        id,
        filename,
        file_path,
        file_size,
        duration_seconds,
        sampling_rate,
        n_channels,
        montage,
        reference,
        eo_start,
        eo_end,
        ec_start,
        ec_end,
        project_id,
        created_at
      )
    `)
    .eq('id', params.id)
    .single();

  if (error || !analysis) {
    redirect('/projects');
  }

  return <AnalysisDetailsClient analysis={analysis} user={user} />;
}
