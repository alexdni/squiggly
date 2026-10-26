import { NextResponse } from 'next/server';
import { fetchUsageEvents, getAdminUser } from '@/lib/server/admin';

export const dynamic = 'force-dynamic';

// GET /api/admin/usage - raw usage events for the admin dashboard
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const events = await fetchUsageEvents();
    return NextResponse.json(events, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[GET /api/admin/usage]', error);
    return NextResponse.json({ error: 'Failed to load usage' }, { status: 500 });
  }
}
