// @vitest-environment node
/**
 * tests/roll-gates.test.ts — a curation gate with no caller is not a gate.
 *
 * The reader asked for the odd designs to stay pickable but never be handed
 * out: *"you dont have to be too cruel… similarly for randomise you can omit
 * them from being used"*. Each vocabulary answers that with a tier and a
 * filtered roll pool.
 *
 * Three vocabularies are gated here — the papers, the bindings and (last to be
 * ranked) the shelf's carpentry, whose builds and timber patterns were still
 * being rolled in full while the other two were filtered.
 *
 * The bindings wired theirs up. The WALLPAPERS did not: `isRollableWallpaper`,
 * `WALLPAPER_ROLL` and `rollWallpaper` were authored, exported and unit-tested,
 * and `grep` over `src/` found no caller — the studio's "surprise me" was still
 * rolling all 126 presets, demoted papers included. Every unit test passed the
 * whole time, because they all tested the pool rather than who reads it.
 *
 * That is the same shape as the three inert effect axes found this session, and
 * as the spine bake that was requested and then dropped. So this file checks
 * the WIRING, by reading the source of the callers: whichever module rolls a
 * vocabulary must roll the gated pool, not the full table.
 *
 * Source-reading rather than behavioural, deliberately: the studio is a Solid
 * component that reaches for `window` on import, and the property here is
 * "which constant does this line name", which is exactly what source can say.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  WALLPAPER_PRESETS,
  WALLPAPER_ROLL,
  isRollableWallpaper,
} from '../src/art/wallpaperDesign';
import { BOOK_PRESETS, ROLLABLE_PRESETS } from '../src/art/bookDesign';
import {
  BUILDS,
  BUILD_FAMILIES,
  BUILD_IDS,
  DEFAULT_SHELF_DESIGN,
  FALLBACK_SHELF_DESIGN,
  PATTERNS,
  PATTERN_FAMILIES,
  PATTERN_IDS,
  ROLLABLE_BUILDS,
  ROLLABLE_PATTERNS,
  SHELF_TIERS,
  isRollableBuild,
  isRollablePattern,
} from '../src/art/shelfDesign';

const SRC = join(import.meta.dirname, '..', 'src');
const studio = readFileSync(join(SRC, 'views', 'rail', 'LibraryStudio.tsx'), 'utf8');
const options = readFileSync(join(SRC, 'views', 'rail', 'designOptions.ts'), 'utf8');

/** Strip comments, so this file's own explanations cannot satisfy a match. */
const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');

const code = strip(studio);
const optionsCode = strip(options);

describe('the roll pools are smaller than the tables', () => {
  it('demotes some wallpapers and some bindings, or there is nothing to gate', () => {
    // A pool equal to its table means the tiering is not doing anything, and
    // every check below would pass vacuously.
    expect(WALLPAPER_ROLL.length).toBeLessThan(WALLPAPER_PRESETS.length);
    expect(WALLPAPER_ROLL.length).toBeGreaterThan(0);
    expect(ROLLABLE_PRESETS.length).toBeLessThan(BOOK_PRESETS.length);
  });

  it('keeps every demoted design PICKABLE, just not rollable', () => {
    // The reader's actual instruction: do not be cruel, do not delete.
    const rollable = new Set(WALLPAPER_ROLL.map((p) => p.id));
    const demoted = WALLPAPER_PRESETS.filter((p) => !rollable.has(p.id));
    expect(demoted.length).toBeGreaterThan(0);
    for (const p of demoted) {
      expect(WALLPAPER_PRESETS, `${p.id} was removed rather than demoted`).toContain(p);
      expect(isRollableWallpaper(p)).toBe(false);
    }
  });
});

