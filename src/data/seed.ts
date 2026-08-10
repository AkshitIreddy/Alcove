/**
 * First-run seeding + seed migrations.
 *
 * Seeds ONE "Welcome to Alcove ✎" book whose pages are authored in Notebook
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
 *   v2 → v3  Notebook → Bellanote. The welcome book is RETITLED in place rather
 *            than reseeded. See renameLegacyWelcomeBook.
 *   v3 → v4  Bellanote → Alcove, the same way — and the reason the old title is
 *            now a LIST. A library that skipped v3 is still sitting on
 *            "Welcome to Notebook ✎", so the migration has to sweep every past
 *            name, not just the most recent one.
 *   v4 → v5  the welcome book was rewritten (five pages to sixteen). The BOOK
 *            is kept — same row, same id, same spine, same slot on the shelf —
 *            and only its PAGES are replaced, and only when every one of them
 *            is still exactly as it was seeded. See refreshWelcomeBook.
 *   v5 → v6  rewritten again (sixteen pages to thirty-two), by the same
 *            machinery: half the v5 pages stopped two thirds of the way down
 *            the leaf and the tour was thinner than the app.
 *   v6 → v7  the same thirty-two leaves, re-cut. Every v6 page was authored
 *            against a budget measured in a 1600x1000 window and the app opens
 *            at 1280x800, so each one arrived a third over the leaf it landed
 *            on and the drain grew the book from 32 leaves to 46 the first
 *            time anybody opened it. Same machinery again.
 *   v7 → v8  expanded into a forty-eight-leaf field guide: a progressive,
 *            learn-by-doing tour of the editor, catalogue, diagrams,
 *            navigation, history, media and ways in and out. The outgoing v7
 *            sources remain byte-identical below, so only an untouched tour
 *            is refreshed.
 *   v8 → v9  changed the untouched Welcome cover marker from Forest to Navy.
 *   v9 → v10 makes the untouched Welcome marker pair Crimson outside and the
 *            Festive / Gift ribbon design inside.
 *   v10 → v11 makes both untouched Welcome markers blue: Navy outside and a
 *             broad Cornflower silk marker inside.
 *   v11 → v12 removes the untouched Welcome book's outer marker and striped
 *             endbands, and pins its previously seed-rolled silhouette to the
 *             solid square case. The blue between-page ribbon stays.
 *   v12 → v13 rebinds only the untouched Welcome book as a formal crown
 *             presentation volume: a restrained gilt fillet and one crown
 *             replace the quill programme and applied brass corners. The
 *             unreleased v15 edition moves that authored dressing to blue.
 *   v13 → v14 moves every stored BOOK appearance onto the rebuilt binding
 *             vocabulary. Pages, book identity, shelf position, room
 *             carpentry and wallpaper are deliberately outside this step.
 *   v14 → v15 refreshes the Welcome field guide for the rebuilt, titleless-
 *             spine book system, portable local pictures and the optional
 *             keep-current updater preference. As before, edited pages move
 *             only when their reader explicitly opted in.
 *   v15 → v16 gives the untouched Grand-blue Welcome binding its authored
 *             Renaissance panel, engraved title hand and formal Gilt Quarto
 *             construction. A foliate lozenge replaces the rejected velvet
 *             crown programme; no page content changes.
 *
 * The current seed version lives in the `settings` table under 'seedVersion'.
 */

import { parse } from '../script';
import { materializeStableBlockIds } from '../editor/blockIdentity';
import { scriptDocToTiptap } from '../editor/script/toTiptap';
import { normaliseBookPresetId } from '../art/bookDesign';
import { normalizeBookStyleOverrides } from '../art/bookStyle';
import { normalizeCoverOverrides } from '../art/covers';
import { createBook, deleteBook } from './books';
import { getDb, type Db } from './db';
import { bookBinding, loadDesignPrefs, saveBookBinding } from './designPrefs';
import { removePageIndex } from './search';
import { createPage, listPages, savePageDoc, setPageScript } from './pages';
import type { PageDoc } from './types';

/**
 * Bump when the seed contents change in a way that needs a migration.
 *
 * v5: rewritten from five pages to sixteen, to show the things the app grew
 * after the first version was written — maths, footnotes, page references,
 * toggles, columns, the stationery and keepsake drawers, and some pictures.
 *
 * v6: rewritten again, sixteen pages to thirty-two, for the defect the reader
 * reported — "a lot of pages have empty space at the second half". Measured
 * rather than eyeballed (`scripts/probe-welcome.mjs`, which walks the book in
 * the running app and reports how far down each leaf the writing reaches): the
 * v5 median was 51% of the leaf and one page stopped at 36%. This generation
 * comes back at 81% with nothing overflowing, and shows the eight things v5
 * only described — code fences, mindmaps and flowcharts, the postal and
 * accounts drawers, `::let` and `::style`, sub- and superscript, the lettering
 * axes, and the page's own paper.
 *
 * v7: the same thirty-two leaves, re-cut for the window the app actually
 * opens at. v6 was measured with `probe-welcome.mjs` at 1600x1000 and came
 * back at 81% of the leaf with nothing overflowing — and both halves of that
 * were true only in a window `tauri.conf.json` never opens.
 * `src-tauri/tauri.conf.json` starts the app at 1280x800, where a leaf holds
 * 19.41 lines rather than 25.66 AND the column narrows from 592px to 434px, so
 * the same words wrap half again as often. Every v6 page costed 136% of that
 * leaf on average, which is why opening the book turned 32 pages into 46.
 * Nothing here changes what the tour teaches: the leaves and their subjects
 * are v6's, said in fewer words, with the second card dropped from the pages
 * that carried two.
 *
 * See refreshWelcomeBook for what a bump does to a library that already has a
 * welcome book: nothing at all unless every page in it is still ours, or the
 * reader explicitly opted into replacing their edited guide on updates.
 *
 * v8: forty-eight leaves, deliberately organised as a journey rather than a
 * feature list. The design follows the strongest current onboarding pattern:
 * useful sample data first, then guided action, then progressive discovery.
 * See the research note above WELCOME_PAGE_SOURCES.
 */
export const SEED_VERSION = 16;

/** `settings` table key holding the last-applied seed version. */
export const SEED_VERSION_KEY = 'seedVersion';

/** Read only the one boot-time preference without hydrating the UI store. */
async function readRefreshWelcomePreference(db: Db): Promise<boolean> {
  const rows = await db.select<Array<{ value: string }>>(
    'SELECT value FROM settings WHERE key = $1 LIMIT 1',
    ['app'],
  );
  if (rows.length === 0) return false;
  try {
    const parsed: unknown = JSON.parse(rows[0].value);
    return parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      (parsed as Record<string, unknown>).refreshWelcomeBookOnUpdate === true;
  } catch {
    return false;
  }
}

const STUDIO_DESIGNS_KEY = 'studioDesigns';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Rewrite only the BOOK half of the Studio preference blob.
 *
 * The room half is copied verbatim. This migration is the hard boundary of
 * the rebuilt binding system, not an excuse to reinterpret a case's timber or
 * wallpaper. Retired named bindings and retired `own:` components resolve
 * through `normaliseBookPresetId` to the current formal book; junk is removed
 * so the book's deterministic current default can take over.
 */
export function normalizeStoredBookBindings(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (!isRecord(parsed)) return raw;

  const sourceBooks = isRecord(parsed.books) ? parsed.books : {};
  const books: Record<string, string> = {};
  for (const [bookId, binding] of Object.entries(sourceBooks)) {
    const safe = normaliseBookPresetId(binding);
    if (safe !== null) books[bookId] = safe;
  }
  return JSON.stringify({ ...parsed, books });
}

/**
 * Move a persisted Book Studio style through the current safe validator while
 * leaving every unrelated cover-meta section byte-for-byte equivalent.
 *
 * A pre-Studio `cover` section is normalized through the same active
 * frame/emblem/title/edge/charm rules as the renderer. The canonical `style`
 * section is rewritten too, so neither a reopen nor a later export can carry
 * retired book furniture forward.
 */
export function normalizeStoredBookCoverMeta(raw: string | null): string | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (!isRecord(parsed)) return raw;

  const next = { ...parsed };
  if (Object.prototype.hasOwnProperty.call(parsed, 'style')) {
    const style = normalizeBookStyleOverrides(parsed.style);
    if (style === null) delete next.style;
    else next.style = style;
  }
  if (Object.prototype.hasOwnProperty.call(parsed, 'cover')) {
    const cover = normalizeCoverOverrides(parsed.cover);
    if (cover === null) delete next.cover;
    else next.cover = cover;
  }
  return JSON.stringify(next);
}

/**
 * v14: force stored book appearances onto the new safe binding vocabulary.
 *
 * This deliberately does not select or update page rows, floor/slot columns,
 * book titles, room preferences, or the open-book pointer. The only database
 * surfaces in scope are the book-binding map and `cover_meta.style`.
 */
async function migrateBookAppearanceSystem(db: Db): Promise<void> {
  const designRows = await db.select<Array<{ value: string }>>(
    'SELECT value FROM settings WHERE key = $1 LIMIT 1',
    [STUDIO_DESIGNS_KEY],
  );
  const storedDesigns = designRows[0]?.value;
  if (storedDesigns !== undefined) {
    const normalized = normalizeStoredBookBindings(storedDesigns);
    if (normalized !== storedDesigns) {
      await db.execute('INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)', [
        STUDIO_DESIGNS_KEY,
        normalized,
      ]);
    }
  }

  const books = await db.select<Array<{ id: string; cover_meta: string | null }>>(
    'SELECT id, cover_meta FROM books WHERE cover_meta IS NOT NULL',
  );
  for (const book of books) {
    const normalized = normalizeStoredBookCoverMeta(book.cover_meta);
    if (normalized === book.cover_meta) continue;
    await db.execute('UPDATE books SET cover_meta = $1 WHERE id = $2', [
      normalized,
      book.id,
    ]);
  }
}

export const WELCOME_BOOK_TITLE = 'Welcome to Alcove ✎';

/**
 * Every title the welcome book has ever had, oldest first.
 *
 * This is not history for its own sake: the title is ALSO the identity check
 * that stops a second welcome book being seeded. A library still holding an old
 * title has to be recognised, or it fails its own existence test and grows a
 * duplicate beside the book its owner has been writing in.
 *
 * A LIST, because it was a single constant for one rename and that shape does
 * not survive the second: Notebook → Bellanote → Alcove means two old titles,
 * and a library that skipped a version holds the older of them. Append here,
 * never replace, and `brand.json` carries the same list so
 * `tests/brand-consistency.test.ts` can check the two agree.
 */
export const LEGACY_WELCOME_BOOK_TITLES: readonly string[] = [
  'Welcome to Notebook ✎',
  'Welcome to Bellanote ✎',
];

/**
 * The most recent old title.
 *
 * Kept because callers and tests read it by name; everything that has to be
 * CORRECT across more than one rename uses the list above.
 */
export const LEGACY_WELCOME_BOOK_TITLE =
  LEGACY_WELCOME_BOOK_TITLES[LEGACY_WELCOME_BOOK_TITLES.length - 1]!;

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
 * grand blue presentation boards, two raised cords, one foliate lozenge and
 * gilt edges, quarto and stout so it has some presence beside a pocket
 * paperback. Its binding preset is pinned separately to `gilt-quarto`; that
 * preset's square publisher case and continuous fillet supply the formal
 * silhouette instead of the seed's old waist or the rejected velvet crown.
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
 * ## Why grand blue
 *
 * Pigment 29 is captioned *Lapis* and paints the house Cobalt cloth. The
 * authored role colours below pin a deeper Grand palette explicitly, so this
 * calling card does not depend on two independently ordered colour tables:
 * a navy-blue spine, a slightly lighter royal-blue board and warm gilt tooling.
 *
 * The measured spine panel and two cords keep the blue field structured at
 * shelf scale. The front board spends the detail budget on one continuous
 * Renaissance panel, an engraved direct-gilt title and one foliate lozenge.
 *
 * The cool blue deliberately separates the Welcome volume from the default
 * walnut case and from the warmer mixed shelf, while the gold keeps it formal
 * rather than nautical or modern.
 *
 * `thickness` is pinned, which the seed did not do before. It defaults from
 * page count, and five pages gave a sliver whose raised bands and gilt tooling
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
/** Exact pre-blue crown edition, recognised only so an untouched guide upgrades. */
const V13_CLARET_WELCOME_BINDING: Readonly<Record<string, unknown>> = {
  pigment: 20,
  hueJitter: 0,
  raisedBands: 2,
  bandGilt: true,
  gilt: true,
  headTail: false,
  ornament: 20,
  titlePlate: 'gilt-direct',
  titleFont: 0,
  wear: 0.08,
  edge: 'gilt',
  format: 'quarto',
  thickness: 44,
  charm: 'none',
  coverFrame: 26,
  coverMedallion: 20,
  cornerProtectors: false,
  insetPlate: false,
};

/** Exact v15 Grand-blue exterior, recognized so an untouched guide upgrades. */
const V15_BLUE_WELCOME_BINDING: Readonly<Record<string, unknown>> = {
  // Lapis is the named picker fallback; exact roles pin the authored Grand blue.
  pigment: 29,
  hueJitter: 0,
  spineBaseHex: '#394c70',
  spineAccentHex: '#2f3d5b',
  coverBaseHex: '#475d82',
  coverAccentHex: '#314564',
  toolingHex: '#f1d16f',
  emblemHex: '#f7e09a',
  // Two cords frame the crown without turning the titleless spine into a
  // ladder. Three remains available in the Studio for readers who deliberately
  // want a heavily corded volume; the authored Welcome binding stays quieter.
  raisedBands: 2,
  bandGilt: true,
  gilt: true,
  // No striped endband: at shelf scale its alternating pale/red strokes read
  // as an unexplained mark on the spine rather than as sewn thread.
  headTail: false,
  ornament: 20, // Crown — the same heraldic tool used on the front board
  titlePlate: 'gilt-direct',
  titleFont: 0,
  wear: 0.05,
  edge: 'gilt',
  format: 'quarto',
  thickness: 44, // 'stout' — a five-page book would otherwise be a sliver
  // A grand presentation-cloth hierarchy chosen as one coherent programme:
  // one heavy-and-fine fillet with authored fleurons, direct gilt lettering,
  // and one crown. Applied corner hardware and an inset title plaque made the
  // crown compete with two other focal programmes. The between-page marker is enough; the outer
  // ribbon accessory made the closed book look as if it carried two bookmarks.
  charm: 'none',
  coverFrame: 26, // Fillet & Fleurons — nested rules with formal corner tools
  coverMedallion: 20, // Crown — the same device as the spine
  cornerProtectors: false,
  insetPlate: false,
};

/** Exact pre-release Grand Crown Velvet edition, accepted for replacement. */
const V16_VELVET_WELCOME_BINDING: Readonly<Record<string, unknown>> = {
  ...V15_BLUE_WELCOME_BINDING,
  titleFont: 44,
  coverFrame: 48,
};

/**
 * The current Grand-blue Welcome exterior.
 *
 * The Renaissance panel supplies one continuous architectural perimeter and
 * restrained acanthus returns. Engraved direct gilt gives the title the same
 * formal register without adding a label or badge. A broad foliate lozenge is
 * the single focal on both faces; it reads as binder's tooling rather than a
 * costume crown, shield or themed prop.
 */
export const WELCOME_BINDING: Readonly<Record<string, unknown>> = {
  ...V15_BLUE_WELCOME_BINDING,
  ornament: 0, // Foliate lozenge — broad, formal and legible at shelf width
  titleFont: 44, // Engraved — reader-legible formal caps from the curated case
  coverFrame: 48, // Renaissance Panel — banded architectural corner returns
  coverMedallion: 0, // The same foliate lozenge as the titleless spine
};

