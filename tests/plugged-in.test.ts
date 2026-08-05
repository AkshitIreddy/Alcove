// @vitest-environment node
/**
 * tests/plugged-in.test.ts — the standing alarm for code that was written,
 * exported, unit-tested, and then read by nobody.
 *
 * The reader asked for this in as many words:
 *
 *   > "perhaps even a safety clever functionality sort of like alarm to every
 *   >  part of the code to basically spit out errors if it isn't plugged in"
 *
 * They asked because it had happened FIVE times, and every one of the five
 * passed its own tests the whole time it was inert:
 *
 *   1. the colour effect axis — fifty tints, in the vocabulary, in the CSS,
 *      offered by no menu;
 *   2. the whole lettering shelf — hand, ink, size and ranging, likewise;
 *   3. all fifty underlines;
 *   4. the wallpaper roll gate — `WALLPAPER_ROLL` / `isRollableWallpaper` /
 *      `rollWallpaper`, authored and exported while the studio's "surprise me"
 *      still rolled all 126 presets;
 *   5. `ROLLABLE_SHAPES` / `ROLLABLE_MATERIALS` / `ROLLABLE_DECORATIONS`.
 *
 *   …and a sixth, found by this file on the day it was written: the settings
 *   sheet's Appearance section offered four themes, three hands and three inks
 *   while fifty named inks, fifty named papers and nine loaded type families
 *   sat one import away.
 *
 * `tests/roll-gates.test.ts` is the ancestor of this file: it checks that the
 * three roll pools have a caller, by reading the caller's source. This
 * generalises it — every exported VOCABULARY, POOL, GATE and LABEL MAP in
 * `src/art` and `src/editor/effects` must have a real consumer somewhere in
 * `src/` outside its own module.
 *
 * ## How it decides
 *
 * Two passes, because neither alone is enough:
 *
 *   - the modules are IMPORTED, and each export inspected, so "is this a
 *     vocabulary" is answered by what the value actually IS (a table of
 *     entries, a pool, a predicate) rather than by how its name reads;
 *   - the consumers are found by READING SOURCE, because the question is
 *     "does any module in this app name this thing", and source is exactly
 *     what can answer that. A consumer must both import from the defining
 *     module and name the identifier, so a coincidence of names elsewhere in
 *     a thirty-thousand-line tree cannot wave an inert export through.
 *
 * ## The exemption list
 *
 * Some exports really are API-only — a predicate that exists so a table one
 * file down can be built from it, a constant a test measures against. Those
 * are listed in `EXEMPT` with the reason written out. The list is checked back
 * against the tree: an exemption naming something that no longer exists fails
 * the suite, so it cannot quietly rot into a list of names nobody recognises.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  APP_THEMES,
  APP_THEME_FAMILIES,
  APPEARANCE_TIERS,
  BLOCK_INK_IDS,
  BLOCK_PAPER_IDS,
  DEFAULT_APP_THEME_ID,
  HANDS,
  INKS,
  INK_FAMILIES,
  PAPERS,
  PAPER_FAMILIES,
  THEME_BASES,
  appearanceTokens,
  contrastRatio,
  resolveHand,
  resolveInk,
  resolvePaper,
  resolveTheme,
} from '../src/features/settings/appearance';
import { HANDWRITING_FONT_STACKS } from '../src/features/settings/apply';

/* ========================================================================== *
 *                        part one — the standing alarm                       *
 * ========================================================================== */

const SRC = join(import.meta.dirname, '..', 'src');

/**
 * What this alarm watches.
 *
 * Two directories and two files. The directories are the vocabulary roots;
 * the files are named one at a time because their FOLDERS cannot be watched —
 * part one IMPORTS everything it watches under a node environment, and
 * `src/features/settings/` also holds `SettingsPanel.tsx`, which pulls in
 * Solid, GSAP and the DOM. Naming the pure module is what lets the alarm cover
 * a vocabulary that happens to live beside a component.
 *
 * `codeLanguages` and `codeAppearance` are the seventh and eighth vocabularies
 * in the app, and both are exactly the shape this file exists to watch: a
 * table of entries with tiers, a shortlist derived from them, and a roll pool.
 * The appearance vocabulary was the sixth thing the alarm found — on itself,
 * the day it was written — so a new one going unwatched is a mistake this
 * file has already made once.
 */
const WATCHED = [
  join(SRC, 'art'),
  join(SRC, 'editor', 'effects'),
  join(SRC, 'editor', 'codeLanguages.ts'),
  join(SRC, 'features', 'settings', 'codeAppearance.ts'),
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Strip comments, so a file's own prose cannot count as a consumer. */
const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');

/* ========================================================================== *
 *          what counts as READING something, and what only looks like it     *
 * ========================================================================== *
 *
 * THE THREE WAYS A MENTION CAN LIE, all of which this tree has actually used.
 * Each is stripped before a file is asked whether it names an export:
 *
 *   1. AN IMPORT. `import { openTemplatesGallery } from './TemplatesGallery'`
 *      says a module MIGHT use the thing. Twelve of the files in here import
 *      something they then only re-export.
 *   2. A RE-EXPORT. `export { openTemplatesGallery } from './TemplatesGallery'`
 *      moves a name; it does not read it. `features/templates/groupD.ts` is a
 *      barrel of exactly these, and while the original version of this file
 *      counted them, it certified four whole features as "read by somebody"
 *      on the strength of a barrel nobody imported for them.
 *   3. A DEV BRIDGE. `if (import.meta.env.DEV) { window.__nbGroupD = {…} }`
 *      is not a home; it is a hatch for a test harness. The same four features
 *      were on that object, and their Playwright specs drove them through it,
 *      so every one of them passed continuously while being unreachable.
 *
 * What survives the strip is the code that runs in a production build, which
 * is the only thing that can put a button in front of a reader.
 */

/**
 * A module's source with imports, re-export relays and DEV blocks removed.
 *
 * EVERY PATTERN HERE IS ANCHORED TO THE START OF A LINE, and that is not
 * cosmetic. The first cut matched `\bimport\s*['"]…['"]` anywhere, and
 * `SettingsPanel.tsx` contains the type `(tab: 'export' | 'import')` — so the
 * word inside that string literal opened a "side-effect import" that ran to
 * the next quote a thousand characters later and quietly deleted three real
 * call sites. A statement-shaped regex has to be pinned where statements are.
 */
function liveCode(src: string): string {
  let text = strip(src);
  // Bare `import '…'` FIRST: it has no `from`, so leaving it would let the
  // pattern below start there and run on to some later import's `from`.
  text = text.replace(/^\s*import\s*['"][^'"]*['"]\s*;?/gm, ' ');
  text = text.replace(/^\s*import\s[\s\S]*?\bfrom\s*['"][^'"]*['"]\s*;?/gm, ' ');
  // `export … from '…'`, in both the `*` and the `{ … }` forms.
  text = text.replace(
    /^\s*export\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[\s\S]*?\})\s*from\s*['"][^'"]*['"]\s*;?/gm,
    ' ',
  );
  return stripDevBlocks(text);
}

/**
 * Blank out the body of every `if (import.meta.env.DEV …) { … }`.
 *
 * Brace-counted rather than regexed: the block in `groupD.ts` holds an object
 * literal and an arrow function, and a non-greedy `\{[\s\S]*?\}` stops at the
 * first inner brace — which would leave the half of the bridge that names the
 * flows still standing.
 *
 * It also has to find the `if` that OWNS the mention rather than the next `{`
 * in the file: `App.tsx` says `return import.meta.env.DEV === true;` inside a
 * predicate, and blanking from there to the next matching brace took the whole
 * of the following component with it. A mention with no `if (` in front of it
 * on its own line is left exactly where it is.
 */
function stripDevBlocks(text: string): string {
  let out = text;
  let from = 0;
  for (;;) {
    const at = out.indexOf('import.meta.env.DEV', from);
    if (at < 0) return out;
    const block = devBlockAt(out, at);
    if (block === null) {
      from = at + 1;
      continue;
    }
    out = out.slice(0, block.start) + ' '.repeat(block.end - block.start) + out.slice(block.end);
    from = block.start;
  }
}

