/**
 * src/features/system/tray.ts — frontend half of tray quick capture and
 * close-to-tray.
 *
 * The Rust side (src-tauri/src/tray.rs) owns the tray icon and menu; this
 * module sends both persisted tray settings through one `tray_sync` command
 * and handles the "Quick note" action: the tray emits
 * `nb://tray-quick-note`, and we open an "Inbox" book — created on demand on
 * floor 0 — for fast capture.
 */

import { getDb, isTauri } from '../../data/db';
import { createBook, listBooksByFloorRange } from '../../data/books';
import { createPage } from '../../data/pages';
import { subscribe as subscribeSettings } from '../../data/settings';
import { appState } from '../../state/app';
import type { Book, BookRow, Settings } from '../../data/types';
import { setAppHiddenInTray } from '../../sound/engine';

/** Must match `QUICK_NOTE_EVENT` in src-tauri/src/tray.rs. */
export const QUICK_NOTE_EVENT = 'nb://tray-quick-note';
/** Must match `VISIBILITY_EVENT` in src-tauri/src/tray.rs. */
export const TRAY_VISIBILITY_EVENT = 'nb://tray-visibility';

/** Title of the on-demand capture book. */
export const INBOX_TITLE = 'Inbox';

/** Floor the Inbox book is shelved on when first created. */
export const INBOX_FLOOR = 0;

/* ------------------------------ pure logic --------------------------------- */

/** First free slot after the occupied ones on `floor` (0 when empty). */
export function nextFreeSlot(
  books: ReadonlyArray<{ floor: number; slot: number }>,
  floor: number,
): number {
  let max = -1;
  for (const book of books) {
    if (book.floor === floor && book.slot > max) max = book.slot;
  }
  return max + 1;
}

/** Whether either tray feature needs the icon to remain reachable. */
export function trayNeeded(
  current: Pick<Settings, 'trayQuickCapture' | 'closeToTray'>,
): boolean {
  return current.trayQuickCapture || current.closeToTray;
}

/* ------------------------------- inbox book -------------------------------- */

async function findBookByTitle(title: string): Promise<Book | null> {
  const db = await getDb();
  const rows = await db.select<BookRow[]>(
    'SELECT * FROM books WHERE title = $1 LIMIT 1',
    [title],
  );
  if (rows.length === 0) return null;
  // Minimal row -> model mapping (books.ts keeps rowToBook private).
  const row = rows[0];
  return {
    id: row.id,
    title: row.title,
    floor: row.floor,
    slot: row.slot,
    spineSeed: row.spine_seed,
    coverMeta: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Find the Inbox book, creating it (with one empty page) when missing.
 * Reused by the tray handler and available for other capture flows.
 */
export async function ensureInboxBook(): Promise<Book> {
  const existing = await findBookByTitle(INBOX_TITLE);
  if (existing !== null) return existing;
  const floorBooks = await listBooksByFloorRange(INBOX_FLOOR, INBOX_FLOOR);
  const book = await createBook({
    title: INBOX_TITLE,
    floor: INBOX_FLOOR,
    slot: nextFreeSlot(floorBooks, INBOX_FLOOR),
  });
  await createPage({ bookId: book.id });
  return book;
}

/** Quick-note action: make sure the Inbox exists, then open it. */
export async function openQuickNote(): Promise<void> {
  const book = await ensureInboxBook();
  appState.openBook(book.id);
}

/* --------------------------------- sync ------------------------------------ */

async function invokeTraySync(
  quickCapture: boolean,
  closeToTray: boolean,
): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('tray_sync', { quickCapture, closeToTray });
}

/**
 * Keep the tray in sync with both tray settings and listen for quick-note
 * events. Desktop only (no-op disposer in the browser).
 * Returns a disposer.
 */
export function startTraySync(): () => void {
  if (!isTauri()) return () => {};

  let lastQuickCapture: boolean | null = null;
  let lastCloseToTray: boolean | null = null;
  const unsubscribeSettings = subscribeSettings((current) => {
    const quickCapture = current.trayQuickCapture;
    const closeToTray = current.closeToTray;
    if (
      quickCapture === lastQuickCapture &&
      closeToTray === lastCloseToTray
    ) return;
    lastQuickCapture = quickCapture;
    lastCloseToTray = closeToTray;
    void invokeTraySync(quickCapture, closeToTray).catch(() => {
      // Tray unavailable (unregistered command / platform) — setting stays.
    });
  });

  let unlistenQuick: (() => void) | null = null;
  let unlistenVisibility: (() => void) | null = null;
  let disposed = false;
  void (async () => {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      const [stopQuick, stopVisibility] = await Promise.all([
        listen(QUICK_NOTE_EVENT, () => void openQuickNote()),
        listen<boolean>(TRAY_VISIBILITY_EVENT, (event) => {
          setAppHiddenInTray(event.payload === true);
        }),
      ]);
      if (disposed) {
        stopQuick();
        stopVisibility();
      } else {
        unlistenQuick = stopQuick;
        unlistenVisibility = stopVisibility;
      }
    } catch {
      // Event API unavailable — desktop tray integrations simply stay inert.
    }
  })();

  return () => {
    disposed = true;
    unsubscribeSettings();
    unlistenQuick?.();
    unlistenVisibility?.();
  };
}
