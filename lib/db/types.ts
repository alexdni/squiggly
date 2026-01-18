/**
 * Database Client Interface
 *
 * Abstracts database operations to work with both Supabase (cloud)
 * and direct PostgreSQL (Docker mode)
 */

export interface QueryResult<T = Record<string, unknown>> {
  data: T | T[] | null;
  error: Error | null;
  count?: number;
}

export interface InsertResult<T = Record<string, unknown>> {
  data: T | null;
  error: Error | null;
}

export interface UpdateResult<T = Record<string, unknown>> {
  data: T | T[] | null;
  error: Error | null;
}

export interface DeleteResult {
  error: Error | null;
}

export interface SelectBuilder<T = Record<string, unknown>> {
  eq(column: string, value: unknown): SelectBuilder<T>;
  neq(column: string, value: unknown): SelectBuilder<T>;
  gt(column: string, value: unknown): SelectBuilder<T>;
  gte(column: string, value: unknown): SelectBuilder<T>;
  lt(column: string, value: unknown): SelectBuilder<T>;
  lte(column: string, value: unknown): SelectBuilder<T>;
  like(column: string, pattern: string): SelectBuilder<T>;
  ilike(column: string, pattern: string): SelectBuilder<T>;
  is(column: string, value: unknown): SelectBuilder<T>;
  in(column: string, values: unknown[]): SelectBuilder<T>;
  order(column: string, options?: { ascending?: boolean }): SelectBuilder<T>;
  limit(count: number): SelectBuilder<T>;
  offset(count: number): SelectBuilder<T>;
  single(): Promise<QueryResult<T>>;
  execute(): Promise<QueryResult<T[]>>;
}

export interface InsertBuilder<T = Record<string, unknown>> {
  select(columns?: string): InsertBuilder<T>;
  single(): Promise<InsertResult<T>>;
  execute(): Promise<InsertResult<T>>;
}

export interface UpdateBuilder<T = Record<string, unknown>> {
  eq(column: string, value: unknown): UpdateBuilder<T>;
  neq(column: string, value: unknown): UpdateBuilder<T>;
  select(columns?: string): UpdateBuilder<T>;
  single(): Promise<UpdateResult<T>>;
  execute(): Promise<UpdateResult<T>>;
}

export interface DeleteBuilder {
  eq(column: string, value: unknown): DeleteBuilder;
  neq(column: string, value: unknown): DeleteBuilder;
  execute(): Promise<DeleteResult>;
}

export interface TableClient<T = Record<string, unknown>> {
  select(columns?: string): SelectBuilder<T>;
  insert(data: Partial<T> | Partial<T>[]): InsertBuilder<T>;
  update(data: Partial<T>): UpdateBuilder<T>;
  delete(): DeleteBuilder;
}

export interface DatabaseClient {
  from<T = Record<string, unknown>>(table: string): TableClient<T>;

  /**
   * Execute a raw SQL query (for migrations and special cases)
   */
  rawQuery<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T[]>>;

  /**
   * Check if the database connection is healthy
   */
  healthCheck(): Promise<boolean>;
}

export type DatabaseMode = 'supabase' | 'postgres';

export function getDatabaseMode(): DatabaseMode {
  const mode = process.env.DATABASE_MODE;
  if (mode === 'postgres') {
    return 'postgres';
  }
  return 'supabase';
}