/** The `if (…DEV…) { … }` a mention sits in, or null when it is not in one. */
function devBlockAt(text: string, at: number): { start: number; end: number } | null {
  const lineStart = text.lastIndexOf('\n', at) + 1;
  const head = text.slice(lineStart, at);
  const ifAt = head.lastIndexOf('if');
  if (ifAt < 0 || !/^if\s*\(/.test(head.slice(ifAt))) return null;
  const start = lineStart + ifAt;
  // Walk the condition's parens, then the block's braces.
  const close = matchAt(text, text.indexOf('(', start), '(', ')');
  if (close < 0) return null;
  const open = text.indexOf('{', close);
  if (open < 0 || text.slice(close + 1, open).trim() !== '') return null;
  const end = matchAt(text, open, '{', '}');
  return end < 0 ? null : { start, end: end + 1 };
}

/** Index of the delimiter closing the one at `open`, or -1. */
function matchAt(text: string, open: number, up: string, down: string): number {
  if (open < 0) return -1;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === up) depth += 1;
    else if (text[i] === down) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const ALL_FILES = walk(SRC);
const SOURCE = new Map(ALL_FILES.map((f) => [f, strip(readFileSync(f, 'utf8'))] as const));
/** The same files with the three lying mentions removed — see above. */
const LIVE = new Map(
  ALL_FILES.map((f) => [f, liveCode(readFileSync(f, 'utf8'))] as const),
);
const WATCHED_FILES = ALL_FILES.filter((f) => WATCHED.some((dir) => f.startsWith(dir)));

const rel = (file: string): string => relative(SRC, file).replace(/\\/g, '/');
/** `src/art/flat.ts` → `flat`, which is how every importer spells it. */
const moduleName = (file: string): string => basename(file).replace(/\.tsx?$/, '');

/**
 * Every spelling an importer can use for this file.
 *
 * `index.ts` is imported by its FOLDER — `from '../transfer'`, never
 * `from '../transfer/index'` — so a barrel matched only on its basename looks
 * like a module nobody imports, and everything it supplies looks inert.
 */
function specifiers(file: string): string[] {
  const base = moduleName(file);
  return base === 'index' ? ['index', basename(join(file, '..'))] : [base];
}

/**
 * Every module a name can be imported FROM: the one that defines it, plus
 * every barrel that relays it, transitively.
 *
 * Without this the re-export strip above would be too sharp: a consumer that
 * legitimately imports `exportEntireLibrary` from `features/transfer` (the
 * barrel) would not be seen to import it from `features/transfer/index.ts`
 * (where it is written), and a plugged-in flow would be reported as inert.
 */
function suppliers(file: string, name: string): Set<string> {
  const found = new Set([file]);
  for (;;) {
    let grew = false;
    for (const [other, text] of SOURCE) {
      if (found.has(other)) continue;
      const relays = [...found].some((source) =>
        specifiers(source).some((spec) =>
          new RegExp(
            `export\\s*(?:\\*|\\{[^}]*\\b${name}\\b[^}]*\\})\\s*from\\s*['"][^'"]*/${spec}['"]`,
          ).test(text),
        ),
      );
      if (relays) {
        found.add(other);
        grew = true;
      }
    }
    if (!grew) return found;
  }
}

/**
 * Does any module in `src/` really read `name` out of `file`?
 *
 * Both halves are required. Naming the identifier alone is not enough — `INKS`
 * or `SHAPES` could plausibly be somebody else's local — and importing the
 * module alone is not enough either, since a file usually wants one export out
 * of forty. What is new since this file was written is WHICH mentions count:
 * see the three lies above.
 *
 * `includeOwn` is the difference between the two questions this file asks. A
 * vocabulary read only by the module that defines it is still a vocabulary no
 * menu offers (part one). A FLOW called by its own module's event wiring — the
 * block context menu opening itself on a right-click — is genuinely reachable,
 * so part three counts a second mention inside the defining file.
 */
function readers(file: string, name: string, includeOwn = false): string[] {
  const from = [...suppliers(file, name)].flatMap(specifiers);
  const word = new RegExp(`\\b${name}\\b`);
  const out: string[] = [];
  if (includeOwn) {
    const mentions = (LIVE.get(file) ?? '').match(new RegExp(`\\b${name}\\b`, 'g'));
    // Two, because the declaration itself is one of them.
    if ((mentions?.length ?? 0) > 1) out.push(`${rel(file)} (its own wiring)`);
  }
  for (const [other, live] of LIVE) {
    if (other === file) continue;
    const imported = from.some((spec) => importsFrom(SOURCE.get(other) ?? '', spec));
    if (imported && word.test(live)) out.push(rel(other));
  }
  return out;
}

/**
 * Does `text` import module `spec` — by either spelling?
 *
 * BOTH spellings, and the second one is the point. This used to look only for
 * a static `from '…/spec'`, and that made the alarm punish the fix for a
 * different problem: the shelf's "+ from template" button reaches the gallery
 * with `import('../templates/TemplatesGallery')`, because a static import of
 * it puts TipTap, ProseMirror, highlight.js and yjs — about a megabyte — in
 * the chunk the shelf boots from. A guard that cannot see a dynamic import
 * calls that button unwired, and the only way to quiet it is to put the
 * megabyte back. So it reads `import(…)` too. A lazily reached feature is
 * reached; the reader waits a frame, not forever.
 */
function importsFrom(text: string, spec: string): boolean {
  return (
    new RegExp(`from\\s+['"][^'"]*/${spec}['"]`).test(text) ||
    new RegExp(`import\\s*\\(\\s*['"][^'"]*/${spec}['"]\\s*\\)`).test(text)
  );
}

/** Part one's question: is this vocabulary read by anybody but its author? */
const consumers = (file: string, name: string): string[] => readers(file, name);

type Kind = 'vocabulary' | 'pool' | 'gate' | 'labels';

/** A collection big enough that somebody meant it as a menu, not a tuple. */
const MENU_SIZE = 6;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Map) &&
    !(value instanceof Set)
  );
}

/**
 * What kind of thing an export is, or `null` for "not this alarm's business".
 *
 * Deliberately NOT "everything exported": a hex, a bounds pair, a drawing
 * function and a type guard over one id are all legitimate module API, and an
 * alarm that shouts about them is an alarm somebody switches off. What it
 * watches is the shapes the five inert things had — a table of entries, a
 * filtered pool, the predicate that filters it, and a map of names.
 */
function classify(name: string, value: unknown): Kind | null {
  // A pool by convention: the gated half of a table. Every one of the five
  // things this file exists for was one of these or fed one.
  if (/^ROLLABLE_/.test(name) || /_ROLL$/.test(name)) return 'pool';
  // The predicate behind a pool, or the curation rank it reads.
  if (typeof value === 'function' && /^(isRollable|roll[A-Z])/.test(name)) return 'gate';
  if (typeof value !== 'function') {
    if (/_(TIERS|TAGS|FAMILIES|LABELS)$/.test(name)) return 'labels';
    if (Array.isArray(value) && value.length >= MENU_SIZE) return 'vocabulary';
    if (isPlainRecord(value) && Object.keys(value).length >= MENU_SIZE) return 'labels';
  }
  return null;
}

/**
 * Exports that are legitimately reachable from their own module only.
 *
 * Every line says WHY, and every line is checked back against the tree below —
 * a name here that no longer exists fails the suite, which is what stops this
 * from becoming the list where inconvenient findings go to be forgotten.
 *
 * The format is `module#export`.
 */
const EXEMPT: Readonly<Record<string, string>> = {
  /* --- predicates that exist to BUILD a pool, one file down --------------- */
  'art/shelfDesign.ts#isRollableBuild':
    'the predicate behind ROLLABLE_BUILDS, which is the half the studio reads. Kept exported because tests/roll-gates.test.ts checks the rank of a specific build with it.',
  'art/shelfDesign.ts#isRollablePattern':
    'as isRollableBuild, for ROLLABLE_PATTERNS.',
  'art/wallpaperDesign.ts#isRollableWallpaper':
    'the predicate behind WALLPAPER_ROLL. The pool is what LibraryStudio rolls; this is how a test asks about one paper.',
  'art/bookDesign.ts#isRollable':
    'the predicate behind ROLLABLE_PRESETS, which presetForSeed reads inside this same module.',
  'art/wallpaperDesign.ts#rollWallpaper':
    'a convenience roll over WALLPAPER_ROLL. LibraryStudio rolls the pool itself because it has to fold the mood filter in first; this stays as the plain answer for anything that does not.',

  /* --- rank tables the ORDER is derived from, not menus ------------------- */
  'art/shelfDesign.ts#SHELF_TIERS':
    'the rank order the exported BUILD_IDS / PATTERN_IDS order is derived FROM. Nothing renders it; tests/roll-gates.test.ts holds the derivation.',
  'art/bookDesign.ts#BOOK_TIERS':
    'as SHELF_TIERS, for the bindings.',
  'art/wallpaperDesign.ts#WALLPAPER_TIERS':
    'as SHELF_TIERS, for the papers.',

  /* --- measured constants a test asserts against ------------------------- */
  'art/spines.ts#TITLE_PLATE_SPECS':
    'the table titlePlateSpec indexes, in this module. Exported for tests/spine-resolution.test.ts, which walks every plate.',
  'art/spines.ts#EDGE_SPECS':
    'as TITLE_PLATE_SPECS, for the block edges.',
  'art/flat.ts#CLOTH_SPECS':
    'the table CLOTHS and clothsTagged are derived from. The derived halves are what the app reads.',
};

