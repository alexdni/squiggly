// Middleware helper for auth (supports both Supabase and local auth)
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/types/database';

// Check if we're in local auth mode
function isLocalAuthMode(): boolean {
  return process.env.AUTH_MODE === 'local';
}

// Local auth session check
async function updateSessionLocal(request: NextRequest) {
  const supabaseResponse = NextResponse.next({
    request,
  });

  // Check for local session cookie
  const sessionCookie = request.cookies.get('squiggly_session');
  let isAuthenticated = false;

  if (sessionCookie) {
    try {
      const sessionData = JSON.parse(sessionCookie.value);
      // Check if session is not expired
      if (sessionData.expires && new Date(sessionData.expires) > new Date()) {
        isAuthenticated = true;
      }
    } catch {
      // Invalid session cookie
      isAuthenticated = false;
    }
  }

  // Protect authenticated routes
  const isAuthRoute =
    request.nextUrl.pathname.startsWith('/dashboard') ||
    request.nextUrl.pathname.startsWith('/projects') ||
    request.nextUrl.pathname.startsWith('/analyses');

  if (isAuthRoute && !isAuthenticated) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from login/signup
  if (
    (request.nextUrl.pathname === '/login' ||
      request.nextUrl.pathname === '/signup') &&
    isAuthenticated
  ) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

// Supabase auth session check (original implementation)
async function updateSessionSupabase(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session if needed
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Protect authenticated routes
  const isAuthRoute =
    request.nextUrl.pathname.startsWith('/dashboard') ||
    request.nextUrl.pathname.startsWith('/projects') ||
    request.nextUrl.pathname.startsWith('/analyses');

  if (isAuthRoute && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from login/signup
  if (
    (request.nextUrl.pathname === '/login' ||
      request.nextUrl.pathname === '/signup') &&
    user
  ) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export async function updateSession(request: NextRequest) {
  if (isLocalAuthMode()) {
    return updateSessionLocal(request);
  }
  return updateSessionSupabase(request);
}