/**
 * The binding preset pinned to an untouched Welcome book.
 *
 * `gilt-quarto` supplies a square formal publisher binding. The explicit style
 * uses two gilt cords and one broad foliate lozenge; the resolver quiets the
 * preset fillet while that focal tool is present, avoiding two stacked ornate
 * systems on a narrow spine. This deliberately does not pin the coarse material
 * control: the named binding owns its smooth presentation cloth. The straight
 * back stays unmistakably booklike at shelf width; rounded caps read as a
 * canister.
 */
export const WELCOME_BOOK_PRESET = 'gilt-quarto';

/** Exact v12 shipped style, used only to upgrade an untouched quill binding. */
const V12_QUILL_WELCOME_BINDING: Readonly<Record<string, unknown>> = {
  material: 'leather',
  pigment: 20,
  hueJitter: 0,
  raisedBands: 4,
  bandGilt: true,
  gilt: true,
  headTail: false,
  ornament: 9,
  titlePlate: 'gilt',
  titleFont: 0,
  wear: 0.1,
  edge: 'gilt',
  format: 'quarto',
  thickness: 44,
  charm: 'none',
  coverFrame: 21,
  coverMedallion: 9,
  cornerProtectors: true,
  insetPlate: true,
};

/** Exact v9–v11 shipped style, used only to recognise an untouched cover. */
const LEGACY_MARKED_WELCOME_BINDING: Readonly<Record<string, unknown>> = {
  material: 'leather',
  pigment: 20,
  hueJitter: 0,
  raisedBands: 4,
  bandGilt: true,
  gilt: true,
  headTail: true,
  headTailStyle: 2,
  ornament: 9,
  titlePlate: 'gilt',
  titleFont: 0,
  wear: 0.1,
  edge: 'gilt',
  format: 'quarto',
  thickness: 44,
  charm: 'ribbon',
  // Migrated Forest → Crimson → Navy. The matcher below accepts only
  // those three shipped indices and compares every other field exactly.
  charmColor: 2,
  coverFrame: 21,
  coverMedallion: 9,
  cornerProtectors: true,
  insetPlate: true,
};

/**
 * The Welcome book's between-page ribbon keeps the broad Gift silhouette but
 * wears blue Cornflower silk. It is deliberately a complete custom design:
 * no named preset currently has this exact colour/shape combination.
 */
export const WELCOME_RIBBON: Readonly<Record<string, unknown>> = {
  cloth: 'cornflower',
  weight: 'sash',
  tail: 'swallowtail',
  material: 'silk',
  charm: 'none',
  charmTone: 'gilt',
  preset: null,
};