/**
 * THE BACKLOG. Everything the alarm found on the day it was switched on.
 *
 * These are NOT exemptions. Each one is a real finding — a table, a pool or a
 * map of names that exists, is exported, and is read by nothing outside the
 * module that wrote it. They are listed rather than fixed because they belong
 * to four different areas of the app and this file's job was to find them; the
 * note on each says what plugging it actually means.
 *
 * The list is ratcheted, three ways:
 *   - anything NEW that goes inert fails the suite immediately, because it is
 *     neither exempt nor listed here;
 *   - a name here that no longer exists fails the suite, so the list cannot
 *     rot into names nobody recognises;
 *   - plugging one FAILS the suite until the line is deleted and
 *     `BACKLOG_CEILING` is lowered by hand, so the backlog shortens in the
 *     file rather than only in the console.
 *
 * Every run prints what is left. That is the "spit out errors if it isn't
 * plugged in" the reader asked for, in the one place that gets read.
 */
const KNOWN_UNPLUGGED: Readonly<Record<string, string>> = {
  /* --- the block effects vocabulary: nine per-axis lists, no readers ------
     `effects/vocabulary.ts` exports eleven `*_ALL` constants. `blockEffects`
     reads UNDERLINE_ALL and calls `effectValues(key)` for the rest; the
     appearance vocabulary now reads INK_ALL and PAPER_ALL. These nine are the
     remainder. Plugging them means the pickers naming the axis they offer
     rather than looking it up by string — or deleting the aliases. */
  'editor/effects/vocabulary.ts#TAPE_ALL': 'per-axis alias; CataloguePanel walks EFFECT_AXES instead.',
  'editor/effects/vocabulary.ts#WASHI_ALL': 'as TAPE_ALL.',
  'editor/effects/vocabulary.ts#SHADOW_ALL': 'as TAPE_ALL.',
  'editor/effects/vocabulary.ts#FRAME_ALL': 'as TAPE_ALL.',
  'editor/effects/vocabulary.ts#FONT_ALL': 'as TAPE_ALL — and the one the app-wide hand picker could not use, because a hand there is a family and here it is a treatment.',
  'editor/effects/vocabulary.ts#SIZE_ALL': 'as TAPE_ALL.',
  'editor/effects/vocabulary.ts#ALIGN_ALL': 'as TAPE_ALL.',
  'editor/effects/vocabulary.ts#TINT_ALL': 'as TAPE_ALL. This is the colour axis that shipped inert once already.',
  'editor/effects/vocabulary.ts#SCRIPT_DOMAINS': 'the script-vs-editor guard. Read by fuzzyCollisions in the same file and by tests; no app code asks it anything.',
  'editor/effects/blockEffects.ts#BLOCK_EFFECT_ATTRS':
    'the attribute list the TipTap extension builds itself from. Plugging it means the context menu deriving its rows from it.',
  /* Found the day the reader stopped counting a re-export as a reader (see
     `liveCode`): its note used to say BLOCK_EFFECT_TYPES "IS read", and what
     was actually true is that `editor/nodes/index.ts` RELAYS it and nobody
     imports it from there. Plugging it means the node barrel's own consumers
     naming the list, or dropping the relay. */
  'editor/effects/blockEffects.ts#BLOCK_EFFECT_TYPES':
    'the node types a block effect can be hung on. Read inside blockEffects.ts and re-exported by editor/nodes/index.ts, which is not the same as being read.',
  'editor/effects/confetti.ts#CONFETTI_PALETTE':
    'the confetti colours, used inside confetti.ts. Exported for the bounds test.',

  /* --- tag vocabularies: the WORDS a mood filter could offer --------------
     `views/rail/designOptions.ts` reads tags STRUCTURALLY off each spec
     (`tagsOf`) and counts them at runtime, so the authored tag lists — the
     canonical vocabulary, and the only place a typo would be caught — are
     read by nobody. Plugging them means the mood row offering the vocabulary
     instead of whatever the specs happened to spell. */
  'art/flat.ts#CLOTH_TAGS': 'the cloth mood words.',
  'art/shelfDesign.ts#BUILD_TAGS': 'the carpentry mood words.',
  'art/spines.ts#SPINE_TAGS': 'the spine mood words.',
  'art/spines.ts#ORNAMENT_TAGS': 'the ornament mood words.',
  'art/spines.ts#PIGMENT_TAGS': 'the pigment mood words.',
  'art/spines.ts#TITLE_PLATE_TAGS': 'the label-plate mood words.',
  'art/spines.ts#EDGE_TAGS': 'the block-edge mood words.',
  'art/themes.ts#THEME_TAGS': 'the room mood words.',
  'art/wallpaperDesign.ts#WALLPAPER_MOODS': 'the wallpaper mood words.',

  /* --- family lists and their labels: typed out twice ---------------------
     Each vocabulary exports its family order, and each picker then keeps its
     own copy — `designOptions.ts` has a local WALLPAPER_FAMILY_LABELS.
     Plugging them is an import, and it is how a family added to a vocabulary
     reaches the picker headings without a second edit. */
  'art/themes.ts#THEME_FAMILIES': 'the five room families.',
  'art/themes.ts#FAMILY_LABELS': 'what those five families are called.',
  'art/shelfDesign.ts#BUILD_FAMILIES': 'the carpentry families.',
  'art/shelfDesign.ts#PATTERN_FAMILIES': 'the timber-pattern families.',
  'art/wallpaperDesign.ts#WALLPAPER_FAMILIES': 'the wallpaper families; designOptions keeps its own label map instead.',
  'art/customColour.ts#WASH_FAMILIES': 'the wash families a reader’s own colour is filed under.',

  /* --- book and cover tables the studio never opened ---------------------- */
  'art/bookDesign.ts#SHAPES': 'the fifty spine shapes, by id. The studio picks a whole PRESET, so the three axes underneath were never offered on their own.',
  'art/bookDesign.ts#SPINE_SHAPES': 'the same fifty, in picker order.',
  'art/bookDesign.ts#DECORS': 'the fifty decorations, by id.',
  'art/bookDesign.ts#DECORATIONS': 'the same fifty, in picker order.',
  'art/bookDesign.ts#BOOK_PRESET_IDS': 'the preset ids; the studio walks BOOK_PRESETS itself.',
  'art/bookDesign.ts#BOOK_TAGS': 'the binding mood words.',
  'art/bookDesign.ts#MATERIAL_LOOK_FOR_BINDING': 'the binding-material bridge to the spine pipeline.',
  'art/bookStyle.ts#THICKNESS_CLASSES': 'the named book thicknesses; nothing offers a reader a thickness.',
  'art/covers.ts#COVER_TEXTURES': 'the cover coverings — the front board’s own vocabulary, with no picker.',
  'art/covers.ts#COVER_TEXTURE_LABELS': 'what those coverings are called.',
  'art/covers.ts#COVER_FONTS': 'the faces a cover can be lettered in.',
  'art/covers.ts#COVER_FONT_KIN': 'which of those faces read as relatives.',
  'art/covers.ts#FRAME_LABELS': 'what the cover frames are called.',
  'art/flat.ts#HOUSE_CLOTHS': 'the icon’s original six, which the default room is pinned against. Read by tests only.',

  /* --- the pointer skin, mid-flight --------------------------------------
     `CURSOR_ROLES` was the fifth line of this block and is gone from it,
     because `features/settings/CursorSetPicker.tsx` now walks it — which is
     exactly what a backlog entry is supposed to do. Deleting it is the ratchet
     working; see BACKLOG_CEILING. */
  'art/cursors.ts#CURSOR_CLASSES': 'the class name per role; the picker reads CURSOR_ROLES only.',
  'art/cursors.ts#CURSOR_ALIASES': 'as CURSOR_CLASSES.',
  'art/cursors.ts#CURSOR_FALLBACK': 'as CURSOR_CLASSES.',
};

