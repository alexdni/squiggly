/**
 * Database Client Factory
 *
 * Returns the appropriate database client based on environment configuration
 */

import type { DatabaseClient, DatabaseMode } from './types';
import { getDatabaseMode } from './types';
import { SupabaseDatabaseClient } from './supabase-db';
import { PostgresDatabaseClient } from './postgres-db';

let databaseClientInstance: DatabaseClient | null = null;

/**
 * Get the database client singleton
 *
 * Returns SupabaseDatabaseClient when DATABASE_MODE is 'supabase' (default)
 * Returns PostgresDatabaseClient when DATABASE_MODE is 'postgres'
 */
export function getDatabaseClient(): DatabaseClient {
  if (!databaseClientInstance) {
    const mode = getDatabaseMode();

    if (mode === 'postgres') {
      databaseClientInstance = new PostgresDatabaseClient();
    } else {
      databaseClientInstance = new SupabaseDatabaseClient();
    }
  }

  return databaseClientInstance;
}

/**
 * Create a new database client instance (not singleton)
 * Useful for testing or when you need a fresh client
 */
export function createDatabaseClient(mode?: DatabaseMode): DatabaseClient {
  const resolvedMode = mode || getDatabaseMode();

  if (resolvedMode === 'postgres') {
    return new PostgresDatabaseClient();
  }

  return new SupabaseDatabaseClient();
}

/**
 * Check if running in direct PostgreSQL mode
 */
export function isPostgresMode(): boolean {
  return getDatabaseMode() === 'postgres';
}

// Re-export types
export type {
  DatabaseClient,
  TableClient,
  SelectBuilder,
  InsertBuilder,
  UpdateBuilder,
  DeleteBuilder,
  QueryResult,
  InsertResult,
  UpdateResult,
  DeleteResult,
  DatabaseMode,
} from './types';
export { getDatabaseMode } from './types';
export { SupabaseDatabaseClient } from './supabase-db';
export { PostgresDatabaseClient } from './postgres-db';
