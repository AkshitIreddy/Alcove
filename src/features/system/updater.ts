/**
 * Check the signed release feed after the shelf has had time to paint, then
 * offer the update inside Alcove instead of dropping a native prompt over it.
 * Browser/dev runs never check: they have no signed installed bundle to update.
 */
import { isTauri } from '../../data/db';

export const UPDATE_CHECK_DELAY_MS = 10_000;
export const UPDATE_CHECK_TIMEOUT_MS = 15_000;

let checkInFlight: Promise<void> | null = null;

export async function checkForUpdates(): Promise<void> {
  checkInFlight ??= (async () => {
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check({ timeout: UPDATE_CHECK_TIMEOUT_MS });
      if (update === null) return;
      const { openUpdateDialog } = await import('./UpdateDialog');
      openUpdateDialog(update);
    } catch {
      // Offline, an unsigned development bundle, or no published manifest:
      // update checking is background housekeeping and must not interrupt use.
    }
  })().finally(() => {
    checkInFlight = null;
  });
  await checkInFlight;
}

/** Start one delayed update check; returns the ordinary system-feature disposer. */
export function startUpdateChecker(): () => void {
  if (!isTauri() || import.meta.env.DEV || typeof window === 'undefined') {
    return () => {};
  }
  const timer = window.setTimeout(() => void checkForUpdates(), UPDATE_CHECK_DELAY_MS);
  return () => window.clearTimeout(timer);
}