/** Exact v10 inner marker, used only to avoid replacing customised ribbons. */
const LEGACY_CRIMSON_WELCOME_RIBBON: Readonly<Record<string, unknown>> = {
  cloth: 'postbox',
  weight: 'sash',
  tail: 'swallowtail',
  material: 'silk',
  charm: 'none',
  charmTone: 'gilt',
  preset: 'gift',
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
 * The kittens.
 *
 * They are asked for by name in the reader's own report, and they are drawn
 * rather than fetched. The app HAS an image search (`fetch_images` in
 * src-tauri/src/media.rs, Openverse) and the language HAS a directive for it
 * (`::fetch{query="a kitten"}`), but nothing in the app calls the one from the
 * other yet — so a `fetch:` line in a seeded page renders as the words
 * "fetch: a kitten" and no picture. A welcome book may not promise a feature
 * by failing at it.
 *
 * These ship in `public/kittens/`, which means they are on disk before the
 * first run and need no network, no cache and no asset row. They are also
 * drawn in the app's own flat language, so the pictures on page six look like
 * they belong to the same world as the bookcase behind them.
 */
const KITTENS = {
  ginger: '/kittens/ginger.svg',
  asleep: '/kittens/asleep.svg',
  box: '/kittens/in-a-box.svg',
} as const;

/**
 * The welcome/guide pages, one Notebook Script source per page.
 *
 * ## What this book is for
 *
 * It is the only page of documentation anybody reads, so it is written as a
 * TOUR rather than a reference: thirty-two short leaves, each one showing a
 * real thing the app does, in the app's own voice. Everything here is parsed by
 * `parse()` and mapped by `scriptDocToTiptap()` at seed time, and the verbatim
 * source is stored on the page — so "Export script" hands the reader back
 * exactly this, and the book doubles as a worked example of the language.
 *
 * ## Rules this content has to keep, because a test enforces each one
 *
 *  - **Every page parses without a single diagnostic.** The book that teaches
 *    the language may not be written in slop. That is also why it is a real
 *    test of the parser: maths, footnotes, page references, toggles, columns,
 *    code fences, all five diagram grammars, both leaf directives and every
 *    drawer of stationery go through it here at full size.
 *  - **Multi-word attribute values are quoted** (`{title="Buttermilk scones"}`)
 *    — unquoted, the attr parser reads the second word as a bare flag, which
 *    is a warning and a wrong title.
 *  - **Pages stay short.** Leaves are fixed height and overflow FLOWS to the
 *    next page, so a page written past its capacity would rearrange the tour
 *    the first time it was opened. `tests/data-seed.test.ts` costs every page
 *    with the pagination estimator and refuses one that is over budget.
 *  - **…and pages stay LONG.** The other half of the same rule, and the one
 *    that was missing: a page at a third of its capacity passes every gate a
 *    short page passes, and half of the v5 tour did exactly that. The same
 *    test now refuses a page that is too cheap as well as one that is too dear.
 *  - **`[[Page name]]` references name pages of this book**, and the seeder
 *    resolves them against the pages it has just created (see
 *    `createWelcomeBook`). A reference that matches no page would still
 *    render — as its own words — but the backlinks page would then be
 *    teaching something the reader cannot see happening.
 *
 * ## Which leaf these pages are cut for, which is not the leaf they were
 *
 * **1280x800 — the window `src-tauri/tauri.conf.json` opens the app at.** Every
 * generation before v7 was authored against a budget measured at 1600x1000, a
 * window a reader has to drag the frame out to reach, and the difference is not
 * small: a leaf there holds 25.66 lines against 19.41, and its prose column is
 * 592px against 434px, so the same sentence wraps half again as often. Both
 * losses compound, every v6 page cost 136% of the leaf it landed on, and the
 * drain turned the tour from 32 leaves into 46 the moment it was opened.
 *
 * So a page here is written to about 16 of the 17.2 lines
 * `PAGE_LINE_BUDGET` allows — 87% to 100% of the budget, 84% of the leaf. On a
 * 1600x1000 screen the same pages cover 60% of the (much larger) leaf and read
 * as generously margined rather than full, which is the side of the trade the
 * owner's *"half-empty pages"* report argues against paying at the DEFAULT
 * window and says nothing about paying at a window nobody is given.
 *
 * Two consequences for anyone editing this text:
 *
 *  - **A container's chrome is fixed and its text is not.** A card costs 2.7
 *    lines before a word is written and an index card 4.9, whatever the window;
 *    what moves is the wrap. So the cheapest way to bring a page down is to
 *    shorten a SENTENCE, and the cheapest way to bring it down a lot is to drop
 *    a whole container. Pages that carried two cards explaining the same thing
 *    now carry one.
 *  - **The estimator is not the judge.** Every page was walked in the running
 *    app and measured — `node scripts/probe-page-cost.mjs`, which reports what
 *    each leaf really spends and names any page whose tail is being carried
 *    onto the next one, and `scripts/probe-welcome.mjs` for the fill. Change
 *    the text here and run them again; the arithmetic is not a substitute.
 */
const WELCOME_PAGE_SOURCES_V7: readonly string[] = [
  // ---------------------------------------------------------------- the world
  // Page 1 — what this is, and how to move around
  `---
paper: lined
wash: amber
---

# Welcome to Alcove ✎ {sticker=star}

Every book on that shelf opens into pages like this one — ==real paper you can write on=={color=amber}.

::: callout {variant=tip}
Click the ruled lines and type. It saves itself, and never leaves this machine.
:::

- Drag to pan the shelf, scroll to zoom
- Click a book to bring it forward, again to open
- Click a page edge to turn it, or drag it

::: card {title="Thirty-two leaves, every one a demonstration"}
Nothing here is a screenshot.
:::

::: banner {color=moss}
So: turn the page. {sticker=arrow}
:::
`,

  // Page 2 — the shelf you just came from
  `# The shelf {sticker=book}

Behind this book is a bookcase, and behind that a room.

::: card {title="Getting about"}
Drag to pan, scroll to zoom. Pull a book out, or press \`Enter\` on the lit one.
:::

::: sticky-note {color=lemon, rotate=-2}
The dock at the foot of the rail holds a new book, a floor, the studio and the trash.
:::


::: tag {color=moss}
\`Ctrl Alt F\` grows the case by a floor
:::
`,

  // Page 3 — more than one bookcase
  `# A library of your own {sticker=star}

One bookcase is a start. Make another for another subject.

\`\`\`tree
Your library
  Study
    Books | on ten floors
    A wall, a wallpaper
  Workshop
    Books
\`\`\`

::: card {title="The studio, under the shelf"}
Carpentry, timber, wallpaper and colour are four separate dials — \`Ctrl Alt S\`.
:::
`,

  // Page 4 — the book itself is a thing you can dress
  `# Dressing a book {sticker=sparkle}

The paintbrush opens the **book studio**.

::: card {title="The outside"}
Leather, cloth or board; raised cords, gilt rules, a title plate and gilt edges.
:::

::: card {title="The inside"}
Ruled, grid, dotted or blank paper; the wash at the page edge; a ribbon in any cloth.
:::

::: tag {color=amber}
\`Ctrl Alt D\` dresses the open book
:::
`,

  // --------------------------------------------------------------- the writing
  // Page 5 — the writing surface itself
  `# Writing {sticker=book}

Press \`/\` on an empty line for the **slash menu** — headings, lists, tables, callouts, diagrams, the lot.

- [ ] Press \`/\` and put a callout here
- [ ] Drag a block by its **handle**
- [ ] Right-click a word for washes
- [x] Read this far

::: sticky-note {color=lemon, rotate=-2}
Sticky notes are blocks too — move me.
:::

> A page that fills up flows onto the next. {washi=top}

::: callout {variant=info}
No save button and no cloud — every keystroke lands in a file on this machine.
:::
`,

  // Page 6 — every inline mark the language has AND THE EDITOR DRAWS.
  //
  // Deliberately no `^sup^` or `~sub~`, though the parser reads both and the
  // spec teaches them: `toTiptap` degrades them to plain text because no
  // sub/superscript mark is installed, so "H~2~O" arrives on the leaf as the
  // flat characters H2O. Same rule as the kittens above — a welcome book may
  // not demonstrate a feature by failing at it. Put them back the day the mark
  // exists, and not before.
  `# Every mark there is {sticker=pin}

**Bold**, *italic*, \`code\`, ~~struck out~~, ==highlighted=={color=lemon}, and [a link out](https://example.com).

A note can hang off a word[^ like this one ].

::: card {title="The seven washes"}
==amber=={color=amber} ==terracotta=={color=terracotta} ==moss=={color=moss} ==lemon=={color=lemon} ==sky=={color=sky} ==blush=={color=blush} ==graphite=={color=graphite}
:::

::: index-card {title="Two spellings of everything"}
\`**bold**\` or \`__bold__\`. The parser takes whichever you reach for.
:::
`,

  // Page 7 — lists, three kinds
  `# Lists {sticker=leaf}

A dash makes a bullet, a number a numbered list.

- Bindings
  - Leather
  - Buckram
- Papers
  - Laid

1. Pull a book off the shelf
2. Write in it
3. Put it back

- [ ] Square brackets make a box
- [x] A cross fills it in

::: marginalia
Tab and Shift-Tab move a line in and out again.
:::
`,

  // Page 8 — the block model, and the handle that moves one
  `# Blocks {sticker=pin}

Every paragraph, list, picture and card is a **block**.

::: card {title="What the handle does"}
Hover a block and a handle appears at its left edge. Drag it to move the block; click it for turn-into, wash, colour, duplicate, delete.
:::

::: callout {variant=warn}
Nothing scrolls. When a page fills, its last block moves onto the next leaf by itself.
:::

::: marginalia
Right-click a block for the same menu.
:::
`,

  // ---------------------------------------------------------------- the drawers
  // Page 9 — the stationery drawer
  `# The stationery drawer {sticker=pin}

::: card {title="What a card is for"}
Anything worth fencing off from the prose.
:::

::: index-card {title="Buttermilk scones"}
Rub 60g of butter into 250g of flour. Milk to bind. Hot oven, eight minutes.
:::

::: quote-card {color=blush}
"A room without books is like a body without a soul."
:::

::: marginalia
Two dozen in all, in the catalogue.
:::
`,

  // Page 10 — the postal drawer
  `# The postal drawer {sticker=heart}

::: envelope {color=amber}
Something folded away for later.
:::

::: stamp {color=terracotta}
Perforated, postmarked, worth one penny.
:::

::: postcard {title="WISH YOU WERE HERE"}
Message left, address right, and no room for either.
:::

::: callout {variant=tip}
Type \`:::\` to open the whole drawer.
:::
`,

  // Page 11 — the keepsake drawer
  `# Things stuck in {sticker=flower}

::: pressed-flower {title="Meadow cranesbill — June"}
Flat between the pages for a fortnight, and still blue.
:::

::: ticket-stub {title="ADMIT ONE"}
Row H, seat 12. It rained.
:::

::: wax-seal {title=A}
Pressed while still soft. Not to be opened before Sunday.
:::
`,

  // Page 12 — the four callouts, each being itself
  `# Four kinds of aside {sticker=coffee}

::: callout {variant=info}
**Info** — what a reader needs first.
:::

::: callout {variant=tip}
**Tip** — the thing you would say over a shoulder.
:::

::: callout {variant=warn}
**Warn** — the one that raises its voice.
:::

::: callout {variant=star}
**Star** — worth keeping, and worth using sparingly.
:::

::: marginalia
\`:::info\`, \`:::tip\`, \`:::warn\` and \`:::star\` are the short spellings.
:::
`,

  // Page 13 — the asides that are not callouts, and the two folds
  `# Notes to one side {sticker=music}

::: sticky-note {color=lemon, rotate=-2}
A post-it. Pick it up by its handle, then tilt it with \`{rotate=-2}\`.
:::

::: map-pin {title="The blue door"}
Second on the left, past the bakery.
:::

::: toggle {title="A fold — click it"}
Here is what was folded away. A toggle nests as deep as the thought goes.
:::

::: spoiler
And a spoiler hides one answer until you look.
:::
`,

  // ---------------------------------------------------------------- the pictures
  // Page 14 — pictures (the kittens the reader asked for)
  `# Pictures {sticker=cat}

Paste one in, drop one on the page, or write \`![a caption](picture.png)\`.

::: image-row {style=polaroid, cols=3}
![A ginger kitten](${KITTENS.ginger}){caption="Has plans"}
![A grey kitten asleep](${KITTENS.asleep}){caption="On the good chair"}
![A cream kitten in a box](${KITTENS.box}){caption="His box now"}
:::

::: card {title="How a row behaves"}
Up to four stand side by side. \`{style=plain}\` takes the frames off.
:::
`,

  // Page 15 — one picture, properly
  `# One picture, properly {sticker=sun}

::: columns {gap=lg}
::: col
::: polaroid
![The ginger kitten again](${KITTENS.ginger})
A white frame, captioned in pencil.
:::
:::
::: col
::: photo-corner {title="or four paper corners"}
![A grey kitten asleep](${KITTENS.asleep})
:::
:::
:::

::: card {title="Both are only containers"}
Drag a corner, or write \`{width=320}\`.
:::
`,

  // Page 16 — columns, shown by doing the thing columns are for
  `# Two up {sticker=leaf}

::: columns {gap=lg}
::: col
![A cream kitten in a box](${KITTENS.box}){width=260}
:::
::: col
**Words beside a picture**

The picture keeps its column and the words keep theirs, and neither is measured against the other.
:::
:::

::: card {title="How it is written"}
\`::: columns\`, a \`::: col\` for each, and a plain \`:::\` to close each one.
:::

::: marginalia
A column may hold anything a page may hold, including more columns.
:::
`,

  // ---------------------------------------------------------------- the diagrams
  // Page 17 — things that nest
  `# Diagrams, drawn by hand {sticker=microscope}

Indentation alone makes a \`tree\`: two spaces to a level, \`|\` for a note.

\`\`\`tree {style=watercolor}
Alcove
  A library
    Bookcases | one per subject
    Floors
  A book
    Pages | this thing you are reading
    Ribbons
\`\`\`

::: card {title="tree, mindmap, graph, flowchart, timeline"}
Five fences, no library: every line is drawn by hand.
:::
`,

  // Page 18 — the same grammar, laid out the other way
  `# Thrown outward {sticker=sparkle}

A \`mindmap\` reads exactly like a \`tree\`, and lays its branches around the middle.

\`\`\`mindmap
Bookbinding
  Sewing
    Kettle stitch
    Long stitch
  Covering
    Cloth
    Quarter leather
  Tools
    Bone folder
\`\`\`

::: marginalia
Swap the word and it redraws.
:::
`,

  // Page 19 — arrows
  `# Arrows {sticker=arrow}

One edge to a line makes a \`graph\`.

\`\`\`graph
Idea {shape=cloud, color=amber}
Idea -> Draft, Notes
Draft -> Page: eventually
Notes -> Page
\`\`\`

::: card {title="The arrow is forgiving"}
\`->\`, \`-->\`, \`=>\` and \`→\` all mean the same thing, and a comma fans out to several.
:::
`,

  // Page 20 — the same fence, for a process
  `# A process, step by step {sticker=coffee}

\`flowchart\` is the same grammar, renamed.

\`\`\`flowchart
Write -> Fills up: a page
Fills up -> Flows on: by itself
Flows on -> Carry on: a fresh leaf
\`\`\`

::: marginalia
A pasted \`mermaid\` fence renders too.
:::
`,

  // Page 21 — things in order
  `# In order {sticker=moon}

\`label: text\` on each line makes a \`timeline\`, and \`| color=…\` tints one.

\`\`\`timeline
1665: Hooke looks down a microscope and names the cell
1839: Schwann — animal cells
1855: Virchow — cells come from cells | color=amber
1931: The electron microscope
\`\`\`

::: card {title="What goes in the label"}
Anything: a year, a step number, a day of the week. It is printed as written.
:::

::: marginalia
\`| color=amber\` tints one entry.
:::
`,

  // ---------------------------------------------------------------- the precise
  // Page 22 — maths, both kinds, on squared paper
  `---
paper: grid
---

# Maths, in a notebook hand {sticker=sparkle}

A dollar either side puts maths in a sentence — a circle is $\\pi r^2$ — and two dollars make an equation.

$$
e^{i\\pi} + 1 = 0
$$

$$
\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}
$$

::: callout {variant=info}
Click any formula to see the TeX behind it. Enter puts the drawing back.
:::

::: card {title="Squared paper, because this page asked"}
\`paper: grid\` at the top of the script, and the leaf is ruled in squares.
:::
`,

  // Page 23 — code, kept exactly as it was pasted
  `# Code, in its own colours {sticker=microscope}

Three backticks and a language name. Every space you gave it is kept.

\`\`\`python
def shelve(book, case):
    """Put a book back where it belongs."""
    floor, slot = case.free_spot()
    if slot is None:
        case.add_floor()
    case.books[floor][slot] = book
\`\`\`

::: card {title="Seventy-odd languages"}
An unknown one keeps its name and its spacing anyway, and arrives in grey.
:::
`,

  // Page 24 — tables, and the one keepsake that is a table
  `# Tables and figures {sticker=coffee}

| Key | What it does |
| --- | --- |
| \`/\` | opens the slash menu |
| \`Esc\` | back to the shelf |
| \`Ctrl K\` | jumps to any page |
| \`Ctrl /\` | every other shortcut |

Click a column heading to sort by it; click again to sort the other way.

::: ledger {title="Bindery, March"}
Buckram 12.00 · Bookcloth 18.50 · Thread 3.20 · Bone folder 9.00
:::
`,

  // Page 25 — footnotes, and why they travel with the paragraph
  `# Footnotes {sticker=pin}

A footnote is a marker in the prose[^ Bracket, caret, note, bracket. ] and the note is printed at the foot of the leaf[^flow].

The Markdown spelling works too[^why].

::: card {title="Why they travel"}
A note that stayed behind would be orphaned.
:::

::: index-card {title="Both spellings"}
\`[^ inline ]\` puts the words in the marker; \`[^name]\` puts a label there.
:::

[^flow]: So when a paragraph moves on, its note goes with it.
[^why]: Because an assistant will reach for it first.
`,

  // Page 26 — references, and the backlinks they grow
  `# Pages point at pages {sticker=heart}

Type \`[[\` and pick a page, or write its name between double brackets.

The equations are on [[Maths, in a notebook hand]], the fences on [[Diagrams, drawn by hand]], the kittens on [[Pictures]].

::: callout {variant=star}
Open a page that is being pointed at and it tells you what mentions it.
:::

::: index-card {title="A reference that finds nothing"}
It stays on the page as its own words, rather than a chip pointing nowhere.
:::
`,

  // ------------------------------------------------------------- the decoration
  // Page 27 — the universal block attrs
  `# Decorations {sticker=star}

Any block will wear them, and they stack.

Underlined by hand. {underline=squiggle}

A little tilt, and a piece of tape. {rotate=-2, tape=top}

Torn paper, inside a scalloped frame. {paper=torn, frame=scallop}

Circled, as if in red pencil. {underline=circled}

::: washi-box {color=sky}
Held down with a strip of tape.
:::

::: marginalia
Under the paintbrush in the rail, and on the effects shelf — \`Ctrl Alt A\`.
:::
`,

  // Page 28 — the lettering axes
  `# Lettering and ink {sticker=music}

The everyday hand. {font=hand}

A marker pen. {font=marker}

Set in a book face, for a page that wants to look printed. {font=book}

Written in crimson. {ink=crimson}

Larger, and ranged right. {size=lg, align=right}

Small, centred, in ink-blue. {size=sm, align=center, ink=ink-blue}

::: card {title="Nine hands, five inks, five sizes"}
\`{font=marker}\`, \`{ink=crimson}\`, \`{size=lg}\` — they stack, on any block.
:::

::: marginalia
Every face travels with the app.
:::
`,

  // Page 29 — the page's own style, set from the top of the script
  `---
paper: dotted
wash: moss
---

# Paper and wash {sticker=leaf}

This leaf is dotted, with a moss wash at its edge. Both were set in three lines at the top of the script.

::: card {title="Four papers"}
\`cream\`, \`lined\`, \`grid\`, \`dotted\`. The page-style panel sets the same by hand.
:::

::: callout {variant=tip}
\`Ctrl Alt L\` opens it. The choice belongs to the page, not the book.
:::

::: tag {color=moss}
\`wash: amber\`, \`terracotta\`, \`moss\` or \`none\`
:::
`,

  // Page 30 — the two leaf directives, demonstrated on themselves
  `# Shorthand {sticker=pin}

::let course = Bookbinding, Michaelmas
::let {room=B12, week=3}
::style hero {color=amber, underline=marker}

Two colons define a value once, and \`{{name}}\` uses it anywhere.

**{{course}}** — room {{room}}, week {{week}}. {use=hero}

::: card {title="Named sets of decoration"}
\`::style hero {…}\` names a bundle and \`{use=hero}\` puts it on any block.
:::

::: callout {variant=info}
An unknown name never breaks a page. It stays on the leaf, verbatim.
:::

::: marginalia
Both lines are lifted out before the page is built, so they cost nothing on the leaf.
:::
`,

  // -------------------------------------------------------------- the way about
  // Page 31 — getting back to something you wrote
  `# Finding it again {sticker=book}

::: card {title="Three ways back"}
\`Ctrl K\` jumps to any book or page. \`Ctrl Shift F\` searches every word.
:::

::: index-card {title="Six of the useful ones"}
- \`Ctrl Alt B\` a ribbon on this page
- \`Ctrl Alt T\` the table of contents
- \`Ctrl N\` a new page after this one
- \`F9\` focus mode
- \`Ctrl /\` every other shortcut
- \`Esc\` back to the shelf
:::
`,

  // Page 32 — the language, and the way out
  `# Write it with your AI {sticker=sparkle}

Every page here is written in **Notebook Script**, which the app reads back out.

1. Open the tray at the foot of the rail
2. Click **Copy AI spec**, paste it to your assistant
3. Paste the reply into **Insert script**

::: card {title="And back out again"}
The tray exports a page as script, PDF or picture, and packs the library into one file.
:::

::: quote-card {color=amber}
Now go and write something of your own.
:::
`,
];

/**
 * The current welcome field guide: useful sample data, then guided action,
 * then progressively deeper tools.
 *
 * Research choice, recorded where it changes the product:
 *
 * - Notion's template guidance treats a worked example as a starting point,
 *   not a feature inventory: https://www.notion.com/help/guides/the-ultimate-guide-to-notion-templates
 * - ProductLed's current onboarding examples favour learning by doing and an
 *   early useful outcome: https://productled.com/blog/best-user-onboarding-examples
 *
 * So these forty-eight leaves form a real little notebook. Each spread shows
 * the result before naming the mechanism, asks for one safe action where that
 * helps, and saves reference material for the second half. It remains authored
 * in Notebook Script, so Export Script hands the reader a truthful, editable
 * example rather than a brochure baked specially for first run.
 */
const WELCOME_PAGE_SOURCES_V14: readonly string[] = [
  // ----------------------------------------------------------- begin here
  `---
paper: lined
wash: amber
---

# Welcome to Alcove ✎ {sticker=star}

Every book on the shelf opens into ==real pages you can change=={color=amber}.

::: callout {variant=tip}
Click a ruled line and type. Your writing saves itself on this machine.
:::

- Pull a book forward, then open it
- Turn a page from its outer edge
- Use the left rail for everything else

::: banner {color=moss}
This whole book is editable. Turn the page. {sticker=arrow}
:::
`,

  `# Your first five minutes {sticker=coffee}

Try the small things that make the rest obvious.

1. Put the caret at the end of this sentence
2. Press \`/\` and browse the block menu
3. Tick the task below
4. Turn the page, then come back

- [ ] I made one mark of my own

::: sticky-note {color=lemon, rotate=-2}
There is no save button to remember. Alcove keeps up while you write.
:::

::: marginalia
\`Esc\` always gives you a way back.
:::
`,

  `# The shelf is a room {sticker=book}

The shelf behind this page is not a file picker. It is the place your books live.

::: card {title="Move through the room"}
Drag to pan. Scroll to zoom. Click a spine to pull it forward; click the held book to read.
:::

::: tag {color=moss}
The dock makes a book, opens templates, dresses the room, adds a floor and holds the trash.
:::

::: callout {variant=info}
Keyboard focus follows the same route, so the shelf works without a mouse.
:::
`,

  `# More than one bookcase {sticker=star}

A library can have a case for each part of a life.

\`\`\`tree
Your library
  Work · Research
  Home · Recipes
  Someday · Ideas
\`\`\`

::: map-pin {title="Three rooms, one library"}
Each case keeps its floors, carpentry, timber and wallpaper. Search still sees the whole library.
:::
`,

  `# Dress the room {sticker=flower}

The shelf studio separates shape from colour.

::: columns {gap=lg}
::: col
**Carpentry**

Arches, rails, crowns and the clear height books must fit beneath.
:::
::: col
**Walls & timber**

Wallpaper pattern, scale and ink; timber pattern; a complete colour scheme.
:::
:::

::: callout {variant=tip}
Preview first. The case repaints in place when you choose.
:::
`,

  `# Dress this book {sticker=sparkle}

This claret volume is showing the book studio before you even open it.

::: card {title="The spine"}
Leather, cloth or board; pigment, raised cords, gilt rules, title plate, edge and wear.
:::

::: card {title="The cover"}
Tooled frame, medallion, inset plate, corner protectors and a ribbon marker.
:::

::: marginalia
A book keeps its identity when it moves to another room.
:::
`,

  `# Paper and ribbons {sticker=leaf}

The page-style rail holds **twenty-seven rulings**: everyday lines and grids, specialist guides, music paper and oddities.

::: columns {gap=lg}
::: col
**One leaf**

Ruling, line height and the gap between printed rules.
:::
::: col
**The whole book**

Ribbon design and the default page look apply to every leaf, now and later.
:::
:::

::: marginalia
Bookmarks cycle six ribbon colours, with no six-page limit.
:::
`,

  `# Four ways to begin {sticker=pin}

::: columns {gap=lg}
::: col
**Blank** — start with one line.

**Template** — begin from a useful shape.
:::
::: col
**Markdown** — bring an existing note.

**Notebook Script** — let an assistant draft a whole page.
:::
:::

::: callout {variant=star}
The best starting point is the one that gets your own words onto paper soonest.
:::

::: wax-seal {title=A}
No beginning seals the rest of the book; change course whenever you like.
:::
`,

  // ------------------------------------------------------------ write it
  `# Write by blocks {sticker=book}

Every paragraph, list, picture, card and diagram is a **block**.

- [ ] Press \`/\` on an empty line
- [ ] Insert a callout or heading
- [ ] Hover its left edge for the handle

::: card {title="Why blocks matter"}
Move one thought without cutting text. Turn it into another kind. Duplicate it, decorate it or delete it.
:::

> A page stays flexible without becoming a pile of tiny text boxes. {washi=top}
`,

  `# Headings and dividers {sticker=star}

## A section you can find again

Headings build the table of contents automatically.

### A smaller thought inside it

Three levels are enough to make a page legible without turning it into an outline.

---

The divider above is a block too: move it, tint it, or use it to separate two kinds of work.

::: marginalia
Type \`#\`, \`##\` or \`###\` in Notebook Script.
:::
`,

  `# Lists that think {sticker=leaf}

- A bullet can contain another idea
  - and another level beneath it
  - without losing the parent
- Tab moves inward; Shift-Tab comes back

1. Number the order
2. Change the order by dragging a block
3. Keep writing

- [ ] An open task waits
- [x] A finished task remembers

::: callout {variant=tip}
Checking a task gives a small, deliberately silent visual celebration. Motion-off skips the burst.
:::
`,

  `# Move, change, duplicate {sticker=arrow}

The block handle and the right-click menu reach the same useful actions.

::: index-card {title="A block can become"}
Paragraph, heading, quote, bullet, number or task — without retyping its words.
:::

::: card {title="A block can also"}
Move up or down, duplicate, copy a link to itself, change its wash, or leave the page. Immediate undo restores a deletion; history may also hold an earlier snapshot.
:::
`,

  `# Ink between words {sticker=pin}

**Bold**, *italic*, \`inline code\`, ~~struck out~~ and [a link](https://example.com).

==Amber=={color=amber}, ==terracotta=={color=terracotta}, ==moss=={color=moss}, ==lemon=={color=lemon}, ==sky=={color=sky}, ==blush=={color=blush}, ==graphite=={color=graphite}.

::: card {title="A toolbar appears on selection"}
Keep the words selected and choose emphasis, ink, a wash or a link. The page stays put while you decide.
:::

::: marginalia
The same marks round-trip through Notebook Script.
:::
`,

  `# Columns you can resize {sticker=leaf}

::: columns {gap=lg}
::: col
**Compare**

Before / after
:::
::: col
**Compose**

Picture / prose
:::
::: col
**Rebalance**

Drag the lines
:::
:::

::: card {title="One block, several measures"}
Each lane stays editable while you rebalance the widths.
:::

::: marginalia
Choose two, three or four columns from the block menu.
:::
`,

  `# Tables you can sort {sticker=coffee}

| Project | Next step | Priority |
| --- | --- | --- |
| Herbarium | label specimens | high |
| Reading list | find the essay | medium |
| Recipes | test the scones | high |

Use the small sort control in a heading once to sort, again to reverse it.

::: marginalia
Tab moves between cells. Exported Markdown keeps the pipes and headings.
:::
`,

  `# Pages that never scroll {sticker=moon}

A leaf has a real bottom. When writing reaches it, the last complete block moves to the next page.

::: callout {variant=star}
No scrollbar appears inside paper, and no sentence is cut in half at the fold.
:::

::: card {title="The book grows with the writing"}
If there is no next page, Alcove makes one. If type becomes larger, the fold is measured again.
:::

::: marginalia
Turn the page instead of scrolling the page.
:::
`,

  // ---------------------------------------------------------- catalogue
  `# The catalogue {sticker=sparkle}

Seven shelves turn the editor's vocabulary into things you can see before inserting.

::: columns {gap=lg}
::: col
- Paper & cards
- Text blocks
- Callouts
- Diagrams
:::
::: col
- Tape & trim
- Lettering
- Stickers
- Search every shelf
:::
:::

::: callout {variant=tip}
Paper and sticker shelves are yours to curate: hide what you never use and keep favourites near the front.
:::
`,

  `# Make a little collage {sticker=flower}

This paragraph is taped down. {tape=corner, rotate=-2, paper=torn}

This one wears a stitched frame and a soft lift. {frame=stitch, shadow=lifted, color=sky}

::: washi-box {color=blush}
A washi box is useful for a thought that should feel collected rather than announced.
:::

Underlined as if by hand. {underline=squiggle}
`,

  `# Cards with a purpose {sticker=pin}

::: card {title="Definition"}
**Colophon** — the note that tells how a book was made.
:::

::: ledger {title="Field expenses"}
::: col
Tea

Postage

Pencils
:::
::: col
£2.40

£1.85

£3.10
:::
:::

::: marginalia
The ledger's writing sits on its printed rules. Use a shape because it has a job, not only because it is pretty.
:::
`,

  `# Postal desk {sticker=heart}

::: envelope {color=amber}
A letter folded away for later, with its flap still open.
:::

::: stamp {color=terracotta}
One penny, postmarked in a small hand.
:::

::: postcard {title="WISH YOU WERE HERE"}
::: col
The rain turned. The bookshop stayed open. I found our atlas.
:::
::: col
Alcove House
Library Lane
Home
:::
:::
`,

  `# Keepsakes {sticker=flower}

A page can keep a whole afternoon.

::: pressed-flower {title="Meadow cranesbill — June"}
Flat between the pages for a fortnight, and still blue.
:::

::: ticket-stub {title="ADMIT ONE"}
Row H · seat 12 · rain all the way home.
:::

`,

  `# Fold it away {sticker=moon}

::: callout {variant=info}
Callouts say what kind of aside they are: information, tip, warning or star.
:::

::: toggle {title="A longer aside — click to open"}
Toggles keep supporting material on the page without making the main path longer. They may contain other blocks.
:::

::: spoiler
A spoiler hides one short answer until the reader chooses to look.
:::

::: marginalia
These remain real editable blocks while closed.
:::
`,

  `# Washes and fasteners {sticker=star}

Amber wash, taped at the top. {color=amber, tape=top}

Sky paper in a double frame. {color=sky, frame=double}

Blush with a stacked-paper edge. {color=blush, shadow=stacked}

::: card {title="Effects stack"}
Choose several; each remains removable without rebuilding the block.
:::
`,

  `# Lettering cabinet {sticker=music}

The everyday notebook hand. {font=hand}

A quick casual hand. {font=casual}

A marker for a loud label. {font=marker, size=lg}

A book face for something printed. {font=book}

Monospaced labels a specimen. {font=mono, ink=graphite}

::: card {title="Fifty hands · fifty inks · twelve sizes"}
Ten ranging modes place a block from the left margin to the far edge; the choice travels with it.
:::
`,

  // ------------------------------------------------------------ pictures
  `# Pictures, starring kittens {sticker=cat}

Paste, choose a file, or drop a picture directly onto paper.

::: image-row {style=polaroid, cols=3}
![A ginger kitten](${KITTENS.ginger}){caption="Has plans"}
![A grey kitten asleep](${KITTENS.asleep}){caption="On the good chair"}
![A cream kitten in a box](${KITTENS.box}){caption="His box now"}
:::

::: marginalia
Rows hold up to four images and keep their captions together.
:::
`,

  `# One picture, properly {sticker=sun}

::: columns {gap=lg}
::: col
::: polaroid {rotate=-2}
![The ginger kitten again](${KITTENS.ginger})
A white frame, captioned in pencil.
:::
:::
::: col
::: photo-corner {title="Four paper corners"}
![A grey kitten asleep](${KITTENS.asleep})
:::
:::
:::

::: marginalia
Drag a picture corner to resize it without cropping the subject.
:::
`,

  `# Picture beside prose {sticker=leaf}

::: columns {gap=lg}
::: col
![A cream kitten in a box](${KITTENS.box}){width=260}
:::
::: col
## Evidence

The box was empty before lunch. It now belongs to the kitten.

### Conclusion

Ownership has been established beyond reasonable doubt.
:::
:::

::: marginalia
Columns keep the picture and the paragraph in their own measures.
:::
`,

  `# Sound and celebration {sticker=sparkle}

- [ ] Tick me to try the confetti

::: card {title="A small response, not a fireworks show"}
The burst is brief and deliberately silent. Motion-off or the operating system's reduce-motion setting removes it.
:::

::: index-card {title="The sound room"}
Choose a shipped sound set, tune categories separately, add typing sounds, or import your own local cue files.
:::

`,

  `# Local video {sticker=music}

Drop a video file onto a leaf and Alcove makes a player block where it lands.

::: card {title="The useful controls stay with it"}
Play, pause, seek, resize and move the block like any other piece of the page.
:::

::: callout {variant=info}
The video is copied into the library's own storage. Opening the notebook later does not depend on the file remaining in Downloads.
:::

::: marginalia
Nothing is uploaded merely because it was placed on a page.
:::
`,

  `# Stickers of your own {sticker=heart}

The built-in drawer has fifty hand-drawn stickers. A local picture can become one more.

::: washi-box {color=lemon}
Import a PNG or SVG once; its filename becomes its sticker name, then click it to place it at the caret.
:::

This block wears a margin sticker. {sticker=bee}

This one wears another. {sticker=moon, color=sky}

::: card {title="Your drawer stays yours"}
Custom stickers and curated favourites persist offline with the rest of the library.
:::
`,

  // ----------------------------------------------------------- diagrams
  `# A tree of ideas {sticker=microscope}

Indentation alone makes a hand-drawn tree. Two spaces mean one branch inward.

\`\`\`tree {style=watercolor}
Alcove | a living library
  Library
    Cases
    Search
  Book
    Pages
    Ribbons
\`\`\`

::: callout {variant=info}
Change the few source lines and every branch is laid out again in the page's hand-drawn visual language.
:::
`,

  `# A mind map {sticker=sparkle}

\`\`\`mindmap
Field notebook
  Observe
    Place
    Weather
  Collect
    Sketch
    Photograph
  Connect
    Question
    Next visit
\`\`\`

::: marginalia
Change \`tree\` to \`mindmap\`; the words stay while the composition redraws.
:::
`,

  `# A graph of connections {sticker=arrow}

One arrow per line makes a network. A comma fans one idea into several.

\`\`\`graph
Question {shape=cloud, color=amber}
Question -> Notes, Experiment
Notes -> Draft: informs
Experiment -> Draft
\`\`\`

::: marginalia
Nodes may be rectangles, circles or clouds; labels belong on arrows.
:::
`,

  `---
paper: grid
wash: moss
---

# A process, step by step {sticker=coffee}

\`\`\`flowchart
Capture -> Sort: blocks
Capture -> Connect: links
Sort -> Share: when ready
Connect -> Share
\`\`\`

::: tag {color=moss}
\`flowchart\` uses the graph grammar; this leaf also asked for squared paper in its script header.
:::
`,

  `# A timeline {sticker=moon}

\`label: text\` puts events in order; a pipe can tint one turning point.

\`\`\`timeline
1665: Hooke names the cell
1839: Schwann describes animal cells
1855: Virchow — cells come from cells | color=amber
1931: The electron microscope
Today: Add your own observation | color=moss
\`\`\`

`,

  `# Diagrams stay editable {sticker=pin}

A diagram is not flattened into an image. Click it to reopen the few lines that made it.

::: index-card {title="Five tiny languages"}
\`tree\` · \`mindmap\` · \`graph\` · \`flowchart\`

\`timeline\`
:::

::: card {title="Tolerant on purpose"}
Common arrow spellings and a pasted Mermaid-style fence are understood gently. Diagnostics explain repairs instead of breaking the page.
:::

`,

  // ------------------------------------------------------------- precise
  `---
paper: grid
---

# Maths in the margins {sticker=sparkle}

Single dollars keep maths in a sentence: the circle is $A=\\pi r^2$ and the error stays below $\\epsilon$. Double dollars give an equation its own line.

$$
e^{i\\pi} + 1 = 0
$$

$$
\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}
$$

::: callout {variant=info}
Click a formula to edit its TeX; press Enter to set it back onto the page.
:::

`,

  `# Code, kept exactly {sticker=microscope}

Three backticks and a language name preserve spaces and colour the tokens.

\`\`\`python
def shelve(book, case):
    spot = case.free_spot()
    if spot is None:
        case.add_floor()
        spot = case.free_spot()
    case.place(spot, book)
    return spot
\`\`\`

::: marginalia
Unknown languages keep their name and spacing; they simply arrive without syntax colour.
:::
`,

  `# Notes at the foot {sticker=pin}

A marker can carry its note inline[^ Like this, between the brackets. ] or point to a definition below[^travel].

::: card {title="Why the note travels"}
Pages have a fixed height. If the marked paragraph flows onward, its footnote moves with it instead of becoming an orphan.
:::

::: marginalia
Two spellings: \`[^ whole note ]\`, or \`[^name]\` with a definition below.
:::

[^travel]: This note belongs to the paragraph that names it.
`,

  `# Pages point at pages {sticker=heart}

Type \`[[\` and choose a page. The reference works in both directions.

The formulas are on [[Maths in the margins]], the kittens on [[Pictures, starring kittens]], and the first diagram on [[A tree of ideas]].

::: callout {variant=star}
Open a page that is being mentioned and its backlinks show what points here.
:::

::: card {title="A missing destination stays readable"}
If no page matches, the words remain ordinary text instead of becoming a broken chip.
:::
`,

  // ----------------------------------------------------------- wayfinding
  `# Find anything again {sticker=book}

::: card {title="Quick switcher"}
\`Ctrl K\` jumps by fuzzy title to any book or headed page, including another bookcase.
:::

::: card {title="Full-text search"}
\`Ctrl Shift F\` searches the words inside every page and takes you to the match.
:::

::: marginalia
Useful habit: name a page for what you will remember asking, not only its date.
:::

`,

  `# Four ways through {sticker=leaf}

Four views answer four different navigation questions.

::: columns {gap=lg}
::: col
**Contents**

Which headings are in this book?

**Thumbnails**

Which leaf do I recognise by sight?
:::
::: col
**Ribbons**

Which pages matter now?

**Backlinks**

What else mentions this page?
:::
:::

::: marginalia
All four jump without changing the page itself.
:::
`,

  `# Focus, zoom, and leaf {sticker=moon}

::: index-card {title="Walk the rungs"}
Spread → page → single leaf. Use the dial, or \`[\` and \`]\` while focused.
:::

::: card {title="Then choose the distance"}
Zoom further into the paper and pan when it grows larger than the window. The exit remains in the top-left corner.
:::

::: callout {variant=tip}
Focus closes the tool panel first, so the page gets the room the mode promises.
:::
`,

  `# History and autosave {sticker=moon}

Every edit saves locally; useful earlier states remain available in page history.

\`\`\`timeline
Now: the page in your hands
Earlier: a saved snapshot
Before that: another recoverable turn
Restore: make the chosen snapshot current
\`\`\`

::: callout {variant=warn}
Restoring is deliberate and visible. It never silently overwrites the page while you browse.
:::

`,

  `# Daily pages and templates {sticker=sun}

Type \`/today\` to jump to today's journal page, creating it when needed.

::: card {title="Templates are starting shapes"}
Choose Cornell notes, a lecture page, flashcards, a weekly planner or a reading log, then make it yours.
:::

::: card {title="Markdown comes in as books"}
Import one or several files. Headings, lists, tables, links and image references become editable blocks.
:::
`,

  `# Notebook Script {sticker=sparkle}

::let subject = The complete Alcove tour
::style hero {color=amber, underline=marker}

**{{subject}}** was written in the same text format you can export. {use=hero}

::: columns {gap=lg}
::: col
**Familiar**

Markdown headings, lists, tables, pictures, code and links.
:::
::: col
**Expressive**

Containers, attributes, diagrams, variables and reusable styles.
:::
:::

::: callout {variant=tip}
Download the format guide and attach it—or copy it when the chat accepts a long paste. Ask for one page, preview the result, then insert it.
:::
`,

  `# In, out, and safekeeping {sticker=book}

::: columns {gap=lg}
::: col
**A page leaves as**

- Notebook Script
- PNG picture
- PDF
:::
::: col
**A library leaves as**

- A portable parcel
- An automatic backup
- A manual backup
:::
:::

::: callout {variant=info}
When a newer signed release is available, Alcove offers the update and runs the ordinary installer only after you accept.
:::

::: marginalia
Your library is kept by default when the app itself is replaced.
:::
`,

  `---
paper: dotted
wash: amber
---

# This leaf is yours {sticker=heart}

You have seen rooms become libraries, lines become pages, and plain words become diagrams and keepsakes.

::: quote-card {color=amber}
The showcase ends here. Your notebook does not.
:::

- [ ] Add a page and write one thing of your own

::: card {title="Need a way back?"}
- [[Your first five minutes]]
- [[The catalogue]]
- [[Find anything again]]
:::
`,
];

/**
 * The v15 edition changes only three leaves of the forty-eight-page guide.
 * Keep v14 above byte-identical: it is the fingerprint that lets
 * `refreshWelcomeBook` distinguish an untouched guide from somebody's notes.
 */
const WELCOME_PAGE_SOURCES_V15: readonly string[] = WELCOME_PAGE_SOURCES_V14.map(
  (source) => {
    if (source.includes('# Dress this book {')) {
      return `# Dress this book {sticker=sparkle}

This claret volume is showing the book studio before you even open it.

::: card {title="The titleless spine"}
Choose a straight binding, quiet cloth or leather, colour, cords and restrained rules. Add one book emblem when it earns the space; the book's name stays on its cover.
:::

::: card {title="The cover"}
Set a complete title, continuous frame, the same emblem and plain or gilt page edges. Nothing needs to be wallpapered with tiny symbols.
:::

::: callout {variant=tip}
Surprise me offers distinct directions, then lets you lock every part you want to keep before rolling again.
:::

::: marginalia
A book keeps its identity when it moves to another room.
:::
`;
    }
    if (source.includes('# Notebook Script {')) {
      return `# Notebook Script {sticker=sparkle}

::let subject = The complete Alcove tour
::style hero {color=amber, underline=marker}

**{{subject}}** was written in the same text format you can export. {use=hero}

::: columns {gap=lg}
::: col
**Familiar**

Markdown headings, lists, tables, pictures, code and links.
:::
::: col
**Expressive**

Containers, attributes, diagrams, variables and reusable styles.
:::
:::

::: callout {variant=tip}
Download the format guide and attach it—or copy it when the chat accepts a long paste. An assistant may leave an intentional picture placeholder; choose or drop the real image into that card after insertion.
:::
`;
    }
    if (source.includes('# In, out, and safekeeping {')) {
      return `# In, out, and safekeeping {sticker=book}

::: columns {gap=lg}
::: col
**A page leaves as**

- Notebook Script
- PNG picture
- PDF
:::
::: col
**A library leaves as**

- A portable parcel
- An automatic backup
- A manual backup
:::
:::

::: callout {variant=info}
Portable parcels carry local pictures and videos with the selected pages. Both lossless and script-only bundles reconnect them to the destination library rather than remembering the old machine's path.
:::

::: callout {variant=tip}
Settings can keep this Welcome guide current on future app updates, even after edits. It is off by default and tells you that the newest guide will replace those edited Welcome pages.
:::

::: marginalia
Your library is kept by default when the app itself is replaced.
:::
`;
    }
    return source;
  },
);

/**
 * v16 teaches the rebuilt binding studio and portable video path. Keep v15
 * byte-identical above so an untouched guide from 0.5.x is still recognisable.
 */
export const WELCOME_PAGE_SOURCES: readonly string[] = WELCOME_PAGE_SOURCES_V15.map(
  (source) => {
    if (source.includes('# Dress this book {')) {
      return `# Dress this book {sticker=sparkle}

This Grand-blue volume is showing the rebuilt book studio before you even open it.

::: card {title="The titleless spine"}
Choose one of the straight binding constructions, eighteen quiet coverings, up to three raised cords and a single broad binder's tool. The book's name stays on its cover.
:::

::: card {title="The cover"}
Set the complete title in one of ten lettering hands, choose among twelve continuous frames and sixteen matched emblems, then finish the paper block with one of six real edge treatments and three sewn endbands.
:::

::: callout {variant=tip}
Surprise me composes a whole binding in a distinct direction. Lock any parts you love, then roll the rest again.
:::

::: marginalia
Richness comes from one authored hierarchy, never wallpapered symbols or hardware.
:::
`;
    }
    if (source.includes('# Dressing a book {')) {
      return `# Dressing a book {sticker=sparkle}

The paintbrush at the top of the rail opens **Customize this book**, where the spine and cover are designed as one binding.

::: card {title="The binding"}
Straight cloth, calf, vellum and split-board constructions; up to three raised cords; sixteen broad emblems; three sewn endbands; and restrained material-led tooling. The spine stays titleless so its structure can breathe.
:::

::: card {title="The cover and paper block"}
Keep the full title, choose one of ten lettering hands and twelve continuous frames, then finish the page edges in plain, gilt, stained, deckled or burnished styles.
:::

::: quote-card {color=sky}
This Welcome book is a Grand blue Gilt Quarto with an engraved gilt title, a Renaissance panel and one foliate lozenge shared by cover and spine.
:::

::: tag {color=amber}
\`Ctrl Alt D\` dresses the open book
:::
`;
    }
    return source;
  },
);

/**
 * Every page this book USED to be, kept verbatim — the v7 thirty-two, then
 * the older generations already retained below.
 *
 * They are here for one job: telling a welcome book nobody has touched from a
 * welcome book somebody has been writing in. A refresh replaces the first and
 * never goes near the second, and the only way to know which is which is to
 * still have the old text to compare against.
 *
 * Append the outgoing generation here whenever this book is rewritten; never
 * edit an entry. A character out of place makes an untouched book look
 * written-in, which is the safe direction to be wrong in (the reader keeps the
 * old tour) but it is still wrong — `tests/seed-encoding.test.ts` exists
 * because that has already happened once, to a whole generation, over a
 * mojibaked pencil.
 */
export const LEGACY_WELCOME_PAGE_SOURCES: readonly string[] = [
  // v15 — the outgoing 0.5.x field guide, retained for the v16 refresh.
  ...WELCOME_PAGE_SOURCES_V15,

  // v14 — forty-eight leaves. This exact edition is what v15 recognises.
  ...WELCOME_PAGE_SOURCES_V14,

  // v7 — thirty-two leaves. Kept by reference so the outgoing strings remain
  // byte-for-byte the exact template literals above; never edit that array.
  ...WELCOME_PAGE_SOURCES_V7,

  // Page 1 — what Alcove is + how to get around
  `---
paper: cream
wash: amber
---

# Welcome to Alcove ✎ {sticker=star}

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
Alcove
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

  // -------------------------------------------------------------------------
  // The v5 generation: sixteen pages. Outgoing because half of them stopped
  // two thirds of the way down the leaf — measured on the running app rather
  // than argued about, `scripts/probe-welcome.mjs`, median fill 51%.
  //
  // Verbatim, including the `${KITTENS.…}` interpolations: what has to match
  // is the STRING a v5 install stored, and that string had the paths in it.
  // -------------------------------------------------------------------------

  // Page 1 — what this is, and how to move around
  `---
paper: cream
wash: amber
---

# Welcome to Alcove ✎ {sticker=star}

This is your **library**. Every book on that shelf opens into pages like this one — ==real paper you can write on=={color=amber}, not a picture of some.

::: callout {variant=tip}
Click anywhere on the ruled lines and start typing. Everything saves itself as you go.
:::

- The **shelf** goes on and on — drag to pan, scroll to zoom
- **Click a book** and it comes forward; click it again to open. \`Esc\` puts it back
- **Arrow keys** turn the pages, or drag a corner and watch it curl
- The **rail on the left** holds everything else

::: banner {color=moss}
The rest of this book is a tour of what the paper can do. {sticker=arrow}
:::
`,

  // Page 2 — the writing surface itself
  `# Writing {sticker=book}

Write the way you would anywhere else. Then press \`/\` on an empty line for the **slash menu** — headings, lists, tables, callouts, diagrams, equations, stickers, the lot.

**Bold**, *italic*, \`code\`, ~~struck out~~, ==highlighted=={color=lemon}, or ==washed in another colour=={color=sky}.

- [ ] Press \`/\` and put a callout on this page
- [ ] Drag a block somewhere else by its **handle**
- [x] Read this far

::: sticky-note {color=lemon, rotate=-2}
Sticky notes are blocks too. Pick me up and move me.
:::

> A page that fills up simply flows onto the next one. Nothing here ever scrolls. {washi=top}
`,

  // Page 3 — maths, both kinds
  `# Maths, in a notebook hand {sticker=sparkle}

A dollar either side puts maths inside a sentence: a circle is $\\pi r^2$, the golden ratio is $\\frac{1+\\sqrt{5}}{2}$, and $\\sigma$ is one standard deviation.

Two dollars on a line of their own make an equation:

$$
e^{i\\pi} + 1 = 0
$$

$$
\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}
$$

::: callout {variant=info}
Click any formula to see the TeX behind it. Enter puts the drawing back.
:::
`,

  // Page 4 — the stationery drawer
  `# The stationery drawer {sticker=pin}

::: card {title="What a card is for"}
Definitions, rules, anything worth fencing off from the prose around it.
:::

::: index-card {title="Buttermilk scones"}
Rub 60g of butter into 250g of flour. Milk to bind. Hot oven, eight minutes.
:::

::: quote-card {color=blush}
"A room without books is like a body without a soul."
:::

::: envelope {color=amber}
Something folded away for later, with the flap still open.
:::

::: tag {color=moss}
a luggage tag, for labelling whatever comes next
:::
`,

  // Page 5 — the keepsake drawer
  `# Things stuck in {sticker=flower}

::: pressed-flower {title="Meadow cranesbill — the lane, June"}
Flat between the pages for a fortnight, and still blue.
:::

::: ticket-stub {title="ADMIT ONE"}
Row H, seat 12. It rained the whole way home.
:::

::: postcard {title="WISH YOU WERE HERE"}
Ran out of room on the front, as usual.
:::

::: map-pin {title="The blue door"}
Second on the left, past the bakery.
:::

::: wax-seal {title=A}
Not to be opened before Sunday.
:::
`,

  // Page 6 — pictures (the kittens the reader asked for)
  `# Pictures {sticker=cat}

Paste one in, drop one on the page, or write it out: \`![a caption](path/to/picture.png)\`.

::: image-row {style=polaroid, cols=3}
![A ginger kitten](${KITTENS.ginger}){caption="Has plans"}
![A grey kitten asleep](${KITTENS.asleep}){caption="On the good chair"}
![A cream kitten in a box](${KITTENS.box}){caption="His box now"}
:::

::: marginalia
Up to four pictures will stand in a row together.
:::
`,

  // Page 7 — one picture, properly
  `# One picture, properly {sticker=sun}

::: polaroid {rotate=-2}
![The ginger kitten again](${KITTENS.ginger})
A polaroid is one picture in a white frame, captioned underneath in pencil.
:::

Drag a corner to resize a picture, or write \`{width=320}\`. Give it \`{align=left}\`, \`{align=center}\` or \`{align=right}\` to slide it across the page. For words beside a picture, put the two in \`:::columns\`.
`,

  // Page 8 — columns, and the two kinds of fold
  `# Two up, and things that fold {sticker=leaf}

::: columns {gap=lg}
::: col
**On the left.** Columns hold two to four of these, side by side.
:::
::: col
**On the right.** Anything goes in one — a list, a picture, another fold.
:::
:::

::: toggle {title="A fold. Click it."}
Toggles put a long aside out of the way until it is wanted.

::: toggle {title="And they nest"}
All the way down, as deep as the thought goes.
:::
:::

::: spoiler
A spoiler is the other kind of fold: one answer, hidden until you look.
:::
`,

  // Page 9 — diagrams: things that nest
  `# Diagrams, drawn by hand {sticker=microscope}

Fenced mini-languages come out as hand-drawn diagrams. Indentation alone makes a \`tree\`:

\`\`\`tree {style=watercolor}
Alcove
  A library
    Bookcases
    Floors
  A book
    Pages | this thing you are reading
\`\`\`
`,

  // Page 10 — diagrams: arrows
  `# Arrows {sticker=arrow}

One edge to a line makes a \`graph\` — or a \`flowchart\`, which is the same grammar under a name that suits a process better:

\`\`\`graph
Write -> Decorate: whenever
Decorate -> Turn: eventually
Turn -> Write: forever
\`\`\`

::: callout {variant=tip}
None of these is Mermaid, and none of them needs to be.
:::
`,

  // Page 11 — diagrams: things in order
  `# In order {sticker=moon}

\`label: text\` on each line makes a \`timeline\`:

\`\`\`timeline
1: Pull a book off the shelf
2: Write, decorate, wander
3: Turn to a fresh page | color=amber
\`\`\`

::: card {title="The four fences"}
\`tree\` for things that nest, \`mindmap\` for the same laid out radially, \`graph\` for arrows, \`timeline\` for anything with an order.
:::
`,

  // Page 12 — tables and footnotes
  `# Tables, and notes at the foot {sticker=coffee}

| Key | What it does |
| --- | --- |
| \`/\` | opens the slash menu |
| \`Esc\` | puts the book back on the shelf |
| \`Ctrl K\` | jumps to any page in the library |
| \`Ctrl /\` | every other shortcut there is |

Click a column heading to sort by it.

A footnote is a marker in the prose[^ Bracket, caret, the note, close bracket. ] and the note is printed at the foot of whichever page the marker lands on[^flow].

The Markdown spelling works too[^why].

[^flow]: So when a paragraph flows to the next page, its notes go with it.
[^why]: Because an assistant writing you a page will reach for it.
`,

  // Page 13 — one page pointing at another
  `# One page pointing at another {sticker=heart}

Type \`[[\` and pick a page, or write its name between double brackets.

The equations are back on [[Maths, in a notebook hand]], the fences are on [[Diagrams, drawn by hand]], and the kittens are on [[Pictures]].

::: callout {variant=star}
References work both ways. Open a page that is being pointed at and it tells you what mentions it — a table of contents nobody had to keep.
:::

Links to the outside work too: \`[a link](https://example.com)\`.
`,

  // Page 14 — the decorations
  `# Decorations {sticker=star}

Any block will wear them. {underline=marker}

A little tilt, and a piece of tape. {rotate=-2, tape=top}

Torn paper, inside a scalloped frame. {paper=torn, frame=scallop}

A different hand, in a different ink. {font=marker, ink=crimson}

Ranged right, and written larger. {align=right, size=lg}

::: washi-box {color=sky}
Held to the page with washi tape.
:::

All of them live in the rail on the left, under the paintbrush.
`,

  // Page 15 — finding your way back to something
  `# Finding it again {sticker=book}

::: card {title="Three ways back"}
\`Ctrl K\` jumps to any page by name. \`Ctrl Shift F\` searches the words inside every book you own. And the contents panel in the rail lists this book's pages in order.
:::

Drop a **bookmark** on a page and a ribbon appears at the edge of the book, so the page you keep coming back to is one click away.

::: callout {variant=tip}
Every new book lands on the shelf behind this one, and the shelf has a rail of its own: a new book, the studio, another floor, and the trash.
:::
`,

  // Page 16 — the language, and the way out
  `# Write it with your AI {sticker=sparkle}

Every page in this book is written in **Notebook Script** — a forgiving Markdown dialect, which the app also reads back out again.

1. Open the left rail and choose **Insert script**
2. Click **Copy AI spec** and paste that into your assistant
3. Ask it for a page, then paste back what it writes

::: callout {variant=info}
The parser never fails. A small slip renders anyway, with a gentle note saying what it did instead.
:::

::: quote-card {color=amber}
Now go and write something of your own.
:::
`,

  // ------------------------------------------------------------------------
  // v6 — the thirty-two-leaf tour, cut for a 1600x1000 window nobody was
  // given. Retired by v7, which cuts for the window the app opens at.
  // ------------------------------------------------------------------------
  // ---------------------------------------------------------------- the world
  // Page 1 — what this is, and how to move around
  `---
paper: lined
wash: amber
---

# Welcome to Alcove ✎ {sticker=star}

This is your **library**. Every book on that shelf opens into pages like this one — ==real paper you can write on=={color=amber}, not a picture of some.

::: callout {variant=tip}
Click anywhere on the ruled lines and start typing. Everything saves itself as you go, and none of it leaves this machine.
:::

- The **shelf** goes on and on — drag to pan, scroll to zoom
- **Click a book** and it comes forward; click again to open, \`Esc\` to put it back
- **Arrow keys** turn the pages, or drag a corner and watch it curl

::: card {title="Thirty-two leaves, and every one of them a demonstration"}
Nothing here is a screenshot. Every card, diagram, equation and picture is the real thing, made by the page it stands on.
:::

::: banner {color=moss}
So: turn the page. {sticker=arrow}
:::
`,

  // Page 2 — the shelf you just came from
  `# The shelf {sticker=book}

Behind this book is a bookcase, and behind that a room.

::: card {title="Getting about"}
Drag to pan and scroll to zoom. Arrow keys walk the shelf book by book, \`Home\` goes back to the very first one, and \`+\`, \`−\` and \`0\` work the zoom.
:::

::: card {title="Books come off the shelf"}
Drag one out with the mouse, or press \`Enter\` on the lit one. \`Esc\` puts it back exactly where it was.
:::

::: sticky-note {color=lemon, rotate=-2}
The dock at the bottom of the rail holds a new book, another floor, the studio and the trash. Ten floors to begin with.
:::

::: tag {color=moss}
\`Ctrl Alt F\` grows the case by a floor
:::
`,

  // Page 3 — more than one bookcase
  `# A library of your own {sticker=star}

One bookcase is a start. Make another for another subject; each keeps its own room.

\`\`\`tree
Your library
  Study
    Books | on ten floors
    A wall, a wallpaper
  Workshop
    Books
\`\`\`

::: card {title="The studio, under the shelf"}
Carpentry, timber, wallpaper and colour are four separate dials — repainting a room never straightens its arches.
:::

::: callout {variant=tip}
\`Ctrl Alt S\` opens the studio. \`Ctrl Alt N\` puts a new book on the shelf.
:::
`,

  // Page 4 — the book itself is a thing you can dress
  `# Dressing a book {sticker=sparkle}

The paintbrush at the top of the rail opens the **book studio**, where nothing about a book is fixed.

::: card {title="The outside"}
Leather, cloth or board; raised cords with gilt rules; wrapped endbands, a title plate, gilt edges, and a charm hanging off the tail.
:::

::: card {title="The inside"}
Ruled, grid, dotted or blank paper; the wash at the page edge; and a ribbon in whichever cloth you fancy.
:::

::: quote-card {color=blush}
This one is claret leather with four raised cords. Yours can be anything at all.
:::

::: tag {color=amber}
\`Ctrl Alt D\` dresses the open book
:::
`,

  // --------------------------------------------------------------- the writing
  // Page 5 — the writing surface itself
  `# Writing {sticker=book}

Write the way you would anywhere else. Then press \`/\` on an empty line for the **slash menu** — headings, lists, tables, callouts, diagrams, equations, stickers, the lot.

- [ ] Press \`/\` and put a callout on this page
- [ ] Drag a block somewhere else by its **handle**
- [ ] Right-click a word for washes, colours and turn-into
- [x] Read this far

::: sticky-note {color=lemon, rotate=-2}
Sticky notes are blocks too. Pick me up and move me.
:::

> A page that fills up simply flows onto the next one. Nothing here ever scrolls. {washi=top}

::: callout {variant=info}
There is no save button, and there is no cloud either — every keystroke lands in a file on this machine.
:::
`,

  // Page 6 — every inline mark the language has AND THE EDITOR DRAWS.
  //
  // Deliberately no `^sup^` or `~sub~`, though the parser reads both and the
  // spec teaches them: `toTiptap` degrades them to plain text because no
  // sub/superscript mark is installed, so "H~2~O" arrives on the leaf as the
  // flat characters H2O. Same rule as the kittens above — a welcome book may
  // not demonstrate a feature by failing at it. Put them back the day the mark
  // exists, and not before.
  `# Every mark there is {sticker=pin}

**Bold**, *italic*, \`code\`, ~~struck out~~, ==highlighted=={color=lemon}, ==or washed another colour=={color=sky}, and [a link out](https://example.com).

A note can hang off a word[^ like this one ], and a highlight can wear any of the seven washes.

::: card {title="The seven washes"}
==amber=={color=amber} ==terracotta=={color=terracotta} ==moss=={color=moss} ==lemon=={color=lemon} ==sky=={color=sky} ==blush=={color=blush} ==graphite=={color=graphite}
:::

::: callout {variant=tip}
Select any run of words and the little toolbar that appears carries all of it.
:::

::: index-card {title="Two spellings of everything"}
\`**bold**\` or \`__bold__\`, \`*italic*\` or \`_italic_\`. The parser takes whichever one you reach for first.
:::
`,

  // Page 7 — lists, three kinds
  `# Lists {sticker=leaf}

A dash makes a bullet, a number makes a numbered list, and two spaces of indent nests one inside another.

- Bindings
  - Leather
  - Buckram
- Papers
  - Laid
  - Wove

1. Pull a book off the shelf
2. Write in it
3. Put it back

- [ ] Square brackets make a box to tick
- [x] A cross fills it in

---

::: marginalia
Tab and Shift-Tab move a line in and out again while you write.
:::
`,

  // Page 8 — the block model, and the handle that moves one
  `# Blocks {sticker=pin}

Every paragraph, list, picture and card is a **block**.

::: card {title="What the handle does"}
Hover a block and a handle appears at its left edge. Drag it to move the block anywhere on the page; click it for the block menu — turn into, wash, colour, duplicate, delete.
:::

::: card {title="Two other ways in"}
Right-click anywhere on a block for the same menu without hunting for the handle. Or click the empty paper below the last line, and a fresh paragraph opens right there.
:::

::: callout {variant=warn}
Nothing here scrolls. When a page fills up, its last block moves onto the next leaf by itself — so a long thought becomes several pages instead of a scrollbar.
:::
`,

  // ---------------------------------------------------------------- the drawers
  // Page 9 — the stationery drawer
  `# The stationery drawer {sticker=pin}

::: card {title="What a card is for"}
Definitions, rules, anything worth fencing off from the prose around it. A card takes a \`title\` and wears any of the washes.
:::

::: index-card {title="Buttermilk scones"}
Rub 60g of butter into 250g of flour. Milk to bind. Hot oven, eight minutes. One fact to a card, and the drawer looks like a recipe box.
:::

::: quote-card {color=blush}
"A room without books is like a body without a soul."
:::

::: tag {color=moss}
a luggage tag, for labelling whatever comes next
:::

::: marginalia
Two dozen in all. The catalogue has the lot — \`Ctrl Alt A\`.
:::
`,

  // Page 10 — the postal drawer
  `# The postal drawer {sticker=heart}

::: envelope {color=amber}
Something folded away for later, with the flap still open.
:::

::: stamp {color=terracotta}
Perforated, postmarked, and worth exactly one penny.
:::

::: postcard {title="WISH YOU WERE HERE"}
Message on the left, address lines on the right, and no room for either. Ran out on the front, as usual.
:::

::: wax-seal {title=A}
Pressed while still soft. Not to be opened before Sunday.
:::

::: callout {variant=tip}
Type \`:::\` at the start of a line and the whole drawer opens as a menu.
:::
`,

  // Page 11 — the keepsake drawer
  `# Things stuck in {sticker=flower}

::: pressed-flower {title="Meadow cranesbill — the lane, June"}
Flat between the pages for a fortnight, and still blue.
:::

::: ticket-stub {title="ADMIT ONE"}
Row H, seat 12. It rained the whole way home, and it was worth every minute.
:::

::: map-pin {title="The blue door"}
Second on the left, past the bakery. Ask for Mrs Hale.
:::

::: card {title="Why each of these has a name of its own"}
Every one is an OCCASION rather than a shape. A set that differed only in its border radius would be one container with a colour attribute.
:::

::: callout {variant=tip}
They all take a \`title\`, and it is drawn as the label.
:::
`,

  // Page 12 — the four callouts, each being itself
  `# Four kinds of aside {sticker=coffee}

::: callout {variant=info}
**Info** — the plain one, for what a reader needs first.
:::

::: callout {variant=tip}
**Tip** — a nicety, or the thing you would say over a shoulder.
:::

::: callout {variant=warn}
**Warn** — mind this. The only one that raises its voice.
:::

::: callout {variant=star}
**Star** — worth keeping, and worth using sparingly.
:::

| Write this | Or just this |
| --- | --- |
| \`:::callout {variant=info}\` | \`:::info\` |
| \`:::callout {variant=tip}\` | \`:::tip\` or \`:::hint\` |
| \`:::callout {variant=warn}\` | \`:::warn\` or \`:::caution\` |
| \`:::callout {variant=star}\` | \`:::star\` or \`:::important\` |
`,

  // Page 13 — the asides that are not callouts, and the two folds
  `# Notes to one side {sticker=music}

::: sticky-note {color=lemon, rotate=-2}
A post-it. Pick it up by its handle and move it wherever it belongs, then tilt it with \`{rotate=-2}\`.
:::

::: washi-box {color=sky}
A box held to the page by a strip of washi tape.
:::

::: index-card {title="And a fold, in two kinds"}
A \`toggle\` puts a long aside out of the way until it is wanted, and nests as deep as the thought goes. A \`spoiler\` hides one answer until you look.
:::

::: toggle {title="A fold — click it"}
Here is what was folded away.
:::

::: spoiler
And this is the other kind.
:::
`,

  // ---------------------------------------------------------------- the pictures
  // Page 14 — pictures (the kittens the reader asked for)
  `# Pictures {sticker=cat}

Paste one in, drop one on the page, or write it out: \`![a caption](path/to/picture.png)\`.

::: image-row {style=polaroid, cols=3}
![A ginger kitten](${KITTENS.ginger}){caption="Has plans"}
![A grey kitten asleep](${KITTENS.asleep}){caption="On the good chair"}
![A cream kitten in a box](${KITTENS.box}){caption="His box now"}
:::

::: card {title="How a row behaves"}
Up to four will stand side by side, sharing the width between them. \`{style=plain}\` takes the frames off; \`{style=washi}\` tapes them down instead.
:::
`,

  // Page 15 — one picture, properly
  `# One picture, properly {sticker=sun}

::: columns {gap=lg}
::: col
::: polaroid
![The ginger kitten again](${KITTENS.ginger})
A white frame, captioned underneath in pencil.
:::

Drag a corner to resize a picture, or write \`{width=320}\`.
:::
::: col
::: photo-corner {title="or four paper corners"}
![A grey kitten asleep](${KITTENS.asleep})
:::

\`{align=left}\`, \`{align=center}\` and \`{align=right}\` slide one across the page.
:::
:::

::: card {title="Both of them are only containers"}
So a picture goes anywhere a block goes.
:::
`,

  // Page 16 — columns, shown by doing the thing columns are for
  `# Two up {sticker=leaf}

::: columns {gap=lg}
::: col
![A cream kitten in a box](${KITTENS.box}){width=260}
:::
::: col
**Words beside a picture**

This is what columns are best at. The picture keeps its own column and the words keep theirs, and neither has to be measured against the other.

Columns hold two, three or four of these. \`{gap=sm}\`, \`{gap=md}\` and \`{gap=lg}\` set how far apart they stand.
:::
:::

::: card {title="How it is written"}
\`::: columns\`, a \`::: col\` for each column, and a plain \`:::\` to close each one — the last of them closing the row.
:::

::: marginalia
A column may hold anything a page may hold, including more columns.
:::
`,

  // ---------------------------------------------------------------- the diagrams
  // Page 17 — things that nest
  `# Diagrams, drawn by hand {sticker=microscope}

Indentation alone makes a \`tree\`: two spaces to a level, \`|\` for a note.

\`\`\`tree {style=watercolor}
Alcove
  A library
    Bookcases | one per subject
    Floors
  A book
    Pages | this thing you are reading
    Ribbons
\`\`\`

::: card {title="Five fences, no library"}
\`tree\`, \`mindmap\`, \`graph\`, \`flowchart\` and \`timeline\` — about eighty lines of parser each, and every line of every diagram drawn by hand on the page.
:::

::: tag {color=amber}
the next five leaves are the other four
:::
`,

  // Page 18 — the same grammar, laid out the other way
  `# The same thing, thrown outward {sticker=sparkle}

A \`mindmap\` reads exactly like a \`tree\` — same indentation, same \`|\` notes — and lays its branches out around the middle instead of down the page.

\`\`\`mindmap
Bookbinding
  Sewing
    Kettle stitch
    Long stitch
  Covering
    Cloth
    Quarter leather
  Tools
    Bone folder
\`\`\`

::: callout {variant=tip}
Swap one word for the other and the same fence draws the other picture.
:::
`,

  // Page 19 — arrows
  `# Arrows {sticker=arrow}

One edge to a line makes a \`graph\`. A comma fans out to several at once.

\`\`\`graph
Idea {shape=cloud, color=amber}
Idea -> Draft, Notes
Draft -> Page: eventually
Notes -> Page
\`\`\`

::: card {title="The arrow is forgiving"}
\`->\`, \`-->\`, \`=>\` and \`→\` all mean the same thing, so whatever your assistant reaches for will work.
:::

::: callout {variant=tip}
\`{shape=rect}\`, \`{shape=cloud}\` or \`{shape=circle}\`, and any of the seven washes.
:::
`,

  // Page 20 — the same fence, for a process
  `# A process, step by step {sticker=coffee}

\`flowchart\` is the same grammar under a name that suits a process better.

\`\`\`flowchart
Write -> Fills up: a page
Fills up -> Flows on: by itself
Flows on -> Carry on: a fresh leaf
\`\`\`

::: callout {variant=info}
A \`mermaid\` fence is read by this same parser, so a diagram pasted in from somewhere else usually renders anyway.
:::

::: quote-card {color=moss}
None of these is Mermaid, and none of them needs to be.
:::
`,

  // Page 21 — things in order
  `# In order {sticker=moon}

\`label: text\` on each line makes a \`timeline\`, and \`| color=…\` tints one entry.

\`\`\`timeline
1665: Hooke looks down a microscope and names the cell
1839: Schwann — animal cells
1855: Virchow — cells come from cells | color=amber
1931: The electron microscope
\`\`\`

::: index-card {title="What goes in the label"}
Anything at all: a year, a step number, a day of the week. It is printed as written.
:::

::: card {title="And what comes after the pipe"}
\`| color=amber\` tints one entry. The same trick labels a branch on a \`tree\` and decorates a node on a \`graph\`.
:::
`,

  // ---------------------------------------------------------------- the precise
  // Page 22 — maths, both kinds, on squared paper
  `---
paper: grid
---

# Maths, in a notebook hand {sticker=sparkle}

A dollar either side puts maths inside a sentence — a circle is $\\pi r^2$, the golden ratio is $\\frac{1+\\sqrt{5}}{2}$ — and two dollars on a line of their own make an equation.

$$
e^{i\\pi} + 1 = 0
$$

$$
\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}
$$

$$
\\int_{0}^{\\infty} e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$

::: callout {variant=info}
Click any formula to see the TeX behind it. Enter puts the drawing back.
:::

::: card {title="Squared paper, because this page asked for it"}
\`paper: grid\` at the top of the script, and the leaf is ruled in squares.
:::
`,

  // Page 23 — code, kept exactly as it was pasted
  `# Code, in its own colours {sticker=microscope}

Three backticks and a language name. The block keeps every space you gave it, and colours itself.

\`\`\`python
def shelve(book, case):
    """Put a book back where it belongs."""
    floor, slot = case.free_spot()
    if slot is None:
        case.add_floor()
        floor, slot = case.free_spot()
    case.books[floor][slot] = book
    return floor, slot
\`\`\`

::: card {title="Seventy-odd languages"}
Python, Rust, TypeScript, SQL, YAML… and an unknown one keeps its name and its spacing anyway, it simply arrives in grey.
:::

::: callout {variant=tip}
The language sits on a little tab at the corner. Click it to change it, and the colours follow.
:::
`,

  // Page 24 — tables, and the one keepsake that is a table
  `# Tables, and a column of figures {sticker=coffee}

| Key | What it does |
| --- | --- |
| \`/\` | opens the slash menu |
| \`Esc\` | puts the book back on the shelf |
| \`Ctrl K\` | jumps to any page in the library |
| \`Ctrl Shift F\` | searches every word you own |
| \`Ctrl /\` | every other shortcut there is |

Click a column heading to sort by it; click again to sort the other way.

::: ledger {title="Bindery, March"}
Buckram 12.00 · Bookcloth 18.50 · Thread 3.20 · Bone folder 9.00
:::

::: card {title="Pipes and dashes are the whole syntax"}
A row with the wrong number of cells still makes a table. You get a note saying which row it was, never a broken page.
:::
`,

  // Page 25 — footnotes, and why they travel with the paragraph
  `# Notes at the foot of the page {sticker=pin}

A footnote is a marker in the prose[^ Bracket, caret, note, bracket. ] and the note is printed at the foot of the leaf it lands on[^flow].

The Markdown spelling works too[^why].

::: card {title="Why they travel"}
Pages here are a fixed height and text flows onward when one fills up. A note that stayed behind would end up on a leaf its marker had already left.
:::

::: index-card {title="Both spellings, side by side"}
\`[^ the whole note, inline ]\` puts the words in the marker. \`[^name]\` puts a label there and \`[^name]: …\` writes the note anywhere below.
:::

::: callout {variant=tip}
Hover a marker to read its note without looking down.
:::

[^flow]: So when a paragraph moves on, its note goes with it.
[^why]: Because an assistant writing you a page will reach for it first.
`,

  // Page 26 — references, and the backlinks they grow
  `# One page pointing at another {sticker=heart}

Type \`[[\` and pick a page, or write its name between double brackets.

The equations are back on [[Maths, in a notebook hand]], the fences are on [[Diagrams, drawn by hand]], and the kittens are on [[Pictures]].

::: callout {variant=star}
References work both ways. Open a page that is being pointed at and it tells you what mentions it — a table of contents nobody had to keep.
:::

::: card {title="Out of the app as well"}
\`[a link](https://example.com)\` opens in your browser, and a bare address typed on the page is turned into one.
:::

::: index-card {title="A reference that finds nothing"}
It stays on the page as its own words. Better a sentence that still reads than a chip pointing at a page nobody made.
:::
`,

  // ------------------------------------------------------------- the decoration
  // Page 27 — the universal block attrs
  `# Decorations {sticker=star}

Any block will wear them, and they stack.

Underlined by hand. {underline=squiggle}

A little tilt, and a piece of tape. {rotate=-2, tape=top}

Torn paper, inside a scalloped frame. {paper=torn, frame=scallop}

Circled, as if in red pencil. {underline=circled}

Lifted a little off the page. {shadow=lifted}

::: washi-box {color=sky}
Held down with a strip of washi tape.
:::

::: card {title="Where they live"}
Under the paintbrush in the rail, and on the effects shelf of the catalogue — \`Ctrl Alt A\`.
:::
`,

  // Page 28 — the lettering axes
  `# Lettering, and the ink it is in {sticker=music}

The everyday hand. {font=hand}

A marker pen. {font=marker}

Set in a book face, for a page that wants to look printed. {font=book}

Written in crimson. {ink=crimson}

Larger, and ranged right. {size=lg, align=right}

Small, centred, in ink-blue. {size=sm, align=center, ink=ink-blue}

::: card {title="Nine hands, five inks, five sizes"}
Every face here travels with the app, so a page looks the same on a machine that has never once seen the internet.
:::

::: index-card {title="Written out"}
\`{font=marker}\`, \`{ink=crimson}\`, \`{size=lg}\`, \`{align=right}\` — and they stack, in any order, on any block.
:::
`,

  // Page 29 — the page's own style, set from the top of the script
  `---
paper: dotted
wash: moss
---

# Paper, and the wash at the edge {sticker=leaf}

This leaf is dotted, with a moss wash at its edge. Both were set in three lines at the top of the script.

::: card {title="Four papers"}
\`cream\` for blank, \`lined\` for ruled, \`grid\` for squares, \`dotted\` for a dot grid. The page-style panel sets the same thing by hand.
:::

::: callout {variant=tip}
\`Ctrl Alt L\` opens it. The choice belongs to the page and not the book, so one leaf can be squared and the next one plain.
:::

::: index-card {title="And the ink"}
\`ink: sepia\`, \`ink: graphite\` or \`ink: ink-blue\` sets the colour the whole page is written in.
:::

::: tag {color=moss}
\`wash: amber\`, \`terracotta\`, \`moss\` or \`none\`
:::
`,

  // Page 30 — the two leaf directives, demonstrated on themselves
  `# Shorthand {sticker=pin}

::let course = Bookbinding, Michaelmas
::let {room=B12, week=3}
::style hero {color=amber, underline=marker}

Two colons define a value once, and \`{{name}}\` uses it anywhere. Define one at a time or several at once; the order does not matter.

**{{course}}** — room {{room}}, week {{week}}. {use=hero}

::: card {title="Named sets of decoration"}
\`::style hero {color=amber, underline=marker}\` names a bundle of attributes and \`{use=hero}\` puts it on any block. \`{use="hero quiet"}\` applies several at once.
:::

::: callout {variant=info}
An unknown name never breaks a page. It stays on the leaf, verbatim, beside a note saying which names were defined.
:::

::: index-card {title="Where they go afterwards"}
Both lines are lifted out before the page is built, so they cost nothing on the leaf — and once you edit the page in the app, an export has the values already written in.
:::
`,

  // -------------------------------------------------------------- the way about
  // Page 31 — getting back to something you wrote
  `# Finding it again {sticker=book}

::: card {title="Three ways back"}
\`Ctrl K\` jumps to any book, heading or page by name. \`Ctrl Shift F\` searches the words inside every book you own. The contents panel lists this book's pages in order.
:::

Drop a **ribbon** on a page — \`Ctrl Alt B\` — and it shows at the edge of the book, so the page you keep returning to is one click away.

::: index-card {title="Eight of the useful ones"}
- \`Ctrl Alt T\` the table of contents
- \`Ctrl Alt M\` the strip of little pages
- \`Ctrl N\` a new page after this one
- \`F9\` focus mode, just you and the paper
- \`Ctrl ,\` settings
- \`Ctrl /\` every other shortcut there is
- \`Ctrl Alt G\` start from a template
- \`Esc\` back to the shelf
:::
`,

  // Page 32 — the language, and the way out
  `# Write it with your AI {sticker=sparkle}

Every page in this book is written in **Notebook Script** — a forgiving Markdown dialect, which the app reads back out again.

1. Open the tray at the foot of the rail — **In and out**
2. Click **Copy AI spec** and paste that into your assistant
3. Ask it for a page, then paste the reply into **Insert script**

::: callout {variant=info}
The parser never fails. A small slip renders anyway, with a gentle note saying what it did instead.
:::

::: card {title="And back out again"}
The same tray exports a page as script, as a PDF or as a picture, packs the whole library into one file, and turns a folder of Markdown into books.
:::

::: quote-card {color=amber}
Now go and write something of your own.
:::
`,
];

/**
 * Node types registered in the real editor schema (src/editor/nodes/index.ts
 * registry + extensions.ts). Passed as `hasNode` so seeding emits real
 * sticker/diagram/container/maths nodes instead of fallback placeholders.
 * Keep in sync with the registry — names match vocab.ts canonical names.
 */
const EDITOR_NODE_NAMES: ReadonlySet<string> = new Set([
  'callout',
  // `imageRow` describes the container, while its content expression still
  // depends on the separate image node. The script bridge now asks about both
  // before emitting a row; omitting this entry silently degraded the Welcome
  // book's kitten photographs into fallback paragraphs.
  'image',
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
  'index-card',
  'envelope',
  'stamp',
  'tag',
  'marginalia',
  'pressed-flower',
  'ticket-stub',
  'postcard',
  'ledger',
  'photo-corner',
  'wax-seal',
  'map-pin',
  // The four that landed after the first version of this book was written,
  // and the reason it is being rewritten: an equation, a note at the foot of
  // the page, a reference to another page, and a fold. A name missing here is
  // not an error — it is a silent downgrade to a paragraph, which is exactly
  // how the first version of this list quietly shipped callouts where the
  // stationery should have been.
  'math',
  'mathInline',
  'footnote',
  'pageLink',
  'details',
  'detailsSummary',
  'detailsContent',
]);

/**
 * Each page's own title — its first heading, read out of the parsed page
 * rather than listed a second time here.
 *
 * A second list would be a second thing to keep in step, and the one place it
 * matters is exactly where a mistake would be invisible: `[[Maths, in a
 * notebook hand]]` on page ten has to match page three's heading CHARACTER FOR
 * CHARACTER or the reference silently degrades to plain words, which is what
 * it is supposed to do when there is no such page.
 */
export function welcomePageTitles(): string[] {
  return WELCOME_PAGE_SOURCES.map((source) => {
    for (const block of parse(source).blocks) {
      if (block.kind !== 'heading') continue;
      let text = '';
      const walk = (nodes: readonly { kind: string }[]): void => {
        for (const n of nodes) {
          const node = n as { kind: string; text?: string; children?: unknown };
          if (typeof node.text === 'string') text += node.text;
          else if (Array.isArray(node.children)) {
            walk(node.children as { kind: string }[]);
          }
        }
      };
      walk(block.content);
      return text.trim();
    }
    return '';
  });
}

/** Where a `[[…]]` reference points, once the pages actually exist. */
export interface WelcomePageIds {
  bookId: string;
  /** Page ids in page order — index-aligned with WELCOME_PAGE_SOURCES. */
  pageIds: readonly string[];
}

/**
 * Build the welcome book's page documents from the script sources.
 *
 * `ids` is optional and only page ten needs it: without it the two `[[…]]`
 * references on that page still render, as the titles they name. That is the
 * honest degradation — a chip pointing at no page would be worse than a
 * sentence — but the seeder does have the ids, so it passes them.
 */
export function buildWelcomePageDocs(ids?: WelcomePageIds): Array<{
  doc: PageDoc;
  source: string;
}> {
  const titles = welcomePageTitles();
  const resolve = (label: string): { pageId: string; bookId: string } | null => {
    if (ids === undefined) return null;
    const index = titles.indexOf(label.trim());
    const pageId = index === -1 ? undefined : ids.pageIds[index];
    return pageId === undefined ? null : { pageId, bookId: ids.bookId };
  };
  return WELCOME_PAGE_SOURCES.map((source, index) => {
    const doc = scriptDocToTiptap(parse(source), {
      hasNode: (name) => EDITOR_NODE_NAMES.has(name),
      resolvePageLink: resolve,
    });
    // The seeder already owns the real page ids. Stamp block identity now so
    // the first offscreen flip capture and the first live leaf cannot each
    // invent a different tilt seed. The fallback scope keeps pure builders
    // deterministic when rows have not been created (tests/previews).
    const pageId = ids?.pageIds[index] ?? `welcome:${index}`;
    return {
      doc: materializeStableBlockIds(pageId, doc).doc,
      source,
    };
  });
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
  // Under ANY name it has ever had — a welcome book is never a stale demo.
  if (ALL_WELCOME_TITLES.includes(title)) return false;
  if (!OLD_DEMO_TITLES.includes(title)) return false;
  return pageDocs.every(isEmptyPageDoc);
}

// ---------------------------------------------------------------------------
// The welcome book was rewritten, and the old one is replaced ONLY where
// nobody has written in it.
//
// Written once for v4 → v5 and reused unchanged for v5 → v6, which is the
// point of it: the decision is "is every page in this book still one we
// shipped", not "which generation is it". Appending the outgoing pages to
// LEGACY_WELCOME_PAGE_SOURCES is the whole of what a rewrite has to do here.
// ---------------------------------------------------------------------------

/**
 * Every welcome page this app has ever seeded — the two retired generations
 * and the live one. Membership is the first half of "we put this here".
 */
const SHIPPED_WELCOME_SOURCES: readonly string[] = [
  ...LEGACY_WELCOME_PAGE_SOURCES,
  ...WELCOME_PAGE_SOURCES,
];

/**
 * A page's document with every `id` attribute removed, as canonical JSON.
 *
 * The ids are why this comparison cannot be a plain deep-equal. Current seeds
 * carry deterministic ids, while older seeds were stored without them and
 * TipTap minted random ones when a page first opened. Both shapes describe
 * the same authored page, so identity is removed before comparison.
 */
function docFingerprint(doc: PageDoc): string {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (value === null || typeof value !== 'object') return value;
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'id') continue;
      if (key === 'attrs' && inner !== null && typeof inner === 'object') {
        const attrs: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(inner as Record<string, unknown>)) {
          if (k !== 'id' && v !== null) attrs[k] = v;
        }
        if (Object.keys(attrs).length > 0) out.attrs = attrs;
        continue;
      }
      out[key] = strip(inner);
    }
    return out;
  };
  return JSON.stringify(strip(doc));
}

