// @vitest-environment node
/**
 * tests/readme.test.ts — the README is checked, not trusted.
 *
 * The developer half of the README makes two kinds of claim a repo can drift
 * away from silently:
 *
 *  1. **Paths.** It links roughly a hundred source files by relative path,
 *     which is the whole mechanism by which it points AT the 3,841 lines of
 *     module docstring instead of copying them. A moved file turns that into
 *     a 404 and nothing else in the suite would notice.
 *  2. **Numbers.** "222 of 230 source files open with a module docstring",
 *     "126 papers", "five design docs carry a superseded banner". Every one
 *     was measured once and none is self-maintaining.
 *  3. **Pictures.** Twenty-four screenshots, which drift the most quietly of all:
 *     the whole set predated the rename, so the banner said *Bellanote* over
 *     the old blue mark and the open spread was headed "Welcome to Bellanote"
 *     while every link to them resolved and every byte was valid.
 *     `shots-now/readme-shots.mjs` now takes all twenty-four in one run and writes
 *     down what it photographed; `checkShots()` reads that back.
 *  4. **Navigation.** The front page's body is two tables of anchor links into
 *     the halves, one row per section. Those were typed by hand, which is how
 *     the developer tail went stale in the first place: rename a heading and
 *     the row still renders, still looks right, and lands the reader at the top
 *     of the page. `checkLinks()` cannot see it — it splits `#` off and stats
 *     the file — so the rows are now composed by `scripts/gen-readme.mjs` from
 *     an invisible `<!--nav: …-->` beside each heading, and its `--check` is
 *     gated below alongside a real resolution of all 87 fragments.
 *
 * So the numbers are not typed as prose — they are written into the markdown
 * inside an invisible marker (`<!--f:key-->126<!--/f-->`, which GitHub renders
 * as `126`) and recomputed here. `scripts/check-readme.mjs` does the file-only
 * half and can be run on its own with `npm run readme:check`; the vocabulary
 * counts need the TypeScript modules loaded, which a vitest file can simply
 * import, so this is where they are gated.
 *
 * Fixing a failure is one command: `npm run readme:facts` prints the true
 * values, `npm run readme:build` recomposes the front page, and the deferred
 * counts are printed by this file's failure message.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** The repo root, from this file's own location — no cwd assumption. */
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

import {
  DEFERRED_FACTS,
  DEPICTED_KEYS,
  SHOTS_MANIFEST,
  checkFacts,
  checkLinks,
  checkShots,
  computeFacts,
  measureShot,
  readShotsManifest,
  readmeDocs,
  shotFiles,
} from '../scripts/check-readme.mjs';
import {
  PARTS,
  checkAnchors,
  checkReadme,
  sectionsOf,
} from '../scripts/gen-readme.mjs';

import {
  BUILD_IDS,
  DEFAULT_SHELF_DESIGN,
  PATTERN_IDS,
  SHELF_PRESETS,
} from '../src/art/shelfDesign';
import {
  DEFAULT_WALLPAPER_ID,
  WALLPAPER_PATTERNS,
  WALLPAPER_PRESETS,
} from '../src/art/wallpaperDesign';
import {
  BOOK_PRESETS,
  DECORATIONS,
  MATERIAL_LOOKS,
  SPINE_SHAPES,
} from '../src/art/bookDesign';
import { DEFAULT_THEME_ID, THEME_IDS } from '../src/art/themes';
import { CLOTHS } from '../src/art/flat';
import { WELCOME_BOOK_TITLE, WELCOME_PAGE_SOURCES } from '../src/data/seed';
import { SOUND_SET_IDS } from '../src/sound/soundSets';
import { SOUND_NAMES, SOUNDSCAPE_LOOPS } from '../src/sound/engine';
import { ROOM_PRESETS } from '../src/views/rail/designOptions';
import { RIBBON_PRESETS } from '../src/views/bookmarks';
import {
  COVER_FRAME_COUNT,
  COVER_MEDALLION_COUNT,
  COVER_PALETTE_COUNT,
} from '../src/art/covers';
import { SLASH_COMMANDS } from '../src/editor/slash/registry';
import { STICKER_IDS } from '../src/editor/nodes/stickers';
import { EFFECT_AXES } from '../src/editor/effects/vocabulary';
import { PLACEABLE_AXES } from '../src/editor/effects/placeableEffects';
import { BLOCK_EFFECT_TYPES } from '../src/editor/effects/blockEffects';
import {
  CONTAINER_ALIASES,
  CONTAINER_NAMES,
  DIAGRAM_LANGS,
  KNOWN_ATTR_KEYS,
} from '../src/script/vocab';
import { DEFAULT_SETTINGS } from '../src/data/defaults';
import { SHORTCUT_ACTIONS, LISTED_ACTION_IDS } from '../src/data/keybindings';
import { NOTEBOOK_TEMPLATES } from '../src/features/templates/templates';
import { DEFAULT_FLOOR_COUNT, MAX_FLOOR_COUNT } from '../src/data/bookcases';
import { PACK_CATEGORIES, UNSUPPORTED_CATEGORIES } from '../src/features/packs/categories';
import { tourSteps } from '../src/features/tutorial/steps';
import { TASTE_QUESTIONS } from '../src/features/tutorial/tasteProfile';

