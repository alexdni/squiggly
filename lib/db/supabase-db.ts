/**
 * Supabase Database Client
 *
 * Wraps the existing Supabase client to implement DatabaseClient interface
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type {
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
} from './types';

class SupabaseSelectBuilder<T> implements SelectBuilder<T> {
  private query: any;

  constructor(query: any) {
    this.query = query;
  }

  eq(column: string, value: unknown): SelectBuilder<T> {
    this.query = this.query.eq(column, value);
    return this;
  }

  neq(column: string, value: unknown): SelectBuilder<T> {
    this.query = this.query.neq(column, value);
    return this;
  }

  gt(column: string, value: unknown): SelectBuilder<T> {
    this.query = this.query.gt(column, value);
    return this;
  }

  gte(column: string, value: unknown): SelectBuilder<T> {
    this.query = this.query.gte(column, value);
    return this;
  }

  lt(column: string, value: unknown): SelectBuilder<T> {
    this.query = this.query.lt(column, value);
    return this;
  }

  lte(column: string, value: unknown): SelectBuilder<T> {
    this.query = this.query.lte(column, value);
    return this;
  }

  like(column: string, pattern: string): SelectBuilder<T> {
    this.query = this.query.like(column, pattern);
    return this;
  }

  ilike(column: string, pattern: string): SelectBuilder<T> {
    this.query = this.query.ilike(column, pattern);
    return this;
  }

  is(column: string, value: unknown): SelectBuilder<T> {
    this.query = this.query.is(column, value);
    return this;
  }

  in(column: string, values: unknown[]): SelectBuilder<T> {
    this.query = this.query.in(column, values);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): SelectBuilder<T> {
    this.query = this.query.order(column, options);
    return this;
  }

  limit(count: number): SelectBuilder<T> {
    this.query = this.query.limit(count);
    return this;
  }

  offset(count: number): SelectBuilder<T> {
    this.query = this.query.range(count, count + 1000);
    return this;
  }

  async single(): Promise<QueryResult<T>> {
    const { data, error } = await this.query.single();
    return {
      data: data as T,
      error: error ? new Error(error.message) : null,
    };
  }

  async execute(): Promise<QueryResult<T[]>> {
    const { data, error, count } = await this.query;
    return {
      data: data as T[],
      error: error ? new Error(error.message) : null,
      count: count ?? undefined,
    };
  }
}

class SupabaseInsertBuilder<T> implements InsertBuilder<T> {
  private query: any;

  constructor(query: any) {
    this.query = query;
  }

  select(columns?: string): InsertBuilder<T> {
    this.query = this.query.select(columns);
    return this;
  }

  async single(): Promise<InsertResult<T>> {
    const { data, error } = await this.query.single();
    return {
      data: data as T,
      error: error ? new Error(error.message) : null,
    };
  }

  async execute(): Promise<InsertResult<T>> {
    const { data, error } = await this.query;
    return {
      data: data as T,
      error: error ? new Error(error.message) : null,
    };
  }
}

class SupabaseUpdateBuilder<T> implements UpdateBuilder<T> {
  private query: any;

  constructor(query: any) {
    this.query = query;
  }

  eq(column: string, value: unknown): UpdateBuilder<T> {
    this.query = this.query.eq(column, value);
    return this;
  }

  neq(column: string, value: unknown): UpdateBuilder<T> {
    this.query = this.query.neq(column, value);
    return this;
  }

  select(columns?: string): UpdateBuilder<T> {
    this.query = this.query.select(columns);
    return this;
  }

  async single(): Promise<UpdateResult<T>> {
    const { data, error } = await this.query.single();
    return {
      data: data as T,
      error: error ? new Error(error.message) : null,
    };
  }

  async execute(): Promise<UpdateResult<T>> {
    const { data, error } = await this.query;
    return {
      data: data as T,
      error: error ? new Error(error.message) : null,
    };
  }
}

class SupabaseDeleteBuilder implements DeleteBuilder {
  private query: any;

  constructor(query: any) {
    this.query = query;
  }

  eq(column: string, value: unknown): DeleteBuilder {
    this.query = this.query.eq(column, value);
    return this;
  }

  neq(column: string, value: unknown): DeleteBuilder {
    this.query = this.query.neq(column, value);
    return this;
  }

  async execute(): Promise<DeleteResult> {
    const { error } = await this.query;
    return {
      error: error ? new Error(error.message) : null,
    };
  }
}

class SupabaseTableClient<T> implements TableClient<T> {
  private supabase: any;
  private tableName: string;

  constructor(supabase: any, tableName: string) {
    this.supabase = supabase;
    this.tableName = tableName;
  }

  select(columns?: string): SelectBuilder<T> {
    const query = this.supabase.from(this.tableName).select(columns);
    return new SupabaseSelectBuilder<T>(query);
  }

  insert(data: Partial<T> | Partial<T>[]): InsertBuilder<T> {
    const query = this.supabase.from(this.tableName).insert(data);
    return new SupabaseInsertBuilder<T>(query);
  }

  update(data: Partial<T>): UpdateBuilder<T> {
    const query = this.supabase.from(this.tableName).update(data);
    return new SupabaseUpdateBuilder<T>(query);
  }

  delete(): DeleteBuilder {
    const query = this.supabase.from(this.tableName).delete();
    return new SupabaseDeleteBuilder(query);
  }
}

export class SupabaseDatabaseClient implements DatabaseClient {
  private supabase: any;

  constructor(supabase?: any) {
    this.supabase = supabase;
  }

  private async getClient() {
    if (this.supabase) {
      return this.supabase;
    }

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

  from<T = Record<string, unknown>>(table: string): TableClient<T> {
    // Note: This is synchronous, but getClient is async
    // We'll need to get the client lazily in the builders
    return new LazySupabaseTableClient<T>(this.getClient.bind(this), table);
  }

  async rawQuery<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T[]>> {
    const supabase = await this.getClient();
    const { data, error } = await supabase.rpc('exec_sql', { query: sql, params });
    return {
      data: data as T[],
      error: error ? new Error(error.message) : null,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const supabase = await this.getClient();
      const { error } = await supabase.from('projects').select('id').limit(1);
      return !error;
    } catch {
      return false;
    }
  }
}

// Lazy loading wrapper to handle async client creation
class LazySupabaseTableClient<T> implements TableClient<T> {
  private getClientFn: () => Promise<any>;
  private tableName: string;

  constructor(getClientFn: () => Promise<any>, tableName: string) {
    this.getClientFn = getClientFn;
    this.tableName = tableName;
  }

  select(columns?: string): SelectBuilder<T> {
    return new LazySelectBuilder<T>(this.getClientFn, this.tableName, columns);
  }

  insert(data: Partial<T> | Partial<T>[]): InsertBuilder<T> {
    return new LazyInsertBuilder<T>(this.getClientFn, this.tableName, data);
  }

  update(data: Partial<T>): UpdateBuilder<T> {
    return new LazyUpdateBuilder<T>(this.getClientFn, this.tableName, data);
  }

  delete(): DeleteBuilder {
    return new LazyDeleteBuilder(this.getClientFn, this.tableName);
  }
}

// Lazy builders that resolve the client on execution
class LazySelectBuilder<T> implements SelectBuilder<T> {
  private getClientFn: () => Promise<any>;
  private tableName: string;
  private columns?: string;
  private filters: Array<{ method: string; args: unknown[] }> = [];

  constructor(getClientFn: () => Promise<any>, tableName: string, columns?: string) {
    this.getClientFn = getClientFn;
    this.tableName = tableName;
    this.columns = columns;
  }

  private addFilter(method: string, ...args: unknown[]): SelectBuilder<T> {
    this.filters.push({ method, args });
    return this;
  }

  eq(column: string, value: unknown): SelectBuilder<T> {
    return this.addFilter('eq', column, value);
  }

  neq(column: string, value: unknown): SelectBuilder<T> {
    return this.addFilter('neq', column, value);
  }

  gt(column: string, value: unknown): SelectBuilder<T> {
    return this.addFilter('gt', column, value);
  }

  gte(column: string, value: unknown): SelectBuilder<T> {
    return this.addFilter('gte', column, value);
  }

  lt(column: string, value: unknown): SelectBuilder<T> {
    return this.addFilter('lt', column, value);
  }

  lte(column: string, value: unknown): SelectBuilder<T> {
    return this.addFilter('lte', column, value);
  }

  like(column: string, pattern: string): SelectBuilder<T> {
    return this.addFilter('like', column, pattern);
  }

  ilike(column: string, pattern: string): SelectBuilder<T> {
    return this.addFilter('ilike', column, pattern);
  }

  is(column: string, value: unknown): SelectBuilder<T> {
    return this.addFilter('is', column, value);
  }

  in(column: string, values: unknown[]): SelectBuilder<T> {
    return this.addFilter('in', column, values);
  }

  order(column: string, options?: { ascending?: boolean }): SelectBuilder<T> {
    return this.addFilter('order', column, options);
  }

  limit(count: number): SelectBuilder<T> {
    return this.addFilter('limit', count);
  }

  offset(count: number): SelectBuilder<T> {
    return this.addFilter('offset', count);
  }

  private async buildQuery() {
    const client = await this.getClientFn();
    let query = client.from(this.tableName).select(this.columns);

    for (const filter of this.filters) {
      if (filter.method === 'offset') {
        const offset = filter.args[0] as number;
        query = query.range(offset, offset + 1000);
      } else {
        query = query[filter.method](...filter.args);
      }
    }

    return query;
  }

  async single(): Promise<QueryResult<T>> {
    const query = await this.buildQuery();
    const { data, error } = await query.single();
    return {
      data: data as T,
      error: error ? new Error(error.message) : null,
    };
  }

  async execute(): Promise<QueryResult<T[]>> {
    const query = await this.buildQuery();
    const { data, error, count } = await query;
    return {
      data: data as T[],
      error: error ? new Error(error.message) : null,
      count: count ?? undefined,
    };
  }
}

class LazyInsertBuilder<T> implements InsertBuilder<T> {
  private getClientFn: () => Promise<any>;
  private tableName: string;
  private data: Partial<T> | Partial<T>[];
  private selectColumns?: string;

  constructor(getClientFn: () => Promise<any>, tableName: string, data: Partial<T> | Partial<T>[]) {
    this.getClientFn = getClientFn;
    this.tableName = tableName;
    this.data = data;
  }

  select(columns?: string): InsertBuilder<T> {
    this.selectColumns = columns;
    return this;
  }

  private async buildQuery() {
    const client = await this.getClientFn();
    let query = client.from(this.tableName).insert(this.data);
    if (this.selectColumns !== undefined) {
      query = query.select(this.selectColumns);
    }
    return query;
  }

  async single(): Promise<InsertResult<T>> {
    const query = await this.buildQuery();
    const { data, error } = await query.single();
    return {
      data: data as T,
      error: error ? new Error(error.message) : null,
    };
  }

  async execute(): Promise<InsertResult<T>> {
    const query = await this.buildQuery();
    const { data, error } = await query;
    return {
      data: data as T,
      error: error ? new Error(error.message) : null,
    };
  }
}

class LazyUpdateBuilder<T> implements UpdateBuilder<T> {
  private getClientFn: () => Promise<any>;
  private tableName: string;
  private data: Partial<T>;
  private filters: Array<{ method: string; args: unknown[] }> = [];
  private selectColumns?: string;

  constructor(getClientFn: () => Promise<any>, tableName: string, data: Partial<T>) {
    this.getClientFn = getClientFn;
    this.tableName = tableName;
    this.data = data;
  }

  eq(column: string, value: unknown): UpdateBuilder<T> {
    this.filters.push({ method: 'eq', args: [column, value] });
    return this;
  }

  neq(column: string, value: unknown): UpdateBuilder<T> {
    this.filters.push({ method: 'neq', args: [column, value] });
    return this;
  }

  select(columns?: string): UpdateBuilder<T> {
    this.selectColumns = columns;
    return this;
  }

  private async buildQuery() {
    const client = await this.getClientFn();
    let query = client.from(this.tableName).update(this.data);

    for (const filter of this.filters) {
      query = query[filter.method](...filter.args);
    }

    if (this.selectColumns !== undefined) {
      query = query.select(this.selectColumns);
    }

    return query;
  }

  async single(): Promise<UpdateResult<T>> {
    const query = await this.buildQuery();
    const { data, error } = await query.single();
    return {
      data: data as T,
      error: error ? new Error(error.message) : null,
    };
  }

  async execute(): Promise<UpdateResult<T>> {
    const query = await this.buildQuery();
    const { data, error } = await query;
    return {
      data: data as T,
      error: error ? new Error(error.message) : null,
    };
  }
}

class LazyDeleteBuilder implements DeleteBuilder {
  private getClientFn: () => Promise<any>;
  private tableName: string;
  private filters: Array<{ method: string; args: unknown[] }> = [];

  constructor(getClientFn: () => Promise<any>, tableName: string) {
    this.getClientFn = getClientFn;
    this.tableName = tableName;
  }

  eq(column: string, value: unknown): DeleteBuilder {
    this.filters.push({ method: 'eq', args: [column, value] });
    return this;
  }

  neq(column: string, value: unknown): DeleteBuilder {
    this.filters.push({ method: 'neq', args: [column, value] });
    return this;
  }

  async execute(): Promise<DeleteResult> {
    const client = await this.getClientFn();
    let query = client.from(this.tableName).delete();

    for (const filter of this.filters) {
      query = query[filter.method](...filter.args);
    }

    const { error } = await query;
    return {
      error: error ? new Error(error.message) : null,
    };
  }
}