/**
 * Rebuild the document a stored script source would have produced.
 *
 * Exported because the migration test has to be able to build a v4 library
 * exactly as the v4 seeder left it — writing the old documents by hand would
 * be testing the test.
 */
export function docFromSeededSource(source: string): PageDoc {
  return scriptDocToTiptap(parse(source), {
    hasNode: (name) => EDITOR_NODE_NAMES.has(name),
  });
}

/**
 * True when this page is still exactly what the seeder put there.
 *
 * Two things have to hold, and neither is enough alone. The stored source has
 * to be one WE shipped — otherwise it is a page the reader inserted, which is
 * theirs. And the document has to still be what that source builds —
 * otherwise they have written in it since, and the source is only the thing it
 * started as.
 *
 * The `source_dirty` flag is deliberately not consulted. Older app versions
 * marked it when merely opening a page caused UniqueID's first save, and that
 * historical bit remains set after an upgrade even though current identity
 * preparation no longer treats opening as an authored edit.
 */
export function isUnchangedSeededPage(page: {
  scriptSource: string | null;
  doc: PageDoc;
}): boolean {
  if (page.scriptSource === null) return false;
  if (!SHIPPED_WELCOME_SOURCES.includes(page.scriptSource)) return false;
  return docFingerprint(page.doc) === docFingerprint(docFromSeededSource(page.scriptSource));
}

