import { describe, expect, it } from 'vitest';
import { mergeCoverMetaSection } from '../src/data/books';
import {
  BOOK_STUDIO_PREFS_VERSION,
  bookStudioPrefsSection,
  bookSurpriseLocksFor,
  mergeBookStudioPrefsSection,
  normalizeBookStudioPrefs,
} from '../src/features/bookshelf/bookStudioPrefs';

describe('per-book Book Studio preferences', () => {
  it('normalizes corrupt and future data to a safe known lock set', () => {
    expect(normalizeBookStudioPrefs(null).surpriseLocks).toEqual([]);
    expect(
      normalizeBookStudioPrefs({
        version: 99,
        surpriseLocks: ['title.scale', 'unknown.future-lock', 'binding', 'title.scale'],
      }),
    ).toEqual({
      version: BOOK_STUDIO_PREFS_VERSION,
      surpriseLocks: ['binding'],
    });
  });

  it('hydrates locks directly from an already-loaded book row', () => {
    expect(
      bookSurpriseLocksFor({
        coverMeta: {
          studio: {
            version: 1,
            surpriseLocks: ['cover.frame', 'thickness'],
          },
        },
      }),
    ).toEqual(['thickness', 'cover.frame']);
  });

  it('omits an empty preference envelope and emits a versioned nonempty one', () => {
    expect(bookStudioPrefsSection([])).toBeNull();
    expect(bookStudioPrefsSection(['bands'])).toEqual({
      version: BOOK_STUDIO_PREFS_VERSION,
      surpriseLocks: ['bands'],
    });
  });

  it('merges Studio intent without dropping independent cover metadata', () => {
    const current = {
      style: { thickness: 0.7 },
      shelf: { pinned: true },
      futureSection: { keep: true },
    };
    expect(
      mergeCoverMetaSection(current, 'studio', {
        version: 1,
        surpriseLocks: ['binding'],
      }),
    ).toEqual({
      ...current,
      studio: { version: 1, surpriseLocks: ['binding'] },
    });
  });

  it('replaces only known v1 locks while preserving extensions and unknown lock entries', () => {
    const extension = { foil: 'silver', depth: 2 };
    expect(
      mergeBookStudioPrefsSection({
        version: 1,
        surpriseLocks: [
          'binding',
          'future.foil',
          { futureGroup: 'endpapers' },
          'future.foil',
          'title.scale',
        ],
        futureFinishing: extension,
      }, ['cover.frame', 'thickness']),
    ).toEqual({
      version: 1,
      surpriseLocks: [
        'future.foil',
        { futureGroup: 'endpapers' },
        'future.foil',
        'thickness',
        'cover.frame',
      ],
      futureFinishing: extension,
    });
  });

  it('keeps current v1 empty-envelope behavior unless extension state remains', () => {
    expect(mergeBookStudioPrefsSection(null, [])).toBeNull();
    expect(
      mergeBookStudioPrefsSection({ version: 1, surpriseLocks: ['binding'] }, []),
    ).toBeNull();
    expect(
      mergeBookStudioPrefsSection({
        version: 1,
        surpriseLocks: ['binding'],
        futureFinishing: { foil: 'silver' },
      }, []),
    ).toEqual({
      version: 1,
      futureFinishing: { foil: 'silver' },
    });
  });

  it('never downgrades or deletes a future envelope when known locks become empty', () => {
    expect(
      mergeBookStudioPrefsSection({
        version: 7,
        surpriseLocks: ['binding', 'future.foil'],
        futureFinishing: { foil: 'silver' },
      }, []),
    ).toEqual({
      version: 7,
      surpriseLocks: ['future.foil'],
      futureFinishing: { foil: 'silver' },
    });
    expect(
      mergeBookStudioPrefsSection({
        version: 7,
        surpriseLocks: ['binding'],
      }, []),
    ).toEqual({
      version: 7,
      surpriseLocks: [],
    });
    expect(
      mergeBookStudioPrefsSection({ version: 7, futureOnly: true }, []),
    ).toEqual({ version: 7, futureOnly: true });
  });

  it('refuses to overwrite an opaque future lock representation', () => {
    const future = {
      version: 8,
      surpriseLocks: { groups: ['binding'], mode: 'inherited' },
      futureOnly: true,
    };
    expect(mergeBookStudioPrefsSection(future, ['thickness'])).toBe(future);
  });

  it('merges known locks into future data deterministically without rewriting its version', () => {
    const future = {
      version: 4,
      surpriseLocks: ['future.binding-mode', 'binding', 101],
      schema: 'book-studio-next',
    };
    const expected = {
      version: 4,
      surpriseLocks: ['future.binding-mode', 101, 'thickness'],
      schema: 'book-studio-next',
    };
    expect(
      mergeBookStudioPrefsSection(future, ['title.space', 'thickness']),
    ).toEqual(expected);
    expect(
      mergeBookStudioPrefsSection(future, ['title.space', 'thickness']),
    ).toEqual(expected);
  });
});
