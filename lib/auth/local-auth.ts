/**
 * Local Session-based Auth Client
 *
 * Implements AuthClient interface using session cookies and PostgreSQL for Docker mode
 */

import * as crypto from 'crypto';
import { cookies } from 'next/headers';
import type {
  AuthClient,
  User,
  Session,
  AuthResult,
  SignInCredentials,
  SignUpCredentials,
} from './types';

// Session cookie name
const SESSION_COOKIE_NAME = 'squiggly_session';
const SESSION_EXPIRY_DAYS = 7;

// In-memory session store (in production, use Redis or database)
// For Docker mode, this is acceptable since there's only one process
const sessions = new Map<string, { userId: string; expiresAt: number }>();

// Utility functions for password hashing
async function hashPassword(password: string): Promise<string> {
  // Use scrypt for password hashing (built-in to Node.js)
  const salt = crypto.randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, key] = hash.split(':');
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(derivedKey.toString('hex') === key);
    });
  });
}

function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Dynamic import for pg
let Pool: any = null;
let pool: any = null;

async function getPool() {
  if (!Pool) {
    const pg = await import('pg');
    Pool = pg.Pool;
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
  }
  return pool;
}

export class LocalAuthClient implements AuthClient {
  async getUser(): Promise<{ user: User | null; error: Error | null }> {
    try {
      const cookieStore = await cookies();
      const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

      if (!sessionToken) {
        return { user: null, error: null };
      }

      // Check session validity
      const sessionData = sessions.get(sessionToken);
      if (!sessionData || sessionData.expiresAt < Date.now()) {
        sessions.delete(sessionToken);
        return { user: null, error: null };
      }

      // Fetch user from database
      const pgPool = await getPool();
      const result = await pgPool.query(
        'SELECT id, email, name, role, created_at FROM users WHERE id = $1',
        [sessionData.userId]
      );

      if (result.rows.length === 0) {
        sessions.delete(sessionToken);
        return { user: null, error: null };
      }

      const row = result.rows[0];
      return {
        user: {
          id: row.id,
          email: row.email,
          name: row.name,
          role: row.role,
          createdAt: row.created_at,
        },
        error: null,
      };
    } catch (error) {
      return { user: null, error: error as Error };
    }
  }

  async getSession(): Promise<{ session: Session | null; error: Error | null }> {
    const { user, error } = await this.getUser();

    if (error) {
      return { session: null, error };
    }

    if (!user) {
      return { session: null, error: null };
    }

    return {
      session: { user },
      error: null,
    };
  }

  async signInWithPassword(credentials: SignInCredentials): Promise<AuthResult> {
    try {
      // Fetch user from database
      const pgPool = await getPool();
      const result = await pgPool.query(
        'SELECT id, email, name, role, password_hash, created_at FROM users WHERE email = $1',
        [credentials.email.toLowerCase()]
      );

      if (result.rows.length === 0) {
        return {
          user: null,
          session: null,
          error: new Error('Invalid email or password'),
        };
      }

      const row = result.rows[0];

      // Verify password
      const isValid = await verifyPassword(credentials.password, row.password_hash);

      if (!isValid) {
        return {
          user: null,
          session: null,
          error: new Error('Invalid email or password'),
        };
      }

      // Create session
      const sessionToken = generateSessionToken();
      const expiresAt = Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

      sessions.set(sessionToken, {
        userId: row.id,
        expiresAt,
      });

      // Set session cookie
      const cookieStore = await cookies();
      cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        expires: new Date(expiresAt),
        path: '/',
      });

      const user: User = {
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        createdAt: row.created_at,
      };

      return {
        user,
        session: { user },
        error: null,
      };
    } catch (error) {
      return { user: null, session: null, error: error as Error };
    }
  }

  async signOut(): Promise<{ error: Error | null }> {
    try {
      const cookieStore = await cookies();
      const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

      if (sessionToken) {
        sessions.delete(sessionToken);
      }

      cookieStore.delete(SESSION_COOKIE_NAME);

      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  }

  async signUp(credentials: SignUpCredentials): Promise<AuthResult> {
    try {
      const pgPool = await getPool();

      // Check if user already exists
      const existing = await pgPool.query(
        'SELECT id FROM users WHERE email = $1',
        [credentials.email.toLowerCase()]
      );

      if (existing.rows.length > 0) {
        return {
          user: null,
          session: null,
          error: new Error('User already exists'),
        };
      }

      // Hash password
      const passwordHash = await hashPassword(credentials.password);

      // Create user
      const userId = crypto.randomUUID();
      const result = await pgPool.query(
        `INSERT INTO users (id, email, name, password_hash, role, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING id, email, name, role, created_at`,
        [userId, credentials.email.toLowerCase(), credentials.name || null, passwordHash, 'user']
      );

      const row = result.rows[0];

      // Create session
      const sessionToken = generateSessionToken();
      const expiresAt = Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

      sessions.set(sessionToken, {
        userId: row.id,
        expiresAt,
      });

      // Set session cookie
      const cookieStore = await cookies();
      cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        expires: new Date(expiresAt),
        path: '/',
      });

      const user: User = {
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        createdAt: row.created_at,
      };

      return {
        user,
        session: { user },
        error: null,
      };
    } catch (error) {
      return { user: null, session: null, error: error as Error };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const pgPool = await getPool();
      await pgPool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Create an admin user (called during container initialization)
 */
export async function createAdminUser(email: string, password: string): Promise<void> {
  const pgPool = await getPool();

  // Check if admin already exists
  const existing = await pgPool.query(
    'SELECT id FROM users WHERE email = $1',
    [email.toLowerCase()]
  );

  if (existing.rows.length > 0) {
    console.log(`Admin user ${email} already exists`);
    return;
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // Create admin user
  const userId = crypto.randomUUID();
  await pgPool.query(
    `INSERT INTO users (id, email, name, password_hash, role, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [userId, email.toLowerCase(), 'Admin', passwordHash, 'admin']
  );

  console.log(`Created admin user: ${email}`);
}
