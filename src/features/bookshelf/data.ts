/**
 * features/bookshelf/data.ts — floor data store for the shelf world.
 *
 * Floors are paged from the data layer 8 at a time (debounced, deduped by
 * page). `get(floor)` returns undefined while a page is in flight, [] for a
 * known-empty floor, or the floor's books sorted by slot.
 *
 * Non-Tauri dev fallback: when the SQLite layer is a stub and returns nothing
 * even after seedIfEmpty(), ~40 deterministic demo books (spine_seed =
 * fnv1a(title), floors 0–5 with varied counts per floor) keep the shelf
 * visually populated.
 */

import {
  listBooksByFloorRange,
  maxOccupiedFloor,
  readShelfMeta,
} from '../../data/books';
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
export function demoBooks(): Book[] {
  const now = new Date().toISOString();
  return DEMO_BOOKS.map((spec) => ({
    id: `demo-${fnv1a(spec.title).toString(16).padStart(8, '0')}`,
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
  private readonly listeners = new Set<(floors: readonly number[]) => void>();
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private demoMode = false;
  private sort: ShelfSort = 'manual';

  /** Highest occupied floor (>= 0), refreshed on init and reloads. */
  maxFloor = 0;

  /**
   * First-run: seed the library, then load page 0. When even the seeded page
   * comes back empty (stubbed SQLite in plain-browser dev), fall back to the
   * deterministic demo library so the shelf is never blank.
   */
  async init(): Promise<void> {
    try {
      await seedIfEmpty();
    } catch {
      // Seeding is best-effort; the demo fallback below still populates.
    }
    await this.loadPage(0, true);
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
      await this.loadPage(page, page === 0 && this.demoMode);
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
      const max = await maxOccupiedFloor();
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
      for (const page of pages) void this.loadPage(page, false);
    }, FETCH_DEBOUNCE_MS);
  }

  onChange(cb: (floors: readonly number[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.debounce !== null) clearTimeout(this.debounce);
    this.debounce = null;
    this.listeners.clear();
    this.floors.clear();
    this.pages.clear();
    this.pendingPages.clear();
  }

  private async loadPage(page: number, allowDemoFallback: boolean): Promise<void> {
    if (this.destroyed || this.pages.has(page)) return;
    this.pages.set(page, 'loading');
    const start = page * FLOOR_PAGE_SIZE;
    const end = start + FLOOR_PAGE_SIZE - 1;
    let books: Book[] = [];
    try {
      books = await listBooksByFloorRange(start, end);
    } catch {
      books = [];
    }
    if (this.destroyed) return;
    if (allowDemoFallback && page === 0 && books.length === 0) {
      this.demoMode = true;
      books = demoBooks();
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
