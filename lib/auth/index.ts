/**
 * Auth Client Factory
 *
 * Returns the appropriate auth client based on environment configuration
 */

import type { AuthClient, AuthMode } from './types';
import { getAuthMode } from './types';
import { SupabaseAuthClient } from './supabase-auth';
import { LocalAuthClient, createAdminUser } from './local-auth';

let authClientInstance: AuthClient | null = null;

/**
 * Get the auth client singleton
 *
 * Returns SupabaseAuthClient when AUTH_MODE is 'supabase' (default)
 * Returns LocalAuthClient when AUTH_MODE is 'local'
 */
export function getAuthClient(): AuthClient {
  if (!authClientInstance) {
    const mode = getAuthMode();

    if (mode === 'local') {
      authClientInstance = new LocalAuthClient();
    } else {
      authClientInstance = new SupabaseAuthClient();
    }
  }

  return authClientInstance;
}

/**
 * Create a new auth client instance (not singleton)
 * Useful for testing or when you need a fresh client
 */
export function createAuthClient(mode?: AuthMode): AuthClient {
  const resolvedMode = mode || getAuthMode();

  if (resolvedMode === 'local') {
    return new LocalAuthClient();
  }

  return new SupabaseAuthClient();
}

/**
 * Check if running in local auth mode
 */
export function isLocalAuthMode(): boolean {
  return getAuthMode() === 'local';
}

/**
 * Get the current authenticated user
 * Works in both local and Supabase auth modes
 * For use in Server Components and API routes
 */
export async function getCurrentUser(): Promise<{ id: string; email: string } | null> {
  if (isLocalAuthMode()) {
    const authClient = getAuthClient();
    const { user } = await authClient.getUser();
    return user ? { id: user.id, email: user.email || '' } : null;
  } else {
    // Dynamically import to avoid issues when Supabase env vars aren't set
    const { createClient } = await import('@/lib/supabase-server');
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user ? { id: user.id, email: user.email || '' } : null;
  }
}

// Re-export types and utilities
export type { AuthClient, User, Session, AuthResult, SignInCredentials, SignUpCredentials, AuthMode } from './types';
export { getAuthMode } from './types';
export { SupabaseAuthClient } from './supabase-auth';
export { LocalAuthClient, createAdminUser } from './local-auth';