/**
 * How many of the backlog are still unplugged. A FROZEN NUMBER, checked in by
 * hand beside the list.
 *
 * IT USED TO BE `Object.keys(KNOWN_UNPLUGGED).length`, and that is the bug this
 * comment exists for. `outstanding` is the SUBSET of the findings whose key is
 * in `KNOWN_UNPLUGGED`, so `outstanding.length <= Object.keys(KNOWN_UNPLUGGED)`
 * is true by the definition of a subset — arithmetically unfalsifiable, for any
 * edit to any file. The ceiling tracked the list instead of pinning it, and the
 * only work the test did was a `console.log`. It ran for months over a list
 * that had in fact shrunk by one (CURSOR_ROLES, above) with nothing to say
 * about it.
 *
 * Frozen, the number does the job it was named for: plug one, and the suite
 * fails until you delete its line and lower this by one. That is a ratchet; the
 * old one was a mirror.
 *
 * Note which direction is gated here and which is not. Growth cannot be caught
 * from this number at all — a newly inert export is not in `KNOWN_UNPLUGGED`,
 * so it never joins `outstanding`; it is caught one test up, by 'nothing NEW is
 * exported into the void', which is where it belongs. This gates the direction
 * that was silent: SHRINKAGE.
 */
const BACKLOG_CEILING = 44;

interface Finding {
  readonly where: string;
  readonly name: string;
  readonly kind: Kind;
}

/**
 * Every watched export, classified, with its consumers.
 *
 * `await import` rather than a static one: the point is to walk a directory,
 * and a static import list would be one more thing that has to be remembered
 * when a module is added — which is the exact failure mode this file is about.
 */
async function survey(): Promise<{ findings: Finding[]; names: Set<string> }> {
  const findings: Finding[] = [];
  const names = new Set<string>();
  for (const file of WATCHED_FILES) {
    const mod = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
    for (const [name, value] of Object.entries(mod)) {
      const kind = classify(name, value);
      if (kind === null) continue;
      names.add(`${rel(file)}#${name}`);
      if (consumers(file, name).length === 0) findings.push({ where: rel(file), name, kind });
    }
  }
  return { findings, names };
}

const surveyed = await survey();

describe('the alarm itself works', () => {
  it('found the vocabularies at all', () => {
    // If the walk or the import ever silently stops finding modules, every
    // other assertion in this file passes vacuously — which is the one way an
    // alarm can fail that nobody notices.
    expect(WATCHED_FILES.length).toBeGreaterThanOrEqual(15);
    expect(surveyed.names.size).toBeGreaterThanOrEqual(60);
  });

  it('recognises a consumer that really is one', () => {
    // A control: BOOK_PRESETS is read by the book studio, and the two-part
    // consumer test has to say so. If this fails, the test is measuring
    // nothing and the empty findings list below means nothing either.
    expect(consumers(join(SRC, 'art', 'bookDesign.ts'), 'BOOK_PRESETS').length).toBeGreaterThan(0);
  });
});

describe('every vocabulary, pool, gate and label map has a reader', () => {
  it('nothing NEW is exported into the void', () => {
    const unplugged = surveyed.findings
      .filter(
        (f) =>
          EXEMPT[`${f.where}#${f.name}`] === undefined &&
          KNOWN_UNPLUGGED[`${f.where}#${f.name}`] === undefined,
      )
      .map(
        (f) =>
          `${f.where} — ${f.name} (${f.kind}) is read by nobody in src/. ` +
          'Wire it up, or add it to EXEMPT with the reason it is API-only.',
      );
    expect(unplugged.sort()).toEqual([]);
  });

  it('neither list can rot: every name on both still exists', () => {
    const gone = [...Object.keys(EXEMPT), ...Object.keys(KNOWN_UNPLUGGED)].filter(
      (key) => !surveyed.names.has(key),
    );
    expect(
      gone,
      'these name exports that are gone or are no longer classified — delete the lines',
    ).toEqual([]);
  });

  it('the exemption list cannot hide a live problem either', () => {
    // An exemption for something that DOES have a consumer is dead weight,
    // and dead weight is how a list stops being read. (The BACKLOG is not
    // held to this: an entry there going quiet is somebody plugging it, which
    // is the outcome we want, and the ceiling below is what notices.)
    const pointless = Object.keys(EXEMPT).filter(
      (key) => !surveyed.findings.some((f) => `${f.where}#${f.name}` === key),
    );
    expect(pointless, 'these exemptions are not needed — the export has a reader').toEqual([]);
  });

  it('the backlog only ever gets shorter, and says what is left', () => {
    const outstanding = surveyed.findings
      .map((f) => `${f.where}#${f.name}`)
      .filter((key) => KNOWN_UNPLUGGED[key] !== undefined)
      .sort();
    // Printed on every run. A list nobody sees is a list nobody clears.
    console.log(
      `\n  still unplugged (${outstanding.length} of ${BACKLOG_CEILING}):\n` +
        outstanding.map((key) => `    ${key} — ${KNOWN_UNPLUGGED[key]}`).join('\n'),
    );
    // Equality, against the frozen number — see BACKLOG_CEILING for why the
    // `<=` this replaced could not fail. Every line of KNOWN_UNPLUGGED is a
    // finding today, so the two agree exactly, and the day one of them gains a
    // reader this is the test that says so instead of the console whispering it
    // into a log nobody reads.
    const plugged = Object.keys(KNOWN_UNPLUGGED).filter((key) => !outstanding.includes(key));
    expect(
      outstanding.length,
      plugged.length > 0
        ? `these are plugged in now — delete their lines from KNOWN_UNPLUGGED and set ` +
          `BACKLOG_CEILING to ${outstanding.length}:\n    ${plugged.join('\n    ')}`
        : 'the backlog changed size without a line changing — read the list printed above',
    ).toBe(BACKLOG_CEILING);
  });
});

/* ========================================================================== *
 *              part three — a finished FEATURE with no button                *
 * ========================================================================== *
 *
 * Part one watches vocabularies. It could not have caught what happened next,
 * and the post-mortem is worth writing down because all three reasons were
 * design decisions rather than oversights.
 *
 * FOUR finished, e2e-tested features shipped with no entry point anywhere in
 * the app — `openTemplatesGallery`, `openExportPdfDialog`, `importMarkdownBooks`
 * and `exportActivePagePng`. The only way to reach any of them was to type
 * `window.__nbGroupD` into a console. Part one said nothing, because:
 *
 *   1. IT WATCHES TWO DIRECTORIES. `WATCHED` is `src/art` and
 *      `src/editor/effects`; these four live in `src/features/templates`.
 *   2. IT CLASSIFIES DATA, NOT DOING. `classify()` looks for tables, pools,
 *      predicates and label maps. A flow is a plain exported function and is
 *      not this alarm's business by that definition.
 *   3. ITS CONSUMER TEST COUNTED A BARREL. `features/templates/groupD.ts`
 *      imports all four, re-exports all four, and hangs all four on a dev-only
 *      global — so every one of them had a "consumer" in `src/`.
 *
 * Part three answers the other question: not "is this vocabulary offered?" but
 * "can a reader get at this at all?". It is SOURCE-ONLY on purpose — part one
 * imports the modules it watches, which is why it can only watch pure ones
 * (`src/art` under a node environment), and a flow lives in a `.tsx` that
 * pulls in Solid, Pixi, CSS and the DOM. Reading source is what lets this half
 * cover every module in `src/` instead of two directories.
 *
 * (1) is fixed by walking all of `src/`; (2) by classifying by the SHAPE of an
 * entry point; (3) by `liveCode()` above, which is shared with part one — so a
 * vocabulary can no longer be laundered through a barrel either.
 */

/**
 * What an entry point is called.
 *
 * Deliberately narrow, and every prefix earns its place by naming an act a
 * reader performs rather than a value a module computes: something is OPENED,
 * SHOWN, LAUNCHED or STARTED, or data is IMPORTed or EXPORTed across the app's
 * edge. `getX`, `buildX`, `resolveX` and the rest are plumbing — a plumbing
 * function with no caller is dead code, which is a tidiness problem, not the
 * "we shipped a feature nobody can reach" problem this file exists for.
 */
const ENTRY_SHAPE = /^(open|show|launch|start|import|export)[A-Z]/;

/**
 * Exported functions matching `ENTRY_SHAPE`, found by reading declarations.
 *
 * Both forms this tree uses: `export function openX()` (with or without
 * `async`) and `export const openX = (…) =>`. A re-export line cannot match
 * either, which matters — `groupD.ts` would otherwise be reported as the
 * definition site of all four of the flows it merely relays.
 */
function entryPoints(): Array<{ file: string; name: string }> {
  const out: Array<{ file: string; name: string }> = [];
  for (const [file, text] of SOURCE) {
    for (const match of text.matchAll(
      /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    )) {
      if (ENTRY_SHAPE.test(match[1]!)) out.push({ file, name: match[1]! });
    }
    for (const match of text.matchAll(
      /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:async\s*)?\(/g,
    )) {
      if (ENTRY_SHAPE.test(match[1]!)) out.push({ file, name: match[1]! });
    }
  }
  return out;
}

