import { redirect } from 'next/navigation';
import DashboardClient from '@/components/DashboardClient';
import { getCurrentUser } from '@/lib/auth';

export default async function DashboardPage() {
  const user = await getCurrentUser();

  if (!user) {
    // Use ?expired=1 so middleware clears the stale cookie and breaks the redirect loop
    redirect('/login?expired=1');
  }

  return <DashboardClient user={user as any} />;
}
