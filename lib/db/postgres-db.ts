/**
 * Direct PostgreSQL Database Client
 *
 * Implements DatabaseClient interface using pg package for Docker mode
 */

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

// Dynamic import for pg to avoid bundling issues
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

class PostgresSelectBuilder<T> implements SelectBuilder<T> {
  private tableName: string;
  private columns: string;
  private whereConditions: string[] = [];
  private params: unknown[] = [];
  private orderByClause = '';
  private limitClause = '';
  private offsetClause = '';

  constructor(tableName: string, columns: string = '*') {
    this.tableName = tableName;
    this.columns = columns;
  }

  private addCondition(column: string, operator: string, value: unknown): this {
    const paramIndex = this.params.length + 1;
    this.whereConditions.push(`"${column}" ${operator} $${paramIndex}`);
    this.params.push(value);
    return this;
  }

  eq(column: string, value: unknown): SelectBuilder<T> {
    return this.addCondition(column, '=', value);
  }

  neq(column: string, value: unknown): SelectBuilder<T> {
    return this.addCondition(column, '!=', value);
  }

  gt(column: string, value: unknown): SelectBuilder<T> {
    return this.addCondition(column, '>', value);
  }

  gte(column: string, value: unknown): SelectBuilder<T> {
    return this.addCondition(column, '>=', value);
  }

  lt(column: string, value: unknown): SelectBuilder<T> {
    return this.addCondition(column, '<', value);
  }

  lte(column: string, value: unknown): SelectBuilder<T> {
    return this.addCondition(column, '<=', value);
  }

  like(column: string, pattern: string): SelectBuilder<T> {
    return this.addCondition(column, 'LIKE', pattern);
  }

  ilike(column: string, pattern: string): SelectBuilder<T> {
    return this.addCondition(column, 'ILIKE', pattern);
  }

  is(column: string, value: unknown): SelectBuilder<T> {
    if (value === null) {
      this.whereConditions.push(`"${column}" IS NULL`);
    } else {
      this.whereConditions.push(`"${column}" IS ${value}`);
    }
    return this;
  }

  in(column: string, values: unknown[]): SelectBuilder<T> {
    const paramIndex = this.params.length + 1;
    this.whereConditions.push(`"${column}" = ANY($${paramIndex})`);
    this.params.push(values);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): SelectBuilder<T> {
    const direction = options?.ascending === false ? 'DESC' : 'ASC';
    this.orderByClause = ` ORDER BY "${column}" ${direction}`;
    return this;
  }

  limit(count: number): SelectBuilder<T> {
    this.limitClause = ` LIMIT ${count}`;
    return this;
  }

  offset(count: number): SelectBuilder<T> {
    this.offsetClause = ` OFFSET ${count}`;
    return this;
  }

  private buildQuery(): string {
    let sql = `SELECT ${this.columns} FROM "${this.tableName}"`;

    if (this.whereConditions.length > 0) {
      sql += ` WHERE ${this.whereConditions.join(' AND ')}`;
    }

    sql += this.orderByClause;
    sql += this.limitClause;
    sql += this.offsetClause;

    return sql;
  }

  async single(): Promise<QueryResult<T>> {
    try {
      const pgPool = await getPool();
      const sql = this.buildQuery() + ' LIMIT 1';
      const result = await pgPool.query(sql, this.params);

      if (result.rows.length === 0) {
        return {
          data: null,
          error: new Error('No rows returned'),
        };
      }

      return {
        data: result.rows[0] as T,
        error: null,
      };
    } catch (error) {
      return {
        data: null,
        error: error as Error,
      };
    }
  }

  async execute(): Promise<QueryResult<T[]>> {
    try {
      const pgPool = await getPool();
      const sql = this.buildQuery();
      const result = await pgPool.query(sql, this.params);

      return {
        data: result.rows as T[],
        error: null,
        count: result.rowCount ?? undefined,
      };
    } catch (error) {
      return {
        data: null,
        error: error as Error,
      };
    }
  }
}

class PostgresInsertBuilder<T> implements InsertBuilder<T> {
  private tableName: string;
  private data: Partial<T> | Partial<T>[];
  private selectColumns?: string;

  constructor(tableName: string, data: Partial<T> | Partial<T>[]) {
    this.tableName = tableName;
    this.data = data;
  }

  select(columns?: string): InsertBuilder<T> {
    this.selectColumns = columns || '*';
    return this;
  }

  private buildQuery(): { sql: string; params: unknown[] } {
    const rows = Array.isArray(this.data) ? this.data : [this.data];
    const keys = Object.keys(rows[0] as Record<string, unknown>);
    const columns = keys.map((k) => `"${k}"`).join(', ');

    const params: unknown[] = [];
    const valuePlaceholders = rows.map((row) => {
      const rowValues = keys.map((key) => {
        params.push((row as Record<string, unknown>)[key]);
        return `$${params.length}`;
      });
      return `(${rowValues.join(', ')})`;
    });

    let sql = `INSERT INTO "${this.tableName}" (${columns}) VALUES ${valuePlaceholders.join(', ')}`;

    if (this.selectColumns) {
      sql += ` RETURNING ${this.selectColumns}`;
    }

    return { sql, params };
  }

