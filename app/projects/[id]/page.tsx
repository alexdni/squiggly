import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import ProjectDetailsClient from '@/components/ProjectDetailsClient';

interface ProjectPageProps {
  params: {
    id: string;
  };
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch project details
  const { data: project, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', params.id)
    .single();

  if (error || !project) {
    redirect('/projects');
  }

  return <ProjectDetailsClient project={project} user={user} />;
}
