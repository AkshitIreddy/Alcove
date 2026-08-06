// @vitest-environment node
/**
 * The current bookcase card and the shelf have to repaint from the same write.
 *
 * `saveLibraryPrefs` moves the live room before SQLite answers; the row on the
 * bookcase store is intentionally later. Using that row for every card made the
 * current thumbnail trail the world by one selection, while using the live room
 * for every card would repaint all the closed cases as though they were open.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LIBRARY_PREFS,
  prefsForBookcasePreview,
  type LibraryPrefs,
} from '../src/features/bookshelf/libraryPrefs';

const live = (theme: LibraryPrefs['theme']): LibraryPrefs => ({
  ...DEFAULT_LIBRARY_PREFS,
  theme,
});

describe('bookcase card room previews', () => {
  const persistedOnePressAgo = JSON.stringify(live('walnut'));
  const openNow = live('reef');

  it('paints the open card from the optimistic room, not its stale row', () => {
    expect(prefsForBookcasePreview(persistedOnePressAgo, true, openNow).theme).toBe(
      'reef',
    );
  });

  it('keeps a closed card in the room stored on that bookcase', () => {
    expect(prefsForBookcasePreview(persistedOnePressAgo, false, openNow).theme).toBe(
      'walnut',
    );
  });
});
