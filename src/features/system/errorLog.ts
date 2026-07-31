/**
 * src/features/system/errorLog.ts — an in-memory ring buffer of recent errors.
 *
 * Nothing in the app collected errors before this, so a crash left the user
 * with nothing to hand over. `startErrorLog()` (wired from
 * `initSystemFeatures`) listens for `error` / `unhandledrejection` and tees
 * `console.error`, keeping the last `ERROR_LOG_CAPACITY` entries.
 *
 * Memory only: never written to the database, never persisted, never sent
 * anywhere. `./diagnostics.ts` is the only reader, and it redacts before the
 * text ever reaches a file. Stacks are deliberately NOT kept — a stack frame
 * carries the developer's own disk paths in dev builds, and the message alone
 * is what makes an error identifiable.
 */

/** How many entries survive; older ones fall off the front. */
export const ERROR_LOG_CAPACITY = 30;

/** Longest message we keep — a runaway stringify must not eat the buffer. */
export const MESSAGE_MAX = 300;

export type ErrorSource = 'console' | 'window' | 'promise';

export interface LoggedError {
  /** ISO-8601, UTC. */
  at: string;
  source: ErrorSource;
  message: string;
  /** Consecutive repeats folded into one entry (1 = seen once). */
  count: number;
}

/* -------------------------------- pure bits -------------------------------- */

/** One readable line for a single console/handler argument. Total. */
function describeValue(value: unknown): string {
  if (value instanceof Error) {
    const name = value.name === '' ? 'Error' : value.name;
    return value.message === '' ? name : `${name}: ${value.message}`;
  }
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      // Cyclic or exotic object — its shape is not worth a crash.
      return '[unserializable object]';
    }
  }
  return String(value);
}

/**
 * Fold a console.error argument list into one clamped line. Exported for the
 * unit tests, which is also why it never touches module state.
 */
export function describeErrorArgs(args: readonly unknown[]): string {
  const joined = args.map(describeValue).join(' ').replace(/\s+/g, ' ').trim();
  if (joined.length <= MESSAGE_MAX) return joined;
  return `${joined.slice(0, MESSAGE_MAX - 1)}…`;
}

/* ------------------------------- the buffer -------------------------------- */

let buffer: LoggedError[] = [];

/**
 * Push an entry. Identical back-to-back messages bump `count` instead of
 * filling the whole buffer with one repeating failure (a rAF-loop error can
 * fire sixty times a second).
 */
export function recordError(source: ErrorSource, message: string): void {
  const text = message.trim();
  if (text === '') return;
  const last = buffer[buffer.length - 1];
  if (last !== undefined && last.source === source && last.message === text) {
    last.count += 1;
    last.at = new Date().toISOString();
    return;
  }
  buffer.push({ at: new Date().toISOString(), source, message: text, count: 1 });
  if (buffer.length > ERROR_LOG_CAPACITY) {
    buffer = buffer.slice(buffer.length - ERROR_LOG_CAPACITY);
  }
}

/** Oldest first. A copy — callers must not be able to mutate the log. */
export function recentErrors(): LoggedError[] {
  return buffer.map((entry) => ({ ...entry }));
}

export function clearErrorLog(): void {
  buffer = [];
}

/* ------------------------------- the listeners ----------------------------- */

let stop: (() => void) | null = null;

/**
 * Start collecting. Idempotent — a second call returns a disposer for the
 * first installation rather than double-teeing console.error.
 */
export function startErrorLog(): () => void {
  if (stop !== null) return stop;
  if (typeof window === 'undefined') return () => {};

  const onError = (event: ErrorEvent): void => {
    recordError('window', describeErrorArgs([event.error ?? event.message]));
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    recordError('promise', describeErrorArgs([event.reason]));
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  // Tee, never replace: the console must still show the error to a developer.
  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]): void => {
    recordError('console', describeErrorArgs(args));
    originalConsoleError(...args);
  };

  stop = () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    console.error = originalConsoleError;
    stop = null;
  };
  return stop;
}