/**
 * Flows that really are reachable from their own module and nowhere else, or
 * that exist as API beside the one the app calls. Same contract as `EXEMPT`:
 * every line says why, and a line naming something that no longer exists fails
 * the suite.
 *
 * IT IS EMPTY, AND THAT IS THE GOOD STATE — every flow in the tree has a way
 * in, so nothing has needed to be excused yet. Do not add a line to make the
 * rot check below "do something": the check earns its keep by being ready, and
 * `rotted()` is exercised against a synthetic list so it is a live gate even
 * while the real one is `{}`.
 */
const EXEMPT_FLOWS: Readonly<Record<string, string>> = {};

const FLOWS = entryPoints();
const FLOW_FINDINGS = FLOWS.filter(
  ({ file, name }) => readers(file, name, true).length === 0,
).map(({ file, name }) => `${rel(file)}#${name}`);

/**
 * The two ways an exemption list rots, as a function rather than as two
 * expressions inlined into a test.
 *
 * WHY IT IS A FUNCTION NOW. The test below used to read
 * `Object.keys(EXEMPT_FLOWS).filter(…)` twice, directly, and `EXEMPT_FLOWS` is
 * `{}` — so both filters were `[].filter(…)`, both assertions were
 * `expect([]).toEqual([])`, and the test could not fail for any edit to any
 * file in the repository. It was not merely weak; it read no product source at
 * all, so there was no mutation anywhere that could turn it red. That is the
 * worst kind of green: it looked like the same ratchet `EXEMPT` gets, and it
 * was a constant.
 *
 * Pulling it out lets the same code be run against a list that ISN'T empty,
 * which is what makes the machinery testable while the real list is not. Both
 * halves read `FLOWS` and `FLOW_FINDINGS`, which are derived from the source of
 * every module in `src/` — so renaming a flow out there now reaches this file.
 */
function rotted(list: Readonly<Record<string, string>>): {
  gone: string[];
  pointless: string[];
} {
  const known = new Set(FLOWS.map(({ file, name }) => `${rel(file)}#${name}`));
  return {
    // Named flows that no longer exist — the list has drifted off the tree.
    gone: Object.keys(list).filter((key) => !known.has(key)),
    // Excused flows that DO have a way in — dead weight, and dead weight is
    // how a list stops being read.
    pointless: Object.keys(list).filter(
      (key) => known.has(key) && !FLOW_FINDINGS.includes(key),
    ),
  };
}

describe('the flow alarm can see what part one could not', () => {
  it('walks every module in src/, not two vocabularies', () => {
    // The vacuous-pass guard, same as part one's. `src/features/templates`
    // has to be in scope or this whole section is theatre.
    expect(ALL_FILES.length).toBeGreaterThanOrEqual(200);
    expect(FLOWS.length).toBeGreaterThanOrEqual(20);
    expect(FLOWS.map((f) => rel(f.file))).toContain(
      'features/templates/TemplatesGallery.tsx',
    );
  });

  it('does not count an import or a re-export as a reader', () => {
    const relay = liveCode(`
      import { openThing } from './thing';
      export { openThing } from './thing';
      export * from './other';
      const unrelated = 1;
    `);
    expect(relay).not.toMatch(/openThing/);
    expect(relay).toMatch(/unrelated/);
  });

  it('does not count the dev bridge as a reader', () => {
    // Read off the REAL file, not a fixture: `window.__nbGroupD` is the exact
    // shape that certified four unreachable features as plugged in, and a
    // fixture would stop testing that the day the bridge was rewritten.
    const groupD = readFileSync(join(SRC, 'features', 'templates', 'groupD.ts'), 'utf8');
    expect(groupD, 'the bridge this test is about has been removed').toMatch(
      /import\.meta\.env\.DEV/,
    );
    expect(groupD).toMatch(/__nbGroupD/);
    const live = liveCode(groupD);
    expect(live).not.toMatch(/__nbGroupD/);
    for (const flow of [
      'openTemplatesGallery',
      'openExportPdfDialog',
      'importMarkdownBooks',
      'exportActivePagePng',
    ]) {
      expect(
        live,
        `${flow} is still visible in groupD's live code — the barrel would vouch for it again`,
      ).not.toMatch(new RegExp(flow));
    }
  });

  it('still recognises a flow that really is wired', () => {
    // Two controls, because a strip that removed everything would also report
    // an empty findings list. The parcel desk is opened by App.tsx and by the
    // settings sheet; the templates gallery is opened by the shelf dock and
    // the book rail. Both must read as PLUGGED.
    expect(
      readers(join(SRC, 'features', 'transfer', 'TransferPanel.tsx'), 'openTransferPanel', true),
    ).not.toEqual([]);
    expect(
      readers(join(SRC, 'features', 'templates', 'TemplatesGallery.tsx'), 'openTemplatesGallery', true),
    ).not.toEqual([]);
  });

  it('counts a module that wires its own flow up', () => {
    // `contextMenuController` opens its own menu from its own event handler.
    // That is a button, it is just not somebody else's button — and an alarm
    // that shouted about it would be an alarm somebody switched off.
    expect(
      readers(join(SRC, 'editor', 'menu', 'contextMenuController.ts'), 'openBlockContextMenu', true),
    ).not.toEqual([]);
  });
});

describe('every finished flow has a way in', () => {
  it('nothing is reachable only from a dev global', () => {
    const orphans = FLOW_FINDINGS.filter((key) => EXEMPT_FLOWS[key] === undefined).map(
      (key) =>
        `${key} — nothing in a production build opens this. Give it a button ` +
        '(and a shortcut in data/keybindings), or add it to EXEMPT_FLOWS with the reason.',
    );
    expect(orphans.sort()).toEqual([]);
  });

  it('the rot check for the flow exemptions is a live gate, not an empty loop', () => {
    /*
     * THE ANTI-VACUITY GUARD, and the reason it has to exist.
     *
     * `EXEMPT_FLOWS` is `{}` — truthfully, because nothing in the tree needs
     * excusing — so running the rot check over it asserts nothing at all. The
     * test underneath this one is therefore honest about being a placeholder,
     * and THIS one is what keeps the machinery working in the meantime: the
     * same `rotted()` the real list is passed through, run against a list with
     * one of each kind of rot in it.
     *
     * A flow that is wired must be reported POINTLESS (excusing it is dead
     * weight); a name that no longer exists must be reported GONE. Both answers
     * come out of `FLOWS` / `FLOW_FINDINGS`, which are read off every `.ts(x)`
     * in `src/` — so this fails if the sweep stops finding entry points, if
     * `openTemplatesGallery` is renamed, or if it loses the two controls that
     * open it. Watched fail: renaming it in `TemplatesGallery.tsx` moves it out
     * of `gone`'s complement and the first expectation goes red.
     *
     * The two halves are also disjoint now. The old `pointless` filter did not
     * exclude names that were already reported `gone`, so a single rotted line
     * came out of both — fine when the list was empty forever, wrong the moment
     * it is not.
     */
    const WIRED = 'features/templates/TemplatesGallery.tsx#openTemplatesGallery';
    const NOWHERE = 'features/templates/TemplatesGallery.tsx#openNothingAtAll';
    const probe = rotted({
      [WIRED]: 'a flow with two real buttons — excusing it would be dead weight',
      [NOWHERE]: 'a flow that was never written',
    });
    expect(probe.gone, 'the rot check no longer notices a name off the tree').toEqual([
      NOWHERE,
    ]);
    expect(
      probe.pointless,
      'the rot check no longer notices an exemption the app does not need',
    ).toEqual([WIRED]);
  });

  it('the flow exemptions cannot rot', () => {
    /*
     * A PLACEHOLDER, said out loud. With `EXEMPT_FLOWS` empty this asserts
     * nothing; it is here so that the day somebody excuses a flow, the line
     * they add is already being checked back against the tree. The gate above
     * is what proves the check still works while this one sleeps.
     */
    const { gone, pointless } = rotted(EXEMPT_FLOWS);
    expect(gone, 'these name flows that no longer exist — delete the lines').toEqual([]);
    expect(pointless, 'these exemptions are not needed — the flow has a way in').toEqual([]);
  });

  it('the four that shipped inert are wired to real controls now', () => {
    /*
     * Belt and braces over the sweep above. The sweep proves SOMETHING names
     * each flow; this names the file that has to, so moving a button out of
     * the rail without putting it anywhere else fails here with the reason
     * rather than three tests away.
     */
    const wiredIn = (module: string, flow: string): string[] =>
      readers(join(SRC, ...module.split('/')), flow, true);
    expect(wiredIn('features/templates/TemplatesGallery.tsx', 'openTemplatesGallery')).toEqual(
      expect.arrayContaining([
        'features/bookshelf/BookshelfWorld.tsx',
        'views/BookView.tsx',
      ]),
    );
    expect(wiredIn('features/templates/ExportPdfDialog.tsx', 'openExportPdfDialog')).toEqual(
      expect.arrayContaining(['views/rail/SharePanel.tsx']),
    );
    expect(
      wiredIn('editor/script/exporters/exportPage.ts', 'exportActivePagePng'),
    ).toEqual(expect.arrayContaining(['views/rail/SharePanel.tsx']));
    expect(wiredIn('features/templates/importMarkdown.ts', 'importMarkdownBooks')).toEqual(
      expect.arrayContaining([
        'App.tsx',
        'features/settings/SettingsPanel.tsx',
        'views/rail/SharePanel.tsx',
      ]),
    );
  });

  it('gives each of them a rebindable key, not just a button', () => {
    /*
     * A control the reader can find is half of it; the brief asked for the
     * other half — "registered through the central map so it is rebindable and
     * appears in the cheat sheet". Both surfaces are generated from
     * SHORTCUT_ACTIONS (tests/keybindings.test.ts holds that), so being in the
     * registry IS being in the cheat sheet.
     */
    const registry = readFileSync(join(SRC, 'data', 'keybindings.ts'), 'utf8');
    for (const id of ['templates', 'export-pdf', 'export-png', 'import-markdown']) {
      expect(registry, `${id} is not in the shortcut registry`).toMatch(
        new RegExp(`id:\\s*'${id}'`),
      );
    }
    // …and something on screen has to PERFORM each of them, or the row in the
    // settings sheet captures a key that does nothing. A view claims an id by
    // naming it as a key in a `registerCommands` map, quoted or bare — both
    // spellings are in the tree and neither is wrong.
    const performs = (id: string): string[] =>
      [...LIVE]
        .filter(
          ([, live]) =>
            live.includes('registerCommands') &&
            new RegExp(`['"]?${id}['"]?\\s*:`).test(live),
        )
        .map(([file]) => rel(file));
    expect(performs('templates')).toEqual(
      expect.arrayContaining(['features/bookshelf/BookshelfWorld.tsx', 'views/BookView.tsx']),
    );
    expect(performs('export-pdf')).toEqual(expect.arrayContaining(['views/BookView.tsx']));
    expect(performs('export-png')).toEqual(expect.arrayContaining(['views/BookView.tsx']));
    expect(performs('import-markdown')).toEqual(expect.arrayContaining(['App.tsx']));
  });
});

