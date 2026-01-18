import { redirect } from 'next/navigation';
import ProjectDetailsClient from '@/components/ProjectDetailsClient';
import { getCurrentUser } from '@/lib/auth';
import { getDatabaseClient } from '@/lib/db';

interface ProjectPageProps {
  params: {
    id: string;
  };
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch project details
  const db = getDatabaseClient();
  const { data: project, error } = await db
    .from('projects')
    .select('*')
    .eq('id', params.id)
    .single();

  if (error || !project) {
    redirect('/projects');
  }

  return <ProjectDetailsClient project={project as any} user={user as any} />;
}
