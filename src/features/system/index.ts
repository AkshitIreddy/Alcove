/**
 * src/features/system/index.ts — wave-2 group F system polish surface.
 *
 * `initSystemFeatures()` is the single startup hook: it wires the error log,
 * the backup scheduler, open-book persistence, tray sync, and the launch-
 * into-last-book jump. Idempotent (second call returns the first disposer's
 * no-op sibling) so an accidental double mount cannot double-schedule backups.
 *
 * Intended App.tsx wiring (orchestrator):
 *   import { initSystemFeatures } from "./features/system";
 *   // inside onMount():
 *   onCleanup(initSystemFeatures());
 *
 * The PerfHud overlay is self-mounted from SettingsPanel's always-present
 * layer, so it needs no App.tsx line.
 */

import { startBackupScheduler } from './backup';
import { startErrorLog } from './errorLog';
import { launchIntoLastBook, startOpenBookPersistence } from './launch';
import { startTraySync } from './tray';

export { default as PerfHud } from './PerfHud';
export {
  formatRelativeTime,
  getLastBackupRun,
  isBackupDue,
  listBackups,
  restoreBackup,
  runBackupNow,
} from './backup';
export {
  collectDiagnostics,
  diagnosticsFileName,
  exportDiagnostics,
  formatDiagnostics,
  redactPaths,
  type DiagnosticsReport,
} from './diagnostics';
export {
  ERROR_LOG_CAPACITY,
  clearErrorLog,
  describeErrorArgs,
  recentErrors,
  recordError,
  startErrorLog,
  type LoggedError,
} from './errorLog';
export { launchIntoLastBook, startOpenBookPersistence } from './launch';
export { ensureInboxBook, openQuickNote, startTraySync } from './tray';

let initialized = false;

/** Start all system features; returns a disposer. Safe to call once only. */
export function initSystemFeatures(): () => void {
  if (initialized) return () => {};
  initialized = true;
  const disposers = [
    // First, so an error thrown by any of the others lands in the log that
    // "Export diagnostics…" reads.
    startErrorLog(),
    startOpenBookPersistence(),
    startBackupScheduler(),
    startTraySync(),
  ];
  void launchIntoLastBook();
  return () => {
    initialized = false;
    for (const dispose of disposers) dispose();
  };
}
