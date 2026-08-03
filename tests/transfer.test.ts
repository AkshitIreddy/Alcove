/**
 * tests/transfer.test.ts — the pure half of the transfer feature
 * (src/features/transfer/**): bundle format, zip codec, export scoping,
 * plain-Markdown degradation, the import conflict matrix, restore-point
 * retention and revert planning.
 *
 * Everything under test is deterministic and DOM-free; the panel, the
 * database glue and the Rust commands are covered by tests/e2e/transfer.spec.ts
 * and the #[cfg(test)] module in src-tauri/src/transfer.rs.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  BUNDLE_FORMAT,
  BUNDLE_SCHEMA_VERSION,
  buildManifest,
  checksumBytes,
  checksumText,
  describeCounts,
  formatBytes,
  inventoryChecksum,
  isSafeArchivePath,
  pageFilePath,
  parseManifest,
  slugify,
  verifyBundleChecksum,
  type ManifestBook,
} from '../src/features/transfer/format';
import {
  bytesToText,
  crc32,
  dosDateTime,
  textToBytes,
  unzip,
  zipStore,
} from '../src/features/transfer/zip';
import {
  DEFAULT_EXPORT_OPTIONS,
  buildExportPlan,
  emptyLibrarySnapshot,
  occupiedFloors,
  planLabel,
  resolveScopeSelection,
  suggestedFileName,
  type BookSnapshot,
  type BookcaseSnapshot,
  type ExportOptions,
  type LibrarySnapshot,
} from '../src/features/transfer/scope';
import {
  PAGE_BREAK,
  buildBundleFiles,
  buildMarkdownDocument,
  toPlainMarkdown,
} from '../src/features/transfer/bundle';
import {
  buildImportPlan,
  buildLibraryIndex,
  defaultResolution,
  detectBookConflict,
  detectPageConflict,
  neededBookcaseIds,
  planBookcases,
  selectAllPages,
  uniqueTitle,
  type BookResolution,
} from '../src/features/transfer/conflicts';
import {
  DEFAULT_RETENTION,
  applyRetention,
  describeRestorePoint,
  expiresInDays,
  formatWhen,
  normalizeRetention,
  planRevert,
  pruneForSize,
  type LibraryRowIds,
  type RestorePoint,
} from '../src/features/transfer/restore';
import { parseHistory } from '../src/features/transfer/store';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function page(id: string, title: string, body = 'hello there'): BookSnapshot['pages'][number] {
  return {
    id,
    bookId: 'unset',
    ord: 0,
    title,
    script: `# ${title}\n\n${body}\n`,
    docJson: JSON.stringify({
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] }],
    }),
    chars: body.length,
  };
}

function book(
  id: string,
  title: string,
  pageTitles: string[],
  floor = 0,
  bookcaseId: string | null = 'case-1',
): BookSnapshot {
  return {
    id,
    title,
    bookcaseId,
    floor,
    slot: 0,
    spineSeed: 42,
    coverMeta: { cover: { palette: 'amber' } },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    pages: pageTitles.map((pageTitle, index) => ({
      ...page(`${id}-p${index}`, pageTitle),
      bookId: id,
      ord: index,
    })),
  };
}

function bookcase(
  id: string,
  name: string,
  ord = 0,
  floors = 10,
  room: string | null = null,
): BookcaseSnapshot {
  return {
    id,
    name,
    ord,
    room,
    floors,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
}

/** A snapshot with the furniture filled in from whichever cases books cite. */
function snapshotOf(
  books: BookSnapshot[],
  bookcases?: BookcaseSnapshot[],
): LibrarySnapshot {
  const cited = [...new Set(books.map((b) => b.bookcaseId))].filter(
    (id): id is string => id !== null,
  );
  return {
    ...emptyLibrarySnapshot(),
    bookcases: bookcases ?? cited.map((id, i) => bookcase(id, `Case ${i + 1}`, i)),
    books,
  };
}

function library(): LibrarySnapshot {
  return {
    bookcases: [bookcase('case-1', 'My Library', 0, 10, '{"theme":"parchment"}')],
    books: [
      book('b1', 'Study notes', ['Cell biology', 'Mitosis', 'Meiosis'], 0),
      book('b2', 'Recipes', ['Sourdough', 'Focaccia'], 1),
    ],
    assets: [
      { id: 'a1', relPath: 'images/leaf.png', kind: 'image', meta: null, bytes: 4096 },
    ],
    theme: { theme: 'parchment', shelfWoodStain: 'oak' },
  };
}

/** The same library split across two pieces of furniture. */
function twoCaseLibrary(): LibrarySnapshot {
  const snapshot = library();
  snapshot.bookcases = [
    bookcase('case-1', 'Study', 0, 12, '{"theme":"parchment"}'),
    bookcase('case-2', 'Kitchen', 1, 8, '{"theme":"reef"}'),
  ];
  snapshot.books[1].bookcaseId = 'case-2';
  return snapshot;
}

const OPTIONS: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS };

function allPages(snapshot: LibrarySnapshot): Set<string> {
  return resolveScopeSelection(snapshot, { kind: 'library' });
}

function restorePoint(patch: Partial<RestorePoint> = {}): RestorePoint {
  return {
    id: 'rp1',
    label: 'Imported study.nbk',
    createdAt: '2026-07-01T10:00:00.000Z',
    kind: 'import',
    source: 'study.nbk',
    counts: { books: 1, pages: 3 },
    createdBooks: [],
    createdPages: [],
    createdBookcases: [],
    priorBooks: [],
    priorPages: [],
    priorBookcases: [],
    revertOf: null,
    revertedAt: null,
    revertedBy: null,
    ...patch,
  };
}

// ---------------------------------------------------------------------------
// format
// ---------------------------------------------------------------------------