/**
 * The refresh decision: may this welcome book's pages be replaced wholesale?
 *
 * Only if every page in it is either one of ours, untouched, or a blank leaf
 * somebody added and never filled. One written page — a shopping list on page
 * four, a paragraph appended to page one — and the whole book is left exactly
 * as it is. The reader keeps the old tour, which is a small loss; the
 * alternative is deleting somebody's writing to install a nicer brochure.
 */
export function isReplaceableWelcomeBook(
  pages: readonly { scriptSource: string | null; doc: PageDoc }[],
): boolean {
  if (pages.length === 0) return false;
  let ours = 0;
  for (const page of pages) {
    if (isUnchangedSeededPage(page)) {
      ours += 1;
      continue;
    }
    // A blank leaf carries nothing to lose. Anything else is theirs.
    if (page.scriptSource === null && isEmptyPageDoc(page.doc)) continue;
    return false;
  }
  return ours > 0;
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

/** Every title the book may currently be under: the live one and all the old. */
const ALL_WELCOME_TITLES: readonly string[] = [
  WELCOME_BOOK_TITLE,
  ...LEGACY_WELCOME_BOOK_TITLES,
];

/**
 * EVERY title counts, not just the current one.
 *
 * A library seeded before a rename still holds an old title, and asking only
 * about the live one would report the welcome book missing and seed a second
 * copy beside it. Built from the list so a third rename needs no edit here.
 */
async function welcomeBookExists(db: Db): Promise<boolean> {
  const placeholders = ALL_WELCOME_TITLES.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await db.select<Array<{ id: string }>>(
    `SELECT id FROM books WHERE title IN (${placeholders}) LIMIT 1`,
    [...ALL_WELCOME_TITLES],
  );
  return rows.length > 0;
}

/**
 * The app was renamed, so the book that welcomes you to it is renamed in place.
 * Retitling rather than reseeding is the whole point — the reader may have
 * written in it, and it is still their book.
 *
 * Sweeps ALL the old titles, not the most recent one: a library that skipped a
 * version is sitting on an older name, and migrating only the newest would
 * leave it unrecognised — which is precisely the case that seeds a duplicate.
 *
 * The spine is deliberately left alone. Its seed is derived from the title, so
 * regenerating it would change the object on the shelf under someone who had
 * come to recognise it, to no benefit.
 */
async function renameLegacyWelcomeBook(db: Db): Promise<void> {
  for (const old of LEGACY_WELCOME_BOOK_TITLES) {
    await db.execute('UPDATE books SET title = $1 WHERE title = $2', [
      WELCOME_BOOK_TITLE,
      old,
    ]);
  }
}

/**
 * v13: the Welcome book keeps one blue marker between its pages and its solid
 * square case, but an untouched v12 quill binding is redressed with one crown
 * and a restrained gilt fillet.
 *
 * This migration is deliberately all-or-nothing across the three appearance
 * axes. The complete cover style, between-page ribbon and binding choice must
 * all still be shipped/unset values before any one is changed. A reader who
 * customised even one part keeps the whole book exactly as they left it,
 * unless they explicitly enabled replacing the edited guide on updates.
 */
async function migrateWelcomeBookDesign(db: Db, force = false): Promise<void> {
  // A direct book route can seed before the shelf starts this store. Load it
  // before testing the binding or an in-memory empty value could overwrite a
  // real persisted choice.
  await loadDesignPrefs();
  let rows = await db.select<Array<{ id: string; cover_meta: string | null }>>(
    'SELECT id, cover_meta FROM books WHERE title = $1',
    [WELCOME_BOOK_TITLE],
  );
  // A reader may have renamed the guide. The deterministic seed is its stable
  // fallback identity when they explicitly ask an update to replace edits.
  if (force && rows.length === 0) {
    rows = await db.select<Array<{ id: string; cover_meta: string | null }>>(
      'SELECT id, cover_meta FROM books WHERE spine_seed = $1',
      [WELCOME_SPINE_SEED],
    );
  }
  const legacyStyle = LEGACY_MARKED_WELCOME_BINDING as Record<string, unknown>;
  const legacyStyleKeys = Object.keys(legacyStyle).sort();
  const v12Style = V12_QUILL_WELCOME_BINDING as Record<string, unknown>;
  const v12StyleKeys = Object.keys(v12Style).sort();
  const claretStyle = V13_CLARET_WELCOME_BINDING as Record<string, unknown>;
  const claretStyleKeys = Object.keys(claretStyle).sort();
  const v15BlueStyle = V15_BLUE_WELCOME_BINDING as Record<string, unknown>;
  const v15BlueStyleKeys = Object.keys(v15BlueStyle).sort();
  const v16VelvetStyle = V16_VELVET_WELCOME_BINDING as Record<string, unknown>;
  const v16VelvetStyleKeys = Object.keys(v16VelvetStyle).sort();
  const currentStyle = WELCOME_BINDING as Record<string, unknown>;
  const currentStyleKeys = Object.keys(currentStyle).sort();
  const legacyRibbonKeys = Object.keys(LEGACY_CRIMSON_WELCOME_RIBBON).sort();
  const currentRibbonKeys = Object.keys(WELCOME_RIBBON).sort();

  const exactRecord = (
    raw: unknown,
    expected: Readonly<Record<string, unknown>>,
    keys: readonly string[],
  ): raw is Record<string, unknown> =>
    raw !== null &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    Object.keys(raw).sort().length === keys.length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(raw, key) &&
        (raw as Record<string, unknown>)[key] === expected[key],
  );

  for (const row of rows) {
    let meta: Record<string, unknown> = {};
    if (row.cover_meta !== null) {
      try {
        const parsed: unknown = JSON.parse(row.cover_meta);
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          meta = parsed as Record<string, unknown>;
        } else if (!force) {
          continue;
        }
      } catch {
        if (!force) continue;
      }
    } else if (!force) {
      continue;
    }

    if (force) {
      // `cover` is the old compatibility projection of `style`. Keeping a
      // reader-authored copy here would let the open-book renderer repaint the
      // new edition with stale furniture even after the canonical style moved.
      const preservedMeta = { ...meta };
      delete preservedMeta.cover;
      await db.execute(
        'UPDATE books SET title = $1, spine_seed = $2, cover_meta = $3, updated_at = $4 WHERE id = $5',
        [
          WELCOME_BOOK_TITLE,
          WELCOME_SPINE_SEED,
          JSON.stringify({
            ...preservedMeta,
            style: { ...WELCOME_BINDING },
            ribbon: { ...WELCOME_RIBBON },
          }),
          new Date().toISOString(),
          row.id,
        ],
      );
      await saveBookBinding(row.id, WELCOME_BOOK_PRESET);
      continue;
    }
    const rawStyle = meta.style;
    let isOldShippedStyle = false;
    if (rawStyle !== null && typeof rawStyle === 'object' && !Array.isArray(rawStyle)) {
      const style = rawStyle as Record<string, unknown>;
      const keys = Object.keys(style).sort();
      const hasShippedShape =
        keys.length === legacyStyleKeys.length &&
        keys.every((key, index) => key === legacyStyleKeys[index]);
      const isLegacyMarker =
        style.charmColor === 0 || style.charmColor === 1 || style.charmColor === 2;
      isOldShippedStyle =
        style.charm === 'ribbon' &&
        isLegacyMarker &&
        hasShippedShape &&
        legacyStyleKeys.every(
          (key) => key === 'charmColor' || style[key] === legacyStyle[key],
        );
    }
    const isV12ShippedStyle = exactRecord(rawStyle, v12Style, v12StyleKeys);
    const isClaretShippedStyle = exactRecord(rawStyle, claretStyle, claretStyleKeys);
    const isV15BlueShippedStyle = exactRecord(rawStyle, v15BlueStyle, v15BlueStyleKeys);
    const isV16VelvetShippedStyle = exactRecord(
      rawStyle,
      v16VelvetStyle,
      v16VelvetStyleKeys,
    );
    // Recognising the current value makes the operation recoverable if a v12
    // or v13 run wrote cover_meta but was interrupted before pinning the
    // silhouette.
    const isCurrentShippedStyle = exactRecord(rawStyle, currentStyle, currentStyleKeys);

    const rawRibbon = meta.ribbon;
    const hasLegacyRibbon = exactRecord(
      rawRibbon,
      LEGACY_CRIMSON_WELCOME_RIBBON,
      legacyRibbonKeys,
    );
    const hasCurrentShippedRibbon = exactRecord(rawRibbon, WELCOME_RIBBON, currentRibbonKeys);
    const ribbonIsShipped =
      !Object.prototype.hasOwnProperty.call(meta, 'ribbon') ||
      hasLegacyRibbon ||
      hasCurrentShippedRibbon;
    const pinned = bookBinding(row.id);
    const bindingIsShipped =
      pinned === null ||
      pinned === 'plain-cloth' ||
      pinned === 'velvet-ducal' ||
      pinned === WELCOME_BOOK_PRESET;

    if (
      !(
        isOldShippedStyle ||
        isV12ShippedStyle ||
        isClaretShippedStyle ||
        isV15BlueShippedStyle ||
        isV16VelvetShippedStyle ||
        isCurrentShippedStyle
      ) ||
      !ribbonIsShipped ||
      !bindingIsShipped
    ) {
      continue;
    }

    if (
      isOldShippedStyle ||
      isV12ShippedStyle ||
      isClaretShippedStyle ||
      isV15BlueShippedStyle ||
      isV16VelvetShippedStyle ||
      !hasCurrentShippedRibbon
    ) {
      await db.execute('UPDATE books SET cover_meta = $1 WHERE id = $2', [
        JSON.stringify({
          ...meta,
          style: { ...WELCOME_BINDING },
          ribbon: { ...WELCOME_RIBBON },
        }),
        row.id,
      ]);
    }
    if (pinned !== WELCOME_BOOK_PRESET) {
      await saveBookBinding(row.id, WELCOME_BOOK_PRESET);
    }
  }
}

