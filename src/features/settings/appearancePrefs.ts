/**
 * src/features/settings/appearancePrefs.ts — where the paper stock lives.
 *
 * Three of the four appearance axes already had somewhere to go: the room is
 * `settings.theme`, the ink is `settings.inkColor` and the hand is
 * `settings.handwritingFont`, all three of them fields `data/types.ts` has
 * carried since the app shipped. The PAPER STOCK is new, and `Settings` is a
 * shape owned by `data/types.ts` — a file this feature does not own.
 *
 * `data/designPrefs.ts` hit exactly this and answered it exactly this way:
 *
 *   > Rather than widen either validator from a file the studio does not own,
 *   > the studio keeps its own book of choices here, in the same `settings`
 *   > table every other keyed preference lives in.
 *
 * So this is the settings feature's own book, one row, one key. It is
 * deliberately tiny — if a second appearance choice ever needs storing it
 * belongs in here beside the paper rather than in a third place.
 *
 * Every read is total: a value comes back out of SQLite unvalidated, and a bad
 * one has to give "as the room" rather than an exception inside a repaint.
 */

import { createSignal } from 'solid-js';
import { getDb } from '../../data/db';
import { AUTO_PAPER, resolvePaper } from './appearance';

const SETTINGS_KEY = 'appearance';

interface AppearanceBook {
  /** A `PaperSpec` id, or `AUTO_PAPER` for "whatever the room is printed on". */
  paper: string;
}

const EMPTY: AppearanceBook = { paper: AUTO_PAPER };

/** Total. Anything that is not a stock this app knows about means "as the room". */
function normalize(raw: unknown): AppearanceBook {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY;
  const paper = (raw as Record<string, unknown>).paper;
  if (typeof paper !== 'string' || resolvePaper(paper) === null) return EMPTY;
  return { paper };
}

const [book, setBook] = createSignal<AppearanceBook>(EMPTY);
const listeners = new Set<(paper: string) => void>();

/**
 * The chosen stock.
 *
 * One function for both callers, deliberately: inside a Solid computation it
 * tracks (the panel's chips restyle themselves), and outside one it is a plain
 * read (`apply.ts` calls it from a subscription callback). A second
 * "snapshot" entry point would be the same line of code wearing a hat.
 */
export const paperStock = (): string => book().paper;

/**
 * Fire when the stock changes. Returns an unsubscribe.
 *
 * `apply.ts` uses this rather than the other way round: a settings write and a
 * paper write have to end at the same place (one call to `applySettings`), and
 * the arrow has to point from the store to the applier or the two modules
 * import each other.
 */
export function subscribePaperStock(listener: (paper: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let loadPromise: Promise<AppearanceBook> | null = null;

/** Load once; later calls reuse the same promise. */
export function loadPaperStock(): Promise<AppearanceBook> {
  loadPromise ??= (async () => {
    try {
      const db = await getDb();
      const rows = await db.select<Array<{ value: string }>>(
        'SELECT value FROM settings WHERE key = $1 LIMIT 1',
        [SETTINGS_KEY],
      );
      const next = normalize(rows.length > 0 ? JSON.parse(rows[0].value) : null);
      setBook(next);
      for (const listener of listeners) listener(next.paper);
      return next;
    } catch {
      // No database yet, or a blob that will not parse. The house paper is a
      // perfectly good answer and an exception here would take the whole
      // first paint with it.
      return EMPTY;
    }
  })();
  return loadPromise;
}

/** Choose a stock. `AUTO_PAPER` hands the page back to the room. */
export async function savePaperStock(id: string): Promise<void> {
  const next: AppearanceBook = resolvePaper(id) === null ? EMPTY : { paper: id };
  setBook(next);
  for (const listener of listeners) listener(next.paper);
  try {
    const db = await getDb();
    await db.execute('INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)', [
      SETTINGS_KEY,
      JSON.stringify(next),
    ]);
  } catch {
    // Applied but not persisted: the reader sees their choice now and loses it
    // on restart, which is far better than a picker that appears to do nothing.
  }
}
