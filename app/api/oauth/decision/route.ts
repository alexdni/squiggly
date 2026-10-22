import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getCurrentUser, isLocalAuthMode } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (isLocalAuthMode()) {
    return new NextResponse(null, { status: 404 });
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const form = await request.formData();
  const authorizationId = form.get('authorization_id');
  const decision = form.get('decision');
  if (typeof authorizationId !== 'string' || !authorizationId) {
    return NextResponse.json({ error: 'authorization_id is required' }, { status: 400 });
  }
  if (decision !== 'approve' && decision !== 'deny') {
    return NextResponse.json({ error: 'decision must be approve or deny' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } =
    decision === 'approve'
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });

  if (error || !data?.redirect_url) {
    return NextResponse.json(
      { error: error?.message ?? 'Authorization request failed' },
      { status: 400 }
    );
  }
  // 303 so the browser follows with GET after the form POST
  return NextResponse.redirect(data.redirect_url, 303);
}
