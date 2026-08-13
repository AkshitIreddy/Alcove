/**
 * Database access. Lazy singleton:
 *
 * - Inside Tauri: `@tauri-apps/plugin-sql` against the installer-selected
 *   library folder (schema/migrations are registered against that exact URL
 *   on the Rust side in src-tauri/src/lib.rs).
 * - Outside Tauri (plain `vite` in a browser): a stub implementing the same
 *   `select`/`execute` surface, so the UI runs in dev without Rust. The stub
 *   understands the small SQL dialect the repos in this directory actually
 *   use and degrades to empty results (never throws) on anything else. Its
 *   tables persist to localStorage, so a book created in the browser survives
 *   a reload just like it does on the real SQLite file.
 */

/** Browser/dev fallback, and the pre-custom-location legacy URL. */
export const DB_PATH = 'sqlite:notebook.db';

export interface LibraryInfo {
  root: string;
  assetsRoot: string;
  dbUrl: string;
}

let libraryInfoPromise: Promise<LibraryInfo> | null = null;

/** The one Rust-resolved root used by SQLite, media, backups and imports. */
export async function getLibraryInfo(): Promise<LibraryInfo> {
  if (!isTauri()) return { root: '', assetsRoot: '', dbUrl: DB_PATH };
  libraryInfoPromise ??= (async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<LibraryInfo>('library_info');
  })();
  return libraryInfoPromise;
}

export async function getDbPath(): Promise<string> {
  return (await getLibraryInfo()).dbUrl;
}

export interface DbExecuteResult {
  rowsAffected: number;
  lastInsertId?: number;
}

/** The subset of `@tauri-apps/plugin-sql` Database the app relies on. */
export interface Db {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  execute(query: string, bindValues?: unknown[]): Promise<DbExecuteResult>;
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

let instance: Promise<Db> | null = null;

export function getDb(): Promise<Db> {
  instance ??= isTauri() ? loadTauriDb() : Promise.resolve(new MemoryDb());
  return instance;
}

async function loadTauriDb(): Promise<Db> {
  // Dynamic import so the browser dev build never touches Tauri internals.
  const { default: Database } = await import('@tauri-apps/plugin-sql');
  return Database.load(await getDbPath());
}

// ---------------------------------------------------------------------------
// In-memory stub (browser dev only)
// ---------------------------------------------------------------------------

/**
 * localStorage key holding the browser stub's tables. Versioned so a future
 * dialect change can abandon an old blob instead of misreading it.
 */
export const STUB_STORAGE_KEY = 'notebook.stubdb.v1';

/**
 * The stub persists only where a real Web Storage implementation exists
 * (browser dev, Playwright). In node — the unit-test environment — there is
 * no localStorage, so the stub stays purely in-memory and tests keep their
 * fresh-module isolation.
 */
function stubStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Accessing localStorage can itself throw (denied storage). Never throw.
    return null;
  }
}

type SqlRow = Record<string, unknown>;
type Predicate = (row: SqlRow) => boolean;

const PRIMARY_KEYS: Record<string, string> = {
  books: 'id',
  pages: 'id',
  settings: 'key',
  assets: 'id',
  ai_agent_reviewed_drafts: 'generation_id',
  ai_agent_patch_journal: 'idempotency_key',
  ai_agent_task_tombstones: 'id',
};

/** ON DELETE CASCADE relationships mirrored from the SQLite schema. */
const CASCADES: ReadonlyArray<{
  parent: string;
  parentPk: string;
  child: string;
  fk: string;
}> = [{ parent: 'books', parentPk: 'id', child: 'pages', fk: 'book_id' }];

interface BindCursor {
  next: number;
}

