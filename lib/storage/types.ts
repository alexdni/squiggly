/**
 * Storage Client Interface
 *
 * Abstracts storage operations to work with both Supabase Storage (cloud)
 * and local filesystem (Docker mode)
 */

export interface UploadOptions {
  contentType?: string;
  upsert?: boolean;
}

export interface StorageFile {
  name: string;
  id?: string;
  size?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface SignedUrlResult {
  signedUrl: string;
  path: string;
  token?: string;
}

export interface StorageClient {
  /**
   * Upload a file to storage
   * @param bucket - Bucket name (recordings, visuals, exports)
   * @param path - Path within the bucket
   * @param data - File data as Buffer or Uint8Array
   * @param options - Upload options
   */
  upload(
    bucket: string,
    path: string,
    data: Buffer | Uint8Array,
    options?: UploadOptions
  ): Promise<{ path: string; error?: Error }>;

  /**
   * Download a file from storage
   * @param bucket - Bucket name
   * @param path - Path within the bucket
   * @returns File data as Buffer
   */
  download(bucket: string, path: string): Promise<Buffer>;

  /**
   * Delete a file from storage
   * @param bucket - Bucket name
   * @param paths - Array of paths to delete
   */
  remove(bucket: string, paths: string[]): Promise<{ error?: Error }>;

  /**
   * List files in a directory
   * @param bucket - Bucket name
   * @param path - Directory path
   */
  list(bucket: string, path: string): Promise<StorageFile[]>;

  /**
   * Create a signed URL for uploading
   * @param bucket - Bucket name
   * @param path - Path for the upload
   */
  createSignedUploadUrl(
    bucket: string,
    path: string
  ): Promise<SignedUrlResult>;

  /**
   * Create a signed URL for downloading
   * @param bucket - Bucket name
   * @param path - Path to the file
   * @param expiresIn - Expiration time in seconds
   */
  createSignedUrl(
    bucket: string,
    path: string,
    expiresIn: number
  ): Promise<{ signedUrl: string }>;

  /**
   * Get public URL for a file (if bucket is public)
   * @param bucket - Bucket name
   * @param path - Path to the file
   */
  getPublicUrl(bucket: string, path: string): string;
}

export type StorageMode = 'supabase' | 'local';

export function getStorageMode(): StorageMode {
  const mode = process.env.STORAGE_MODE;
  if (mode === 'local') {
    return 'local';
  }
  return 'supabase';
}
