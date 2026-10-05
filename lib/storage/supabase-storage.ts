/**
 * Supabase Storage Client
 *
 * Implements StorageClient interface using Supabase Storage
 */

import { createServerClient } from '@supabase/ssr';
import type { StorageClient, UploadOptions, StorageFile, SignedUrlResult } from './types';

export class SupabaseStorageClient implements StorageClient {
  private supabaseUrl: string;
  private supabaseKey: string;

  constructor() {
    this.supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    this.supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  }

  private getClient() {
    return createServerClient(
      this.supabaseUrl,
      this.supabaseKey,
      {
        cookies: {
          getAll: () => [],
          setAll: () => {},
        },
      }
    );
  }

  async upload(
    bucket: string,
    path: string,
    data: Buffer | Uint8Array,
    options?: UploadOptions
  ): Promise<{ path: string; error?: Error }> {
    const supabase = this.getClient();

    const { error } = await supabase.storage.from(bucket).upload(path, data, {
      contentType: options?.contentType,
      upsert: options?.upsert ?? false,
    });

    if (error) {
      return { path, error: new Error(error.message) };
    }

    return { path };
  }

  async download(bucket: string, path: string): Promise<Buffer> {
    const supabase = this.getClient();

    const { data, error } = await supabase.storage.from(bucket).download(path);

    if (error) {
      throw new Error(`Failed to download ${bucket}/${path}: ${error.message}`);
    }

    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async remove(bucket: string, paths: string[]): Promise<{ error?: Error }> {
    const supabase = this.getClient();

    const { error } = await supabase.storage.from(bucket).remove(paths);

    if (error) {
      return { error: new Error(error.message) };
    }

    return {};
  }

  async list(bucket: string, path: string): Promise<StorageFile[]> {
    const supabase = this.getClient();

    const { data, error } = await supabase.storage.from(bucket).list(path);

    if (error) {
      throw new Error(`Failed to list ${bucket}/${path}: ${error.message}`);
    }

    return (data || []).map((file) => ({
      name: file.name,
      id: file.id,
      size: file.metadata?.size,
      createdAt: file.created_at,
      updatedAt: file.updated_at,
    }));
  }

  async createSignedUploadUrl(
    bucket: string,
    path: string
  ): Promise<SignedUrlResult> {
    const supabase = this.getClient();

    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUploadUrl(path);

    if (error || !data) {
      throw new Error(`Failed to create signed upload URL: ${error?.message || 'Unknown error'}`);
    }

    return {
      signedUrl: data.signedUrl,
      path: data.path,
      token: data.token,
    };
  }

  async createSignedUrl(
    bucket: string,
    path: string,
    expiresIn: number
  ): Promise<{ signedUrl: string }> {
    const supabase = this.getClient();

    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, expiresIn);

    if (error || !data) {
      throw new Error(`Failed to create signed URL: ${error?.message || 'Unknown error'}`);
    }

    return { signedUrl: data.signedUrl };
  }

  getPublicUrl(bucket: string, path: string): string {
    const supabase = this.getClient();
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }
}
