import { NextResponse } from 'next/server';
import { getAuthClient, isLocalAuthMode } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const authClient = getAuthClient();
    const { user, error } = await authClient.signInWithPassword({ email, password });

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 401 }
      );
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Return auth mode for client to determine login method
  return NextResponse.json({
    mode: isLocalAuthMode() ? 'local' : 'supabase',
  });
}
