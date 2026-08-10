/**
 * Latest-selection-wins gate for asynchronous shelf-studio hydration.
 * Selecting B invalidates A before either promise settles; cancellation also
 * makes a late response harmless after the panel unmounts.
 */
export function createLatestBookHydrator<T>(
  load: (bookId: string) => Promise<T | null>,
  apply: (bookId: string, value: T | null) => void,
): { select(bookId: string | null): void; cancel(): void } {
  let ticket = 0;
  return {
    select(bookId) {
      const mine = ++ticket;
      if (bookId === null) return;
      void load(bookId).then(
        (value) => {
          if (mine === ticket) apply(bookId, value);
        },
        () => {
          /* A failed read leaves the caller's already-cleared state in place. */
        },
      );
    },
    cancel() {
      ticket += 1;
    },
  };
}

/**
 * Lifecycle gate for the shelf-hosted Book Studio.
 *
 * The shelf deliberately keeps its studio component mounted while the rail is
 * closed. It also keeps the selected book id, so watching that id alone does
 * not re-read the Book row when the same studio is opened again. That leaves
 * the hidden panel holding an old cover_meta snapshot which can overwrite an
 * edit made in BookView between close and reopen.
 *
 * This controller treats an open rising edge as a new selection even when the
 * id is unchanged. A real selection change while already open does the same.
 * Closing invalidates the outstanding read but leaves the old view mounted for
 * the rail's exit animation; the caller clears it synchronously immediately
 * before the next read, so stale controls are never interactive while loading.
 */
export function createShelfStudioHydration<T>(
  load: (bookId: string) => Promise<T | null>,
  clear: () => void,
  apply: (bookId: string, value: T | null) => void,
): {
  update(open: boolean, bookId: string | null): void;
  cancel(): void;
} {
  const latest = createLatestBookHydrator(load, apply);
  let wasOpen = false;
  let selectedBookId: string | null = null;

  return {
    update(open, bookId) {
      const opening = open && !wasOpen;
      const changedBook = bookId !== selectedBookId;
      wasOpen = open;
      selectedBookId = bookId;

      if (!open) {
        // Invalidate a read that was started before the panel closed. A late
        // response must not silently become the next opening's initial state.
        latest.select(null);
        return;
      }

      if (!opening && !changedBook) return;

      clear();
      latest.select(bookId);
    },
    cancel() {
      latest.cancel();
    },
  };
}