/** The counts `scripts/check-readme.mjs` defers to this file. */
function vocabularyFacts(): Record<string, number> {
  return {
    shelfBuilds: BUILD_IDS.length,
    shelfPatterns: PATTERN_IDS.length,
    shelfPresets: SHELF_PRESETS.length,
    wallpaperMotifs: WALLPAPER_PATTERNS.length,
    wallpaperPapers: WALLPAPER_PRESETS.length,
    bookShapes: SPINE_SHAPES.length,
    bookMaterials: MATERIAL_LOOKS.length,
    bookDecorations: DECORATIONS.length,
    bookPresets: BOOK_PRESETS.length,
    roomThemes: THEME_IDS.length,
    bookCloths: CLOTHS.length,
    soundSets: SOUND_SET_IDS.length,
    soundCues: SOUND_NAMES.length,
    // Beds, not rows: SOUNDSCAPE_NAMES ends in 'none', which is silence.
    ambienceBeds: Object.keys(SOUNDSCAPE_LOOPS).length,
    roomPresets: ROOM_PRESETS.length,
    ribbonPresets: RIBBON_PRESETS.length,
    coverPigments: COVER_PALETTE_COUNT,
    coverFrames: COVER_FRAME_COUNT,
    coverMedallions: COVER_MEDALLION_COUNT,
    slashCommands: SLASH_COMMANDS.length,
    stickers: STICKER_IDS.length,
    effectAxes: EFFECT_AXES.length,
    effectValues: EFFECT_AXES.reduce((sum, axis) => sum + axis.values.length, 0),
    // The trim a reader can put ANYWHERE on the page, as opposed to the axes
    // that stay properties of a block.
    //
    // Summed from PLACEABLE_AXES rather than by filtering EFFECT_AXES with
    // PLACEABLE_KEYS, which is what this first did and which was quietly five
    // short: `doodle` is placeable but is NOT an effect axis — it has no block
    // form at all, so it lives in its own vocabulary and the filter could never
    // see it. PLACEABLE_AXES is the list the panel itself renders, so this
    // counts what the reader is actually offered.
    placeableValues: PLACEABLE_AXES.reduce((sum, axis) => sum + axis.values.length, 0),
    // Node types the BlockEffects global-attribute extension attaches to —
    // i.e. how many kinds of block a reader can decorate.
    blockEffectTypes: BLOCK_EFFECT_TYPES.length,
    scriptContainers: CONTAINER_NAMES.length,
    scriptContainerAliases: Object.keys(CONTAINER_ALIASES).length,
    scriptAttrKeys: KNOWN_ATTR_KEYS.length,
    scriptDiagrams: DIAGRAM_LANGS.length,
    settingsOptions: Object.keys(DEFAULT_SETTINGS).length,
    // What the settings sheet lets you actually move: listed rows, minus the
    // ones that say out loud that they are fixed.
    rebindableKeys: SHORTCUT_ACTIONS.filter(
      (action) => action.kind === 'binding' && LISTED_ACTION_IDS.includes(action.id),
    ).length,
    templates: NOTEBOOK_TEMPLATES.length,
    defaultFloors: DEFAULT_FLOOR_COUNT,
    maxFloors: MAX_FLOOR_COUNT,
    packCategories: PACK_CATEGORIES.length,
    packRefusals: UNSUPPORTED_CATEGORIES.length,
    tourSteps: tourSteps('full').length,
    tasteQuestions: TASTE_QUESTIONS.length,
  };
}