describe('bundle format', () => {
  it('checksums are FNV-1a/32 and match the Rust twin', () => {
    // The same three constants are asserted in src-tauri/src/transfer.rs.
    expect(checksumText('')).toBe('811c9dc5');
    expect(checksumText('notebook')).toBe('4dec6320');
    expect(checksumText('hello')).toBe('4f9f2cab');
  });

  it('checksum is stable and content-sensitive', () => {
    expect(checksumText('a page')).toBe(checksumText('a page'));
    expect(checksumText('a page')).not.toBe(checksumText('a pag'));
    expect(checksumBytes(new Uint8Array([1, 2, 3]))).toMatch(/^[0-9a-f]{8}$/);
  });

  it('inventory checksum ignores entry order', () => {
    const a = [
      { path: 'pages/a.nbs', checksum: '1111' },
      { path: 'pages/b.nbs', checksum: '2222' },
    ];
    expect(inventoryChecksum(a)).toBe(inventoryChecksum([...a].reverse()));
    expect(inventoryChecksum(a)).not.toBe(
      inventoryChecksum([{ path: 'pages/a.nbs', checksum: '9999' }, a[1]]),
    );
  });

  it('slugifies titles safely and never returns empty', () => {
    expect(slugify('My Study Notes!')).toBe('my-study-notes');
    expect(slugify('   ')).toBe('untitled');
    expect(slugify('../../etc/passwd')).toBe('etc-passwd');
    expect(slugify('日本語')).toBe('日本語');
  });

  /*
   * Bookcases arrived after this format did, and for a while the bundle simply
   * did not mention them: exporting a library with three cases and importing it
   * back gave one flat shelf, because every book landed in whichever case
   * happened to be open. Nothing failed — the books were all there, just not
   * where they had been.
   */
  describe('bookcases survive a round trip', () => {
    const manifestOf = (mutate: (s: LibrarySnapshot) => void = () => {}) => {
      const snapshot = library();
      mutate(snapshot);
      return buildBundleFiles({
        snapshot,
        plan: buildExportPlan(snapshot, allPages(snapshot), OPTIONS),
        options: OPTIONS,
        label: 'The whole library',
        createdAt: '2026-07-30T09:00:00.000Z',
        appVersion: '0.1.0',
      }).manifest;
    };

    it('carries the case a book stood in', () => {
      const manifest = manifestOf((s) => {
        s.books[0]!.bookcaseId = 'case-a';
        s.books[1]!.bookcaseId = 'case-b';
      });
      const byId = new Map(manifest.books.map((b) => [b.id, b]));
      expect(byId.get('b1')?.bookcaseId).toBe('case-a');
      expect(byId.get('b2')?.bookcaseId).toBe('case-b');
    });

    it('parses the case back out', () => {
      const manifest = manifestOf((s) => {
        s.books[0]!.bookcaseId = 'case-a';
      });
      const round = parseManifest(JSON.parse(JSON.stringify(manifest)) as unknown);
      expect(round.manifest?.books[0]?.bookcaseId).toBe('case-a');
    });

    /**
     * The compatibility case, and the reason the field is nullable rather than
     * defaulted to something. A v1 bundle has no `bookcaseId` at all; parsing
     * must say "none recorded" rather than inventing an id, so the importer can
     * choose the active case instead of filing books into one that is not here.
     */
    it('reads a pre-bookcases bundle as no case, not a made-up one', () => {
      const raw = JSON.parse(JSON.stringify(manifestOf())) as {
        schemaVersion: number;
        books: Array<Record<string, unknown>>;
      };
      for (const b of raw.books) delete b.bookcaseId;
      raw.schemaVersion = 1;

      const round = parseManifest(raw as unknown);
      expect(round.manifest).not.toBeNull();
      expect(round.manifest?.books.every((b) => b.bookcaseId === null)).toBe(true);
    });

    it('treats an empty string as no case', () => {
      const raw = JSON.parse(JSON.stringify(manifestOf())) as {
        books: Array<Record<string, unknown>>;
      };
      raw.books[0]!.bookcaseId = '';
      expect(parseManifest(raw as unknown).manifest?.books[0]?.bookcaseId).toBeNull();
    });

    /*
     * An id alone (schema 2) is only useful when the importing library IS the
     * exporting one. Everything below is schema 3: the furniture itself, so a
     * machine that has never seen this library can build it.
     */
    const twoCaseManifest = () => {
      const snapshot = twoCaseLibrary();
      return buildBundleFiles({
        snapshot,
        plan: buildExportPlan(snapshot, allPages(snapshot), OPTIONS),
        options: OPTIONS,
        label: 'The whole library',
        createdAt: '2026-07-30T09:00:00.000Z',
        appVersion: '0.1.0',
      }).manifest;
    };

    it('carries each case: name, height, order and room', () => {
      const manifest = twoCaseManifest();
      expect(manifest.bookcases.map((c) => c.id)).toEqual(['case-1', 'case-2']);
      expect(manifest.bookcases[0]).toMatchObject({
        name: 'Study',
        ord: 0,
        floors: 12,
        room: '{"theme":"parchment"}',
      });
      expect(manifest.bookcases[1]).toMatchObject({ name: 'Kitchen', floors: 8 });
    });

    it('ships only the cases the chosen books actually stand in', () => {
      const snapshot = twoCaseLibrary();
      // Just the one book from "Study" — the Kitchen must not travel with it.
      const plan = buildExportPlan(snapshot, new Set(['b1-p0']), OPTIONS);
      expect(plan.bookcases.map((c) => c.name)).toEqual(['Study']);
      const manifest = buildBundleFiles({
        snapshot,
        plan,
        options: OPTIONS,
        label: 'One book',
        createdAt: '2026-07-30T09:00:00.000Z',
        appVersion: '0.1.0',
      }).manifest;
      expect(manifest.bookcases.map((c) => c.id)).toEqual(['case-1']);
    });

    /*
     * The furniture is deliberately NOT behind "include the library look".
     * That toggle is about the app-wide ink/paper preferences; the shape of a
     * library is structure, and making it optional would be offering to lose it.
     */
    it('carries the cases even with the library look left out', () => {
      const snapshot = twoCaseLibrary();
      const options: ExportOptions = { ...OPTIONS, includeLibraryTheme: false };
      const manifest = buildBundleFiles({
        snapshot,
        plan: buildExportPlan(snapshot, allPages(snapshot), options),
        options,
        label: 'x',
        createdAt: '2026-07-30T09:00:00.000Z',
        appVersion: '0.1.0',
      }).manifest;
      expect(manifest.theme).toBeNull();
      expect(manifest.bookcases).toHaveLength(2);
      expect(manifest.bookcases[0].room).toBe('{"theme":"parchment"}');
    });

    it('parses the cases back out, in picker order', () => {
      const round = parseManifest(
        JSON.parse(JSON.stringify(twoCaseManifest())) as unknown,
      );
      expect(round.errors).toEqual([]);
      expect(round.manifest?.bookcases.map((c) => c.name)).toEqual([
        'Study',
        'Kitchen',
      ]);
      expect(round.manifest?.bookcases[1].floors).toBe(8);
    });

    it('a bundle that predates the case list reads as no furniture, not a broken one', () => {
      const raw = JSON.parse(JSON.stringify(twoCaseManifest())) as Record<
        string,
        unknown
      >;
      delete raw.bookcases;
      raw.schemaVersion = 2;
      const round = parseManifest(raw as unknown);
      expect(round.manifest).not.toBeNull();
      expect(round.manifest?.bookcases).toEqual([]);
      // The ids are still there — a same-library import still lands correctly.
      expect(round.manifest?.books[1].bookcaseId).toBe('case-2');
    });

    it('drops case entries a hand-edited bundle broke, and keeps the rest', () => {
      const raw = JSON.parse(JSON.stringify(twoCaseManifest())) as {
        bookcases: unknown[];
      };
      raw.bookcases.push(null);
      raw.bookcases.push({ name: 'No id here' });
      raw.bookcases.push({ id: 'case-1', name: 'Study again' });
      const round = parseManifest(raw as unknown);
      expect(round.manifest?.bookcases.map((c) => c.name)).toEqual([
        'Study',
        'Kitchen',
      ]);
      expect(round.warnings.length).toBeGreaterThanOrEqual(3);
    });

    it('refuses an unusable floor count and an oversized room blob', () => {
      const round = parseManifest({
        ...(JSON.parse(JSON.stringify(twoCaseManifest())) as Record<string, unknown>),
        bookcases: [
          { id: 'c', name: 'Odd', floors: -4, room: 'x'.repeat(40_000) },
        ],
      });
      expect(round.manifest?.bookcases[0].floors).toBe(1);
      expect(round.manifest?.bookcases[0].room).toBeNull();
    });
  });

  it('page paths are ordered, slugged and extension-aware', () => {
    expect(pageFilePath('my-book', 0, 'Cell biology', 'bundle')).toBe(
      'pages/my-book/001-cell-biology.nbs',
    );
    expect(pageFilePath('my-book', 11, 'Cell biology', 'markdown')).toBe(
      'pages/my-book/012-cell-biology.md',
    );
  });

  it('rejects archive paths that escape the bundle root', () => {
    expect(isSafeArchivePath('pages/a/001.nbs')).toBe(true);
    expect(isSafeArchivePath('../secrets')).toBe(false);
    expect(isSafeArchivePath('/etc/passwd')).toBe(false);
    expect(isSafeArchivePath('C:/Windows')).toBe(false);
    expect(isSafeArchivePath('pages\\win.nbs')).toBe(false);
    expect(isSafeArchivePath('a/./b')).toBe(false);
    expect(isSafeArchivePath('')).toBe(false);
  });

  it('builds a manifest with derived counts and a checksum', () => {
    const books: ManifestBook[] = [
      {
        id: 'b1',
        title: 'Study notes',
        floor: 0,
        slot: 0,
        spineSeed: 1,
        coverMeta: null,
        createdAt: '',
        updatedAt: '',
        pages: [
          { id: 'p1', ord: 0, title: 'One', file: 'pages/s/001.nbs', docFile: null, bytes: 10, checksum: 'aaaa' },
          { id: 'p2', ord: 1, title: 'Two', file: 'pages/s/002.nbs', docFile: null, bytes: 12, checksum: 'bbbb' },
        ],
      },
    ];
    const manifest = buildManifest({
      createdAt: '2026-07-30T00:00:00.000Z',
      appVersion: '0.1.0',
      scope: 'library',
      variant: 'bundle',
      layout: 'per-page',
      label: 'The whole library',
      books,
      assets: [],
      theme: null,
    });
    expect(manifest.format).toBe(BUNDLE_FORMAT);
    expect(manifest.schemaVersion).toBe(BUNDLE_SCHEMA_VERSION);
    expect(manifest.counts).toEqual({ books: 1, pages: 2, assets: 0 });
    expect(manifest.checksum).toHaveLength(8);
  });
});