/* ========================================================================== *
 *                    part two — the surface it was built for                 *
 * ========================================================================== */

describe('the appearance section is a vocabulary, not four literals', () => {
  it('offers at least twenty of each of the four axes', () => {
    // The reader counted, twice: "in appearance i noticed only 4 themes …
    // atleast 20", "same issue for ink, paper type, atleast 20 options".
    expect(APP_THEMES.length).toBeGreaterThanOrEqual(20);
    expect(INKS.length).toBeGreaterThanOrEqual(20);
    expect(PAPERS.length).toBeGreaterThanOrEqual(20);
    // The hands are filtered by what the machine has, so the floor is on the
    // ones that ship with the app plus the ones Windows always has.
    expect(HANDS.length).toBeGreaterThanOrEqual(20);
    expect(HANDS.filter((h) => h.probe === undefined).length).toBeGreaterThanOrEqual(9);
  });

  it('is what the settings sheet actually reads', () => {
    // The plug, checked from the other end: the font map apply.ts writes
    // `--font-body` from is DERIVED from the vocabulary, so it can never be
    // the shorter list again.
    expect(Object.keys(HANDWRITING_FONT_STACKS).length).toBe(HANDS.length);
    for (const hand of HANDS) {
      expect(HANDWRITING_FONT_STACKS[hand.id]).toBe(hand.stack);
    }
    // …and the three ids that have been stored since the app shipped still
    // mean what they meant.
    for (const id of ['Caveat', 'Patrick Hand', 'Kalam']) {
      expect(HANDWRITING_FONT_STACKS[id]).toBeDefined();
    }
  });

  it('names inks and papers the block vocabulary already knows', () => {
    // A reader who sets one block to "burgundy" and the whole app to
    // "burgundy" is choosing the same pigment by the same name, or one of the
    // two names is a lie.
    const inks = new Set(BLOCK_INK_IDS);
    const papers = new Set(BLOCK_PAPER_IDS);
    expect(INKS.filter((i) => !inks.has(i.id)).map((i) => i.id)).toEqual([]);
    expect(PAPERS.filter((p) => !papers.has(p.id)).map((p) => p.id)).toEqual([]);
  });

  it('resolves junk out of SQLite instead of throwing', () => {
    for (const junk of ['', 'neon', '../../etc', '💥']) {
      expect(resolveTheme(junk).id).toBe(DEFAULT_APP_THEME_ID);
      expect(resolveInk(junk).id).toBe('sepia');
      expect(resolveHand(junk).id).toBe('Patrick Hand');
      expect(resolvePaper(junk)).toBeNull();
    }
    expect(resolveTheme(null).id).toBe(DEFAULT_APP_THEME_ID);
    expect(resolveTheme(undefined).id).toBe(DEFAULT_APP_THEME_ID);
  });

  it('derives its order from family then tier, never by hand', () => {
    // The same property the carpentry holds: inside one family, a demoted
    // entry can never precede a promoted one. A hand-sorted array passes this
    // only by luck, and stops passing the first time one is inserted.
    const rank = new Map(APPEARANCE_TIERS.map((tier, i) => [tier, i] as const));
    const check = (
      table: readonly { id: string; family: string; tier: string }[],
      families: readonly string[],
      what: string,
    ): void => {
      let lastFamily = -1;
      const seen = new Map<string, number>();
      for (const entry of table) {
        const fam = families.indexOf(entry.family);
        expect(fam, `${what} ${entry.id} has a family outside the list`).toBeGreaterThanOrEqual(0);
        expect(fam, `${what} ${entry.id} breaks the family run`).toBeGreaterThanOrEqual(lastFamily);
        lastFamily = fam;
        const t = rank.get(entry.tier as never) ?? 0;
        expect(
          t,
          `${what} ${entry.id} is printed above a better-ranked entry in its family`,
        ).toBeGreaterThanOrEqual(seen.get(entry.family) ?? 0);
        seen.set(entry.family, t);
      }
    };
    check(APP_THEMES, APP_THEME_FAMILIES, 'theme');
    check(INKS, INK_FAMILIES, 'ink');
    check(PAPERS, PAPER_FAMILIES, 'paper');
  });

  it('keeps a demoted entry pickable and out of the dice', () => {
    // "you dont have to be too cruel" — rank it down, never delete it.
    const odd = [...APP_THEMES, ...INKS, ...PAPERS, ...HANDS].filter(
      (e) => e.tier === 'oddity',
    );
    expect(odd.length).toBeGreaterThan(0);
    for (const entry of odd) {
      expect(entry.tier).not.toBe('signature');
    }
    // …and every axis still leads with something.
    expect(APP_THEMES.some((t) => t.tier === 'signature')).toBe(true);
    expect(INKS.some((i) => i.tier === 'signature')).toBe(true);
    expect(PAPERS.some((p) => p.tier === 'signature')).toBe(true);
    expect(HANDS.some((h) => h.tier === 'signature')).toBe(true);
  });

  it('spreads across all four stylesheet rooms', () => {
    // A theme is a room plus a paper plus an accent, so if every theme named
    // the same base the `[data-theme=…]` half of the design would be doing
    // nothing and the dark rooms would not exist.
    for (const base of THEME_BASES) {
      expect(
        APP_THEMES.filter((t) => t.base === base).length,
        `no theme is dressed over the ${base} room`,
      ).toBeGreaterThan(0);
    }
  });
});