describe('the README describes this repo', () => {
  it('has something to check', () => {
    // A silent pass because the file moved would defeat the whole exercise.
    expect(readmeDocs().length).toBeGreaterThan(0);
  });

  it('every relative link resolves from the repo root', () => {
    const { problems } = checkLinks();
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('every marked number still matches the tree', () => {
    const facts = { ...computeFacts(), ...vocabularyFacts() };
    const { problems } = checkFacts(facts);
    const hint =
      '\n\nTrue values right now:\n' +
      Object.entries(facts)
        .map(([k, v]) => `  ${k} = ${v}`)
        .join('\n');
    expect(problems, problems.join('\n') + hint).toEqual([]);
  });

  it('the deferred key list matches what this file supplies', () => {
    // Both halves have to agree or a marker silently checks nothing: a key the
    // script defers but this file forgets is a number nobody verifies.
    expect([...DEFERRED_FACTS].sort()).toEqual(Object.keys(vocabularyFacts()).sort());
  });
});

/**
 * What the README's pictures SHOW, as the tree spells it today.
 *
 * The same deferral {@link vocabularyFacts} uses, one door over: reading these
 * five means loading TypeScript, which `scripts/check-readme.mjs` cannot do and
 * a vitest file gets for free. They are the five strings whose change made the
 * last set of screenshots wrong — the title written across the open spread and
 * drawn into the tree diagram, and the three ids plus the paper that decide
 * what an untouched bookcase looks like on the day someone opens the app.
 */
function depictedIdentity(): Record<string, string> {
  return {
    welcomeTitle: WELCOME_BOOK_TITLE,
    defaultTheme: DEFAULT_THEME_ID,
    defaultBuild: DEFAULT_SHELF_DESIGN.build,
    defaultPattern: DEFAULT_SHELF_DESIGN.pattern,
    defaultWallpaper: DEFAULT_WALLPAPER_ID,
  };
}

describe('the README shows this build of the app', () => {
  it('every screenshot still depicts the app in the tree', () => {
    // The one that would have caught it: the shots said Bellanote for months
    // after the app stopped being called that, and nothing was red.
    const { problems } = checkShots(depictedIdentity());
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('no two screenshots are the same picture', () => {
    // The one that would have caught it: a recapture took `studio.png` while
    // the studio's sheet was still off-screen on its open tween, so the file
    // came out byte-identical to the `shelf.png` shot seconds earlier — a
    // picture of the studio with no studio in it. Everything else on this page
    // passed it, because each of those checks asks whether a shot matches the
    // TREE and this is the one question only the shots can answer about each
    // other: twenty-four captions, twenty-four states, so no two can be one
    // image. Duplicated in checkShots() so `npm run readme:check` sees it too.
    const seen = new Map<string, string>();
    const twins: string[] = [];
    for (const file of shotFiles()) {
      const { sha256 } = measureShot(file);
      const first = seen.get(sha256);
      if (first === undefined) seen.set(sha256, file);
      else twins.push(`${file} is the same image as ${first}`);
    }
    expect(twins, twins.join('\n')).toEqual([]);
  });

  it('the deferred identity list matches what this file supplies', () => {
    // Same trap as the fact markers: a key the script defers and this file
    // forgets is a picture nobody checks.
    expect([...DEPICTED_KEYS].sort()).toEqual(Object.keys(depictedIdentity()).sort());
  });

  it('the capture turns dev chrome OFF', () => {
    // The one that would have caught it: `App.tsx`'s `devChromeEnabled()` falls
    // through to `import.meta.env.DEV`, which is true on the dev server the
    // shots are taken against — so the dev-only "shelf | book" view switcher
    // was pinned over the bottom-right corner of EVERY picture on the front
    // page, half across the page-curl dog-ear. Thirteen shots showed readers a
    // control the installed app does not have, sitting on top of one it does,
    // and every other check here passed: the pill is a dozen pixels tall, it
    // does not change the app identity the shots spell out, and it is present
    // in all of them equally so no two shots became twins.
    //
    // Read rather than imported: `readme-shots.mjs` launches Playwright at the
    // top level, so importing it here would start a browser.
    const source = readFileSync(join(ROOT, 'shots-now/readme-shots.mjs'), 'utf8');
    const urls = [...source.matchAll(/\$\{URL_BASE\}\/\?[^`'"]*/g)].map((m) => m[0]);
    expect(urls.length, 'no app URL found in readme-shots.mjs').toBeGreaterThan(0);
    for (const url of urls) {
      expect(url, `${url} would photograph the app with dev chrome on`).toContain('dev=0');
      expect(url, `${url} would photograph the shelf in its reduced mode`).toContain(
        'fx=force',
      );
    }
    // And the gate it relies on has to keep honouring the parameter.
    const app = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8');
    expect(app, 'App.tsx no longer turns dev chrome off for ?dev=0').toContain(
      `params.get("dev") === "0"`,
    );
  });

  it('has pictures, and a manifest covering all of them', () => {
    // A silent pass because the folder emptied — or because the manifest went
    // missing and checkShots() found nothing to compare — would defeat this
    // whole section.
    const files = shotFiles();
    expect(files.length, 'no screenshots in docs/readme/img/').toBeGreaterThan(0);
    const manifest = readShotsManifest();
    expect(manifest, `${SHOTS_MANIFEST} is missing`).not.toBeNull();
    expect(manifest?.shots.map((s) => s.file).sort()).toEqual(files);
  });
});

/* ------------------- what the alt text quotes off the page ---------------- */

/**
 * The alt text is the one thing on the front page nothing else can see.
 *
 * Twenty-four of the pictures carry hand-written alt text, and it is long and
 * specific on purpose — `img/spread.png` alone quotes a card title, a banner and
 * a highlighted phrase straight out of the Welcome book. Every other check on
 * this page looks at the picture as a FILE: {@link checkShots} weighs it, hashes
 * it and compares the app identity it was taken against; the twins test compares
 * the shots to each other; `checkLinks()` resolves the path. None of them reads a
 * word of the caption, no browser renders it, and the only reader it misleads is
 * somebody who cannot see the picture to notice. So it can be wrong for a whole
 * release and come out the other side.
 *
 * It was. Seed v7 (`src/data/seed.ts`, `WELCOME_PAGE_SOURCES`) re-cut every page
 * of the Welcome book — same thirty-two leaves, same subjects, said in fewer
 * words, with the second card dropped from the pages that carried two — and
 * three alt-text claims were left describing sentences that no longer existed:
 *
 *     "Books come off the shelf"                 a card the shelf page had lost
 *     "the next five leaves are the other four"  a tag dropped with its card
 *     "The same thing, thrown outward"           now just "Thrown outward"
 *
 * Corrected by hand in `bded4a2`; this is about the next time. The rule below is
 * the one that found them, and the two halves of it are both load-bearing:
 *
 *  - **Four words or more.** Shorter quotes are UI chrome — "Getting about",
 *    "the book", "one page", "Table of contents" — which is not in the seed and
 *    never will be. Without that filter every picture of a panel fails and the
 *    gate is unusable. A token has to carry a letter or a digit to count as a
 *    word, which is what keeps `"✕ leave focus  Esc"` (a glyph and three words)
 *    out; `"Welcome to Alcove ✎"` goes the same way and loses nothing, because
 *    the title is already gated as `welcomeTitle` in {@link depictedIdentity}.
 *  - **Normalise first.** Backticks come off (the seed writes `` `Ctrl Alt F` ``
 *    and the alt text writes the rendered `Ctrl Alt F`), whitespace collapses,
 *    HTML entities decode, and the tree renderer's ` · ` separator maps onto the
 *    source's ` | ` — the seed writes `Bookcases | one per subject` and the drawn
 *    diagram the alt is describing reads `Bookcases · one per subject`. Three of
 *    the six phrases the first hand run reported missing were that separator and
 *    nothing else; a gate that cries about them is a gate somebody switches off.
 *
 * Which pictures are covered is read off the alt text rather than listed here:
 * one whose SUBJECT is a page of the Welcome book ("The spread…", "The same
 * spread…", "The Welcome book…", or a thing standing "on the right-hand page of
 * the Welcome book") is a photograph of seed prose and every phrase it quotes has
 * to be seed prose. A panel with the spread behind it — the catalogue, the quick
 * switcher, the cheat sheet, the parcel desk — is a photograph of chrome, and its
 * quotes are chrome: `transfer.png` quotes a page COUNT, "32 pages", not a
 * sentence. The last test below closes the loop the other way, so a new picture
 * of a welcome page cannot quietly fall outside the pattern.
 */
const ALT_QUOTE_EXCEPTIONS: readonly string[] = [
  // Empty, and meant to stay that way. An entry belongs here only for a phrase
  // that is genuinely not seed prose and cannot be filtered by length — a UI
  // label of four words or more that a covered picture has to quote. A list that
  // grows is this gate being switched off one line at a time.
];

/** Alt text and the picture it is written for, wherever it is written. */
interface AltText {
  /** Repo-relative markdown file it was read from. */
  doc: string;
  /** Bare file name of the picture, so both halves' link forms agree. */
  file: string;
  alt: string;
}

/** Both spellings of a picture on the front page: markdown, and a sized `<img>`. */
const MD_IMAGE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const HTML_IMAGE = /<img\b[^>]*>/g;

function altTexts(): AltText[] {
  const found: AltText[] = [];
  const add = (doc: string, src: string, alt: string) => {
    // Badges are remote and their alt is a label, not a description.
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) return;
    found.push({ doc, file: src.split('/').pop() ?? src, alt });
  };
  for (const doc of readmeDocs()) {
    const text = readFileSync(join(ROOT, doc), 'utf8');
    for (const m of text.matchAll(MD_IMAGE)) add(doc, m[2]!, m[1]!);
    for (const m of text.matchAll(HTML_IMAGE)) {
      const src = /\bsrc="([^"]*)"/.exec(m[0])?.[1];
      const alt = /\balt="([^"]*)"/.exec(m[0])?.[1];
      if (src !== undefined && alt !== undefined) add(doc, src, alt);
    }
  }
  return found;
}

/** One run of prose, in the form both the alt text and the seed can be read in. */
function normaliseQuote(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/`/g, '')
    .replace(/\s*·\s*/g, ' | ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Words in a normalised run — a token needs a letter or a digit to be one. */
function wordCount(quote: string): number {
  return quote.split(' ').filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/** Every `"…"` run in one alt text, normalised. */
function quotedRuns(alt: string): string[] {
  return [...alt.matchAll(/"([^"]+)"/g)].map((m) => normaliseQuote(m[1]!));
}

/** A quote long enough to be a claim about the page rather than a UI label. */
function isClaim(quote: string): boolean {
  return wordCount(quote) >= 4 && !ALT_QUOTE_EXCEPTIONS.includes(quote);
}

/** Whether this caption's subject is a page of the Welcome book. */
function showsWelcomeProse(alt: string): boolean {
  const text = alt.trim();
  return (
    /^The (?:same )?spread\b/.test(text) ||
    /^The Welcome book\b/.test(text) ||
    /\bpage of the Welcome book\b/.test(text)
  );
}

/** Bare file names of the pictures whose captions describe a welcome page. */
function shotsShowingWelcomeProse(alts = altTexts()): Set<string> {
  return new Set(alts.filter((a) => showsWelcomeProse(a.alt)).map((a) => a.file));
}

/** The Welcome book's prose as one haystack, in the same normalised form. */
function welcomeProse(): string {
  return normaliseQuote(WELCOME_PAGE_SOURCES.join('\n'));
}

describe('the README quotes the Welcome book as it is written now', () => {
  it('every phrase the pictures quote is still in WELCOME_PAGE_SOURCES', () => {
    const alts = altTexts();
    const covered = shotsShowingWelcomeProse(alts);
    const prose = welcomeProse();
    const seen = new Set<string>();
    const problems: string[] = [];
    let checked = 0;
    for (const { doc, file, alt } of alts) {
      if (!covered.has(file)) continue;
      for (const quote of quotedRuns(alt)) {
        if (!isClaim(quote)) continue;
        const key = `${file} ${quote}`;
        if (seen.has(key)) continue;
        seen.add(key);
        checked += 1;
        if (!prose.includes(quote)) {
          problems.push(
            `${file} (${doc}) quotes "${quote}", which is not in WELCOME_PAGE_SOURCES`,
          );
        }
      }
    }
    // A silent pass because the alt text stopped being extractable — a caption
    // rewritten with curly quotes, a picture moved out of the walked docs —
    // would leave this whole describe asserting nothing.
    expect(checked, 'no quoted claims found in any welcome-page caption').toBeGreaterThan(
      8,
    );
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('covers every picture taken of a welcome page', () => {
    // Derived, not listed — but these six are the ones that exist today, and a
    // pattern that stops matching them has stopped selecting anything.
    const covered = shotsShowingWelcomeProse();
    for (const file of [
      'spread.png',
      'page-turn.png',
      'diagrams.png',
      'focus.png',
      'rail.png',
      'slash.png',
    ]) {
      expect([...covered], `${file} is no longer read as a picture of a page`).toContain(
        file,
      );
    }
  });

  it('no picture it skips is quoting the Welcome book anyway', () => {
    // The hole the pattern above could leave: a new photograph of a welcome page
    // whose caption opens on some other noun would be checked by nothing, and
    // nothing would say so. A skipped picture that quotes a real sentence out of
    // the seed is that picture, so it fails here and the pattern gets widened.
    const alts = altTexts();
    const covered = shotsShowingWelcomeProse(alts);
    const prose = welcomeProse();
    const missed = new Set<string>();
    for (const { file, alt } of alts) {
      if (covered.has(file)) continue;
      for (const quote of quotedRuns(alt)) {
        if (isClaim(quote) && prose.includes(quote)) {
          missed.add(`${file} quotes welcome-book prose ("${quote}") but is not covered`);
        }
      }
    }
    expect([...missed], [...missed].join('\n')).toEqual([]);
  });
});

describe('the front page is composed from the two halves', () => {
  it('README.md matches what gen-readme.mjs builds from them', () => {
    // The same check as `node scripts/gen-readme.mjs --check`, run here so a
    // renamed section is a red test rather than a link that goes nowhere.
    const { problems } = checkReadme();
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('every section of every half is described exactly once', () => {
    // The two failure directions the tables have: a section the front page
    // never mentions (unreachable from the door) and a row pointing at a
    // section that no longer exists (a link to nowhere). Composing the table
    // makes both impossible, so this pins the property rather than the output.
    for (const part of PARTS) {
      const sections = sectionsOf(part);
      const slugs = sections.map((s) => s.slug);
      expect(new Set(slugs).size, `${part.href} has two sections with one slug`).toBe(
        slugs.length,
      );
      for (const section of sections) {
        expect(section.nav.trim(), `${part.href} '${section.text}' has an empty summary`)
          .not.toBe('');
      }
    }
  });

  it('every #fragment resolves to a real heading', () => {
    // check-readme.mjs resolves the file and drops the fragment; this resolves
    // the fragment. Between them a moved file and a renamed section both fail.
    const { checked, problems } = checkAnchors();
    expect(problems, problems.join('\n')).toEqual([]);
    expect(checked).toBeGreaterThan(0);
  });
});
