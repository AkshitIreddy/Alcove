/**
 * Daily journal — the `/today` slash command (roadmap #18).
 *
 * `openToday()` finds (or creates) today's dated page inside the designated
 * Journal book (settings.journalBookId) and navigates the app to it:
 * - No journal book configured → reuse a book titled 'Journal' if one is
 *   shelved, else create one on the first empty slot after floor 0's books,
 *   then persist its id via settings.save({ journalBookId }).
 * - Today's page is identified by its first heading matching
 *   `journalTitle(date)` — the doc IS the storage format, so the date lives
 *   in visible ink rather than a parallel column.
 * - Navigation: appState.openBook(bookId) + a pending-jump signal BookView
 *   consumes once the session (re)loads, flipping to the page's spread.
 */
import { createSignal, type Accessor } from 'solid-js';
import { appState } from '../state/app';
import { createBook, getBook, listBooksByFloorRange } from '../data/books';
import { createPage, listPages } from '../data/pages';
import { save, load as loadSettings } from '../data/settings';
import type { Book, Page, PageDoc } from '../data/types';

export const JOURNAL_BOOK_TITLE = 'Journal';

/** Heading text for a day's journal page, e.g. "July 30, 2026". */
export function journalTitle(date: Date = new Date()): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** Text of a doc's first heading (top-level), or null. */
export function firstHeadingText(doc: PageDoc | null | undefined): string | null {
  if (!doc || !Array.isArray(doc.content)) return null;
  for (const block of doc.content) {
    if (block === null || typeof block !== 'object') continue;
    const node = block as { type?: unknown; content?: unknown };
    if (node.type !== 'heading') continue;
    if (!Array.isArray(node.content)) return '';
    return node.content
      .map((child) =>
        child !== null &&
        typeof child === 'object' &&
        typeof (child as { text?: unknown }).text === 'string'
          ? ((child as { text: string }).text)
          : '',
      )
      .join('');
  }
  return null;
}

/** Find the page whose first heading matches `title` (pure). */
export function findJournalPage(
  pages: readonly Page[],
  title: string,
): Page | null {
  return pages.find((page) => firstHeadingText(page.doc) === title) ?? null;
}

/** Starter doc for a fresh dated page. */
export function journalPageDoc(title: string): PageDoc {
  return {
    type: 'doc',
    attrs: { pageStyle: 'ruled' },
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: title }],
      },
      { type: 'paragraph' },
    ],
  };
}

/* ----------------------------------------------------------------------------
   Pending jump — BookView consumes this after the session loads
   -------------------------------------------------------------------------- */

const [pendingJump, setPendingJump] = createSignal<string | null>(null);

/** Page id BookView should flip to once its book session is live, or null. */
export const pendingJournalJump: Accessor<string | null> = pendingJump;

/** Clear the pending jump (BookView calls this after flipping). */
export function clearJournalJump(): void {
  setPendingJump(null);
}

/* ----------------------------------------------------------------------------
   The command
   -------------------------------------------------------------------------- */

async function resolveJournalBook(): Promise<Book> {
  const settings = await loadSettings();
  if (settings.journalBookId !== null) {
    const existing = await getBook(settings.journalBookId);
    if (existing !== null) return existing;
  }
  const shelved = await listBooksByFloorRange(0, 999);
  const byTitle = shelved.find((book) => book.title === JOURNAL_BOOK_TITLE);
  if (byTitle) {
    await save({ journalBookId: byTitle.id });
    return byTitle;
  }
  const floorZero = shelved.filter((book) => book.floor === 0);
  const nextSlot =
    floorZero.length > 0
      ? Math.max(...floorZero.map((book) => book.slot)) + 1
      : 0;
  const created = await createBook({
    title: JOURNAL_BOOK_TITLE,
    floor: 0,
    slot: nextSlot,
  });
  await save({ journalBookId: created.id });
  return created;
}

/**
 * Create-or-jump to today's journal page. Safe to fire-and-forget from the
 * slash command; failures degrade to a no-op (the notebook never throws at
 * the user mid-keystroke).
 */
export async function openToday(date: Date = new Date()): Promise<void> {
  try {
    const book = await resolveJournalBook();
    const title = journalTitle(date);
    const pages = await listPages(book.id);
    const page =
      findJournalPage(pages, title) ??
      (await createPage({ bookId: book.id, doc: journalPageDoc(title) }));
    setPendingJump(page.id);
    appState.openBook(book.id);
  } catch {
    // Best-effort: leave the user where they are.
  }
}
