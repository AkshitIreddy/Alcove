/**
 * src/features/system/launch.ts — "launch into last book" (wave-2 item 32).
 *
 * The id of the most recently opened book is persisted in the `settings`
 * TABLE under `appState:openBookId` (outside the 'app' blob — it is app
 * state, not a preference). On startup, when the `launchIntoLastBook`
 * setting is on and the stored book still exists, the shell jumps straight
 * into that book.
 *
 * (Remembering the maximized window state itself comes free from
 * tauri-plugin-window-state, already registered in lib.rs.)
 */

import { createEffect, createRoot, on } from 'solid-js';
import { getDb } from '../../data/db';
import { getBook } from '../../data/books';
import { load as loadSettings, settings } from '../../data/settings';
import { appState } from '../../state/app';

/** settings-table key holding the last-opened book id. */
export const OPEN_BOOK_KEY = 'appState:openBookId';

/** Pure decision: should startup jump into `storedId`? */
export function shouldLaunchIntoLastBook(
  launchIntoLastBook: boolean,
  storedId: string | null,
): boolean {
  return launchIntoLastBook && storedId !== null && storedId.length > 0;
}

export async function readStoredOpenBookId(): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<Array<{ value: string }>>(
    'SELECT value FROM settings WHERE key = $1 LIMIT 1',
    [OPEN_BOOK_KEY],
  );
  const value = rows.length > 0 ? rows[0].value : '';
  return value.length > 0 ? value : null;
}

async function writeStoredOpenBookId(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)',
    [OPEN_BOOK_KEY, id],
  );
}

/**
 * Persist every non-null `openBookId` change (the id survives closing the
 * book — "last book" means last opened, not currently open). Returns a
 * disposer.
 */
export function startOpenBookPersistence(): () => void {
  return createRoot((dispose) => {
    createEffect(
      on(appState.openBookId, (id) => {
        if (id !== null) void writeStoredOpenBookId(id);
      }),
    );
    return dispose;
  });
}

/**
 * Startup hook: open the last book when the setting asks for it and the
 * book still exists. Returns whether a book was opened. Safe to call in
 * both browser and desktop builds.
 */
export async function launchIntoLastBook(): Promise<boolean> {
  await loadSettings();
  const storedId = await readStoredOpenBookId();
  if (!shouldLaunchIntoLastBook(settings.launchIntoLastBook, storedId)) {
    return false;
  }
  const book = await getBook(storedId as string);
  if (book === null) return false;
  appState.openBook(book.id);
  return true;
}