describe('every ink can be read on every paper in every room', () => {
  /**
   * The gate `styles/tokens.css` states in its own contrast contract: body ink
   * at 7:1 on the ground it sits on, soft ink at 4.5:1 on the darkest ground
   * it ever sits on. Measured, not asserted — that is the whole reason the ink
   * is derived per paper instead of being a hex somebody liked.
   *
   * ~30 themes x ~35 inks x 25 papers is more combinations than a reader will
   * ever make, so the sweep runs every theme against every ink on a sample of
   * papers, plus every paper against a sample of inks. A full cross product is
   * 26,000 bisections and this suite is meant to be run on every save.
   */
  const somePapers = [null, ...PAPERS.filter((_, i) => i % 6 === 0).map((p) => p.id)];
  const someInks = INKS.filter((_, i) => i % 3 === 0);

  it('clears 7:1 for body ink and 4.5:1 for the soft rung', { timeout: 60000 }, () => {
    const fails: string[] = [];
    // Counted, because every branch below has a `continue` in it and a sweep
    // that measured nothing would pass with an empty failure list.
    let measured = 0;
    for (const theme of APP_THEMES) {
      for (const paper of somePapers) {
        for (const ink of someInks) {
          const tokens = appearanceTokens(theme.id, ink.id, paper);
          const body = tokens['--ink-sepia'];
          const soft = tokens['--ink-sepia-soft'];
          // The three inks the stylesheet remaps by hand write nothing here —
          // their values are gated by tests/contrast.test.ts instead.
          if (body === '' || soft === '') continue;
          const aged = tokens['--paper-aged'] !== '' ? tokens['--paper-aged'] : null;
          if (aged === null) continue;
          const where = `${theme.id}/${paper ?? 'auto'}/${ink.id}`;
          const bodyRatio = contrastRatio(body, aged);
          const softRatio = contrastRatio(soft, aged);
          measured += 1;
          if (bodyRatio < 6.9) fails.push(`${where}: body ${bodyRatio.toFixed(2)}:1`);
          if (softRatio < 4.45) fails.push(`${where}: soft ${softRatio.toFixed(2)}:1`);
        }
      }
    }
    expect(fails.slice(0, 12)).toEqual([]);
    expect(measured).toBeGreaterThan(200);
  });

  it('keeps the accent readable as type and as a rim', { timeout: 60000 }, () => {
    const fails: string[] = [];
    let measured = 0;
    for (const theme of APP_THEMES) {
      for (const paper of somePapers) {
        for (const ink of someInks) {
          const tokens = appearanceTokens(theme.id, ink.id, paper);
          const aged = tokens['--paper-aged'];
          const accentInk = tokens['--accent-ink'];
          const accentDeep = tokens['--accent-deep'];
          const onAccent = tokens['--on-accent'];
          if (aged === '') continue;
          const where = `${theme.id}/${paper ?? 'auto'}`;
          // Each token is skipped on its own emptiness, not on the first one's.
          // A shipped room on a chosen PAPER now writes the accent ink (it is
          // solved against the paper) while leaving the accent RAMP to the
          // stylesheet — so `accentInk` being present no longer means
          // `accentDeep` is, and a shared guard measured '' against '' at a
          // cheerful 1.00:1 in twelve rooms.
          if (accentInk !== '') {
            measured += 1;
            const asType = contrastRatio(accentInk, aged);
            if (asType < 4.45) fails.push(`${where}: accent as type ${asType.toFixed(2)}:1`);
          }
          if (accentDeep === '') continue;
          const asRim = contrastRatio(accentDeep, aged);
          if (asRim < 2.9) fails.push(`${where}: accent as rim ${asRim.toFixed(2)}:1`);
          if (onAccent === '') continue;
          const label = contrastRatio(onAccent, accentDeep);
          if (label < 4.45) fails.push(`${where}: label on accent ${label.toFixed(2)}:1`);
        }
      }
    }
    expect(fails.slice(0, 12)).toEqual([]);
    expect(measured).toBeGreaterThan(200);
  });

  it('leaves the four shipped rooms exactly as the stylesheet has them', () => {
    // The four hand-tuned rooms are contrast-gated in tests/contrast.test.ts
    // against the CSS. If this module started writing inline paper or accent
    // over them, that gate would be measuring a page nobody sees.
    for (const base of THEME_BASES) {
      const tokens = appearanceTokens(base, 'sepia', null);
      for (const [name, value] of Object.entries(tokens)) {
        expect(value, `${base} should not override ${name}`).toBe('');
      }
    }
  });

  it('hands the paper back to the room when the stock is cleared', () => {
    const withStock = appearanceTokens('parchment', 'sepia', 'kraft');
    expect(withStock['--paper-cream']).not.toBe('');
    const cleared = appearanceTokens('parchment', 'sepia', null);
    // Empty, not absent: apply.ts writes every key every time, and setting a
    // custom property to '' is what REMOVES the inline declaration. A missing
    // key would leave the kraft paper on the page forever.
    expect(Object.keys(cleared)).toEqual(Object.keys(withStock));
    expect(cleared['--paper-cream']).toBe('');
  });
});

/* ========================================================================== *
 *                 part four — the shell has to render the panel              *
 * ========================================================================== *
 *
 * The seventh time, and the one that was written while this file was being
 * read: `features/tutorial/tasteQuestionnaire.tsx` — four questions that dress
 * a reader's whole library, complete, with thirty-eight passing tests, and
 * reachable only from one row buried in the settings sheet. Neither half of
 * this file could see it:
 *
 *   - part one watches `src/art` and `src/editor/effects`, and it is a panel;
 *   - part three asks whether an OPENER has a caller, and `openTaste` had two
 *     (the panel itself and the settings row) — so the flow alarm was satisfied
 *     while nothing ever put the component on screen for a new reader.
 *
 * A full-viewport panel that owns its own open/closed state is inert until some
 * long-lived host RENDERS it, and "somebody imports the opener" is not that.
 * So this part reads the shell and checks the element is really in the tree.
 * `LIVE` has already had the import lines cut out, so a mention here can only
 * come from JSX.
 */

