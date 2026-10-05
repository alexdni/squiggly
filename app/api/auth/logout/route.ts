import { NextResponse } from 'next/server';
import { getAuthClient } from '@/lib/auth';

export async function POST() {
  try {
    const authClient = getAuthClient();
    const { error } = await authClient.signOut();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