/**
 * Write the welcome pages into a book, in two passes.
 *
 * The second pass exists because page ten links to pages three and eight, and
 * a link needs the id of a row that does not exist until it has been
 * inserted. So: create every page empty to mint the ids, build the documents
 * with those ids in hand, then fill the pages in. One extra write per page,
 * once, on a path that runs at most once per install.
 *
 * `savePageDoc` before `setPageScript` and not the other way round:
 * `savePageDoc` marks a page's source dirty when it already has one, and the
 * source is not stale here — it is the thing the document was just built from.
 */
async function writeWelcomePages(bookId: string): Promise<void> {
  const pageIds: string[] = [];
  for (let i = 0; i < WELCOME_PAGE_SOURCES.length; i += 1) {
    const page = await createPage({ bookId, ord: i });
    pageIds.push(page.id);
  }
  const built = buildWelcomePageDocs({ bookId, pageIds });
  for (let i = 0; i < built.length; i += 1) {
    await savePageDoc(pageIds[i], built[i].doc);
    await setPageScript(pageIds[i], built[i].source);
  }
}

/**
 * Replace a guide deliberately, retaining its existing page identities where
 * the new edition has a page at the same ordinal. Page references, bookmarks
 * and an already-open route therefore keep pointing at the corresponding
 * leaf; only surplus leaves have to disappear.
 */
