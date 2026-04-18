/**
 * Minimal in-memory Supabase-compatible fake for unit tests.
 *
 * The real @supabase/supabase-js client is a thick wrapper over PostgREST.
 * For the state-machine tests we don't need the network — we need a
 * deterministic data store that responds to the same method chain the
 * production code uses:
 *
 *   supabase.from('t').select(...).eq(...).in(...).update(...).insert(...)
 *
 * This file implements exactly the subset of the query builder that the
 * monthly close + apply API touch. If you see a call that throws with
 * "not implemented in test mock", extend it here rather than in the
 * production code.
 *
 * Also supports .rpc('name', args) for the two Guild SQL functions we use.
 */

type Row = Record<string, any>;

export interface TableState {
  rows: Row[];
}

export interface FakeSupabase {
  state: Record<string, TableState>;
  from(table: string): QueryBuilder;
  rpc(
    name: string,
    args: Record<string, any>,
  ): Promise<{ data: any; error: null }>;
}

class QueryBuilder {
  private filters: Array<{ col: string; op: string; val: any }> = [];
  private orFilters: Array<{ col: string; vals: any[] }> = [];
  private orderBy: { col: string; asc: boolean } | null = null;
  private limit_: number | null = null;
  private op:
    | 'select'
    | 'insert'
    | 'update'
    | 'upsert'
    | 'delete'
    | null = null;
  private insertRow: Row | Row[] | null = null;
  private updateValues: Row = {};
  private upsertConflict: string | null = null;

  constructor(
    private store: FakeSupabase,
    private table: string,
  ) {}

  select(_cols?: string): QueryBuilder {
    if (!this.op) this.op = 'select';
    return this;
  }

  insert(row: Row | Row[]): QueryBuilder {
    this.op = 'insert';
    this.insertRow = row;
    return this;
  }

  upsert(row: Row, opts?: { onConflict?: string }): QueryBuilder {
    this.op = 'upsert';
    this.insertRow = row;
    this.upsertConflict = opts?.onConflict ?? null;
    return this;
  }

  update(values: Row): QueryBuilder {
    this.op = 'update';
    this.updateValues = values;
    return this;
  }

  eq(col: string, val: any): QueryBuilder {
    this.filters.push({ col, op: 'eq', val });
    return this;
  }

  in(col: string, vals: any[]): QueryBuilder {
    this.filters.push({ col, op: 'in', val: vals });
    return this;
  }

  is(col: string, val: any): QueryBuilder {
    this.filters.push({ col, op: 'is', val });
    return this;
  }

  lte(col: string, val: any): QueryBuilder {
    this.filters.push({ col, op: 'lte', val });
    return this;
  }

  order(col: string, opts: { ascending: boolean }): QueryBuilder {
    this.orderBy = { col, asc: opts.ascending };
    return this;
  }

  limit(n: number): QueryBuilder {
    this.limit_ = n;
    return this;
  }

  single(): Promise<{ data: Row | null; error: any }> {
    return this.execute().then((r) => ({
      data: r.data && r.data.length ? r.data[0] : null,
      error: r.error,
    }));
  }

  maybeSingle(): Promise<{ data: Row | null; error: any }> {
    return this.single();
  }

  // Awaitable — the production code awaits the builder directly in many places
  then<T>(resolve: (v: { data: Row[]; error: any }) => T): Promise<T> {
    return this.execute().then(resolve);
  }

  private matches(row: Row): boolean {
    for (const f of this.filters) {
      if (f.op === 'eq' && row[f.col] !== f.val) return false;
      if (f.op === 'in' && !f.val.includes(row[f.col])) return false;
      if (f.op === 'is' && row[f.col] !== f.val) return false;
      if (f.op === 'lte' && !(row[f.col] <= f.val)) return false;
    }
    return true;
  }

  private async execute(): Promise<{ data: Row[]; error: any }> {
    const t = (this.store.state[this.table] ||= { rows: [] });

    if (this.op === 'select' || this.op === null) {
      let rows = t.rows.filter((r) => this.matches(r));
      if (this.orderBy) {
        const k = this.orderBy.col;
        rows = [...rows].sort((a, b) =>
          this.orderBy!.asc
            ? String(a[k]).localeCompare(String(b[k]))
            : String(b[k]).localeCompare(String(a[k])),
        );
      }
      if (this.limit_ !== null) rows = rows.slice(0, this.limit_);
      return { data: rows, error: null };
    }

    if (this.op === 'insert') {
      const toInsert = Array.isArray(this.insertRow)
        ? this.insertRow
        : [this.insertRow!];
      const inserted: Row[] = [];

      for (const row of toInsert) {
        // Enforce UNIQUE constraints we care about
        if (this.table === 'guild_monthly_close_runs') {
          if (t.rows.some((r) => r.run_month === row.run_month)) {
            return {
              data: [],
              error: { code: '23505', message: 'duplicate run_month' },
            };
          }
        }
        if (this.table === 'stripe_webhook_events') {
          if (t.rows.some((r) => r.stripe_event_id === row.stripe_event_id)) {
            return {
              data: [],
              error: { code: '23505', message: 'duplicate stripe_event_id' },
            };
          }
        }
        const withId: Row = { id: row.id || `mock_${Math.random().toString(36).slice(2)}`, ...row };
        t.rows.push(withId);
        inserted.push(withId);
      }
      return { data: inserted, error: null };
    }

    if (this.op === 'upsert') {
      const row = this.insertRow as Row;
      const keys = (this.upsertConflict || '').split(',').map((s) => s.trim());
      const existing = t.rows.find((r) => keys.every((k) => r[k] === row[k]));
      if (existing) {
        Object.assign(existing, row);
        return { data: [existing], error: null };
      }
      const withId: Row = { id: `mock_${Math.random().toString(36).slice(2)}`, ...row };
      t.rows.push(withId);
      return { data: [withId], error: null };
    }

    if (this.op === 'update') {
      const matched = t.rows.filter((r) => this.matches(r));
      for (const r of matched) Object.assign(r, this.updateValues);
      return { data: matched, error: null };
    }

    if (this.op === 'delete') {
      const before = t.rows.length;
      t.rows = t.rows.filter((r) => !this.matches(r));
      return { data: Array.from({ length: before - t.rows.length }), error: null };
    }

    throw new Error(`unsupported op ${this.op}`);
  }
}

export function createFakeSupabase(): FakeSupabase {
  const store: FakeSupabase = {
    state: {},
    from(table: string) {
      return new QueryBuilder(this, table) as any;
    },
    async rpc(name: string, args: Record<string, any>) {
      // Mirror the production DB functions' behaviour
      if (name === 'guild_compute_account_fee') {
        const fees: Record<string, number> = {
          apprentice: 20,
          journeyman: 25,
          artisan: 30,
          master: 35,
          fellow: 40,
          emeritus: 0,
        };
        return { data: fees[args.p_tier] ?? 0, error: null };
      }
      if (name === 'guild_deferred_balance_usd') {
        const rows = store.state['guild_account_fees']?.rows || [];
        const total = rows
          .filter(
            (r) =>
              r.guildmember_id === args.p_guildmember_id &&
              !['waived', 'cancelled', 'fully_deducted'].includes(r.status),
          )
          .reduce((s, r) => s + Number(r.amount_deferred_usd || 0), 0);
        return { data: total, error: null };
      }
      if (name === 'increment_referral_commission') {
        return { data: null, error: null };
      }
      throw new Error(`rpc not mocked: ${name}`);
    },
  };
  return store;
}
