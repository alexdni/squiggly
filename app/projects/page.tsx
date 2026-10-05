import { redirect } from 'next/navigation';
import ProjectsClient from '@/components/ProjectsClient';
import { getCurrentUser } from '@/lib/auth';

export default async function ProjectsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/login?expired=1');
  }

  return <ProjectsClient user={user as any} />;
}
