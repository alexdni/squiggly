import { redirect } from 'next/navigation';
import DashboardClient from '@/components/DashboardClient';
import { getCurrentUser } from '@/lib/auth';

export default async function DashboardPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/login');
  }

  return <DashboardClient user={user as any} />;
}
