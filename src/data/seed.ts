/**
 * First-run seeding + seed migrations.
 *
 * Seeds ONE "Welcome to Bellanote ✎" book whose pages are authored in Notebook
 * Script (parsed + mapped to editor JSON at seed time, with the verbatim
 * source stored per page so "Export Script" shows it).
 *
 * Two migrations have accumulated, and both are written to touch as little as
 * possible, because everything here runs against a library someone may have
 * spent months in:
 *
 *   v1 → v2  installs that ran the old 24-demo-book seed. Any book whose title
 *            is in the old demo list AND whose pages are all empty is deleted;
 *            a demo book the user actually wrote in is never touched.
 *   v2 → v3  the app was renamed, so the welcome book is RETITLED in place
 *            rather than reseeded. See renameLegacyWelcomeBook.
 *
 * The current seed version lives in the `settings` table under 'seedVersion'.
 */

import { parse } from '../script';
import { scriptDocToTiptap } from '../editor/script/toTiptap';
import { createBook, deleteBook } from './books';
import { getDb, type Db } from './db';
import { createPage, listPages } from './pages';
import type { PageDoc } from './types';

/** Bump when the seed contents change in a way that needs a migration. */
export const SEED_VERSION = 3;

/** `settings` table key holding the last-applied seed version. */
export const SEED_VERSION_KEY = 'seedVersion';

export const WELCOME_BOOK_TITLE = 'Welcome to Bellanote ✎';

/**
 * What the welcome book was called before the app was renamed (v2 → v3).
 *
 * This is not just history: the title is also the identity check that stops a
 * second welcome book being seeded. Renaming the constant without knowing the
 * old value would make every existing library fail its own existence test and
 * grow a duplicate, so v3 RENAMES the book in place instead.
 */
export const LEGACY_WELCOME_BOOK_TITLE = 'Welcome to Notebook ✎';

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

/**
 * Spine seed for the welcome book. Deterministic from the title, so reinstalls
 * grow an identical spine.
 *
 * It used to carry a +3 nudge chosen to land the seed on palette 0 (warm
 * amber). That is gone: the binding below is authored outright, and an
 * explicit per-book style always beats anything derived from the seed, so
 * tuning the hash to hit a colour would have been a decoration that decided
 * nothing. The seed still drives the details the style does not name.
 */
export const WELCOME_SPINE_SEED = fnv1a(WELCOME_BOOK_TITLE) >>> 0;

/**
 * The welcome book's binding, authored rather than rolled.
 *
 * This is the first object a reader ever sees on the shelf, and it was warm
 * amber cloth with whatever the seed happened to give it — which read as the
 * default it was. It is the app's calling card, so it is dressed like one:
 * claret leather, four raised cords with gilt rules either side, wrapped
 * endbands, a gilt title plate and gilt edges, quarto and stout so it has some
 * presence beside a pocket paperback.
 *
 * ## `pigment` is not the colour its name says
 *
 * Choosing one by name is a trap. `PIGMENT_LABELS` and `flat.CLOTH_SPECS` are
 * two independently ordered tables and `spines.clothForPalette` folds one onto
 * the other; twenty-six of the fifty pigments now land on a cloth of the same
 * name and the other twenty-four land on the nearest one there is. This
 * binding was authored as *oxblood* when the fold still sent oxblood, rust and
 * clay all to terracotta, and it shipped terracotta. Neither the compiler nor
 * a test caught it; a screenshot did. So every candidate below was rendered on
 * the real shelf before it was written down (`shots-now/welcome-binding.mjs`,
 * `shots-now/defaults/board-pigment3.png`).
 *
 * ## Why claret
 *
 * Pigment 20 is captioned *Burgundy* and paints cloth **Claret** `#a44c60` —
 * verified, not assumed. Five deep candidates were photographed against the
 * default room, and claret won for reasons the names would not have given:
 *
 *  - the room is Verdigris Library, a blue-green case, so a red is the
 *    complement and the book separates from the case at any zoom. `forest`
 *    disappeared into the timber, `navy` went quiet against it;
 *  - **oxblood now folds correctly, and that is exactly why it is wrong here**
 *    — `#ae4e40` is one hop from the `oxblood` cloth in Verdigris's own six,
 *    so the calling card would have worn what a random new book wears. This is
 *    the same trap as before, arriving from the opposite direction;
 *  - `plum` (what this shipped previously) survives the fold as itself but is
 *    a muted mauve: beside gilt bands and a gilt plate it reads dusty rather
 *    than bound. Claret is the same family with the value a fine binding has.
 *
 * `thickness` is pinned, which the seed did not do before. It defaults from
 * page count, and five pages gave a sliver whose raised bands and title plate
 * had no room to be anything; 44 world px is the `stout` class, and it is what
 * makes the object read as a bound volume rather than a coloured stripe
 * (`shots-now/defaults/board-thickness.png`). `format` stays quarto — folio
 * measurably changed nothing on screen.
 *
 * Wear is low but not zero. A pristine 0 makes an object look like a render;
 * a little softening at the corners is what makes it look like a book.
 *
 * Stored under `cover_meta.style`, which is the Book Studio's own format
 * (library-themes.md §4) — so a reader can open the studio and change any of
 * it, and the room may never repaint it behind their back.
 */
