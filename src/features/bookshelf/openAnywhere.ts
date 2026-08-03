/**
 * features/bookshelf/openAnywhere.ts — open a book that may live in another
 * bookcase.
 *
 * Search and the quick switcher are LIBRARY-WIDE on purpose: a book must never
 * vanish from search because the reader is standing in a different case
 * (`listBooksByFloor…` takes `bookcaseId` as an optional TRAILING argument, and
 * omitting it means the whole library — see CLAUDE.md). That was the right
 * call and it stays.
 *
 * What it left behind: picking a hit from another case opened the book, and
 * closing it dropped the reader onto a shelf that does not contain the book
 * they just read. Nothing was broken enough to notice in a test — the book
 * opens fine — it is only wrong when you shut it.
 *
 * So the case is switched FIRST, and only then is the book opened. The order
 * matters: `switchBookcase` reloads the shelf's store for the new case, and
 * opening first would have the world briefly resolving a book against the old
 * case's floors.
 *
 * A book with no `bookcaseId` (a historical row, or one an import has not yet
 * been adopted from) is opened where it is. The start-up orphan sweep adopts
 * those into the first case, and racing it here would be a second, quieter
 * implementation of the same policy.
 */
import { activeBookcase, switchBookcase } from '../../data/bookcases';
import { getBook } from '../../data/books';
import { appState } from '../../state/app';

/**
 * The bookcase a book lives in, or null when it is not worth switching to:
 * the book is gone, has no case recorded, or is already in the open one.
 */
export async function caseToSwitchTo(bookId: string): Promise<string | null> {
  let target: string | null | undefined;
  try {
    target = (await getBook(bookId))?.bookcaseId ?? null;
  } catch {
    // A lookup that fails is not a reason to refuse to open the book.
    return null;
  }
  if (typeof target !== 'string' || target === '') return null;
  return target === activeBookcase()?.id ? null : target;
}

/**
 * Open a book, switching to its bookcase first when it lives in another one.
 *
 * Awaited by callers that can await; the switch is what takes time (it reloads
 * the shelf's page for the new case) and the open is synchronous after it.
 */
export async function openBookAnywhere(bookId: string): Promise<void> {
  const target = await caseToSwitchTo(bookId);
  if (target !== null) {
    try {
      await switchBookcase(target);
    } catch {
      // Failing to switch must not swallow the open — the reader still gets
      // their book, on the shelf they were already standing in.
    }
  }
  appState.openBook(bookId);
}
