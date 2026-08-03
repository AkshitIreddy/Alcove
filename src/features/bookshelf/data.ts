/**
 * features/bookshelf/data.ts — floor data store for the shelf world.
 *
 * Floors are paged from the data layer 8 at a time (debounced, deduped by
 * page). `get(floor)` returns undefined while a page is in flight, [] for a
 * known-empty floor, or the floor's books sorted by slot.
 *
 * Every query is scoped to ONE bookcase. That scope is the whole reason a
 * store instance can be reused across a case switch: `setBookcase` throws away
 * every cached floor before the first new row arrives, so a book from the case
 * you just left can never be drawn standing in the case you just opened.
 *
 * Non-Tauri dev fallback: when the SQLite layer is a stub and returns nothing
 * even after seedIfEmpty(), ~40 deterministic demo books (spine_seed =
 * fnv1a(title), floors 0–5 with varied counts per floor) keep the shelf
 * visually populated.
 *
 * ## Nothing may read the books table before the seed has written to it
 *
 * `init()` is not the only thing that loads a page. The world starts its rAF
 * loop the moment it is constructed, the virtualizer asks for the visible
 * range on the very first frame, and `ensureRange` fetches 60ms later — while
 * `init()` is still inside `ensureBookcases()` + `seedIfEmpty()`. On the real
 * SQLite file (every call an IPC round trip, plus the welcome book's six
 * inserts) that fetch wins, comes back EMPTY, marks page 0 `ready`, and then
 * `init`'s own load returns at the front door because `pages.has(0)`.
 *
 * The result on a brand-new install was a bookcase that read as bare while the
 * welcome book sat in the database: the shelf showed the first-run invitation,
 * and the reader's first click on it appeared to create TWO books — the one
 * they asked for, plus the welcome book that `refreshAll()` finally revealed.
 *
 * So the seed is a GATE (`seeded`), opened by `init()` and awaited by every
 * page load before it queries. Whoever wins the race now reads a database the
 * seed has finished with. `destroy()` opens it too, so a store torn down
 * before init can never strand a pending load.
 */

import {
  DEFAULT_BOOKCASE_ID,
  listBooksByFloorRange,
  maxOccupiedFloor,
  readShelfMeta,
} from '../../data/books';
import { ensureBookcases } from '../../data/bookcases';
import { seedIfEmpty } from '../../data/seed';
import type { Book } from '../../data/types';
import { fnv1a } from '../../art/noise';

export const FLOOR_PAGE_SIZE = 8;

/** Shelf ordering mode (mirrors settings.shelfSort). */
export type ShelfSort = 'manual' | 'recent' | 'favorites';

/**
 * Order a floor's books for display (pure). Manual = persisted slot order;
 * favorites = pinned books first (slot order within each group); recent =
 * most recently opened first (never-opened books keep slot order at the end).
 */
export function orderBooks(books: readonly Book[], sort: ShelfSort): Book[] {
  const bySlot = [...books].sort((a, b) => a.slot - b.slot);
  if (sort === 'manual') return bySlot;
  if (sort === 'favorites') {
    return bySlot.sort((a, b) => {
      const pa = readShelfMeta(a)?.pinned === true ? 0 : 1;
      const pb = readShelfMeta(b)?.pinned === true ? 0 : 1;
      return pa !== pb ? pa - pb : a.slot - b.slot;
    });
  }
  return bySlot.sort((a, b) => {
    const ra = readShelfMeta(a)?.lastOpenedAt ?? '';
    const rb = readShelfMeta(b)?.lastOpenedAt ?? '';
    if (ra !== rb) return ra < rb ? 1 : -1; // ISO strings: newest first
    return a.slot - b.slot;
  });
}

/** Debounce window for coalescing page fetches during a fling, ms. */
const FETCH_DEBOUNCE_MS = 60;

type PageStatus = 'loading' | 'ready';

/* ------------------------------ demo fallback ----------------------------- */

interface DemoSpec {
  readonly title: string;
  readonly floor: number;
  readonly slot: number;
}

