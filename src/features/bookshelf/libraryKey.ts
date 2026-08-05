/**
 * features/bookshelf/libraryKey.ts — the one place a room's identity string
 * is spelled. Pure (no Pixi, no DB), so both the texture cache and the prefs
 * store can agree on it and tests can check it in a node environment.
 *
 * The key used to be `theme|pattern|colourway|backdrop`, because three of those
 * four were separate pickers. It is now the room's id plus the scheme itself:
 * the id alone would let an edited hex serve stale case art out of the bake
 * cache, and every colour in the scheme is baked into that art.
 *
 * The id AND the scheme, not just the scheme, because a reader can now take
 * the shelf from one room and the books from another — so the drawn scheme is
 * no longer recoverable from the room's name, and two different mixes could
 * otherwise collide on a shared preset id.
 *
 * ## What a wrong key costs, now that the cache is memory only
 *
 * `art/bake.ts` used to write every baked canvas to disk, and a key that
 * missed an axis therefore served the wrong art *forever*, on any machine that
 * had drawn it once — it outlived a reinstall of the app. That disk cache is
 * gone (measured: the PNG encode cost more than redrawing the flat parts), so
 * the blast radius is now one session: the wrong art is served until the app
 * is reloaded, on the one machine that drew it.
 *
 * That is smaller and it is not small. The cache still validates nothing about
 * a hit, so nothing fails, nothing logs, and the reader simply sees a bookcase
 * that is not the one they chose for as long as the window stays open. It is
 * still the one class of bug here that cannot be seen in a specimen board or a
 * screenshot, which is why the key is spelled once, in a module a node test can
 * load, rather than in each of the four bakes.
 */

import { shelfDesignTag, type ShelfDesignInput } from '../../art/shelfDesign';
import type { ColourScheme, LibraryTheme, ThemeId } from '../../art/themes';

/** Same string ⇒ byte-identical case art, given the same carpentry. */
export function schemeKey(themeId: ThemeId, s: ColourScheme): string {
  return [themeId, s.timber, s.timberDark, s.recess, s.wall, ...s.cloths.flat()].join('|');
}

/**
 * A room to bake the case in: its colours, and its carpentry.
 *
 * It was one field for a while, when a room really was only a colour scheme.
 * `design` is the second axis and is NOT part of the scheme on purpose —
 * repainting a room must not straighten its arches, and rebuilding the case
 * must not repaint it.
 */
export interface ThemeRequest {
  themeId: ThemeId;
  /**
   * The colours to draw, which are NOT necessarily `getTheme(themeId).scheme`.
   * A reader can take the shelf from one room and the books from another, so
   * the composed scheme is passed in rather than looked up — looking it up
   * would silently ignore every part that was borrowed.
   */
  scheme: ColourScheme;
  /**
   * The build and timber pattern. Optional and total: a partial blob (or junk
   * out of SQLite) resolves to the house plank case rather than throwing
   * inside a bake.
   */
  design?: ShelfDesignInput;
}

/**
 * Identity of a baked room — same key ⇒ same case art.
 *
 * It lives here rather than next to the bakes in `textures.ts` for the reason
 * this module exists at all: that file imports Pixi, so a node test cannot
 * load it, and "does every axis reach the key" is precisely the property that
 * has to be tested rather than eyeballed. A missing axis is invisible — the
 * cache validates nothing about a hit, so it serves the wrong art for the rest
 * of the session and never says so.
 */
export function themeKeyOf(req: ThemeRequest): string {
  return `${schemeKey(req.themeId, req.scheme)}|${shelfDesignTag(req.design)}`;
}

/* --------------------------- the case bake keys --------------------------- */

/**
 * Cache-key generation for the flat case.
 *
 * Every part key below carries it. The bake cache validates nothing about a
 * hit, so a bitmap drawn by an older recipe is indistinguishable from a fresh
 * one for as long as the process lives. Bumping this is the escape hatch; it
 * must move whenever the flat recipes change.
 */
export const FLAT_ART_VERSION = 'flat3';

/** The four pieces `textures.ts` bakes. Part of every bake key. */
export type CasePart = 'plank' | 'recess' | 'post' | 'crown';

/**
 * What `art/bake.ts` files one baked case part under.
 *
 * `roomKey` is the FULL `themeKeyOf` string, not a hash of it, and that is the
 * whole point of this function existing.
 *
 * It used to be `fnv1a(schemeKey(…)).toString(36)` — six base-36 characters
 * standing in for a hundred and twenty of colour. `bake.ts`'s own header
 * explains why its map is keyed on full parameter strings ("nothing to gain
 * from shortening the key and a (small) correctness risk in a 32-bit collision
 * serving one room's plank to another"), and the caller then hashed the key
 * before handing it over, which undid exactly that.
 *
 * The risk was not hypothetical. The sixty authored rooms do not collide, but
 * a reader can type their own timber hex (`libraryPrefs.composeScheme` →
 * `palette.caseFaces`), so the real input space is millions of schemes wide,
 * and a sweep of it finds pairs immediately: timber `#0043a9` (navy) and
 * `#006b82` (teal) both hashed to `9sjds2`, so whichever the reader picked
 * second was served the other's plank, recess, post and cornice. There is
 * nothing to gain in exchange — the map is in-process and a few dozen entries
 * deep.
 *
 * ## Why the part and the size come FIRST
 *
 * `bake.ts` records `params.slice(0, 96)` in its profile ring buffer, which
 * the perf HUD and the diagnostics log read. With the room key in front, every
 * sample truncates to a wall of hexes and no two parts are distinguishable.
 * Leading with `plank|1200x40` keeps a sample legible while the rest of the
 * string does the work of being unique.
 */
export function caseBakeKey(part: CasePart, w: number, h: number, roomKey: string): string {
  return `${FLAT_ART_VERSION}|${part}|${w}x${h}|${roomKey}`;
}

/** A whole preset's own key — the scheme it ships with, unmixed. */
export function libraryKey(theme: LibraryTheme): string {
  return schemeKey(theme.id, theme.scheme);
}