async function rewriteWelcomePagesInPlace(db: Db, bookId: string): Promise<void> {
  const existing = await listPages(bookId);
  const pageIds: string[] = [];

  for (let i = 0; i < WELCOME_PAGE_SOURCES.length; i += 1) {
    const page = existing[i];
    if (page === undefined) {
      const created = await createPage({ bookId, ord: i });
      pageIds.push(created.id);
      continue;
    }
    pageIds.push(page.id);
    if (page.ord !== i) {
      await db.execute('UPDATE pages SET ord = $1 WHERE id = $2', [i, page.id]);
    }
  }

  const built = buildWelcomePageDocs({ bookId, pageIds });
  for (let i = 0; i < built.length; i += 1) {
    await setPageScript(pageIds[i], built[i].source, built[i].doc);
  }

  for (const page of existing.slice(WELCOME_PAGE_SOURCES.length)) {
    await removePageIndex(page.id);
    await db.execute('DELETE FROM pages WHERE id = $1', [page.id]);
  }
}

async function createWelcomeBook(): Promise<void> {
  const book = await createBook({
    title: WELCOME_BOOK_TITLE,
    floor: 0,
    slot: 3,
    spineSeed: WELCOME_SPINE_SEED,
    coverMeta: {
      style: { ...WELCOME_BINDING },
      ribbon: { ...WELCOME_RIBBON },
    },
  });
  await saveBookBinding(book.id, WELCOME_BOOK_PRESET);
  await writeWelcomePages(book.id);
}