const DEMO_BOOKS: readonly DemoSpec[] = [
  // Floor 0 — sciences (well stocked)
  { title: 'Cell Biology', floor: 0, slot: 0 },
  { title: 'Organic Chemistry (send help)', floor: 0, slot: 1 },
  { title: 'Physics: Waves & Wobbles', floor: 0, slot: 3 },
  { title: 'Lab Notebook, Semester 3', floor: 0, slot: 4 },
  { title: 'Astronomy Log', floor: 0, slot: 6 },
  { title: 'Geology Rocks (sorry)', floor: 0, slot: 7 },
  { title: 'Tide Pools & Tiny Crabs', floor: 0, slot: 9 },
  { title: 'Weather Diary', floor: 0, slot: 10 },
  { title: 'Mushroom Spotting', floor: 0, slot: 11 },
  // Floor 1 — math & computing (the crowded one)
  { title: 'Linear Algebra', floor: 1, slot: 0 },
  { title: 'Calculus II: The Redemption', floor: 1, slot: 1 },
  { title: 'Huffman Coding (with kittens)', floor: 1, slot: 3 },
  { title: 'Rust Borrow Checker Diary', floor: 1, slot: 4 },
  { title: 'SQL Spellbook', floor: 1, slot: 5 },
  { title: 'Graph Theory Doodles', floor: 1, slot: 7 },
  { title: 'Big-O and Other Fears', floor: 1, slot: 8 },
  { title: 'Regex Incantations', floor: 1, slot: 10 },
  { title: 'Compiler Campfire Stories', floor: 1, slot: 11 },
  { title: 'Probability for Pigeons', floor: 1, slot: 12 },
  { title: 'Knot Theory (literal)', floor: 1, slot: 14 },
  // Floor 2 — languages (roomier)
  { title: 'Kanji Practice', floor: 2, slot: 1 },
  { title: 'French Verbs I Keep Forgetting', floor: 2, slot: 2 },
  { title: 'Latin Roots & Word Nerdery', floor: 2, slot: 4 },
  { title: 'Sign Language Notes', floor: 2, slot: 6 },
  { title: 'Haiku Attempts (be nice)', floor: 2, slot: 7 },
  { title: 'Etymology Rabbit Holes', floor: 2, slot: 10 },
  { title: 'Untranslatable Words', floor: 2, slot: 12 },
  // Floor 3 — arts & craft (well stocked)
  { title: 'Watercolor Basics', floor: 3, slot: 0 },
  { title: 'Figure Drawing Warmups', floor: 3, slot: 1 },
  { title: 'Music Theory Scraps', floor: 3, slot: 3 },
  { title: 'Typography Crushes', floor: 3, slot: 5 },
  { title: 'Bookbinding Experiments', floor: 3, slot: 6 },
  { title: 'Pottery Wheel Mishaps', floor: 3, slot: 8 },
  { title: 'Linocut Ideas', floor: 3, slot: 9 },
  { title: 'Songs Half Written', floor: 3, slot: 11 },
  { title: 'Stage Fright Journal', floor: 3, slot: 12 },
  { title: 'Colour Mixing Notes', floor: 3, slot: 13 },
  // Floor 4 — life, observed
  { title: 'Birdwatching Field Notes', floor: 4, slot: 2 },
  { title: 'Tea Tasting Journal', floor: 4, slot: 3 },
  { title: 'Recipes That Actually Worked', floor: 4, slot: 6 },
  { title: 'Dream Journal (do not read)', floor: 4, slot: 9 },
  { title: 'Cloud Shapes I Have Known', floor: 4, slot: 10 },
  { title: 'Maps of Imaginary Places', floor: 4, slot: 13 },
  // Floor 5 — nearly empty (a few strays before the empty floors begin)
  { title: 'Someday Projects', floor: 5, slot: 4 },
  { title: 'Letters Never Sent', floor: 5, slot: 5 },
  { title: 'Blank On Purpose', floor: 5, slot: 9 },
];

/** Deterministic client-side demo library (browser dev without SQLite). */
export function demoBooks(bookcaseId: string = DEFAULT_BOOKCASE_ID): Book[] {
  const now = new Date().toISOString();
  return DEMO_BOOKS.map((spec) => ({
    id: `demo-${fnv1a(spec.title).toString(16).padStart(8, '0')}`,
    bookcaseId,
    title: spec.title,
    floor: spec.floor,
    slot: spec.slot,
    spineSeed: fnv1a(spec.title),
    coverMeta: null,
    createdAt: now,
    updatedAt: now,
  }));
}

/* -------------------------------- the store ------------------------------- */

export class FloorStore {
  private readonly floors = new Map<number, Book[]>();
  private readonly pages = new Map<number, PageStatus>();
  private readonly pendingPages = new Set<number>();
  /**
   * Page loads currently in flight, so `init` can AWAIT the one the
   * virtualizer started rather than skipping it. Without this, `init` would
   * resolve while page 0 was still parked on the seed gate and the world
   * would call `ready` on a shelf whose first floor had not arrived.
   */
  private readonly pageLoads = new Map<number, Promise<void>>();
  private readonly listeners = new Set<(floors: readonly number[]) => void>();
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private demoMode = false;
  private sort: ShelfSort = 'manual';

  /** The bookcase every query in this store is scoped to. */
  private caseId: string = DEFAULT_BOOKCASE_ID;

