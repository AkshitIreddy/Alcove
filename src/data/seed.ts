import { createBook } from './books';
import { getDb } from './db';
import { createPage } from './pages';

/**
 * FNV-1a 32-bit hash (inlined on purpose — the data layer must not depend on
 * src/art). Same recipe the spine baker uses, so seeds are deterministic and
 * stable across reinstalls: identical titles always grow identical spines.
 */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

interface SeedBookSpec {
  readonly title: string;
  readonly floor: number;
  readonly slot: number;
}

/**
 * 24 starter books across floors 0-4. Slots are intentionally gappy so the
 * shelves read as lived-in rather than freshly stocked.
 */
const SEED_BOOKS: readonly SeedBookSpec[] = [
  // Floor 0 — the sciences
  { title: 'Cell Biology', floor: 0, slot: 0 },
  { title: 'Organic Chemistry (send help)', floor: 0, slot: 1 },
  { title: 'Physics: Waves & Wobbles', floor: 0, slot: 3 },
  { title: 'Lab Notebook, Semester 3', floor: 0, slot: 4 },
  { title: 'Astronomy Log', floor: 0, slot: 7 },
  // Floor 1 — math & computing
  { title: 'Linear Algebra', floor: 1, slot: 0 },
  { title: 'Calculus II: The Redemption', floor: 1, slot: 2 },
  { title: 'Huffman Coding (with kittens)', floor: 1, slot: 3 },
  { title: 'Rust Borrow Checker Diary', floor: 1, slot: 5 },
  { title: 'SQL Spellbook', floor: 1, slot: 8 },
  // Floor 2 — languages
  { title: 'Kanji Practice', floor: 2, slot: 1 },
  { title: 'French Verbs I Keep Forgetting', floor: 2, slot: 2 },
  { title: 'Latin Roots & Word Nerdery', floor: 2, slot: 4 },
  { title: 'Sign Language Notes', floor: 2, slot: 6 },
  { title: 'Haiku Attempts (be nice)', floor: 2, slot: 7 },
  // Floor 3 — arts & craft
  { title: 'Watercolor Basics', floor: 3, slot: 0 },
  { title: 'Figure Drawing Warmups', floor: 3, slot: 1 },
  { title: 'Music Theory Scraps', floor: 3, slot: 4 },
  { title: 'Typography Crushes', floor: 3, slot: 5 },
  { title: 'Bookbinding Experiments', floor: 3, slot: 8 },
  // Floor 4 — life, observed
  { title: 'Birdwatching Field Notes', floor: 4, slot: 2 },
  { title: 'Tea Tasting Journal', floor: 4, slot: 3 },
  { title: 'Recipes That Actually Worked', floor: 4, slot: 6 },
  { title: 'Dream Journal (do not read)', floor: 4, slot: 9 },
];

/**
 * First-run seeding: if the library is empty, stock floors 0-4 with 24
 * starter books, each holding one empty starter page. Returns true when
 * seeding ran, false when books already existed.
 */
export async function seedIfEmpty(): Promise<boolean> {
  const db = await getDb();
  const existing = await db.select<Array<{ id: string }>>(
    'SELECT id FROM books LIMIT 1',
  );
  if (existing.length > 0) return false;

  for (const spec of SEED_BOOKS) {
    const book = await createBook({
      title: spec.title,
      floor: spec.floor,
      slot: spec.slot,
      spineSeed: fnv1a(spec.title),
    });
    await createPage({ bookId: book.id, ord: 0 });
  }
  return true;
}
