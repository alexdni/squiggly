import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getCurrentUser, isLocalAuthMode } from '@/lib/auth';
import { listGrants, revokeGrant } from '@/lib/server/oauth-grants';

export const dynamic = 'force-dynamic';

async function authorize() {
  if (isLocalAuthMode()) {
    return { response: new NextResponse(null, { status: 404 }) };
  }
  const user = await getCurrentUser();
  if (!user) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { supabase: await createClient() };
}

export async function GET() {
  const { response, supabase } = await authorize();
  if (!supabase) return response;
  const { data, error } = await listGrants(supabase);
  if (error) return NextResponse.json({ error }, { status: 400 });
  return NextResponse.json({ grants: data });
}

export async function DELETE(request: Request) {
  const { response, supabase } = await authorize();
  if (!supabase) return response;
  const clientId = new URL(request.url).searchParams.get('client_id');
  if (!clientId) {
    return NextResponse.json({ error: 'client_id is required' }, { status: 400 });
  }
  const { error } = await revokeGrant(supabase, clientId);
  if (error) return NextResponse.json({ error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