export const WELCOME_BINDING: Readonly<Record<string, unknown>> = {
  material: 'leather',
  // Captioned "Burgundy"; paints cloth Claret #a44c60. See the note above —
  // the caption and the cloth are two tables, and only a render settles it.
  pigment: 20,
  hueJitter: 0,
  raisedBands: 4,
  bandGilt: true,
  headTail: true,
  headTailStyle: 2, // wrapped cord
  ornament: 9, // Quill
  titlePlate: 'gilt',
  titleFont: 0,
  wear: 0.1,
  edge: 'gilt',
  format: 'quarto',
  thickness: 44, // 'stout' — a five-page book would otherwise be a sliver
};

/**
 * Titles created by the retired v1 seed (24 demo books). Used only by the
 * v1 → v2 cleanup; never re-created.
 */
export const OLD_DEMO_TITLES: readonly string[] = [
  'Cell Biology',
  'Organic Chemistry (send help)',
  'Physics: Waves & Wobbles',
  'Lab Notebook, Semester 3',
  'Astronomy Log',
  'Linear Algebra',
  'Calculus II: The Redemption',
  'Huffman Coding (with kittens)',
  'Rust Borrow Checker Diary',
  'SQL Spellbook',
  'Kanji Practice',
  'French Verbs I Keep Forgetting',
  'Latin Roots & Word Nerdery',
  'Sign Language Notes',
  'Haiku Attempts (be nice)',
  'Watercolor Basics',
  'Figure Drawing Warmups',
  'Music Theory Scraps',
  'Typography Crushes',
  'Bookbinding Experiments',
  'Birdwatching Field Notes',
  'Tea Tasting Journal',
  'Recipes That Actually Worked',
  'Dream Journal (do not read)',
];

// ---------------------------------------------------------------------------
// Welcome book content (authored as Notebook Script)
// ---------------------------------------------------------------------------

/**
 * The welcome/guide pages, one Notebook Script source per page. Parsed with
 * `parse()` and mapped with `scriptDocToTiptap()` at seed time; the verbatim
 * source is stored on each page so Export Script works out of the box.
 */
