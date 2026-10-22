import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getCurrentUser, isLocalAuthMode } from '@/lib/auth';
import { isSameOriginPost, parseAuthorizationId } from '@/lib/server/oauth-consent';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (isLocalAuthMode()) {
    return new NextResponse(null, { status: 404 });
  }
  // CSRF: only the consent page's own form may record a decision
  if (!isSameOriginPost(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const form = await request.formData();
  const ids = form.getAll('authorization_id');
  const authorizationId = ids.length === 1 ? parseAuthorizationId(ids[0]) : null;
  const decision = form.get('decision');
  if (!authorizationId) {
    return NextResponse.json({ error: 'authorization_id is missing or invalid' }, { status: 400 });
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
    console.error('[oauth] decision failed', { decision, message: error?.message ?? 'no redirect_url' });
    const back = new URL('/oauth/consent', request.url);
    back.searchParams.set('authorization_id', authorizationId);
    back.searchParams.set('error', '1');
    return NextResponse.redirect(back, 303);
  }
  // 303 so the browser follows with GET after the form POST
  return NextResponse.redirect(data.redirect_url, 303);
}
