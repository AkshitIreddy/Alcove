/**
 * tests/studio-moods.test.ts — "surprise me", steered.
 *
 * The studio's mood row is the only part of the app whose EXISTENCE depends on
 * data rather than on code: `LibraryStudio` renders it under
 * `<Show when={moods().length > 0}>`, and `moodTags()` reads tags structurally
 * off whatever the four vocabularies happen to carry. So the row silently
 * vanishes if a vocabulary is rebuilt without its tags — no type error, no
 * failing render, just a feature that is not there any more. It has already
 * been absent for most of its life for exactly that reason.
 *
 * These pin the two things that have to be true for the row to be worth having:
 * there are words, and a word actually narrows something.
 */
import { describe, expect, it } from 'vitest';
import { moodTags, withMood } from '../src/views/rail/designOptions';
import { BUILDS, BUILD_IDS, PATTERNS, PATTERN_IDS } from '../src/art/shelfDesign';
import { THEMES, THEME_IDS } from '../src/art/themes';
import { WALLPAPER_PRESETS } from '../src/art/wallpaperDesign';

const AXES = [
  { name: 'builds', ids: BUILD_IDS, of: (id: string) => BUILDS[id as never] },
  { name: 'patterns', ids: PATTERN_IDS, of: (id: string) => PATTERNS[id as never] },
  { name: 'rooms', ids: THEME_IDS, of: (id: string) => THEMES[id as never] },
  {
    name: 'papers',
    ids: WALLPAPER_PRESETS.map((p) => p.id),
    of: (id: string) => WALLPAPER_PRESETS.find((p) => p.id === id)!,
  },
] as const;

describe('the mood row has something to say', () => {
  it('offers words at all — otherwise the row does not render', () => {
    expect(moodTags().length).toBeGreaterThan(0);
  });

  it('every axis carries tags, so a mood steers all four rather than one', () => {
    for (const axis of AXES) {
      const tagged = axis.ids.filter((id) => {
        const spec = axis.of(id) as { tags?: readonly string[] };
        return Array.isArray(spec.tags) && spec.tags.length > 0;
      });
      expect(`${axis.name}: ${tagged.length}/${axis.ids.length}`).toBe(
        `${axis.name}: ${axis.ids.length}/${axis.ids.length}`,
      );
    }
  });
});

describe('a mood narrows the dice', () => {
  it('a word that some designs carry leaves fewer than all of them', () => {
    // Not "leaves at least one": `withMood` deliberately degrades to the whole
    // vocabulary when nothing matches, so a run that never narrows anything
    // would pass a weaker assertion while doing nothing at all.
    for (const word of moodTags()) {
      const narrowed = AXES.map((axis) => withMood(axis.ids, word, axis.of as never).length);
      const total = AXES.map((axis) => axis.ids.length);
      expect(narrowed.some((n, i) => n < total[i]!)).toBe(true);
    }
  });

  it('an unknown word gives the whole vocabulary back, never nothing', () => {
    for (const axis of AXES) {
      expect(withMood(axis.ids, 'no-such-mood', axis.of as never).length).toBe(axis.ids.length);
    }
  });
});