export const WELCOME_PAGE_SOURCES: readonly string[] = [
  // Page 1 — what Bellanote is + how to get around
  `---
paper: cream
wash: amber
---

# Welcome to Bellanote ✎ {sticker=star}

This is your **library**. Every book on the shelf opens into pages like this one — ==real, editable pages=={color=amber}, not a demo.

::: callout {variant=tip}
Click anywhere below the ink and just start typing. Everything autosaves as you write.
:::

- The **shelf** goes on forever — drag to pan, scroll to zoom
- **Click a spine** and the book comes off the shelf and opens. Wrong one? Press \`Esc\` and it goes back
- Use the **arrow keys** to flip through a book's pages

> Flip to the next page to meet the editor → {washi=top}
`,

  // Page 2 — writing + slash commands
  `# Writing {sticker=book}

Write like in any notes app — then press \`/\` on an empty line to open the **slash menu**: headings, lists, tables, callouts, stickers, diagrams…

## Try it

- [ ] Press \`/\` and insert a callout
- [ ] Grab a block's **drag handle** to reorder it
- [ ] Right-click a block for quick actions

Inline styles: **bold**, *italic*, \`code\`, ~~strikethrough~~, ==highlight=={color=lemon}, and ==colored washes=={color=sky}.

::: sticky-note {color=lemon, rotate=-2}
Sticky notes are blocks too — pick me up and move me anywhere!
:::
`,

  // Page 3 — stickers & effects showcase
  `# Make it yours {sticker=flower}

Blocks can wear decorations — stickers, tape, washi strips, a little tilt…

::: columns {gap=lg}
::: col
::: card {color=sky, tape=top}
A **card** held down with tape.
:::
:::
::: col
::: quote-card {color=blush}
"A quote worth keeping."
:::
:::
:::

::: banner {color=moss}
Banners announce things loudly.
:::

::: spoiler
Hidden until you peek — great for quiz answers.
:::

Highlights come in seven washes: ==amber=={color=amber}, ==moss=={color=moss}, ==sky=={color=sky}, ==blush=={color=blush}, ==terracotta=={color=terracotta}.
`,

  // Page 4 — diagram example
  `# Diagrams {sticker=microscope}

Fenced mini-languages render as hand-drawn diagrams. A \`tree\`:

\`\`\`tree {style=watercolor}
Bellanote
  Shelf
    Floors | endless
    Books
  Pages
    Blocks
    Diagrams | like this one
\`\`\`

And a \`timeline\`:

\`\`\`timeline
1: Pull a book off the shelf
2: Write and decorate | color=amber
3: Flip to a fresh page
\`\`\`
`,

  // Page 5 — the AI-script workflow + closing hint
  `# Your AI can write pages {sticker=sparkle}

Every page in this book was written in **Notebook Script** — a forgiving Markdown dialect any AI assistant can produce.

1. Open any page and click **Insert script** in the toolbar
2. Click **Copy AI spec** and paste the spec into your AI chat
3. Ask it to write a page — paste its reply into the dialog and insert

::: callout {variant=info}
The parser is tolerant: small syntax slips still render, with gentle warnings instead of errors.
:::

::: callout {variant=star}
This very page has script source attached — try **Export script** to read it.
:::

Happy writing! {sticker=heart}
`,
];

/**
 * Node types registered in the real editor schema (src/editor/nodes/index.ts
 * registry + extensions.ts). Passed as `hasNode` so seeding emits real
 * sticker/diagram/container nodes instead of fallback placeholders.
 * Keep in sync with the registry — names match vocab.ts canonical names.
 */
const EDITOR_NODE_NAMES: ReadonlySet<string> = new Set([
  'callout',
  'imageRow',
  'sticker',
  'diagram',
  'linkCard',
  'sticky-note',
  'polaroid',
  'washi-box',
  'card',
  'quote-card',
  'banner',
  'spoiler',
  'columns',
  'col',
]);

/** Build the welcome book's page documents from the script sources. */
export function buildWelcomePageDocs(): Array<{
  doc: PageDoc;
  source: string;
}> {
  return WELCOME_PAGE_SOURCES.map((source) => ({
    doc: scriptDocToTiptap(parse(source), {
      hasNode: (name) => EDITOR_NODE_NAMES.has(name),
    }),
    source,
  }));
}

// ---------------------------------------------------------------------------
// Migration decision logic (pure — unit tested)
// ---------------------------------------------------------------------------

/**
 * True when a page document holds no user content: no blocks at all, or
 * nothing but paragraphs with no inline content. Anything else (any text,
 * any non-paragraph block) counts as content — deletion must be safe.
 */
export function isEmptyPageDoc(doc: PageDoc): boolean {
  const content = doc.content;
  if (content === undefined || content.length === 0) return true;
  return content.every((node) => {
    if (node === null || typeof node !== 'object') return false;
    const block = node as { type?: unknown; content?: unknown };
    if (block.type !== 'paragraph') return false;
    const inner = block.content;
    return inner === undefined || (Array.isArray(inner) && inner.length === 0);
  });
}

/**
 * v1 → v2 cleanup decision: delete only books that (a) carry an old demo
 * title, and (b) have no user content on any page. A demo book with even a
 * single non-empty page is kept; user-created books are never candidates.
 */