  /**
   * Opens the seed gate. Assigned by the promise below, whose executor runs
   * synchronously during field initialization — so the resolver exists before
   * any method can be called.
   */
  private openSeedGate: () => void = () => {};

  /**
   * Resolves once `init()` has finished seeding (or given up on it). Every
   * page load waits on this before touching the books table — see the module
   * docblock. It is created here rather than in `init` because the virtualizer
   * can ask for a page before `init` is even called: the world only reaches it
   * after `loadBookcases()` resolves, and that is itself a database round trip.
   */
  private readonly seeded: Promise<void> = new Promise<void>((resolve) => {
    this.openSeedGate = resolve;
  });

  /** Highest occupied floor (>= 0), refreshed on init and reloads. */
  maxFloor = 0;

  /** Which bookcase is on screen (QA probes, the world's own bookkeeping). */
  get bookcaseId(): string {
    return this.caseId;
  }

  /**
   * First-run: fold any pre-bookcase library into a case, seed, then load
   * page 0. When even the seeded page comes back empty (stubbed SQLite in
   * plain-browser dev), fall back to the deterministic demo library so the
   * shelf is never blank.
   *
   * `ensureBookcases()` runs BEFORE `seedIfEmpty()` on purpose: the welcome
   * book is created with no explicit case and resolves the open one from
   * `settings`, so the case it belongs to has to exist first.
   */
  async init(bookcaseId: string = DEFAULT_BOOKCASE_ID): Promise<void> {
    this.caseId = bookcaseId;
    try {
      await ensureBookcases();
    } catch {
      // A failed migration must not stop the shelf drawing; the orphan sweep
      // runs again next start.
    }
    try {
      await seedIfEmpty();
    } catch {
      // Seeding is best-effort; the demo fallback below still populates.
    }
    // Whatever the virtualizer queued while the above was running may query
    // now — and only now.
    this.openSeedGate();
    // Its load, if it got there first; ours otherwise. Either way `init` does
    // not resolve until floor 0 is really on the shelf.
    await (this.pageLoads.get(0) ?? this.loadPage(0, false));
    await this.updateMaxFloor();
  }

  /**
   * Open a different bookcase. Everything cached is dropped first — a floor
   * that survived the switch would render the previous case's books against
   * the new case's timber, which is precisely the leak this store exists to
   * prevent. Listeners are notified for every floor that WAS loaded so the
   * world can empty those FloorViews even if the new case leaves them bare.
   */
  async setBookcase(bookcaseId: string): Promise<void> {
    if (this.destroyed || bookcaseId === this.caseId) return;
    const stale = [...this.floors.keys()];
    this.caseId = bookcaseId;
    this.demoMode = false;
    this.floors.clear();
    this.pages.clear();
    this.pendingPages.clear();
    if (this.debounce !== null) {
      clearTimeout(this.debounce);
      this.debounce = null;
    }
    this.maxFloor = 0;
    if (stale.length > 0) {
      for (const cb of this.listeners) cb(stale);
    }
    await this.loadPage(0, false);
    await this.updateMaxFloor();
  }

  /** Switch the display ordering; re-sorts loaded floors and notifies. */
  setSort(sort: ShelfSort): void {
    if (sort === this.sort || this.destroyed) return;
    this.sort = sort;
    const affected: number[] = [];
    for (const [floor, list] of this.floors) {
      if (list.length > 1) {
        const ordered = orderBooks(list, sort);
        list.splice(0, list.length, ...ordered);
      }
      affected.push(floor);
    }
    for (const cb of this.listeners) cb(affected);
  }

  /**
   * Re-fetch every loaded page from the data layer (after rename / pin /
   * duplicate / trash / restore / move mutations) and notify all floors.
   */
  async refreshAll(): Promise<void> {
    if (this.destroyed) return;
    const loaded = [...this.pages.keys()];
    this.pages.clear();
    for (const page of loaded) {
      await this.loadPage(page, true);
    }
    await this.updateMaxFloor();
  }

  /**
   * The most recently opened book among loaded floors (continue-reading
   * ribbon), or null when nothing has ever been opened.
   */
  recentBookId(): string | null {
    let best: string | null = null;
    let bestAt = '';
    for (const books of this.floors.values()) {
      for (const book of books) {
        const at = readShelfMeta(book)?.lastOpenedAt;
        if (at !== undefined && at > bestAt) {
          bestAt = at;
          best = book.id;
        }
      }
    }
    return best;
  }

  private async updateMaxFloor(): Promise<void> {
    try {
      const max = await maxOccupiedFloor(this.caseId);
      if (!this.destroyed) this.maxFloor = Math.max(0, max);
    } catch {
      // keep the previous value
    }
  }

  /** undefined = unknown yet; [] = known empty floor. */
  get(floor: number): Book[] | undefined {
    return this.floors.get(floor);
  }

