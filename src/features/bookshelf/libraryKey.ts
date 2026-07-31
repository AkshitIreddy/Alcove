/**
 * features/bookshelf/libraryKey.ts — the one place a room's identity string
 * is spelled. Pure (no Pixi, no DB), so both the texture cache and the prefs
 * store can agree on it and tests can check it in a node environment.
 *
 * The key used to be `theme|pattern|colourway|backdrop`, because three of those
 * four were separate pickers. A room is one colour scheme now, so the key is
 * the room's id plus the scheme itself: the id alone would let an edited hex
 * serve stale case art out of the disk cache, and every colour in the scheme is
 * baked into that art.
 */

import type { LibraryTheme } from '../../art/themes';

/** Same string ⇒ byte-identical case art. */
export function libraryKey(theme: LibraryTheme): string {
  const s = theme.scheme;
  return [theme.id, s.timber, s.timberDark, s.recess, s.wall, ...s.cloths.flat()].join('|');
}
