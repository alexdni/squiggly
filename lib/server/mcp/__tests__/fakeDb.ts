// In-memory DatabaseClient for MCP tests. Each select projects its column list, so a column the
// loaders do not ask for can never reach output, and every select is recorded for assertions.

import type { DatabaseClient, QueryResult } from '@/lib/db/types';

type Row = Record<string, unknown>;

/** In-memory db: projects each select's column list (so unselected columns never leak) and records every select. */
export function fakeDb(tables: Record<string, object[]>) {
  const selects: { table: string; columns: string; limit?: number }[] = [];
  const errors: Record<string, Error> = {};
  const db = {
    from(table: string) {
      return {
        select(columns = '*') {
          const rec: { table: string; columns: string; limit?: number } = { table, columns };
          selects.push(rec);
          let out = [...(tables[table] ?? [])] as Row[];
          const b = {
            eq: (c: string, v: unknown) => ((out = out.filter((r) => r[c] === v)), b),
            in: (c: string, vs: unknown[]) => ((out = out.filter((r) => vs.includes(r[c]))), b),
            order: (c: string, o?: { ascending?: boolean }) => {
              const dir = o?.ascending === false ? -1 : 1;
              out.sort((x, y) => dir * (Date.parse(String(x[c])) - Date.parse(String(y[c]))));
              return b;
            },
            limit: (n: number) => ((rec.limit = n), (out = out.slice(0, n)), b),
            async single(): Promise<QueryResult> {
              if (errors[table]) return { data: null, error: errors[table] };
              return out.length === 1 ? { data: project(out[0]), error: null } : { data: null, error: new Error('no row') };
            },
            async execute(): Promise<QueryResult<Row[]> > {
              if (errors[table]) return { data: null, error: errors[table] };
              return { data: out.map(project) as never, error: null };
            },
          };
          const cols = columns.split(',').map((c) => c.trim());
          const project = (r: Row): Row => (columns === '*' ? r : Object.fromEntries(cols.map((c) => [c, r[c]])));
          return b as never;
        },
      };
    },
  } as unknown as DatabaseClient;
  return { db, selects, errors };
}