describe('manifest parsing is total', () => {
  const valid = (): unknown =>
    JSON.parse(
      JSON.stringify(
        buildManifest({
          createdAt: '2026-07-30T00:00:00.000Z',
          appVersion: '0.1.0',
          scope: 'library',
          variant: 'bundle',
          layout: 'per-page',
          label: 'Lib',
          books: [
            {
              id: 'b1',
              title: 'Study notes',
              floor: 0,
              slot: 0,
              spineSeed: 1,
              coverMeta: null,
              createdAt: '',
              updatedAt: '',
              pages: [
                { id: 'p1', ord: 0, title: 'One', file: 'pages/s/001.nbs', docFile: 'docs/p1.json', bytes: 10, checksum: 'aaaa' },
              ],
            },
          ],
          assets: [],
          theme: null,
        }),
      ),
    );

  it('round-trips a manifest it wrote', () => {
    const result = parseManifest(JSON.stringify(valid()));
    expect(result.errors).toEqual([]);
    expect(result.manifest?.books[0].pages[0].docFile).toBe('docs/p1.json');
  });

  it('rejects non-JSON, non-bundles and newer schemas', () => {
    expect(parseManifest('{oops').errors[0]).toMatch(/not valid JSON/);
    expect(parseManifest('[]').errors[0]).toMatch(/not an object/);
    expect(parseManifest(JSON.stringify({ format: 'zip', schemaVersion: 1 })).errors[0]).toMatch(
      /not a Notebook bundle/,
    );
    const future = { ...(valid() as Record<string, unknown>), schemaVersion: 99 };
    expect(parseManifest(JSON.stringify(future)).errors[0]).toMatch(/newer Notebook/);
  });

  it('skips malformed pages and traversal paths but keeps the book', () => {
    const raw = valid() as { books: Array<{ pages: unknown[] }> };
    raw.books[0].pages.push({ id: 'bad', title: 'Escape', file: '../../evil.nbs' });
    raw.books[0].pages.push(null);
    const result = parseManifest(JSON.stringify(raw));
    expect(result.manifest?.books[0].pages).toHaveLength(1);
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('treats a bundle with no readable books as an error', () => {
    const raw = { ...(valid() as Record<string, unknown>), books: [] };
    expect(parseManifest(JSON.stringify(raw)).manifest).toBeNull();
  });

  it('warns when the declared page count disagrees with the listing', () => {
    const raw = valid() as Record<string, unknown>;
    raw.counts = { books: 1, pages: 99, assets: 0 };
    expect(parseManifest(JSON.stringify(raw)).warnings.join(' ')).toMatch(/claims 99 pages/);
  });

  it('never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(() => parseManifest(value)).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  it('verifies the inventory checksum and reports drift', () => {
    const manifest = parseManifest(JSON.stringify(valid())).manifest;
    expect(manifest).not.toBeNull();
    const honest = [{ path: 'pages/s/001.nbs', checksum: 'aaaa' }];
    expect(verifyBundleChecksum(manifest!, honest).ok).toBe(true);
    expect(
      verifyBundleChecksum(manifest!, [{ path: 'pages/s/001.nbs', checksum: 'zzzz' }]).ok,
    ).toBe(false);
  });
});

describe('presentation helpers', () => {
  it('formats byte sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(45_000)).toBe('44 KB');
    expect(formatBytes(3_500_000)).toBe('3.3 MB');
  });

  it('describes counts with correct plurals', () => {
    expect(describeCounts({ books: 1, pages: 1 })).toBe('1 book · 1 page');
    expect(describeCounts({ books: 3, pages: 41, assets: 2 })).toBe(
      '3 books · 41 pages · 2 assets',
    );
    expect(describeCounts({ books: 2, pages: 4, assets: 0 })).toBe('2 books · 4 pages');
  });
});

// ---------------------------------------------------------------------------
// zip
// ---------------------------------------------------------------------------

