// Test stand-in for lib/db/drizzle.ts: records every query instead of talking to Postgres.
import { getTableName, type Table } from 'drizzle-orm';

export type Op = {
  op: 'select' | 'insert' | 'update';
  table?: string;
  values?: Record<string, unknown>;
};

export const ops: Op[] = [];
/** Rows the next selects return, in order. A select with nothing queued returns []. */
export const selectResults: unknown[][] = [];
let id = 0;

export function resetDb() {
  ops.length = 0;
  selectResults.length = 0;
}

export const inserted = (table: string) =>
  ops.filter((o) => o.op === 'insert' && o.table === table);

// deno-lint-ignore no-explicit-any
function builder(op: Op, result: () => unknown[]): any {
  // deno-lint-ignore no-explicit-any
  const b: any = {
    from(t: Table) {
      op.table = getTableName(t);
      return b;
    },
    values(v: Record<string, unknown>) {
      op.values = v;
      return b;
    },
    set(v: Record<string, unknown>) {
      op.values = v;
      return b;
    },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      return Promise.resolve(result()).then(res, rej);
    }
  };
  for (const m of ['where', 'limit', 'leftJoin', 'innerJoin', 'orderBy', 'returning']) {
    b[m] = () => b;
  }
  return b;
}

export const db = {
  select() {
    const op: Op = { op: 'select' };
    ops.push(op);
    return builder(op, () => selectResults.shift() ?? []);
  },
  insert(t: Table) {
    const op: Op = { op: 'insert', table: getTableName(t) };
    ops.push(op);
    return builder(op, () => [{ id: ++id, ...op.values }]);
  },
  update(t: Table) {
    const op: Op = { op: 'update', table: getTableName(t) };
    ops.push(op);
    return builder(op, () => []);
  }
};
