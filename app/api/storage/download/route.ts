import { NextRequest, NextResponse } from 'next/server';
import { getStorageClient, isLocalStorageMode } from '@/lib/storage';

/**
 * Local storage download endpoint
 *
 * This endpoint handles file downloads in Docker mode when using local storage.
 * The token parameter contains the signed download URL data.
 */
export async function GET(request: NextRequest) {
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

    // Download from local storage
    const storage = getStorageClient();

    try {
      const data = await storage.download(tokenData.bucket, tokenData.path);

      // Determine content type from file extension
      const ext = tokenData.path.split('.').pop()?.toLowerCase();
      const contentType = getContentType(ext);

      return new NextResponse(new Uint8Array(data), {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${tokenData.path.split('/').pop()}"`,
        },
      });
    } catch (error) {
      console.error('Download error:', error);
      return NextResponse.json(
        { error: 'File not found' },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error('Download error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function getContentType(extension: string | undefined): string {
  const contentTypes: Record<string, string> = {
    edf: 'application/octet-stream',
    csv: 'text/csv',
    json: 'application/json',
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
  };

  return contentTypes[extension || ''] || 'application/octet-stream';
}
