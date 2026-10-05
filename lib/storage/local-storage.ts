/**
 * Local Filesystem Storage Client
 *
 * Implements StorageClient interface using local filesystem for Docker mode
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import type { StorageClient, UploadOptions, StorageFile, SignedUrlResult } from './types';

export class LocalStorageClient implements StorageClient {
  private basePath: string;
  private baseUrl: string;

  constructor() {
    this.basePath = process.env.STORAGE_PATH || '/data/storage';
    this.baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  }

  private getFullPath(bucket: string, filePath: string): string {
    return path.join(this.basePath, bucket, filePath);
  }

  private async ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  async upload(
    bucket: string,
    filePath: string,
    data: Buffer | Uint8Array,
    options?: UploadOptions
  ): Promise<{ path: string; error?: Error }> {
    try {
      const fullPath = this.getFullPath(bucket, filePath);
      const dirPath = path.dirname(fullPath);

      await this.ensureDir(dirPath);

      // Check if file exists and upsert is false
      if (!options?.upsert) {
        try {
          await fs.access(fullPath);
          return { path: filePath, error: new Error('File already exists') };
        } catch {
          // File doesn't exist, continue with upload
        }
      }

      await fs.writeFile(fullPath, data);

      return { path: filePath };
    } catch (error) {
      return { path: filePath, error: error as Error };
    }
  }

  async download(bucket: string, filePath: string): Promise<Buffer> {
    const fullPath = this.getFullPath(bucket, filePath);

    try {
      return await fs.readFile(fullPath);
    } catch (error) {
      throw new Error(`Failed to download ${bucket}/${filePath}: ${(error as Error).message}`);
    }
  }

  async remove(bucket: string, paths: string[]): Promise<{ error?: Error }> {
    try {
      for (const filePath of paths) {
        const fullPath = this.getFullPath(bucket, filePath);
        try {
          await fs.unlink(fullPath);
        } catch (error) {
          // Ignore file not found errors
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
          }
        }
      }
      return {};
    } catch (error) {
      return { error: error as Error };
    }
  }

  async list(bucket: string, dirPath: string): Promise<StorageFile[]> {
    const fullPath = this.getFullPath(bucket, dirPath);

    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const files: StorageFile[] = [];

      for (const entry of entries) {
        if (entry.isFile()) {
          const filePath = path.join(fullPath, entry.name);
          const stats = await fs.stat(filePath);
          files.push({
            name: entry.name,
            size: stats.size,
            createdAt: stats.birthtime.toISOString(),
            updatedAt: stats.mtime.toISOString(),
          });
        }
      }

      return files;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async createSignedUploadUrl(
    bucket: string,
    filePath: string
  ): Promise<SignedUrlResult> {
    // For local storage, we generate a token that will be validated on upload
    const token = crypto.randomBytes(32).toString('hex');

    // Store token for validation (in production, use Redis or database)
    // For simplicity, we include the path info in the token
    const signedData = Buffer.from(JSON.stringify({
      bucket,
      path: filePath,
      expires: Date.now() + 3600000, // 1 hour
    })).toString('base64');

    const signedUrl = `${this.baseUrl}/api/storage/upload?token=${signedData}`;

    return {
      signedUrl,
      path: filePath,
      token: signedData,
    };
  }

  async createSignedUrl(
    bucket: string,
    filePath: string,
    expiresIn: number
  ): Promise<{ signedUrl: string }> {
    // Generate a signed URL for downloading
    const signedData = Buffer.from(JSON.stringify({
      bucket,
      path: filePath,
      expires: Date.now() + expiresIn * 1000,
    })).toString('base64');

    const signedUrl = `${this.baseUrl}/api/storage/download?token=${signedData}`;

    return { signedUrl };
  }

  getPublicUrl(bucket: string, filePath: string): string {
    // For local storage, return an API route that serves the file
    return `${this.baseUrl}/api/storage/${bucket}/${filePath}`;
  }

  /**
   * Get the local file path for direct access (used by Python worker)
   */
  getLocalPath(bucket: string, filePath: string): string {
    return this.getFullPath(bucket, filePath);
  }
}
