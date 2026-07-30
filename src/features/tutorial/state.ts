/**
 * src/features/tutorial/state.ts — tour lifecycle + persisted completion.
 *
 * PERSISTENCE: `Settings` has no tutorial field yet (src/data/types.ts), so
 * completion lives in the `settings` TABLE under its own key — the same
 * free-form key/value mechanism `src/features/system/launch.ts`,
 * `src/features/system/backup.ts` and `src/features/bookshelf/floorNames.ts`
 * already use for app state that is not a user preference. If/when
 * `tutorialCompleted: boolean` is added to `Settings` + `DEFAULT_SETTINGS`,
 * `readCompleted`/`writeCompleted` are the only two functions that change.
 *
 * Everything is failure-tolerant: a dead database must never stop the app
 * from starting, and must never make the tour nag on every launch either.
 */

import { batch, createSignal, type Accessor } from 'solid-js';
import { getDb } from '../../data/db';

/** settings-table key holding the tour's completion marker. */
export const TUTORIAL_KEY = 'appState:tutorialCompleted';

/**
 * The `Settings` field we would like added (see module docblock). Exported so
 * the settings feature can grep for one canonical name.
 */
export const TUTORIAL_SETTING_FIELD = 'tutorialCompleted';

/** Truthy stored values. Anything else (missing, '', '0') means "not yet". */
function parseCompleted(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export async function readCompleted(): Promise<boolean> {
  try {
    const db = await getDb();
    const rows = await db.select<Array<{ value: string }>>(
      'SELECT value FROM settings WHERE key = $1 LIMIT 1',
      [TUTORIAL_KEY],
    );
    return parseCompleted(rows.length > 0 ? rows[0].value : undefined);
  } catch {
    // Treat an unreadable store as "already seen" — better a missing tour
    // than a tour that reappears on every single launch.
    return true;
  }
}

async function writeCompleted(done: boolean): Promise<void> {
  try {
    const db = await getDb();
    await db.execute('INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)', [
      TUTORIAL_KEY,
      done ? '1' : '0',
    ]);
  } catch {
    /* persistence is best-effort; the tour still ran */
  }
}

// ---------------------------------------------------------------------------
// Run state
// ---------------------------------------------------------------------------

const [running, setRunning] = createSignal(false);
const [runToken, setRunToken] = createSignal(0);

/** True while the tour overlay is on screen. */
export const tutorialRunning: Accessor<boolean> = running;

/**
 * Bumped on every `startTutorial()` — the overlay watches it so "replay"
 * restarts a tour that is already open instead of doing nothing.
 */
export const tutorialRunToken: Accessor<number> = runToken;

/**
 * Open the guided tour at step one. Safe to call while it is already open.
 *
 * The two writes are batched, and `running` is set first: the overlay's
 * reset effect keys off `runToken` but bails when the tour is not running,
 * so an unbatched bump-then-run would leave a replay sitting on whatever
 * step the previous run ended on.
 */
export function startTutorial(): void {
  batch(() => {
    setRunning(true);
    setRunToken((t) => t + 1);
  });
}

/**
 * Close the tour. `completed` marks it as seen so it does not auto-start
 * again (skipping counts — the user made a choice).
 */
export function stopTutorial(completed = true): void {
  setRunning(false);
  if (completed) void writeCompleted(true);
}

/**
 * Forget that the tour was ever finished, so the next launch offers it again.
 * Exposed in Settings as "replay the tour" alongside `startTutorial()`.
 */
export async function resetTutorial(): Promise<void> {
  await writeCompleted(false);
}

/** Clear the marker and immediately run the tour. */
export async function replayTutorial(): Promise<void> {
  await resetTutorial();
  startTutorial();
}

/**
 * First-run entry point: start the tour only if it has never been completed.
 * Called once from the app shell; never throws.
 */
export async function maybeAutoStartTutorial(): Promise<boolean> {
  const done = await readCompleted();
  if (done) return false;
  startTutorial();
  return true;
}
