import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import ProjectsClient from '@/components/ProjectsClient';

export default async function ProjectsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return <ProjectsClient user={user} />;
}
