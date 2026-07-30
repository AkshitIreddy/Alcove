/**
 * src/features/system/backup.ts — the backup scheduler + invoke wrappers.
 *
 * Honors `backupEnabled` / `backupIntervalDays` / `backupFolder` from the
 * settings store. The last successful run is stamped in the `settings`
 * TABLE under its own key (`backup:lastRun`) — deliberately outside the
 * 'app' settings blob so scheduler state never churns user preferences.
 *
 * All Tauri APIs are imported dynamically and guarded by `isTauri()`, so
 * this module is safe in the browser dev build (where it simply idles).
 */

import { getDb, isTauri, DB_PATH } from '../../data/db';
import { load as loadSettings, settings } from '../../data/settings';

/** settings-table key holding the ISO timestamp of the last backup run. */
export const LAST_RUN_KEY = 'backup:lastRun';

/** How often the scheduler re-checks whether a backup is due. */
export const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly
/** Grace delay before the boot-time check (let the app settle first). */
export const BOOT_DELAY_MS = 15 * 1000;

export interface BackupRunResult {
  path: string;
  bytes: number;
}

export interface BackupEntry {
  path: string;
  fileName: string;
  bytes: number;
  modifiedMs: number | null;
}

export interface RestoreResult {
  safetyCopy: string;
  restoredFiles: number;
}

/* ------------------------------ pure logic --------------------------------- */

/**
 * Is a backup due? Pure. Null / unparseable stamp -> due. Interval is
 * clamped to at least one day so a corrupt setting can't spin backups.
 */
export function isBackupDue(
  lastRunIso: string | null,
  intervalDays: number,
  now: Date,
): boolean {
  if (lastRunIso === null) return true;
  const last = Date.parse(lastRunIso);
  if (Number.isNaN(last)) return true;
  const days = Math.max(1, intervalDays);
  return now.getTime() - last >= days * 86_400_000;
}

/** "just now" / "5 min ago" / "3 hours ago" / "2 days ago" for the panel. */
export function formatRelativeTime(iso: string | null, now: Date): string {
  if (iso === null) return 'never';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'never';
  const ms = Math.max(0, now.getTime() - then);
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

/* ----------------------------- last-run stamp ------------------------------ */

export async function getLastBackupRun(): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<Array<{ value: string }>>(
    'SELECT value FROM settings WHERE key = $1 LIMIT 1',
    [LAST_RUN_KEY],
  );
  return rows.length > 0 ? rows[0].value : null;
}

export async function setLastBackupRun(iso: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)',
    [LAST_RUN_KEY, iso],
  );
}

/* ------------------------------ invoke wrappers ---------------------------- */

async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/**
 * Run a backup now (desktop only), honoring the configured folder, and
 * stamp the run on success.
 */
export async function runBackupNow(): Promise<BackupRunResult> {
  if (!isTauri()) throw new Error('backups need the desktop app');
  await loadSettings();
  const result = await invokeTauri<BackupRunResult>('run_backup', {
    target: settings.backupFolder,
  });
  await setLastBackupRun(new Date().toISOString());
  return result;
}

/** List archives in the configured (or default) backup folder. */
export async function listBackups(): Promise<BackupEntry[]> {
  if (!isTauri()) return [];
  await loadSettings();
  return invokeTauri<BackupEntry[]>('list_backups', {
    target: settings.backupFolder,
  });
}

/**
 * Restore from an archive: closes the sql-plugin connection first (the db
 * file cannot be overwritten while held open on Windows), then extracts.
 * The app must be restarted afterwards — the caller owns that prompt.
 */
export async function restoreBackup(path: string): Promise<RestoreResult> {
  if (!isTauri()) throw new Error('restore needs the desktop app');
  try {
    const { default: Database } = await import('@tauri-apps/plugin-sql');
    const db = await Database.load(DB_PATH);
    await db.close();
  } catch {
    // Best-effort — restore still attempts the file swap.
  }
  return invokeTauri<RestoreResult>('restore_backup', { path });
}

/* -------------------------------- scheduler -------------------------------- */

/**
 * Start the cadence scheduler. Checks shortly after boot and then hourly;
 * runs a backup when enabled, in Tauri, and due per the interval setting.
 * Returns a disposer. Timer/now are injectable for tests.
 */
export function startBackupScheduler(
  deps: {
    now?: () => Date;
    runBackup?: () => Promise<unknown>;
    inTauri?: boolean;
  } = {},
): () => void {
  const now = deps.now ?? (() => new Date());
  const run = deps.runBackup ?? runBackupNow;
  const inTauri = deps.inTauri ?? isTauri();
  if (!inTauri) return () => {};

  let disposed = false;
  let running = false;

  const check = async (): Promise<void> => {
    if (disposed || running) return;
    try {
      await loadSettings();
      if (!settings.backupEnabled) return;
      const last = await getLastBackupRun();
      if (!isBackupDue(last, settings.backupIntervalDays, now())) return;
      running = true;
      await run();
    } catch {
      // A failed backup must never take the app down; retried next tick.
    } finally {
      running = false;
    }
  };

  const boot = setTimeout(() => void check(), BOOT_DELAY_MS);
  const tick = setInterval(() => void check(), CHECK_INTERVAL_MS);
  return () => {
    disposed = true;
    clearTimeout(boot);
    clearInterval(tick);
  };
}
