import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { safeRedirect } from '@/lib/safe-redirect';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const origin = requestUrl.origin;
  const redirectTo = safeRedirect(requestUrl.searchParams.get('redirect'));

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  // Redirect to the specified page or dashboard
  return NextResponse.redirect(`${origin}${redirectTo}`);
}