  async single(): Promise<InsertResult<T>> {
    try {
      const pgPool = await getPool();
      const { sql, params } = this.buildQuery();
      const result = await pgPool.query(sql, params);

      return {
        data: result.rows[0] as T ?? null,
        error: null,
      };
    } catch (error) {
      return {
        data: null,
        error: error as Error,
      };
    }
  }

  async execute(): Promise<InsertResult<T>> {
    return this.single();
  }
}

class PostgresUpdateBuilder<T> implements UpdateBuilder<T> {
  private tableName: string;
  private data: Partial<T>;
  private whereConditions: string[] = [];
  private params: unknown[] = [];
  private selectColumns?: string;

  constructor(tableName: string, data: Partial<T>) {
    this.tableName = tableName;
    this.data = data;

    // Add data values to params
    const entries = Object.entries(data as Record<string, unknown>);
    entries.forEach(([, value]) => {
      this.params.push(value);
    });
  }

  eq(column: string, value: unknown): UpdateBuilder<T> {
    this.params.push(value);
    this.whereConditions.push(`"${column}" = $${this.params.length}`);
    return this;
  }

  neq(column: string, value: unknown): UpdateBuilder<T> {
    this.params.push(value);
    this.whereConditions.push(`"${column}" != $${this.params.length}`);
    return this;
  }

  select(columns?: string): UpdateBuilder<T> {
    this.selectColumns = columns || '*';
    return this;
  }

  private buildQuery(): string {
    const entries = Object.entries(this.data as Record<string, unknown>);
    const setClauses = entries.map(([key], index) => `"${key}" = $${index + 1}`);

    let sql = `UPDATE "${this.tableName}" SET ${setClauses.join(', ')}`;

    if (this.whereConditions.length > 0) {
      sql += ` WHERE ${this.whereConditions.join(' AND ')}`;
    }

    if (this.selectColumns) {
      sql += ` RETURNING ${this.selectColumns}`;
    }

    return sql;
  }

  async single(): Promise<UpdateResult<T>> {
    try {
      const pgPool = await getPool();
      const sql = this.buildQuery();
      const result = await pgPool.query(sql, this.params);

      return {
        data: result.rows[0] as T ?? null,
        error: null,
      };
    } catch (error) {
      return {
        data: null,
        error: error as Error,
      };
    }
  }

  async execute(): Promise<UpdateResult<T>> {
    try {
      const pgPool = await getPool();
      const sql = this.buildQuery();
      const result = await pgPool.query(sql, this.params);

      return {
        data: result.rows as T[],
        error: null,
      };
    } catch (error) {
      return {
        data: null,
        error: error as Error,
      };
    }
  }
}

class PostgresDeleteBuilder implements DeleteBuilder {
  private tableName: string;
  private whereConditions: string[] = [];
  private params: unknown[] = [];

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  eq(column: string, value: unknown): DeleteBuilder {
    this.params.push(value);
    this.whereConditions.push(`"${column}" = $${this.params.length}`);
    return this;
  }

  neq(column: string, value: unknown): DeleteBuilder {
    this.params.push(value);
    this.whereConditions.push(`"${column}" != $${this.params.length}`);
    return this;
  }

  async execute(): Promise<DeleteResult> {
    try {
      const pgPool = await getPool();
      let sql = `DELETE FROM "${this.tableName}"`;

      if (this.whereConditions.length > 0) {
        sql += ` WHERE ${this.whereConditions.join(' AND ')}`;
      }

      await pgPool.query(sql, this.params);

      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  }
}

class PostgresTableClient<T> implements TableClient<T> {
  private tableName: string;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  select(columns?: string): SelectBuilder<T> {
    return new PostgresSelectBuilder<T>(this.tableName, columns);
  }

  insert(data: Partial<T> | Partial<T>[]): InsertBuilder<T> {
    return new PostgresInsertBuilder<T>(this.tableName, data);
  }

  update(data: Partial<T>): UpdateBuilder<T> {
    return new PostgresUpdateBuilder<T>(this.tableName, data);
  }

  delete(): DeleteBuilder {
    return new PostgresDeleteBuilder(this.tableName);
  }
}

export class PostgresDatabaseClient implements DatabaseClient {
  from<T = Record<string, unknown>>(table: string): TableClient<T> {
    return new PostgresTableClient<T>(table);
  }

  async rawQuery<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T[]>> {
    try {
      const pgPool = await getPool();
      const result = await pgPool.query(sql, params);

      return {
        data: result.rows as T[],
        error: null,
        count: result.rowCount ?? undefined,
      };
    } catch (error) {
      return {
        data: null,
        error: error as Error,
      };
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
