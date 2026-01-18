/**
 * Supabase Auth Client
 *
 * Wraps the existing Supabase auth to implement AuthClient interface
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { AuthClient, User, Session, AuthResult, SignInCredentials } from './types';

export class SupabaseAuthClient implements AuthClient {
  private async getClient() {
    const cookieStore = await cookies();

    return createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Server Component - cookies can only be modified in Server Actions or Route Handlers
            }
          },
        },
      }
    );
  }

  async getUser(): Promise<{ user: User | null; error: Error | null }> {
    try {
      const supabase = await this.getClient();
      const { data: { user }, error } = await supabase.auth.getUser();

      if (error) {
        return { user: null, error: new Error(error.message) };
      }

      if (!user) {
        return { user: null, error: null };
      }

      return {
        user: {
          id: user.id,
          email: user.email || '',
          name: user.user_metadata?.name,
          createdAt: user.created_at,
        },
        error: null,
      };
    } catch (error) {
      return { user: null, error: error as Error };
    }
  }

  async getSession(): Promise<{ session: Session | null; error: Error | null }> {
    try {
      const supabase = await this.getClient();
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error) {
        return { session: null, error: new Error(error.message) };
      }

      if (!session) {
        return { session: null, error: null };
      }

      return {
        session: {
          user: {
            id: session.user.id,
            email: session.user.email || '',
            name: session.user.user_metadata?.name,
            createdAt: session.user.created_at,
          },
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          expiresAt: session.expires_at,
        },
        error: null,
      };
    } catch (error) {
      return { session: null, error: error as Error };
    }
  }

  async signInWithPassword(credentials: SignInCredentials): Promise<AuthResult> {
    try {
      const supabase = await this.getClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: credentials.email,
        password: credentials.password,
      });

      if (error) {
        return { user: null, session: null, error: new Error(error.message) };
      }

      if (!data.user || !data.session) {
        return { user: null, session: null, error: new Error('Authentication failed') };
      }

      const user: User = {
        id: data.user.id,
        email: data.user.email || '',
        name: data.user.user_metadata?.name,
        createdAt: data.user.created_at,
      };

      const session: Session = {
        user,
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
      };

      return { user, session, error: null };
    } catch (error) {
      return { user: null, session: null, error: error as Error };
    }
  }

  async signOut(): Promise<{ error: Error | null }> {
    try {
      const supabase = await this.getClient();
      const { error } = await supabase.auth.signOut();

      if (error) {
        return { error: new Error(error.message) };
      }

      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const supabase = await this.getClient();
      await supabase.auth.getSession();
      return true;
    } catch {
      return false;
    }
  }
}
