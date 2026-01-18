/**
 * Storage Client Factory
 *
 * Returns the appropriate storage client based on environment configuration
 */

import type { StorageClient, StorageMode } from './types';
import { getStorageMode } from './types';
import { SupabaseStorageClient } from './supabase-storage';
import { LocalStorageClient } from './local-storage';

let storageClientInstance: StorageClient | null = null;

/**
 * Get the storage client singleton
 *
 * Returns SupabaseStorageClient when STORAGE_MODE is 'supabase' (default)
 * Returns LocalStorageClient when STORAGE_MODE is 'local'
 */
export function getStorageClient(): StorageClient {
  if (!storageClientInstance) {
    const mode = getStorageMode();

    if (mode === 'local') {
      storageClientInstance = new LocalStorageClient();
    } else {
      storageClientInstance = new SupabaseStorageClient();
    }
  }

  return storageClientInstance;
}

/**
 * Create a new storage client instance (not singleton)
 * Useful for testing or when you need a fresh client
 */
export function createStorageClient(mode?: StorageMode): StorageClient {
  const resolvedMode = mode || getStorageMode();

  if (resolvedMode === 'local') {
    return new LocalStorageClient();
  }

  return new SupabaseStorageClient();
}

/**
 * Check if running in local storage mode
 */
export function isLocalStorageMode(): boolean {
  return getStorageMode() === 'local';
}

// Re-export types
export type { StorageClient, StorageFile, SignedUrlResult, UploadOptions, StorageMode } from './types';
export { getStorageMode } from './types';
export { SupabaseStorageClient } from './supabase-storage';
export { LocalStorageClient } from './local-storage';