function resolveValueToken(
  token: string,
  binds: unknown[],
  cursor: BindCursor,
): unknown {
  if (token === '?') return binds[cursor.next++];
  const dollar = /^\$(\d+)$/.exec(token);
  if (dollar) return binds[Number(dollar[1]) - 1];
  if (/^null$/i.test(token)) return null;
  if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
  const quoted = /^'(.*)'$/.exec(token);
  if (quoted) return quoted[1].replace(/''/g, "'");
  return undefined;
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a == null || b == null) return a == null && b == null ? 0 : a == null ? -1 : 1;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function parseWhere(
  src: string,
  binds: unknown[],
  cursor: BindCursor,
): Predicate {
  const tests: Predicate[] = [];
  for (const part of src.split(/\s+AND\s+/i)) {
    const cond = part.trim();
    const nullTest = /^(\w+)\s+IS\s+(NOT\s+)?NULL$/i.exec(cond);
    if (nullTest) {
      const col = nullTest[1];
      const negate = Boolean(nullTest[2]);
      tests.push((row) => (row[col] == null) !== negate);
      continue;
    }
    /*
     * `col IN ($1, $2, …)`. Worth supporting rather than letting it fall to
     * the catch-all below: an unrecognized condition matches NOTHING, which is
     * the safe answer for a DELETE and a silently wrong one for a SELECT. An
     * existence check written with IN would report "absent" for a row that is
     * right there, and the caller would go create a duplicate — which is
     * exactly how this got noticed.
     */
    const inTest = /^(\w+)\s+IN\s*\(([^)]*)\)$/i.exec(cond);
    if (inTest) {
      const col = inTest[1];
      const values = inTest[2]
        .split(',')
        .map((t) => resolveValueToken(t.trim(), binds, cursor));
      tests.push((row) => values.some((v) => row[col] === v));
      continue;
    }
    const cmp = /^(\w+)\s*(=|!=|<>|>=|<=|>|<)\s*(\S+)$/.exec(cond);
    if (!cmp) {
      // Unrecognized condition: match nothing rather than corrupting data.
      tests.push(() => false);
      continue;
    }
    const col = cmp[1];
    const op = cmp[2];
    const value = resolveValueToken(cmp[3], binds, cursor);
    tests.push((row) => {
      const cell = row[col];
      switch (op) {
        case '=':
          return cell === value;
        case '!=':
        case '<>':
          return cell !== value;
        case '>':
          return compareValues(cell, value) > 0;
        case '>=':
          return compareValues(cell, value) >= 0;
        case '<':
          return compareValues(cell, value) < 0;
        case '<=':
          return compareValues(cell, value) <= 0;
        default:
          return false;
      }
    });
  }
  return (row) => tests.every((t) => t(row));
}

