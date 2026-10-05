import { NextResponse } from 'next/server';
import { getAuthClient } from '@/lib/auth';

export async function GET() {
  try {
    const authClient = getAuthClient();
    const { user, error } = await authClient.getUser();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    if (!user) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