export function isDeletableDemoBook(
  title: string,
  pageDocs: readonly PageDoc[],
): boolean {
  if (title === WELCOME_BOOK_TITLE || title === LEGACY_WELCOME_BOOK_TITLE) return false;
  if (!OLD_DEMO_TITLES.includes(title)) return false;
  return pageDocs.every(isEmptyPageDoc);
}

// ---------------------------------------------------------------------------
// Seed version bookkeeping
// ---------------------------------------------------------------------------

async function readSeedVersion(db: Db): Promise<number> {
  const rows = await db.select<Array<{ value: string }>>(
    'SELECT value FROM settings WHERE key = $1 LIMIT 1',
    [SEED_VERSION_KEY],
  );
  if (rows.length === 0) return 0;
  const parsed = Number.parseInt(rows[0].value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function writeSeedVersion(db: Db, version: number): Promise<void> {
  await db.execute(
    'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)',
    [SEED_VERSION_KEY, String(version)],
  );
}

// ---------------------------------------------------------------------------
// Seeding + migration entry point
// ---------------------------------------------------------------------------

async function cleanupOldDemoBooks(db: Db): Promise<void> {
  const rows = await db.select<Array<{ id: string; title: string }>>(
    'SELECT id, title FROM books',
  );
  for (const row of rows) {
    if (!OLD_DEMO_TITLES.includes(row.title)) continue;
    const pages = await listPages(row.id);
    if (isDeletableDemoBook(row.title, pages.map((p) => p.doc))) {
      await deleteBook(row.id);
    }
  }
}

/**
 * Both titles count. A library seeded before the rename holds the legacy one,
 * and asking only about the current title would tell us the welcome book is
 * missing and seed a second copy beside it.
 */
async function welcomeBookExists(db: Db): Promise<boolean> {
  const rows = await db.select<Array<{ id: string }>>(
    'SELECT id FROM books WHERE title IN ($1, $2) LIMIT 1',
    [WELCOME_BOOK_TITLE, LEGACY_WELCOME_BOOK_TITLE],
  );
  return rows.length > 0;
}

/**
 * v2 → v3: the app was renamed, so the book that welcomes you to it is
 * renamed in place. Retitling rather than reseeding is the whole point — the
 * reader may have written in it, and it is still their book.
 *
 * The spine is deliberately left alone. Its seed is derived from the title, so
 * regenerating it would change the object on the shelf under someone who had
 * come to recognise it, to no benefit.
 */
async function renameLegacyWelcomeBook(db: Db): Promise<void> {
  await db.execute('UPDATE books SET title = $1 WHERE title = $2', [
    WELCOME_BOOK_TITLE,
    LEGACY_WELCOME_BOOK_TITLE,
  ]);
}

async function createWelcomeBook(): Promise<void> {
  const book = await createBook({
    title: WELCOME_BOOK_TITLE,
    floor: 0,
    slot: 3,
    spineSeed: WELCOME_SPINE_SEED,
    coverMeta: { style: { ...WELCOME_BINDING } },
  });
  const pages = buildWelcomePageDocs();
  for (let i = 0; i < pages.length; i += 1) {
    await createPage({
      bookId: book.id,
      ord: i,
      doc: pages[i].doc,
      scriptSource: pages[i].source,
    });
  }
}

/**
 * Seed + migrate on app load (name kept for existing callers).
 *
 * - seedVersion >= 3: nothing to do.
 * - seedVersion < 3 (fresh installs, installs that ran the old v1 seed, and
 *   installs sitting at v2 from before the rename): delete pristine v1 demo
 *   books, retitle a legacy welcome book if there is one, create the welcome
 *   book if none exists, then record seedVersion = 3.
 *
 * The order matters. Renaming BEFORE the existence check is what stops a v2
 * library growing a second welcome book — though the check reads both titles
 * as well, because a migration that is only correct in one order is a trap.
 *
 * Returns true when the welcome book was created by this call.
 */
export async function seedIfEmpty(): Promise<boolean> {
  const db = await getDb();
  if ((await readSeedVersion(db)) >= SEED_VERSION) return false;

  await cleanupOldDemoBooks(db);
  await renameLegacyWelcomeBook(db);
  const exists = await welcomeBookExists(db);
  if (!exists) await createWelcomeBook();
  await writeSeedVersion(db, SEED_VERSION);
  return !exists;
}
