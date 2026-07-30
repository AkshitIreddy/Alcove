/**
 * features/bookshelf/libraryKey.ts — the one place a room's identity string
 * is spelled. Pure (no Pixi, no DB), so both the texture cache and the prefs
 * store can agree on it and tests can check it in a node environment.
 */

import type { BackdropId, WallpaperSpec } from '../../art/themes';

/** Same string ⇒ byte-identical case art. */
export function libraryKey(
  themeId: string,
  wallpaper: WallpaperSpec,
  backdrop: BackdropId,
): string {
  return `${themeId}|${wallpaper.pattern}|${wallpaper.colourway}|${backdrop}`;
}