describe('zip codec', () => {
  it('computes the IEEE CRC-32 zip mandates', () => {
    expect(crc32(textToBytes(''))).toBe(0);
    expect(crc32(textToBytes('123456789'))).toBe(0xcbf43926);
  });

  it('round-trips entries including unicode names and empty files', async () => {
    const entries = [
      { path: 'manifest.json', bytes: textToBytes('{"format":"notebook-bundle"}') },
      { path: 'pages/日本/001-はじめに.nbs', bytes: textToBytes('# はじめに\n') },
      { path: 'pages/empty.nbs', bytes: new Uint8Array(0) },
    ];
    const archive = zipStore(entries);
    const back = await unzip(archive);
    expect(back.warnings).toEqual([]);
    expect([...back.files.keys()]).toEqual(entries.map((entry) => entry.path));
    expect(bytesToText(back.files.get('pages/日本/001-はじめに.nbs')!)).toBe('# はじめに\n');
    expect(back.files.get('pages/empty.nbs')!.length).toBe(0);
  });

  it('produces a real ZIP header and end-of-directory record', () => {
    const archive = zipStore([{ path: 'a.txt', bytes: textToBytes('x') }]);
    expect(Array.from(archive.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(archive.length).toBeGreaterThan(22);
  });

  it('reads garbage without throwing', async () => {
    const result = await unzip(new Uint8Array([1, 2, 3, 4, 5]));
    expect(result.files.size).toBe(0);
    expect(result.warnings[0]).toMatch(/not a ZIP/);
  });

  it('never throws on random bytes', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 300 }), async (bytes) => {
        await expect(unzip(bytes)).resolves.toBeTruthy();
      }),
      { numRuns: 40 },
    );
  });

  it('encodes MS-DOS date/time', () => {
    const { date, time } = dosDateTime(new Date(2026, 6, 30, 12, 34, 56));
    expect((date >> 9) + 1980).toBe(2026);
    expect((date >> 5) & 0x0f).toBe(7);
    expect(date & 0x1f).toBe(30);
    expect((time >> 11) & 0x1f).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// scope
// ---------------------------------------------------------------------------

describe('export scope', () => {
  it('seeds a selection from each scope kind', () => {
    const snapshot = library();
    expect(resolveScopeSelection(snapshot, { kind: 'library' }).size).toBe(5);
    expect(resolveScopeSelection(snapshot, { kind: 'book', bookId: 'b2' }).size).toBe(2);
    expect(resolveScopeSelection(snapshot, { kind: 'floor', floor: 1 }).size).toBe(2);
    expect(resolveScopeSelection(snapshot, { kind: 'floor', floor: 7 }).size).toBe(0);
  });

  it('lists occupied floors ascending', () => {
    expect(occupiedFloors(library())).toEqual([0, 1]);
  });

  it('plans counts, omissions and paths', () => {
    const snapshot = library();
    const selection = new Set(['b1-p0', 'b1-p2', 'b2-p0']);
    const plan = buildExportPlan(snapshot, selection, OPTIONS);
    expect(plan.counts).toEqual({ books: 2, pages: 3, assets: 1 });
    expect(plan.books[0].omittedPages).toBe(1);
    expect(plan.books[0].pages.map((p) => p.file)).toEqual([
      'pages/study-notes/001-cell-biology.nbs',
      'pages/study-notes/002-meiosis.nbs',
    ]);
    expect(plan.empty).toBe(false);
  });

  it('is empty when nothing is ticked', () => {
    const plan = buildExportPlan(library(), new Set(), OPTIONS);
    expect(plan.empty).toBe(true);
    expect(plan.counts).toEqual({ books: 0, pages: 0, assets: 0 });
    expect(plan.estimatedBytes).toBe(0);
  });

  it('disambiguates two books with the same title', () => {
    const snapshot: LibrarySnapshot = snapshotOf([book('b1', 'Notes', ['a']), book('b2', 'Notes', ['b'])]);
    const plan = buildExportPlan(snapshot, allPages(snapshot), OPTIONS);
    expect(plan.books[0].pages[0].file).toMatch(/^pages\/notes\//);
    expect(plan.books[1].pages[0].file).toMatch(/^pages\/notes-2\//);
  });

  it('collapses page files when the layout is one-file-per-book', () => {
    const snapshot = library();
    const plan = buildExportPlan(snapshot, allPages(snapshot), {
      ...OPTIONS,
      layout: 'single-file',
    });
    const files = new Set(plan.books[0].pages.map((p) => p.file));
    expect(files.size).toBe(1);
    expect([...files][0]).toBe('pages/study-notes.nbs');
  });

  it('estimated size grows with lossless docs and assets', () => {
    const snapshot = library();
    const selection = allPages(snapshot);
    const lean = buildExportPlan(snapshot, selection, {
      ...OPTIONS,
      losslessDocs: false,
      includeAssets: false,
    });
    const full = buildExportPlan(snapshot, selection, OPTIONS);
    expect(full.estimatedBytes).toBeGreaterThan(lean.estimatedBytes);
    expect(lean.estimatedBytes).toBeGreaterThan(0);
  });

  it('suggests a file name per scope and variant', () => {
    const snapshot = library();
    const plan = buildExportPlan(snapshot, allPages(snapshot), OPTIONS);
    expect(suggestedFileName(plan, { kind: 'library' }, OPTIONS)).toBe('notebook-library.nbk');
    expect(suggestedFileName(plan, { kind: 'floor', floor: 2 }, OPTIONS)).toBe(
      'notebook-floor-3.nbk',
    );
    const one = buildExportPlan(snapshot, new Set(['b2-p0']), OPTIONS);
    expect(suggestedFileName(one, { kind: 'selection' }, OPTIONS)).toBe('recipes.nbk');
    expect(
      suggestedFileName(one, { kind: 'selection' }, { ...OPTIONS, variant: 'markdown', layout: 'single-file' }),
    ).toBe('recipes.md');
  });

  it('labels the plan for the preview header', () => {
    const snapshot = library();
    const plan = buildExportPlan(snapshot, allPages(snapshot), OPTIONS);
    expect(planLabel(plan, { kind: 'library' })).toBe('The whole library');
    expect(planLabel(plan, { kind: 'floor', floor: 0 })).toBe('Floor 1');
    expect(planLabel(plan, { kind: 'selection' })).toBe('2 books');
  });
});

// ---------------------------------------------------------------------------
// bundle building
// ---------------------------------------------------------------------------

describe('plain-Markdown degradation', () => {
  it('drops frontmatter and unwraps directives', () => {
    const script = [
      '---',
      'title: Notes',
      '---',
      '',
      '# Heading',
      '',
      ':::callout {color=amber}',
      'important line',
      ':::',
      '',
      'tail',
      '',
    ].join('\n');
    const md = toPlainMarkdown(script);
    expect(md).not.toMatch(/title: Notes/);
    expect(md).not.toMatch(/:::/);
    expect(md).toMatch(/# Heading/);
    expect(md).toMatch(/important line/);
    expect(md).toMatch(/tail/);
  });

  it('relabels mini-language fences but keeps ordinary code fences', () => {
    const md = toPlainMarkdown('```tree\nroot\n  leaf\n```\n\n```ts\nconst a = 1;\n```\n');
    expect(md).not.toMatch(/```tree/);
    expect(md).toMatch(/```ts/);
    expect(md).toMatch(/const a = 1;/);
  });

  it('leaves directive-looking text inside a fence alone', () => {
    const md = toPlainMarkdown('```\n:::not-a-directive\n```\n');
    expect(md).toMatch(/:::not-a-directive/);
  });
});

describe('bundle files', () => {
  const built = (options: ExportOptions = OPTIONS) => {
    const snapshot = library();
    const plan = buildExportPlan(snapshot, allPages(snapshot), options);
    return buildBundleFiles({
      snapshot,
      plan,
      options,
      label: 'The whole library',
      createdAt: '2026-07-30T09:00:00.000Z',
      appVersion: '0.1.0',
    });
  };

  it('writes the manifest first and one file per page', () => {
    const bundle = built();
    expect(bundle.entries[0].path).toBe('manifest.json');
    const paths = bundle.entries.map((entry) => entry.path);
    expect(paths).toContain('pages/study-notes/001-cell-biology.nbs');
    expect(paths.filter((p) => p.startsWith('docs/'))).toHaveLength(5);
    expect(bundle.manifest.counts).toEqual({ books: 2, pages: 5, assets: 1 });
  });

  it('omits doc JSON and cover styling when the options say so', () => {
    const bundle = built({ ...OPTIONS, losslessDocs: false, includeCoverStyling: false });
    expect(bundle.entries.some((entry) => entry.path.startsWith('docs/'))).toBe(false);
    expect(bundle.manifest.books[0].coverMeta).toBeNull();
    expect(bundle.manifest.books[0].pages[0].docFile).toBeNull();
  });

  it('adds theme.json only when the theme is included', () => {
    expect(built().entries.some((e) => e.path === 'theme.json')).toBe(false);
    const withTheme = built({ ...OPTIONS, includeLibraryTheme: true });
    expect(withTheme.entries.some((e) => e.path === 'theme.json')).toBe(true);
    expect(withTheme.manifest.theme).not.toBeNull();
  });

  it('concatenates pages with a page break in one-file-per-book layout', () => {
    const bundle = built({ ...OPTIONS, layout: 'single-file' });
    const body = bundle.bodies.get('pages/study-notes.nbs');
    expect(body).toBeDefined();
    expect(body!.split(PAGE_BREAK)).toHaveLength(3);
  });

  it('folds a bundle into one Markdown document', () => {
    const bundle = built({ ...OPTIONS, variant: 'markdown', layout: 'single-file' });
    const md = buildMarkdownDocument(bundle);
    expect(md).toMatch(/^# Study notes/);
    expect(md).toMatch(/# Recipes/);
    expect(md).toMatch(/---/);
  });

  it('page checksums in the manifest match the written bodies', () => {
    const bundle = built();
    for (const manifestBook of bundle.manifest.books) {
      for (const manifestPage of manifestBook.pages) {
        const body = bundle.bodies.get(manifestPage.file);
        expect(body).toBeDefined();
        expect(checksumText(body!)).toBe(manifestPage.checksum);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// import conflicts
// ---------------------------------------------------------------------------

describe('import conflict matrix', () => {
  const bundleOf = (snapshot: LibrarySnapshot) => {
    const plan = buildExportPlan(snapshot, allPages(snapshot), OPTIONS);
    return buildBundleFiles({
      snapshot,
      plan,
      options: OPTIONS,
      label: 'Shared notes',
      createdAt: '2026-07-30T09:00:00.000Z',
      appVersion: '0.1.0',
    }).manifest;
  };

  it('indexes the library by id and title', () => {
    const index = buildLibraryIndex(library());
    expect(index.bookIds.has('b1')).toBe(true);
    expect(index.titleToId.get('recipes')).toBe('b2');
    expect(index.pageIds.size).toBe(5);
  });

  it('detects same-id, same-title and no conflict', () => {
    const index = buildLibraryIndex(library());
    expect(detectBookConflict({ id: 'b1', title: 'Anything' }, index)).toBe('same-id');
    expect(detectBookConflict({ id: 'zz', title: ' recipes ' }, index)).toBe('same-title');
    expect(detectBookConflict({ id: 'zz', title: 'Brand new' }, index)).toBe('none');
    expect(detectPageConflict({ id: 'b1-p0' }, index)).toBe('same-id');
    expect(detectPageConflict({ id: 'nope' }, index)).toBe('none');
  });

  it('defaults are never destructive', () => {
    expect(defaultResolution('same-id')).toBe('add-new');
    expect(defaultResolution('same-title')).toBe('rename');
    expect(defaultResolution('none')).toBe('add-new');
  });

  it('de-duplicates titles without stacking suffixes', () => {
    const taken = new Set(['notes', 'notes (2)']);
    expect(uniqueTitle('Notes', taken)).toBe('Notes (3)');
    expect(uniqueTitle('Notes (2)', taken)).toBe('Notes (3)');
    expect(uniqueTitle('Fresh', taken)).toBe('Fresh');
    expect(uniqueTitle('   ', new Set())).toBe('Untitled');
  });

  it('plans a clean import as plain creates', () => {
    const incoming: LibrarySnapshot = snapshotOf([book('n1', 'Physics', ['Optics', 'Waves'])]);
    const manifest = bundleOf(incoming);
    const plan = buildImportPlan(manifest, buildLibraryIndex(library()), {
      pages: selectAllPages(manifest),
      resolutions: new Map(),
    });
    expect(plan.counts).toEqual({ newBooks: 1, appendedBooks: 0, skippedBooks: 0, pages: 2 });
    expect(plan.books[0].action).toBe('create');
    expect(plan.books[0].title).toBe('Physics');
    expect(plan.summary[0]).toMatch(/Shelve “Physics” as a new book with 2 pages/);
  });

  it('renames on a title clash and appends on merge', () => {
    const incoming: LibrarySnapshot = snapshotOf([book('n1', 'Recipes', ['Bagels'])]);
    const manifest = bundleOf(incoming);
    const index = buildLibraryIndex(library());
    const selection = { pages: selectAllPages(manifest), resolutions: new Map() };

    const renamed = buildImportPlan(manifest, index, selection);
    expect(renamed.books[0].action).toBe('create');
    expect(renamed.books[0].title).toBe('Recipes (2)');

    const merged = buildImportPlan(manifest, index, {
      ...selection,
      resolutions: new Map<string, BookResolution>([['n1', 'merge']]),
    });
    expect(merged.books[0].action).toBe('append');
    expect(merged.books[0].targetBookId).toBe('b2');
    expect(merged.summary[0]).toMatch(/Add 1 page to your existing “Recipes”/);
  });

  it('merge without an existing match degrades to a create', () => {
    const incoming: LibrarySnapshot = snapshotOf([book('n1', 'Astronomy', ['Stars'])]);
    const manifest = bundleOf(incoming);
    const plan = buildImportPlan(manifest, buildLibraryIndex(library()), {
      pages: selectAllPages(manifest),
      resolutions: new Map<string, BookResolution>([['n1', 'merge']]),
    });
    expect(plan.books[0].action).toBe('create');
    expect(plan.counts.newBooks).toBe(1);
  });

  it('skips explicitly and when every page is unticked', () => {
    const incoming: LibrarySnapshot = snapshotOf([book('n1', 'Skipped', ['One']), book('n2', 'Empty pick', ['Two'])]);
    const manifest = bundleOf(incoming);
    const plan = buildImportPlan(manifest, buildLibraryIndex(library()), {
      pages: new Set(['n1-p0']),
      resolutions: new Map<string, BookResolution>([['n1', 'skip']]),
    });
    expect(plan.books.map((b) => b.action)).toEqual(['skip', 'skip']);
    expect(plan.summary[1]).toMatch(/no pages ticked/);
    expect(plan.empty).toBe(true);
  });

  it('counts partially ticked books and reports the omissions', () => {
    const incoming: LibrarySnapshot = snapshotOf([book('n1', 'Half', ['a', 'b', 'c'])]);
    const manifest = bundleOf(incoming);
    const plan = buildImportPlan(manifest, buildLibraryIndex(library()), {
      pages: new Set(['n1-p0']),
      resolutions: new Map(),
    });
    expect(plan.books[0].pages).toHaveLength(1);
    expect(plan.books[0].skippedPages).toBe(2);
    expect(plan.counts.pages).toBe(1);
  });

  it('two renamed books in one bundle never collide', () => {
    const incoming: LibrarySnapshot = snapshotOf([book('n1', 'Recipes', ['a']), book('n2', 'Recipes', ['b'])]);
    const manifest = bundleOf(incoming);
    const plan = buildImportPlan(manifest, buildLibraryIndex(library()), {
      pages: selectAllPages(manifest),
      resolutions: new Map<string, BookResolution>([
        ['n1', 'rename'],
        ['n2', 'rename'],
      ]),
    });
    const titles = plan.books.map((b) => b.title);
    expect(new Set(titles).size).toBe(2);
    expect(titles).toEqual(['Recipes (2)', 'Recipes (3)']);
  });

  it('marks pages that already exist in the library', () => {
    const manifest = bundleOf(library());
    const plan = buildImportPlan(manifest, buildLibraryIndex(library()), {
      pages: selectAllPages(manifest),
      resolutions: new Map(),
    });
    expect(plan.books[0].pages.every((p) => p.conflict === 'same-id')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bookcase resolution — which furniture an import needs, and where from
// ---------------------------------------------------------------------------

describe('import bookcase matching', () => {
  const bundleOf = (snapshot: LibrarySnapshot) =>
    buildBundleFiles({
      snapshot,
      plan: buildExportPlan(snapshot, allPages(snapshot), OPTIONS),
      options: OPTIONS,
      label: 'Shared notes',
      createdAt: '2026-07-30T09:00:00.000Z',
      appVersion: '0.1.0',
    }).manifest;

  /** Bundle a two-case library and plan importing all of it. */
  const incoming = (
    here: LibrarySnapshot,
    resolutions = new Map<string, BookResolution>(),
  ) => {
    const manifest = bundleOf(twoCaseLibrary());
    const plan = buildImportPlan(manifest, buildLibraryIndex(here), {
      pages: selectAllPages(manifest),
      resolutions,
    });
    return {
      manifest,
      plan,
      cases: planBookcases(
        manifest,
        plan,
        here.bookcases.map((c) => ({ id: c.id, name: c.name })),
      ),
    };
  };

  it('builds every case a foreign library brought with it', () => {
    // A library that shares no ids and no names with the bundle.
    const here = snapshotOf([], [bookcase('case-mine', 'My Library')]);
    const { cases } = incoming(here);
    expect(cases.create.map((c) => c.name)).toEqual(['Study', 'Kitchen']);
    expect(cases.adopted.size).toBe(0);
    expect(cases.summary).toEqual([
      'Build the bookcase “Study” (12 floors)',
      'Build the bookcase “Kitchen” (8 floors)',
    ]);
    expect(cases.notable).toBe(true);
  });

  /*
   * The everyday import: one library, one bookcase, a bundle that lands in it.
   * There is nothing to say — and saying “books from My Library go into your
   * My Library” above every import makes the lines that matter harder to read.
   */
  it('says nothing when every book lands in the one case already open', () => {
    const single = library();
    const manifest = bundleOf(single);
    const plan = buildImportPlan(manifest, buildLibraryIndex(single), {
      pages: selectAllPages(manifest),
      resolutions: new Map(),
    });
    const cases = planBookcases(manifest, plan, [
      { id: 'case-1', name: 'My Library' },
    ]);
    expect(cases.create).toEqual([]);
    expect(cases.bookcases).toHaveLength(1);
    expect(cases.notable).toBe(false);
  });

  it('speaks up as soon as the books are split across two cases', () => {
    const here = snapshotOf([], [bookcase('case-1', 'Study'), bookcase('case-2', 'Kitchen', 1)]);
    const { cases } = incoming(here);
    expect(cases.create).toEqual([]);
    expect(cases.notable).toBe(true);
  });

  it('adopts a case whose id is already here — the same library, restored', () => {
    const here = snapshotOf([], [bookcase('case-1', 'Renamed since'), bookcase('case-2', 'Kitchen', 1)]);
    const { cases } = incoming(here);
    expect(cases.create).toEqual([]);
    expect(cases.adopted.get('case-1')).toBe('case-1');
    expect(cases.bookcases[0].matchedBy).toBe('id');
    // The name here wins: it is the one the reader chose.
    expect(cases.summary[0]).toBe('Books from “Study” go back into your “Renamed since”');
  });

  /*
   * The second import of the same bundle. Ids are private to a library, so a
   * rebuilt case has a fresh one — without a name match the third import would
   * leave the reader with "Study", "Study" and "Study".
   */
  it('adopts a case that only matches by name', () => {
    const here = snapshotOf([], [bookcase('case-xyz', '  study  ')]);
    const { cases } = incoming(here);
    expect(cases.adopted.get('case-1')).toBe('case-xyz');
    expect(cases.bookcases[0].matchedBy).toBe('name');
    expect(cases.create.map((c) => c.name)).toEqual(['Kitchen']);
  });

  it('needs no furniture at all when every book is skipped', () => {
    const here = snapshotOf([], [bookcase('case-mine', 'My Library')]);
    const { cases } = incoming(
      here,
      new Map<string, BookResolution>([
        ['b1', 'skip'],
        ['b2', 'skip'],
      ]),
    );
    expect(cases.bookcases).toEqual([]);
    expect(cases.create).toEqual([]);
  });

  /*
   * Appending to a book that is already on the shelf must not drag its case in
   * — the book stays where the reader put it, and moving it would be the one
   * destructive thing this feature promises never to do.
   */
  it('a book being appended to brings no case with it', () => {
    const here = library();
    const manifest = bundleOf(twoCaseLibrary());
    const plan = buildImportPlan(manifest, buildLibraryIndex(here), {
      pages: selectAllPages(manifest),
      resolutions: new Map<string, BookResolution>([
        ['b1', 'merge'],
        ['b2', 'skip'],
      ]),
    });
    expect(neededBookcaseIds(manifest, plan).size).toBe(0);
  });

  /*
   * A schema-2 bundle names a case and cannot describe it. If the id is not
   * here there is no recipe to build one from, and inventing an empty case
   * called `case-2` would be furniture with someone else's serial number on
   * it. The books fall back to the active case, exactly as they did before.
   */
  it('leaves a named-but-undescribed case out rather than inventing one', () => {
    const manifest = bundleOf(twoCaseLibrary());
    const stripped = parseManifest({
      ...(JSON.parse(JSON.stringify(manifest)) as Record<string, unknown>),
      bookcases: [],
    }).manifest;
    expect(stripped).not.toBeNull();
    const here = snapshotOf([], [bookcase('case-mine', 'My Library')]);
    const plan = buildImportPlan(stripped!, buildLibraryIndex(here), {
      pages: selectAllPages(stripped!),
      resolutions: new Map(),
    });
    const cases = planBookcases(stripped!, plan, [
      { id: 'case-mine', name: 'My Library' },
    ]);
    expect(cases.bookcases).toEqual([]);
    expect(cases.create).toEqual([]);
    // …but the ids were still needed, which is what the fallback answers for.
    expect([...neededBookcaseIds(stripped!, plan)].sort()).toEqual([
      'case-1',
      'case-2',
    ]);
  });

  it('two source cases sharing one name here both land in it', () => {
    const snapshot = twoCaseLibrary();
    snapshot.bookcases[1].name = 'Study';
    const manifest = bundleOf(snapshot);
    const here = snapshotOf([], [bookcase('case-only', 'Study')]);
    const plan = buildImportPlan(manifest, buildLibraryIndex(here), {
      pages: selectAllPages(manifest),
      resolutions: new Map(),
    });
    const cases = planBookcases(manifest, plan, [{ id: 'case-only', name: 'Study' }]);
    expect(cases.create).toEqual([]);
    expect(cases.adopted.get('case-1')).toBe('case-only');
    expect(cases.adopted.get('case-2')).toBe('case-only');
  });
});

// ---------------------------------------------------------------------------
// restore points
// ---------------------------------------------------------------------------

describe('restore-point retention', () => {
  const at = (iso: string, id: string): RestorePoint =>
    restorePoint({ id, createdAt: iso });

  it('keeps the newest N', () => {
    const points = Array.from({ length: 25 }, (_, i) =>
      at(`2026-07-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`, `p${i}`),
    );
    const { keep, drop } = applyRetention(points, { maxAgeDays: 0, maxCount: 20 });
    expect(keep).toHaveLength(20);
    expect(drop).toHaveLength(5);
    expect(keep[0].id).toBe('p24');
  });

  it('drops points older than the age policy', () => {
    const now = new Date('2026-07-30T00:00:00.000Z');
    const points = [at('2026-07-29T00:00:00.000Z', 'fresh'), at('2026-01-01T00:00:00.000Z', 'old')];
    const { keep, drop } = applyRetention(points, DEFAULT_RETENTION, now);
    expect(keep.map((p) => p.id)).toEqual(['fresh']);
    expect(drop.map((p) => p.id)).toEqual(['old']);
  });

  it('keeps forever when maxAgeDays is 0 and maxCount is 0', () => {
    const points = [at('2000-01-01T00:00:00.000Z', 'ancient')];
    expect(applyRetention(points, { maxAgeDays: 0, maxCount: 0 }).keep).toHaveLength(1);
  });

  it('rescues a point that a kept revert refers back to', () => {
    const now = new Date('2026-07-30T00:00:00.000Z');
    const original = at('2026-01-01T00:00:00.000Z', 'orig');
    const revert = restorePoint({
      id: 'rev',
      kind: 'revert',
      createdAt: '2026-07-29T00:00:00.000Z',
      revertOf: 'orig',
    });
    const { keep } = applyRetention([original, revert], DEFAULT_RETENTION, now);
    expect(keep.map((p) => p.id).sort()).toEqual(['orig', 'rev']);
  });

  it('prunes by serialized size but always keeps the newest', () => {
    const fat = (id: string, iso: string): RestorePoint =>
      restorePoint({
        id,
        createdAt: iso,
        priorPages: [
          {
            id: `${id}-page`,
            book_id: 'b',
            ord: 0,
            doc_json: 'x'.repeat(2000),
            script_source: null,
            source_dirty: 0,
            updated_at: iso,
          },
        ],
      });
    const points = [
      fat('a', '2026-07-01T00:00:00.000Z'),
      fat('b', '2026-07-02T00:00:00.000Z'),
      fat('c', '2026-07-03T00:00:00.000Z'),
    ];
    const { keep, drop } = pruneForSize(points, 2500);
    expect(keep.map((p) => p.id)).toEqual(['c']);
    expect(drop).toHaveLength(2);
  });

  it('normalizes stored retention blobs', () => {
    expect(normalizeRetention(null)).toEqual(DEFAULT_RETENTION);
    expect(normalizeRetention({ maxAgeDays: -4, maxCount: 'nope' })).toEqual(DEFAULT_RETENTION);
    expect(normalizeRetention({ maxAgeDays: 365, maxCount: 5 })).toEqual({
      maxAgeDays: 365,
      maxCount: 5,
    });
  });
});

describe('revert planning', () => {
  const bookRow = (id: string) => ({
    id,
    title: 'Recipes',
    bookcase_id: 'case-1',
    floor: 1,
    slot: 0,
    spine_seed: 4,
    cover_meta: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  });

  /** The library as it stands now: which books live in which case. */
  const rowIds = (
    homes: Record<string, string>,
    pageIds: string[] = [],
    bookcaseIds: string[] = [],
  ): LibraryRowIds => {
    const counts = new Map<string, number>();
    for (const home of Object.values(homes)) {
      counts.set(home, (counts.get(home) ?? 0) + 1);
    }
    return {
      bookIds: new Set(Object.keys(homes)),
      pageIds: new Set(pageIds),
      bookcaseIds: new Set(bookcaseIds),
      bookCountByBookcase: counts,
      bookcaseOfBook: new Map(Object.entries(homes)),
    };
  };

  it('deletes only rows the import created that still exist', () => {
    const point = restorePoint({
      createdBooks: ['new1', 'gone'],
      createdPages: [
        { id: 'pg1', bookId: 'new1' },
        { id: 'pg2', bookId: 'b2' },
        { id: 'pgGone', bookId: 'b2' },
      ],
    });
    const plan = planRevert(
      point,
      rowIds({ new1: 'case-1', b2: 'case-1' }, ['pg1', 'pg2']),
    );
    expect(plan.deleteBookIds).toEqual(['new1']);
    // pg1 lives inside a book being deleted → covered by the cascade.
    expect(plan.deletePageIds).toEqual(['pg2']);
    expect(plan.missing).toEqual({ books: 1, pages: 1 });
    expect(plan.empty).toBe(false);
    expect(plan.summary.join(' ')).toMatch(/already deleted by hand/);
  });

  it('restores modified rows verbatim', () => {
    const point = restorePoint({ priorBooks: [bookRow('b2')] });
    const plan = planRevert(point, rowIds({ b2: 'case-1' }));
    expect(plan.restoreBooks[0]).toEqual(bookRow('b2'));
    expect(plan.summary[0]).toMatch(/Put back 1 row/);
  });

  it('is a no-op once everything is already gone', () => {
    const point = restorePoint({ createdBooks: ['x'], createdPages: [{ id: 'y', bookId: 'x' }] });
    const plan = planRevert(point, rowIds({}));
    expect(plan.empty).toBe(true);
    expect(plan.summary[plan.summary.length - 1]).toMatch(/Nothing left to undo/);
  });

  /*
   * Furniture the import built. The rule is not "delete what I made" but
   * "delete what I made that nobody has used since" — a case the reader has
   * shelved their own books in is theirs, whatever put it there.
   */
  it('takes down a bookcase the import built once the revert empties it', () => {
    const point = restorePoint({
      createdBooks: ['new1'],
      createdBookcases: ['case-new'],
    });
    const plan = planRevert(point, rowIds({ new1: 'case-new' }, [], ['case-1', 'case-new']));
    expect(plan.deleteBookcaseIds).toEqual(['case-new']);
    expect(plan.keptBookcaseIds).toEqual([]);
    expect(plan.summary.join(' ')).toMatch(/Take down 1 bookcase/);
  });

  it('keeps a built bookcase the reader has since shelved their own books in', () => {
    const point = restorePoint({
      createdBooks: ['new1'],
      createdBookcases: ['case-new'],
    });
    const plan = planRevert(
      point,
      rowIds({ new1: 'case-new', mine: 'case-new' }, [], ['case-1', 'case-new']),
    );
    expect(plan.deleteBookcaseIds).toEqual([]);
    expect(plan.keptBookcaseIds).toEqual(['case-new']);
    expect(plan.summary.join(' ')).toMatch(/shelved your own books there/);
  });

  it('leaves alone a built bookcase the reader has already deleted', () => {
    const point = restorePoint({ createdBookcases: ['case-gone'] });
    const plan = planRevert(point, rowIds({}, [], ['case-1']));
    expect(plan.deleteBookcaseIds).toEqual([]);
    expect(plan.empty).toBe(true);
  });

  it('a case is enough to make a revert non-empty', () => {
    const point = restorePoint({ createdBookcases: ['case-new'] });
    const plan = planRevert(point, rowIds({}, [], ['case-new']));
    expect(plan.empty).toBe(false);
    expect(plan.deleteBookcaseIds).toEqual(['case-new']);
  });

  it('puts a bookcase row back verbatim', () => {
    const row = {
      id: 'case-2',
      name: 'Kitchen',
      ord: 1,
      room: '{"theme":"reef"}',
      floors: 8,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    const plan = planRevert(restorePoint({ priorBookcases: [row] }), rowIds({}));
    expect(plan.restoreBookcases[0]).toEqual(row);
    expect(plan.empty).toBe(false);
    expect(plan.summary[0]).toMatch(/Put back 1 row/);
  });
});

describe('restore-point labels', () => {
  const now = new Date('2026-07-30T12:00:00.000Z');

  it('formats relative times', () => {
    expect(formatWhen('2026-07-30T11:59:40.000Z', now)).toBe('just now');
    expect(formatWhen('2026-07-30T11:30:00.000Z', now)).toBe('30 minutes ago');
    expect(formatWhen('2026-07-30T06:00:00.000Z', now)).toBe('6 hours ago');
    expect(formatWhen('2026-07-27T12:00:00.000Z', now)).toBe('3 days ago');
    expect(formatWhen('2026-03-12T12:00:00.000Z', now)).toBe('on 12 Mar 2026');
    expect(formatWhen('not-a-date', now)).toBe('at an unknown time');
  });

  it('describes a point for the history row', () => {
    const point = restorePoint({ createdAt: '2026-07-24T12:00:00.000Z' });
    expect(describeRestorePoint(point, now)).toBe('1 book · 3 pages · 6 days ago');
  });

  it('reports the days a point has left', () => {
    const point = restorePoint({ createdAt: '2026-07-01T12:00:00.000Z' });
    expect(expiresInDays(point, { maxAgeDays: 90, maxCount: 20 }, now)).toBe(61);
    expect(expiresInDays(point, { maxAgeDays: 0, maxCount: 20 }, now)).toBeNull();
  });
});

describe('history storage validation', () => {
  it('degrades corrupt blobs to an empty history', () => {
    expect(parseHistory(null).points).toEqual([]);
    expect(parseHistory('nonsense').points).toEqual([]);
    expect(parseHistory({ points: 'nope' }).points).toEqual([]);
    expect(parseHistory(undefined).retention).toEqual(DEFAULT_RETENTION);
  });

  it('keeps well-formed points and sorts them newest first', () => {
    const history = parseHistory({
      retention: { maxAgeDays: 365, maxCount: 50 },
      points: [
        restorePoint({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' }),
        restorePoint({ id: 'new', createdAt: '2026-07-01T00:00:00.000Z' }),
        { garbage: true },
        null,
      ],
    });
    expect(history.points.map((p) => p.id)).toEqual(['new', 'old']);
    expect(history.retention).toEqual({ maxAgeDays: 365, maxCount: 50 });
  });

  it('recovers created-page refs and drops malformed ones', () => {
    const history = parseHistory({
      points: [
        restorePoint({
          createdPages: [{ id: 'p1', bookId: 'b1' }, { bookId: 'b1' }, 'nope'] as never,
        }),
      ],
    });
    expect(history.points[0].createdPages).toEqual([{ id: 'p1', bookId: 'b1' }]);
  });

  it('never throws on arbitrary stored values', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(() => parseHistory(value)).not.toThrow();
      }),
      { numRuns: 150 },
    );
  });
});

// ---------------------------------------------------------------------------
// End-to-end (pure): export → archive → re-open → import plan
// ---------------------------------------------------------------------------

describe('bundle round trip', () => {
  it('survives zip → unzip → parse with every page intact', async () => {
    const snapshot = library();
    const plan = buildExportPlan(snapshot, allPages(snapshot), OPTIONS);
    const bundle = buildBundleFiles({
      snapshot,
      plan,
      options: OPTIONS,
      label: 'The whole library',
      createdAt: '2026-07-30T09:00:00.000Z',
      appVersion: '0.1.0',
    });

    const archive = zipStore(bundle.entries);
    const back = await unzip(archive);
    expect(back.warnings).toEqual([]);

    const manifest = parseManifest(bytesToText(back.files.get('manifest.json')!)).manifest;
    expect(manifest).not.toBeNull();
    expect(manifest!.counts).toEqual({ books: 2, pages: 5, assets: 1 });

    // Every page body is present and matches its recorded checksum.
    const inventory: Array<{ path: string; checksum: string }> = [];
    for (const manifestBook of manifest!.books) {
      for (const manifestPage of manifestBook.pages) {
        const body = back.files.get(manifestPage.file);
        expect(body).toBeDefined();
        inventory.push({ path: manifestPage.file, checksum: checksumText(bytesToText(body!)) });
      }
    }
    for (const asset of manifest!.assets) {
      inventory.push({ path: asset.file, checksum: String(asset.bytes) });
    }
    expect(verifyBundleChecksum(manifest!, inventory).ok).toBe(true);

    // Re-importing into the same library flags every book as already known.
    const importPlan = buildImportPlan(manifest!, buildLibraryIndex(snapshot), {
      pages: selectAllPages(manifest!),
      resolutions: new Map(),
    });
    expect(importPlan.books.every((b) => b.conflict === 'same-id')).toBe(true);
    expect(importPlan.counts.newBooks).toBe(2);
    expect(importPlan.counts.pages).toBe(5);
  });

  it('a tampered body is detected by the checksum', async () => {
    const snapshot = library();
    const plan = buildExportPlan(snapshot, allPages(snapshot), OPTIONS);
    const bundle = buildBundleFiles({
      snapshot,
      plan,
      options: OPTIONS,
      label: 'x',
      createdAt: '2026-07-30T09:00:00.000Z',
      appVersion: '0.1.0',
    });
    const tampered = bundle.entries.map((entry) =>
      entry.path.endsWith('001-cell-biology.nbs')
        ? { path: entry.path, bytes: textToBytes('# Hacked\n') }
        : entry,
    );
    const back = await unzip(zipStore(tampered));
    const manifest = parseManifest(bytesToText(back.files.get('manifest.json')!)).manifest!;
    const inventory = manifest.books.flatMap((b) =>
      b.pages.map((p) => ({
        path: p.file,
        checksum: checksumText(bytesToText(back.files.get(p.file)!)),
      })),
    );
    inventory.push(...manifest.assets.map((a) => ({ path: a.file, checksum: String(a.bytes) })));
    expect(verifyBundleChecksum(manifest, inventory).ok).toBe(false);
  });
});