describe("the studio's surprise reads the gated pool", () => {
  it('rolls WALLPAPER_ROLL, not WALLPAPER_PRESETS', () => {
    // The exact bug: `withMood(WALLPAPER_PRESETS, …)` in `surprise()`.
    const surprise = code.slice(code.indexOf('const surprise'), code.indexOf('const surprise') + 1200);
    expect(surprise, 'surprise() must not roll the full wallpaper table').not.toMatch(
      /withMood\(\s*WALLPAPER_PRESETS/,
    );
    // The reader's own removals may sit between the two — `rollPool` takes out
    // what they took off the list before the mood narrows what is left (see
    // LibraryStudio.surprise). What this gate cares about is that the thing
    // reaching `withMood` is the TIERED pool and never the full table, so the
    // reader's gate is optional here and pinned exactly in curation.test.ts.
    expect(surprise, 'surprise() should roll the gated pool').toMatch(
      /withMood\(\s*(?:rollPool\('wallpaper',\s*)?WALLPAPER_ROLL/,
    );
  });

  it('still offers every paper in the pickers', () => {
    // Rolling the gated pool must not have narrowed what a reader can CHOOSE.
    expect(code).toMatch(/WALLPAPER_PRESETS/);
  });
});

/* -------------------------------------------------------------------------- *
 * The carpentry — the last vocabulary to get a tier, and the third time this
 * same gate has been authored. The first two are above; the shelf's is checked
 * to the same standard, which means checking the CALLER and not just the pool.
 * -------------------------------------------------------------------------- */

describe('the carpentry is ranked', () => {
  it('demotes some builds and some patterns, or there is nothing to gate', () => {
    // A pool equal to its table means every check below would pass vacuously.
    expect(ROLLABLE_BUILDS.length).toBeLessThan(BUILD_IDS.length);
    expect(ROLLABLE_BUILDS.length).toBeGreaterThan(0);
    expect(ROLLABLE_PATTERNS.length).toBeLessThan(PATTERN_IDS.length);
    expect(ROLLABLE_PATTERNS.length).toBeGreaterThan(0);
  });

  it('keeps every demoted carpentry PICKABLE, just not rollable', () => {
    // The reader's instruction, again: do not be cruel, do not delete. A build
    // and a pattern are persisted per bookcase, so a deletion would silently
    // rebuild somebody's library.
    const rollable = new Set(ROLLABLE_BUILDS.map((b) => b.id));
    const demoted = BUILD_IDS.filter((id) => !rollable.has(id));
    expect(demoted.length).toBeGreaterThan(0);
    for (const id of demoted) {
      expect(BUILD_IDS, `${id} was removed rather than demoted`).toContain(id);
      expect(isRollableBuild(BUILDS[id])).toBe(false);
    }

    const rollablePatterns = new Set(ROLLABLE_PATTERNS.map((p) => p.id));
    const demotedPatterns = PATTERN_IDS.filter((id) => !rollablePatterns.has(id));
    expect(demotedPatterns.length).toBeGreaterThan(0);
    for (const id of demotedPatterns) {
      expect(PATTERN_IDS, `${id} was removed rather than demoted`).toContain(id);
      expect(isRollablePattern(PATTERNS[id])).toBe(false);
    }
  });

  it('excludes the FALLBACK case from the dice and keeps the DEFAULT in it', () => {
    // Two constants, two opposite answers. The plank in bare timber is what a
    // corrupt row resolves to, so being handed it by the dice would make a
    // fault indistinguishable from a choice.
    expect(isRollableBuild(BUILDS[FALLBACK_SHELF_DESIGN.build])).toBe(false);
    expect(isRollablePattern(PATTERNS[FALLBACK_SHELF_DESIGN.pattern])).toBe(false);
    // …and it is still offered in the picker, which is where a reader chooses
    // it on purpose.
    expect(BUILD_IDS).toContain(FALLBACK_SHELF_DESIGN.build);
    expect(PATTERN_IDS).toContain(FALLBACK_SHELF_DESIGN.pattern);

    // The case a new library opens on is a case worth being handed.
    expect(isRollableBuild(BUILDS[DEFAULT_SHELF_DESIGN.build])).toBe(true);
    expect(isRollablePattern(PATTERNS[DEFAULT_SHELF_DESIGN.pattern])).toBe(true);
  });

  it('derives the picker order from family then tier, never by hand', () => {
    // The order is DERIVED, so this is the property to hold rather than a
    // literal list: inside one family a demoted entry can never precede a
    // promoted one. A hand-sorted array passes this only by luck.
    const rank = new Map(SHELF_TIERS.map((t, i) => [t, i] as const));

    const seenBuild = new Map<string, number>();
    let lastBuildFamily = -1;
    for (const id of BUILD_IDS) {
      const spec = BUILDS[id];
      const fam = BUILD_FAMILIES.indexOf(spec.family);
      expect(fam, `${id} has a family outside BUILD_FAMILIES`).toBeGreaterThanOrEqual(0);
      // Families are contiguous runs, in BUILD_FAMILIES order.
      expect(fam, `${id} breaks the family run`).toBeGreaterThanOrEqual(lastBuildFamily);
      lastBuildFamily = fam;
      const t = rank.get(spec.tier) ?? 0;
      expect(t, `${id} is printed above a better-ranked build in its family`).toBeGreaterThanOrEqual(
        seenBuild.get(spec.family) ?? 0,
      );
      seenBuild.set(spec.family, t);
    }

    const seenPattern = new Map<string, number>();
    let lastPatternFamily = -1;
    for (const id of PATTERN_IDS) {
      const spec = PATTERNS[id];
      const fam = PATTERN_FAMILIES.indexOf(spec.family);
      expect(fam, `${id} has a family outside PATTERN_FAMILIES`).toBeGreaterThanOrEqual(0);
      expect(fam, `${id} breaks the family run`).toBeGreaterThanOrEqual(lastPatternFamily);
      lastPatternFamily = fam;
      const t = rank.get(spec.tier) ?? 0;
      expect(
        t,
        `${id} is printed above a better-ranked pattern in its family`,
      ).toBeGreaterThanOrEqual(seenPattern.get(spec.family) ?? 0);
      seenPattern.set(spec.family, t);
    }
  });
});

describe("the studio's surprise reads the gated carpentry", () => {
  // Everything below reads the SOURCE of the caller. That is the whole point of
  // this file: `ROLLABLE_BUILDS` can be authored, exported and unit-tested to
  // death while `surprise()` still rolls the full table, and every other test
  // in the repo passes throughout — which is what happened to the wallpapers.
  const surprise = code.slice(code.indexOf('const surprise'), code.indexOf('const surprise') + 1600);

  it('rolls ROLLABLE_BUILDS, not BUILD_IDS', () => {
    expect(surprise, 'surprise() must not roll the full build table').not.toMatch(
      /withMood\(\s*BUILD_IDS/,
    );
    // Same tolerance as the papers above: the reader's `rollPool` may sit
    // inside, the full table may not.
    expect(surprise, 'surprise() should roll the gated build pool').toMatch(
      /withMood\(\s*(?:rollPool\('build',\s*)?ROLLABLE_BUILDS/,
    );
  });

  it('rolls ROLLABLE_PATTERNS, not PATTERN_IDS', () => {
    expect(surprise, 'surprise() must not roll the full pattern table').not.toMatch(
      /withMood\(\s*PATTERN_IDS/,
    );
    expect(surprise, 'surprise() should roll the gated pattern pool').toMatch(
      /withMood\(\s*(?:rollPool\('pattern',\s*)?ROLLABLE_PATTERNS/,
    );
  });

  it('still offers every build and every pattern in the pickers', () => {
    // Gating the dice must not have narrowed what a reader can CHOOSE, and the
    // choosing lives in designOptions' card builders rather than in the studio.
    expect(optionsCode, 'buildOptions must still walk the whole table').toMatch(
      /BUILD_IDS\.map/,
    );
    expect(optionsCode, 'patternOptions must still walk the whole table').toMatch(
      /PATTERN_IDS\.map/,
    );
    expect(optionsCode, 'the pickers must not be built from the gated pools').not.toMatch(
      /ROLLABLE_(BUILDS|PATTERNS)/,
    );
  });
});
