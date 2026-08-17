/**
 * Signed-update checking shared by startup and Settings.
 *
 * Startup used to make one attempt, ten seconds after launch, and swallow any
 * error. A momentary network/GitHub/plugin failure therefore looked exactly
 * like "there is no update" and Alcove never tried again in that session.
 * The checker now returns an honest outcome, records background failures for
 * diagnostics, and gives startup two bounded retries. Settings calls the same
 * function directly and is never hidden behind the startup delay.
 */
import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater';
import { isTauri } from '../../data/db';
import { APP_VERSION } from '../../version';

export const UPDATE_CHECK_DELAY_MS = 10_000;
export const UPDATE_CHECK_TIMEOUT_MS = 15_000;
export const UPDATE_RETRY_DELAYS_MS = [60_000, 5 * 60_000] as const;

export type UpdateCheckResult =
  | { readonly status: 'available'; readonly version: string }
  | { readonly status: 'current' }
  | { readonly status: 'error'; readonly message: string };

interface UpdaterQaResult {
  readonly status: 'available' | 'current' | 'error';
  readonly version?: string;
  readonly body?: string;
  readonly date?: string;
  readonly message?: string;
}

interface UpdaterQaBridge {
  readonly currentVersion?: string;
  readonly disableAutomatic?: boolean;
  readonly automaticDelayMs?: number;
  readonly retryDelaysMs?: readonly number[];
  check(): Promise<UpdaterQaResult>;
}

declare global {
  interface Window {
    __alcoveUpdaterQa?: UpdaterQaBridge;
  }
}

function qaBridge(): UpdaterQaBridge | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get('fx') !== 'force' || params.get('qa') !== 'updater') return null;
  return window.__alcoveUpdaterQa ?? null;
}

function messageFor(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message.trim();
  if (typeof error === 'string' && error.trim() !== '') return error.trim();
  return 'The update service could not be reached.';
}

function qaUpdate(result: UpdaterQaResult): Update {
  const version = result.version ?? '0.0.0-qa';
  return {
    version,
    currentVersion: qaBridge()?.currentVersion ?? APP_VERSION,
    body: result.body ?? `## Alcove ${version}\n\nA signed test edition is ready.`,
    date: result.date,
    available: true,
    rawJson: result,
    async downloadAndInstall(onEvent?: (event: DownloadEvent) => void) {
      onEvent?.({ event: 'Started', data: { contentLength: 128 } });
      onEvent?.({ event: 'Progress', data: { chunkLength: 128 } });
      onEvent?.({ event: 'Finished' });
    },
    async download() {},
    async install() {},
    async close() {},
  } as unknown as Update;
}

async function findUpdate(): Promise<Update | null> {
  const qa = qaBridge();
  if (qa !== null) {
    const result = await qa.check();
    if (result.status === 'error') {
      throw new Error(result.message ?? 'The simulated update service failed.');
    }
    return result.status === 'available' ? qaUpdate(result) : null;
  }
  const { check } = await import('@tauri-apps/plugin-updater');
  return check({ timeout: UPDATE_CHECK_TIMEOUT_MS });
}

let checkInFlight: Promise<UpdateCheckResult> | null = null;

/**
 * Check now and, when a newer signed release exists, open the existing update
 * offer. Concurrent startup/Settings calls share one network request.
 */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  checkInFlight ??= (async () => {
    try {
      const update = await findUpdate();
      if (update === null) return { status: 'current' } as const;
      const { openUpdateDialog } = await import('./UpdateDialog');
      openUpdateDialog(update);
      return { status: 'available', version: update.version } as const;
    } catch (error) {
      const message = messageFor(error);
      // startErrorLog mirrors console errors/warnings into the diagnostics
      // report. Do not leave updater failures observable only in DevTools.
      console.warn('[Alcove updater] Update check failed:', error);
      return { status: 'error', message } as const;
    }
  })().finally(() => {
    checkInFlight = null;
  });
  return checkInFlight;
}

/** Runtime bundle version, with the source constant as browser/failure fallback. */
export async function installedAppVersion(): Promise<string> {
  const qa = qaBridge();
  if (qa?.currentVersion) return qa.currentVersion;
  if (!isTauri()) return APP_VERSION;
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    return APP_VERSION;
  }
}

/** Settings may check in a signed desktop bundle or the tightly gated QA seam. */
export function canCheckForUpdates(): boolean {
  return isTauri() || qaBridge() !== null;
}

export interface UpdateScheduleHost {
  readonly initialDelay?: number;
  readonly retryDelays?: readonly number[];
  setTimer(callback: () => void, delay: number): number;
  clearTimer(handle: number): void;
  onOnline(callback: () => void): () => void;
  check(): Promise<UpdateCheckResult>;
}

/**
 * Bounded scheduler separated from Tauri/window so its retry contract is
 * deterministic in tests. Online only accelerates a pending retry; it never
 * creates an unbounded polling loop.
 */
export function scheduleUpdateChecks(host: UpdateScheduleHost): () => void {
  const delays = host.retryDelays ?? UPDATE_RETRY_DELAYS_MS;
  let timer: number | null = null;
  let retry = 0;
  let disposed = false;
  let failed = false;
  let running = false;

  const schedule = (delay: number): void => {
    if (disposed) return;
    if (timer !== null) host.clearTimer(timer);
    timer = host.setTimer(() => {
      timer = null;
      void run();
    }, delay);
  };

  const run = async (): Promise<void> => {
    if (disposed || running) return;
    running = true;
    const result = await host.check();
    running = false;
    if (disposed) return;
    failed = result.status === 'error';
    if (failed && retry < delays.length) schedule(delays[retry++]!);
  };

  const offOnline = host.onOnline(() => {
    // Accelerate a retry already granted by the bounded schedule. Once the
    // two retry slots are exhausted there is no pending timer to resurrect.
    if (failed && !running && timer !== null) schedule(0);
  });
  schedule(host.initialDelay ?? UPDATE_CHECK_DELAY_MS);

  return () => {
    disposed = true;
    if (timer !== null) host.clearTimer(timer);
    offOnline();
  };
}

/** Start the delayed, bounded background check. */
export function startUpdateChecker(): () => void {
  if (typeof window === 'undefined') return () => {};
  const qa = qaBridge();
  if ((!isTauri() && qa === null) || qa?.disableAutomatic) return () => {};
  return scheduleUpdateChecks({
    initialDelay: qa?.automaticDelayMs,
    retryDelays: qa?.retryDelaysMs,
    setTimer: (callback, delay) => window.setTimeout(callback, delay),
    clearTimer: (handle) => window.clearTimeout(handle),
    onOnline: (callback) => {
      window.addEventListener('online', callback);
      return () => window.removeEventListener('online', callback);
    },
    check: checkForUpdates,
  });
}
