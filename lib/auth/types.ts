/**
 * Auth Client Interface
 *
 * Abstracts authentication operations to work with both Supabase Auth (cloud)
 * and local session-based auth (Docker mode)
 */

export interface User {
  id: string;
  email: string;
  name?: string;
  role?: string;
  createdAt?: string;
}

export interface Session {
  user: User;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface AuthResult {
  user: User | null;
  session: Session | null;
  error: Error | null;
}

export interface SignInCredentials {
  email: string;
  password: string;
}

export interface SignUpCredentials {
  email: string;
  password: string;
  name?: string;
}

export interface AuthClient {
  /**
   * Get the current user (if authenticated)
   */
  getUser(): Promise<{ user: User | null; error: Error | null }>;

  /**
   * Get the current session
   */
  getSession(): Promise<{ session: Session | null; error: Error | null }>;

  /**
   * Sign in with email and password
   */
  signInWithPassword(credentials: SignInCredentials): Promise<AuthResult>;

  /**
   * Sign out the current user
   */
  signOut(): Promise<{ error: Error | null }>;

  /**
   * Sign up a new user (local mode only)
   */
  signUp?(credentials: SignUpCredentials): Promise<AuthResult>;

  /**
   * Check if the auth system is healthy
   */
  healthCheck(): Promise<boolean>;
}

export type AuthMode = 'supabase' | 'local';

export function getAuthMode(): AuthMode {
  const mode = process.env.AUTH_MODE;
  if (mode === 'local') {
    return 'local';
  }
  return 'supabase';
}