/**
 * Swap a retired tour for the current one, in place.
 *
 * The BOOK is not touched — same row, same id, same spine, same position on
 * the shelf, so a reader who has come to recognise the object finds the same
 * object. Only its pages are replaced, and only when `isReplaceableWelcomeBook`
 * says every one of them is still ours.
 *
 * Search index rows go with the pages they described; leaving them would make
 * the quick switcher offer pages that no longer exist.
 */
async function refreshWelcomeBook(db: Db, force = false): Promise<boolean> {
  let rows = await db.select<Array<{ id: string }>>(
    `SELECT id FROM books WHERE title = $1`,
    [WELCOME_BOOK_TITLE],
  );
  // A reader may rename the guide. Its deterministic seed is the stable
  // fallback only for the explicit destructive option, never for a routine
  // conservative migration.
  if (force && rows.length === 0) {
    rows = await db.select<Array<{ id: string }>>(
      'SELECT id FROM books WHERE spine_seed = $1',
      [WELCOME_SPINE_SEED],
    );
  }
  let refreshed = false;
  for (const row of rows) {
    const pages = await listPages(row.id);
    if (force) {
      await rewriteWelcomePagesInPlace(db, row.id);
      refreshed = true;
      continue;
    }
    if (!isReplaceableWelcomeBook(pages)) continue;
    for (const page of pages) {
      await removePageIndex(page.id);
      await db.execute('DELETE FROM pages WHERE id = $1', [page.id]);
    }
    await writeWelcomePages(row.id);
    refreshed = true;
  }
  return refreshed;
}

/**
 * Seed + migrate on app load (name kept for existing callers).
 *
 * Everything below SEED_VERSION runs, oldest step first:
 *
 *   v1 cleanup  delete the 24 demo books, but only ones nobody wrote in
 *   v2/v3/v4    retitle a welcome book sitting on any past app name
 *   v5, v6      replace the welcome book's PAGES with the current tour, and
 *               only when every page in it is still exactly as it was seeded
 *   v9           changed only the untouched shipped outer marker to navy
 *   v10          changed untouched Welcome markers to crimson / Festive Gift
 *   v11          changes those untouched markers to matching blues
 *   v12          removes the untouched outer marker/endbands and pins a solid
 *                square case, preserving every explicit customisation
 *   v13          rebinds only the exact untouched v12 exterior with a crown
 *                and restrained fillet; pages stay unless the reader opted
 *                into replacing an edited Welcome book on app updates
 *   v14          replaces every retired BOOK appearance with the rebuilt
 *                straight-backed, bookbinder-led system; rooms and pages are
 *                outside that migration
 *   v15          refreshes the three rebuilt-book/media/updater guide leaves,
 *                preserving edited pages unless the reader opted in
 *   v16          upgrades the untouched Grand-blue exterior to its authored
 *                Renaissance panel and engraved direct-gilt title
 *   always      create the welcome book if the library has none
 *
 * The order matters twice. Renaming BEFORE the existence check is what stops
 * a pre-rename library growing a second welcome book (the check reads every
 * past title too, because a migration that is only correct in one order is a
 * trap). And refreshing AFTER the rename is what lets a library that skipped
 * a version get the new pages in the same pass that gives it the new name.
 *
 * Returns true when the welcome book was CREATED by this call — a refreshed
 * book is not a new one, and the caller uses this to decide whether to make a
 * fuss about a first run.
 */
export async function seedIfEmpty(): Promise<boolean> {
  const db = await getDb();
  const previousVersion = await readSeedVersion(db);
  if (previousVersion >= SEED_VERSION) return false;

  // Shelf seeding can race App's settings hydration on a direct book route.
  // Read the persisted blob here instead of trusting the reactive default.
  // A damaged settings row must fail closed: preserving edits is safer.
  const refreshEditedWelcome = await readRefreshWelcomePreference(db);

  await cleanupOldDemoBooks(db);
  await renameLegacyWelcomeBook(db);
  // Run before `migrateWelcomeBookDesign`, whose first action hydrates the
  // design preference store. Loading the old blob first would cache retired
  // bindings for the rest of this launch even after SQLite had been repaired.
  await migrateBookAppearanceSystem(db);
  await migrateWelcomeBookDesign(db, refreshEditedWelcome);
  // v16 updates the binding-studio leaves in the forty-eight-leaf field guide.
  // The refresh
  // helper preserves a reader-edited guide unless they explicitly opted in,
  // while an untouched older guide receives the current onboarding content.
  if (refreshEditedWelcome || previousVersion < 16) {
    await refreshWelcomeBook(db, refreshEditedWelcome);
  }
  const exists = await welcomeBookExists(db);
  if (!exists) await createWelcomeBook();
  await writeSeedVersion(db, SEED_VERSION);
  return !exists;
}