describe('the app shell mounts the panels that outlive what opens them', () => {
  const shell = LIVE.get(join(SRC, 'App.tsx')) ?? '';

  it('has an App.tsx to read', () => {
    // The vacuous-pass guard: an empty string would satisfy nothing below by
    // failing, but a mis-joined path would make every later regex meaningless.
    expect(shell.length).toBeGreaterThan(200);
    expect(shell).toMatch(/<QuickSwitcher\s*\/>/);
  });

  it('renders <TasteQuestionnaire /> beside <TutorialOverlay />', () => {
    expect(
      shell,
      'App.tsx does not render <TasteQuestionnaire /> — the questionnaire ' +
        'cannot open itself from a tree it is not in, so the tour reaches its ' +
        'taste step and nothing happens',
    ).toMatch(/<TasteQuestionnaire\s*\/>/);
    // Beside the overlay, because that is the host that outlives the tour.
    expect(shell).toMatch(/<TutorialOverlay\s*\/>/);
    // …and the shell must be a real reader of the module, not a stray string.
    expect(
      readers(join(SRC, 'features', 'tutorial', 'tasteQuestionnaire.tsx'), 'TasteQuestionnaire'),
    ).toContain('App.tsx');
  });

  /**
   * The questionnaire opens ON a tour step, so for as long as it is up the two
   * are stacked — and both hold a capture-phase `keydown` on `window`. Neither
   * `stopPropagation` nor mount order can separate them: `stopPropagation()`
   * does not stop other listeners on the SAME target, so both handlers run
   * whatever the order. Observed before the guard went in: Escape closed the
   * question AND ended the tour underneath it, and ← → moved both.
   *
   * So the tour — the thing behind — has to stand down, on both of the two
   * things it can tell: the modal's layer is still on screen, or the modal
   * already handled the key. One test per order.
   */
  it('makes the tour stand down while a modal question is over it', () => {
    const overlay = LIVE.get(join(SRC, 'features', 'tutorial', 'TutorialOverlay.tsx')) ?? '';
    expect(overlay.length).toBeGreaterThan(200);
    expect(overlay, 'the overlay no longer looks for a modal above it').toMatch(
      /modalOverTour/,
    );
    expect(
      overlay,
      'the guard has to cover the order where the modal handled the key first',
    ).toMatch(/defaultPrevented/);
    // The questionnaire's own layer is what it looks for; a renamed layer would
    // silently hand Escape back to the tour.
    expect(overlay).toMatch(/'\.nbq-layer'/);
    const taste = readFileSync(
      join(SRC, 'features', 'tutorial', 'taste.css'),
      'utf8',
    );
    expect(taste, 'taste.css no longer draws .nbq-layer').toMatch(/\.nbq-layer\s*\{/);
  });
});

/* ========================================================================== *
 *        part five — one panel for everything that arrives or leaves         *
 * ========================================================================== *
 *
 * The eighth instance is the opposite shape from the other seven, and it is
 * why this part exists.
 *
 * Getting work IN and OUT of a book was seven separate controls: insert
 * script, export script, copy AI spec and start-from-a-template each had a
 * rail icon, and the PDF chooser, the picture and the Markdown import were
 * rows on a sheet behind an eighth. Every one of them was reachable — part
 * three would have said so — and the reader still could not find them:
 *
 *   > "maybe condense insert, copy AI spec, export things into a single
 *   >  setting in side bar, with the above options as well in its panel below"
 *
 * So "reachable" is not the whole of "plugged in". Four of those icons are now
 * rows on `views/rail/SharePanel.tsx`, and the risk in doing that is the exact
 * failure this file is for, run backwards: a flow that had a button loses it
 * and gains a row that is never rendered, or a row that runs nothing. What
 * follows checks the whole chain — the rail draws the one button, the shell
 * renders the panel, the panel lists the row, and the row calls the flow.
 *
 * (It also caught a real one on the way in. `DIVIDER_AT` in BookRail was
 * `findIndex(tool => tool.id === 'insert')`; `insert` moved onto the sheet,
 * `findIndex` returned -1, and the divider the tour teaches stopped rendering
 * with nothing failing anywhere.)
 */

describe('one panel for everything that goes in or out of a book', () => {
  const SHARE = join(SRC, 'views', 'rail', 'SharePanel.tsx');
  const share = LIVE.get(SHARE) ?? '';
  const rail = LIVE.get(join(SRC, 'views', 'rail', 'BookRail.tsx')) ?? '';
  const bookView = LIVE.get(join(SRC, 'views', 'BookView.tsx')) ?? '';

  /** Every `id: '…'` in a table, off the live source. */
  const ids = (text: string): string[] =>
    [...text.matchAll(/^\s*id: '([a-z-]+)',$/gm)].map((m) => m[1]!);

  it('has all three files to read', () => {
    // The vacuous-pass guard the rest of this section leans on.
    expect(share.length).toBeGreaterThan(500);
    expect(rail.length).toBeGreaterThan(500);
    expect(bookView.length).toBeGreaterThan(500);
  });

  it('is rendered by the shell that outlives it', () => {
    // Part four's lesson: an opener with callers is not a component on screen.
    // The sheet is BookView's, and only BookView can put it in the tree.
    expect(bookView, 'BookView does not render <SharePanel').toMatch(/<SharePanel\b/);
    expect(readers(SHARE, 'SharePanel')).toContain('views/BookView.tsx');
    // …under the title the rail button promises, or the reader opens a sheet
    // called something else and does not believe it is the right one.
    expect(bookView).toMatch(/title="In and out"/);
  });

  it('lists the three questions a reader arrives with, in that order', () => {
    const groups = [...share.matchAll(/id: '(in|out|ai)', title:/g)].map((m) => m[1]);
    expect(groups).toEqual(['in', 'out', 'ai']);
    for (const heading of [
      'Bring something in',
      'Take this page, or this book, out',
      'For an assistant',
    ]) {
      expect(share, `the sheet no longer says "${heading}"`).toContain(heading);
    }
  });

  it('carries a row for every one of the eight errands', () => {
    // The brief, spelled out: bring in — paste script, import Markdown, start
    // from a template; take out — PDF, picture, the parcel desk; for an AI —
    // the spec, and this page as script.
    expect(ids(share).sort()).toEqual(
      ['insert', 'markdown', 'pdf', 'png', 'parcel', 'script', 'spec', 'templates'].sort(),
    );
  });

  it('runs the real flow from every row, not a copy of it', () => {
    // The five that resolve their own context call the module-level opener —
    // the same call the keyboard makes — so a row and its key cannot drift.
    for (const [module, flow] of [
      ['features/templates/TemplatesGallery.tsx', 'openTemplatesGallery'],
      ['features/templates/ExportPdfDialog.tsx', 'openExportPdfDialog'],
      ['editor/script/exporters/exportPage.ts', 'exportActivePagePng'],
      ['features/templates/importMarkdown.ts', 'importMarkdownBooks'],
      ['features/transfer/TransferPanel.tsx', 'openTransferPanel'],
    ] as const) {
      expect(
        readers(join(SRC, ...module.split('/')), flow, true),
        `${flow} is no longer run from the one sheet that offers it`,
      ).toContain('views/rail/SharePanel.tsx');
    }
    // …and the three that cannot: the paste box is mounted against the focused
    // leaf, and both copies need this view's page and its toast. If BookView
    // stops passing one, its row becomes a button that does nothing.
    for (const prop of ['onInsertScript', 'onCopyScript', 'onCopySpec']) {
      expect(share, `SharePanel no longer calls ${prop}`).toContain(`props.${prop}()`);
      expect(bookView, `BookView no longer hands SharePanel ${prop}`).toContain(
        `${prop}={`,
      );
    }
  });

  it('took the four folded icons off the rail, and left the one that opens it', () => {
    // The point of the change was FEWER controls, so this is the half that
    // stops the panel from becoming a second door beside four first ones.
    const tools = ids(rail);
    expect(tools).toContain('share');
    for (const gone of ['insert', 'export', 'spec', 'templates']) {
      expect(
        tools,
        `'${gone}' is a rail icon again — the sheet was supposed to be its one home`,
      ).not.toContain(gone);
    }
    // Ten buttons, not fourteen. A number, because "fewer" is not checkable
    // and the rail's crowding is the reason the reader wrote in.
    expect(tools.length).toBeLessThanOrEqual(10);
  });

  it('still draws the divider it teaches, wherever the tools move', () => {
    // Derived from the STRUCTURE (the first tool that opens no panel), never
    // from a tool id — an id is exactly what moved.
    expect(rail).toMatch(/DIVIDER_AT\s*=\s*TOOLS\.findIndex\(\(tool\) => tool\.panel === undefined\)/);
    expect(rail).not.toMatch(/DIVIDER_AT[\s\S]{0,80}tool\.id === /);
  });

  it('draws only key caps that a real shortcut answers', () => {
    // A row whose `keyFor` names nothing renders an empty cap; a row that
    // borrows another action's id renders a key that opens something else.
    // (The AI spec row deliberately has neither — nothing binds it.)
    const registry = readFileSync(join(SRC, 'data', 'keybindings.ts'), 'utf8');
    const claimed = [...share.matchAll(/keyFor: '([a-z-]+)'/g)].map((m) => m[1]!);
    expect(claimed.sort()).toEqual(
      [
        'export-library',
        'export-pdf',
        'export-png',
        'export-script',
        'import-markdown',
        'insert-script',
        'templates',
      ].sort(),
    );
    for (const id of claimed) {
      expect(registry, `${id} is not in the shortcut registry`).toMatch(
        new RegExp(`id:\\s*'${id}'`),
      );
    }
  });

  it('keeps the doors a reader would already have used', () => {
    // Consolidating is not walling off. The gallery is where a book is MADE,
    // out on the shelf; the Markdown import is a library errand as much as a
    // book one; and the insert dialog hands out the spec itself, because
    // wanting the format is what you discover at an empty paste box.
    expect(
      readers(join(SRC, 'features', 'templates', 'TemplatesGallery.tsx'), 'openTemplatesGallery', true),
    ).toEqual(
      expect.arrayContaining([
        'features/bookshelf/BookshelfWorld.tsx',
        'views/rail/SharePanel.tsx',
      ]),
    );
    expect(
      readers(join(SRC, 'features', 'templates', 'importMarkdown.ts'), 'importMarkdownBooks', true),
    ).toEqual(
      expect.arrayContaining([
        'App.tsx',
        'features/settings/SettingsPanel.tsx',
        'views/rail/SharePanel.tsx',
      ]),
    );
    const insertDialog = LIVE.get(join(SRC, 'editor', 'insert', 'InsertScriptDialog.tsx')) ?? '';
    expect(insertDialog).toContain('NOTEBOOK_SCRIPT_SPEC');
  });

  it('sends the tour to a button that exists', () => {
    // The tour asked for `data-tool="spec"` for one commit after that button
    // stopped being drawn. A missing target does not throw — the engine
    // survives it on purpose — so nothing anywhere would have said so.
    const steps = LIVE.get(join(SRC, 'features', 'tutorial', 'steps.ts')) ?? '';
    const railIds = new Set(ids(rail));
    const pointed = [...steps.matchAll(/data-tool="([a-z-]+)"/g)].map((m) => m[1]!);
    expect(pointed.length).toBeGreaterThan(3);
    expect(pointed.filter((id) => !railIds.has(id))).toEqual([]);
    // …and the fact behind that step has to be gettable from what is on
    // screen now: the sheet's button, or one of its three script rows.
    const probe = LIVE.get(join(SRC, 'features', 'tutorial', 'probe.ts')) ?? '';
    expect(probe).toMatch(/nb-share-row/);
    expect(probe).toMatch(/id === 'share'/);
  });
});
