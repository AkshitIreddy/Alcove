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

/** The two vocabulary roots this alarm watches. */
const WATCHED = [join(SRC, 'art'), join(SRC, 'editor', 'effects')];

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

const ALL_FILES = walk(SRC);
const SOURCE = new Map(ALL_FILES.map((f) => [f, strip(readFileSync(f, 'utf8'))] as const));
const WATCHED_FILES = ALL_FILES.filter((f) => WATCHED.some((dir) => f.startsWith(dir)));

const rel = (file: string): string => relative(SRC, file).replace(/\\/g, '/');
/** `src/art/flat.ts` → `flat`, which is how every importer spells it. */
const moduleName = (file: string): string => basename(file).replace(/\.tsx?$/, '');

/**
 * Does any other module in `src/` really read `name` out of `file`?
 *
 * Both halves are required. Naming the identifier alone is not enough — `INKS`
 * or `SHAPES` could plausibly be somebody else's local — and importing the
 * module alone is not enough either, since a file usually wants one export out
 * of forty.
 */
function consumers(file: string, name: string): string[] {
  const from = new RegExp(`from\\s+['"][^'"]*/${moduleName(file)}['"]`);
  const word = new RegExp(`\\b${name}\\b`);
  const out: string[] = [];
  for (const [other, text] of SOURCE) {
    if (other === file) continue;
    if (from.test(text) && word.test(text)) out.push(rel(other));
  }
  return out;
}

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
 *   - the count can only go down (`BACKLOG_CEILING`), so plugging one is the
 *     only way to make this shorter.
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
    'the attribute list the TipTap extension builds itself from, exported beside BLOCK_EFFECT_TYPES which IS read. Plugging it means the context menu deriving its rows from it.',
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

  /* --- the pointer skin, mid-flight -------------------------------------- */
  'art/cursors.ts#CURSOR_ROLES': 'new this session; may well be plugged by the time you read this.',
  'art/cursors.ts#CURSOR_CLASSES': 'as CURSOR_ROLES.',
  'art/cursors.ts#CURSOR_ALIASES': 'as CURSOR_ROLES.',
  'art/cursors.ts#CURSOR_FALLBACK': 'as CURSOR_ROLES.',
};

/** The backlog may shrink. It may not grow. */
const BACKLOG_CEILING = Object.keys(KNOWN_UNPLUGGED).length;

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
    expect(outstanding.length).toBeLessThanOrEqual(BACKLOG_CEILING);
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
          if (aged === '' || accentInk === '') continue;
          const where = `${theme.id}/${paper ?? 'auto'}`;
          const asType = contrastRatio(accentInk, aged);
          const asRim = contrastRatio(accentDeep, aged);
          const label = contrastRatio(onAccent, accentDeep);
          measured += 1;
          if (asType < 4.45) fails.push(`${where}: accent as type ${asType.toFixed(2)}:1`);
          if (asRim < 2.9) fails.push(`${where}: accent as rim ${asRim.toFixed(2)}:1`);
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
