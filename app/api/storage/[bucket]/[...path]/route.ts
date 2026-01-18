import { NextRequest, NextResponse } from 'next/server';
import { isLocalStorageMode } from '@/lib/storage';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Local storage file serving endpoint
 *
 * Serves files from local storage in Docker mode.
 * URL pattern: /api/storage/{bucket}/{path}
 * Example: /api/storage/visuals/analysis-id/topomap.png
 */

const STORAGE_PATH = process.env.STORAGE_PATH || '/data/storage';

// Allowed buckets for security
const ALLOWED_BUCKETS = ['visuals', 'exports'];

function getContentType(extension: string | undefined): string {
  const contentTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    json: 'application/json',
    csv: 'text/csv',
    zip: 'application/zip',
  };

  return contentTypes[extension?.toLowerCase() || ''] || 'application/octet-stream';
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bucket: string; path: string[] }> }
) {
  if (!isLocalStorageMode()) {
    return NextResponse.json(
      { error: 'This endpoint is only available in local storage mode' },
      { status: 400 }
    );
  }

  try {
    const { bucket, path: pathSegments } = await params;

    // Security: Only allow specific buckets
    if (!ALLOWED_BUCKETS.includes(bucket)) {
      return NextResponse.json(
        { error: 'Invalid bucket' },
        { status: 400 }
      );
    }

    // Build file path
    const filePath = pathSegments.join('/');

    // Security: Prevent directory traversal
    if (filePath.includes('..') || filePath.startsWith('/')) {
      return NextResponse.json(
        { error: 'Invalid path' },
        { status: 400 }
      );
    }

    const fullPath = path.join(STORAGE_PATH, bucket, filePath);

    // Security: Verify the resolved path is still within storage
    const resolvedPath = path.resolve(fullPath);
    const storagePath = path.resolve(STORAGE_PATH);
    if (!resolvedPath.startsWith(storagePath)) {
      return NextResponse.json(
        { error: 'Invalid path' },
        { status: 400 }
      );
    }

    // Check if file exists
    if (!fs.existsSync(fullPath)) {
      return NextResponse.json(
        { error: 'File not found' },
        { status: 404 }
      );
    }

    // Read file
    const fileBuffer = fs.readFileSync(fullPath);
    const ext = filePath.split('.').pop();
    const contentType = getContentType(ext);

    // Return file with appropriate headers
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Storage serve error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