  /** Search every loaded floor for a book id. */
  findBook(bookId: string): Book | null {
    for (const books of this.floors.values()) {
      for (const book of books) {
        if (book.id === bookId) return book;
      }
    }
    return null;
  }

  /** Ensure pages covering floors first..last are loaded or in flight. */
  ensureRange(first: number, last: number): void {
    if (this.destroyed) return;
    const firstPage = Math.floor(first / FLOOR_PAGE_SIZE);
    const lastPage = Math.floor(last / FLOOR_PAGE_SIZE);
    let queued = false;
    for (let page = firstPage; page <= lastPage; page++) {
      if (this.pages.has(page) || this.pendingPages.has(page)) continue;
      this.pendingPages.add(page);
      queued = true;
    }
    if (!queued || this.debounce !== null) return;
    this.debounce = setTimeout(() => {
      this.debounce = null;
      const pages = [...this.pendingPages];
      this.pendingPages.clear();
      // `false`, not "never a demo library": this fetch can legitimately be
      // the one that loads page 0 first, and it must then answer exactly as
      // `init` would have. The seed gate inside `loadPage` is what makes the
      // two interchangeable.
      for (const page of pages) void this.loadPage(page, false);
    }, FETCH_DEBOUNCE_MS);
  }

  onChange(cb: (floors: readonly number[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  destroy(): void {
    this.destroyed = true;
    // A store torn down before `init` ran must not leave a page load parked
    // on a gate nobody will ever open.
    this.openSeedGate();
    if (this.debounce !== null) clearTimeout(this.debounce);
    this.debounce = null;
    this.listeners.clear();
    this.floors.clear();
    this.pages.clear();
    this.pendingPages.clear();
    this.pageLoads.clear();
  }

  /**
   * May page `page` fall back to the invented demo library?
   *
   * Only page 0, only the default case — a second bookcase that comes back
   * empty IS empty, and filling it with forty invented books would be a lie
   * the reader cannot delete.
   *
   * `sticky` is the refresh rule: a re-read must never INVENT the demo
   * library, or emptying the case and re-reading it would repopulate it. It
   * only keeps a demo library that is already on screen.
   */
  private demoFallbackFor(page: number, sticky: boolean): boolean {
    if (page !== 0) return false;
    return sticky ? this.demoMode : this.caseId === DEFAULT_BOOKCASE_ID;
  }

  private loadPage(page: number, sticky: boolean): Promise<void> {
    if (this.destroyed || this.pages.has(page)) return Promise.resolve();
    const run = this.loadPageNow(page, sticky);
    this.pageLoads.set(page, run);
    return run.finally(() => {
      if (this.pageLoads.get(page) === run) this.pageLoads.delete(page);
    });
  }

  private async loadPageNow(page: number, sticky: boolean): Promise<void> {
    this.pages.set(page, 'loading');
    // THE SEED GATE (module docblock). Claiming the page above and querying
    // below are deliberately on opposite sides of it: the claim is what stops
    // two loads of the same page, and the wait is what stops any of them
    // reading a books table `seedIfEmpty()` has not finished writing.
    await this.seeded;
    if (this.destroyed) return;
    const start = page * FLOOR_PAGE_SIZE;
    const end = start + FLOOR_PAGE_SIZE - 1;
    const caseId = this.caseId;
    const allowDemoFallback = this.demoFallbackFor(page, sticky);
    let books: Book[] = [];
    try {
      books = await listBooksByFloorRange(start, end, caseId);
    } catch {
      books = [];
    }
    // A switch that landed while this page was in flight: the rows belong to
    // a case nobody is looking at any more, so drop them rather than shelve
    // them in the wrong room.
    if (this.destroyed || caseId !== this.caseId) return;
    if (allowDemoFallback && page === 0 && books.length === 0) {
      this.demoMode = true;
      books = demoBooks(caseId);
    } else if (this.demoMode) {
      // Demo library only stocks floors 0-5; deeper pages stay empty.
      books = [];
    }
    for (let floor = start; floor <= end; floor++) this.floors.set(floor, []);
    for (const book of books) {
      let list = this.floors.get(book.floor);
      if (list === undefined) {
        list = [];
        this.floors.set(book.floor, list);
      }
      list.push(book);
    }
    for (let floor = start; floor <= end; floor++) {
      const list = this.floors.get(floor);
      if (list !== undefined && list.length > 1) {
        const ordered = orderBooks(list, this.sort);
        list.splice(0, list.length, ...ordered);
      }
    }
    this.pages.set(page, 'ready');
    const affected: number[] = [];
    for (let floor = start; floor <= end; floor++) affected.push(floor);
    for (const cb of this.listeners) cb(affected);
  }
}
