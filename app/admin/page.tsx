import { notFound } from 'next/navigation';
import { getAdminUser } from '@/lib/server/admin';
import UsageDashboardClient from '@/components/admin/UsageDashboardClient';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const admin = await getAdminUser();
  if (!admin) notFound();
  return <UsageDashboardClient adminId={admin.id} />;
}
