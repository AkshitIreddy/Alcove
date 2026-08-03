// @vitest-environment node
/**
 * tests/roll-gates.test.ts — a curation gate with no caller is not a gate.
 *
 * The reader asked for the odd designs to stay pickable but never be handed
 * out: *"you dont have to be too cruel… similarly for randomise you can omit
 * them from being used"*. Each vocabulary answers that with a tier and a
 * filtered roll pool.
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

const SRC = join(import.meta.dirname, '..', 'src');
const studio = readFileSync(join(SRC, 'views', 'rail', 'LibraryStudio.tsx'), 'utf8');

/** Strip comments, so this file's own explanations cannot satisfy a match. */
const code = studio
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/[^\n]*$/gm, ' ');

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
    expect(surprise, 'surprise() should roll the gated pool').toMatch(
      /withMood\(\s*WALLPAPER_ROLL/,
    );
  });

  it('still offers every paper in the pickers', () => {
    // Rolling the gated pool must not have narrowed what a reader can CHOOSE.
    expect(code).toMatch(/WALLPAPER_PRESETS/);
  });
});
