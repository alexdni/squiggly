import { NextRequest, NextResponse } from 'next/server';
import { getStorageClient, isLocalStorageMode } from '@/lib/storage';

/**
 * Local storage upload endpoint
 *
 * This endpoint handles file uploads in Docker mode when using local storage.
 * The token parameter contains the signed upload URL data.
 *
 * Supports two upload methods:
 * 1. Raw binary data with Content-Type: application/octet-stream (like Supabase)
 * 2. multipart/form-data with 'file' field
 */
export async function POST(request: NextRequest) {
  return handleUpload(request);
}

export async function PUT(request: NextRequest) {
  return handleUpload(request);
}

async function handleUpload(request: NextRequest) {
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

    // Get file data based on Content-Type
    const contentType = request.headers.get('content-type') || '';
    let buffer: Buffer;
    let fileContentType = 'application/octet-stream';

    if (contentType.includes('multipart/form-data')) {
      // Handle multipart form data
      const formData = await request.formData();
      const file = formData.get('file') as File | null;

      if (!file) {
        return NextResponse.json(
          { error: 'No file provided' },
          { status: 400 }
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      fileContentType = file.type || 'application/octet-stream';
    } else {
      // Handle raw binary data (like Supabase expects)
      const arrayBuffer = await request.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      fileContentType = contentType || 'application/octet-stream';
    }

    if (buffer.length === 0) {
      return NextResponse.json(
        { error: 'Empty file' },
        { status: 400 }
      );
    }

    // Upload to local storage
    const storage = getStorageClient();
    const { error } = await storage.upload(
      tokenData.bucket,
      tokenData.path,
      buffer,
      { contentType: fileContentType, upsert: true }
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
