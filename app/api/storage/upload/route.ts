import { NextRequest, NextResponse } from 'next/server';
import { getStorageClient, isLocalStorageMode } from '@/lib/storage';

/**
 * Local storage upload endpoint
 *
 * This endpoint handles file uploads in Docker mode when using local storage.
 * The token parameter contains the signed upload URL data.
 */
export async function POST(request: NextRequest) {
  if (!isLocalStorageMode()) {
    return NextResponse.json(
      { error: 'This endpoint is only available in local storage mode' },
      { status: 400 }
    );
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json(
        { error: 'Missing token parameter' },
        { status: 400 }
      );
    }

    // Decode and validate token
    let tokenData: { bucket: string; path: string; expires: number };
    try {
      tokenData = JSON.parse(Buffer.from(token, 'base64').toString());
    } catch {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 400 }
      );
    }

    // Check expiration
    if (Date.now() > tokenData.expires) {
      return NextResponse.json(
        { error: 'Token expired' },
        { status: 401 }
      );
    }

    // Get file data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Read file content
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to local storage
    const storage = getStorageClient();
    const { error } = await storage.upload(
      tokenData.bucket,
      tokenData.path,
      buffer,
      { contentType: file.type, upsert: true }
    );

    if (error) {
      console.error('Upload error:', error);
      return NextResponse.json(
        { error: 'Failed to upload file' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      path: tokenData.path,
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  // Alias for POST
  return POST(request);
}