function sortRows(rows: SqlRow[], orderBy: string): SqlRow[] {
  const keys = orderBy
    .split(',')
    .map((part) => /^(\w+)(?:\s+(ASC|DESC))?$/i.exec(part.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({
      col: m[1],
      dir: (m[2] ?? 'ASC').toUpperCase() === 'DESC' ? -1 : 1,
    }));
  return [...rows].sort((a, b) => {
    for (const key of keys) {
      const c = compareValues(a[key.col], b[key.col]);
      if (c !== 0) return c * key.dir;
    }
    return 0;
  });
}

export class MemoryDb implements Db {
  private readonly tables = new Map<string, SqlRow[]>();

  constructor() {
    const storage = stubStorage();
    if (storage === null) return;
    try {
      const raw = storage.getItem(STUB_STORAGE_KEY);
      if (raw === null) return;
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return;
      }
      for (const [table, rows] of Object.entries(parsed)) {
        if (!/^\w+$/.test(table) || !Array.isArray(rows)) continue;
        this.tables.set(
          table,
          rows.filter(
            (row): row is SqlRow =>
              row !== null && typeof row === 'object' && !Array.isArray(row),
          ),
        );
      }
    } catch {
      // A corrupt or unreadable blob means "start empty", never a crash.
    }
  }

  /**
   * Write every table back to localStorage after a mutation. Immediate (not
   * debounced) on purpose: the blob is small in dev and a reload must never
   * lose the book that was created a frame ago.
   */
  private persist(): void {
    const storage = stubStorage();
    if (storage === null) return;
    try {
      const out: Record<string, SqlRow[]> = {};
      for (const [table, rows] of this.tables) out[table] = rows;
      storage.setItem(STUB_STORAGE_KEY, JSON.stringify(out));
    } catch {
      // Quota or denied storage: the session still works, it just won't
      // survive a reload — exactly the pre-persistence behavior.
    }
  }

  select<T>(query: string, bindValues: unknown[] = []): Promise<T> {
    return Promise.resolve(this.runSelect(query, bindValues) as T);
  }

  execute(query: string, bindValues: unknown[] = []): Promise<DbExecuteResult> {
    return Promise.resolve(this.runExecute(query, bindValues));
  }

  private rows(table: string): SqlRow[] {
    let rows = this.tables.get(table);
    if (!rows) {
      rows = [];
      this.tables.set(table, rows);
    }
    return rows;
  }

  private runSelect(query: string, binds: unknown[]): unknown[] {
    const m =
      /^SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(.+?))?(?:\s+LIMIT\s+(\d+))?\s*;?\s*$/i.exec(
        query.trim(),
      );
    if (!m) return [];
    const [, colsRaw, table, whereRaw, orderRaw, limitRaw] = m;
    const cursor: BindCursor = { next: 0 };
    const predicate = whereRaw ? parseWhere(whereRaw, binds, cursor) : null;
    let rows = this.rows(table).filter((row) => predicate?.(row) ?? true);
    if (orderRaw) rows = sortRows(rows, orderRaw);
    if (limitRaw) rows = rows.slice(0, Number(limitRaw));
    const cols = colsRaw.trim();
    if (cols === '*') return rows.map((row) => ({ ...row }));
    const picks = cols
      .split(',')
      .map((part) => /^(\w+)(?:\s+AS\s+(\w+))?$/i.exec(part.trim()))
      .filter((p): p is RegExpExecArray => p !== null)
      .map((p) => ({ col: p[1], as: p[2] ?? p[1] }));
    return rows.map((row) => {
      const out: SqlRow = {};
      for (const pick of picks) out[pick.as] = row[pick.col];
      return out;
    });
  }

  private runExecute(query: string, binds: unknown[]): DbExecuteResult {
    const sql = query.trim();

    const insert =
      /^INSERT\s+(OR\s+(REPLACE|IGNORE)\s+)?INTO\s+(\w+)\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)\s*;?\s*$/i.exec(
        sql,
      );
    if (insert) {
      const conflictMode = insert[2]?.toUpperCase();
      const table = insert[3];
      const cols = insert[4].split(',').map((c) => c.trim());
      const cursor: BindCursor = { next: 0 };
      const values = insert[5]
        .split(',')
        .map((v) => resolveValueToken(v.trim(), binds, cursor));
      const row: SqlRow = {};
      cols.forEach((col, i) => {
        row[col] = values[i];
      });
      const rows = this.rows(table);
      const pk = PRIMARY_KEYS[table] ?? 'id';
      const existing = rows.findIndex((r) => r[pk] === row[pk]);
      if (existing >= 0) {
        if (conflictMode !== 'REPLACE') return { rowsAffected: 0 }; // PK conflict / OR IGNORE
        rows[existing] = row;
        this.persist();
        return { rowsAffected: 1 };
      }
      rows.push(row);
      this.persist();
      return { rowsAffected: 1 };
    }

    const update =
      /^UPDATE\s+(\w+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+?))?\s*;?\s*$/i.exec(sql);
    if (update) {
      const table = update[1];
      const cursor: BindCursor = { next: 0 };
      const assignments = update[2]
        .split(',')
        .map((pair) => /^(\w+)\s*=\s*(\S+)$/.exec(pair.trim()))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => ({
          col: m[1],
          value: resolveValueToken(m[2], binds, cursor),
        }));
      const predicate = update[3] ? parseWhere(update[3], binds, cursor) : null;
      let affected = 0;
      for (const row of this.rows(table)) {
        if (predicate && !predicate(row)) continue;
        for (const a of assignments) row[a.col] = a.value;
        affected += 1;
      }
      if (affected > 0) this.persist();
      return { rowsAffected: affected };
    }

    const del = /^DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?\s*;?\s*$/i.exec(
      sql,
    );
    if (del) {
      const table = del[1];
      const cursor: BindCursor = { next: 0 };
      const predicate = del[2] ? parseWhere(del[2], binds, cursor) : null;
      const kept: SqlRow[] = [];
      const removed: SqlRow[] = [];
      for (const row of this.rows(table)) {
        (predicate === null || predicate(row) ? removed : kept).push(row);
      }
      this.tables.set(table, kept);
      for (const cascade of CASCADES) {
        if (cascade.parent !== table || removed.length === 0) continue;
        const removedKeys = new Set(removed.map((r) => r[cascade.parentPk]));
        this.tables.set(
          cascade.child,
          this.rows(cascade.child).filter((r) => !removedKeys.has(r[cascade.fk])),
        );
      }
      if (removed.length > 0) this.persist();
      return { rowsAffected: removed.length };
    }

    // DDL / unsupported statements: harmless no-op in the dev stub.
    return { rowsAffected: 0 };
  }
}
