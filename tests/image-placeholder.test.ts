import { describe, expect, it, vi } from 'vitest';

import {
  buildWelcomePageDocs,
  welcomePageTitles,
} from '../src/data/seed';
import {
  IMAGE_PLACEHOLDER_ATTRIBUTE,
  imagePlaceholderPrompt,
  persistPlaceholderImage,
} from '../src/editor/media/imagePlaceholder';
import {
  IMAGE_ASSET_REL_PATH_ATTRIBUTE,
  inferAssetRelPathFromSrc,
  rebasePageAssetSources,
} from '../src/editor/media/portableAssets';
import { assetSrcFromRoot } from '../src/editor/media/resolver';
import { docToScript } from '../src/editor/script/fromTiptap';
import { NOTEBOOK_SCRIPT_SPEC } from '../src/editor/script/spec';
import { scriptDocToTiptap } from '../src/editor/script/toTiptap';
import { parse, print, type ImageBlock } from '../src/script';
import { buildBundleFiles } from '../src/features/transfer/bundle';
import {
  pageSnapshotForTransfer,
  prepareImportedPageDoc,
} from '../src/features/transfer/pagePortability';
import {
  buildExportPlan,
  type ExportOptions,
  type LibrarySnapshot,
} from '../src/features/transfer/scope';
import { bytesToText } from '../src/features/transfer/zip';

const PLACEHOLDER =
  '![A labelled plant-cell diagram](){placeholder="upload a labelled plant-cell diagram", caption="Cell anatomy", style=polaroid}';
const CANONICAL_PLACEHOLDER =
  '![A labelled plant-cell diagram](){caption="Cell anatomy", placeholder="upload a labelled plant-cell diagram", style=polaroid}\n';

function parsedImage(source = PLACEHOLDER): ImageBlock {
  const block = parse(source).blocks[0];
  if (block?.kind !== 'image') throw new Error('expected an image block');
  return block;
}

describe('AI-authored image placeholders', () => {
  it('keeps the shipped Welcome photographs as real image-row nodes', () => {
    const index = welcomePageTitles().indexOf('Pictures, starring kittens');
    const page = buildWelcomePageDocs()[index]?.doc;
    const row = page?.content?.find((block) => block.type === 'imageRow');

    expect(index).toBeGreaterThanOrEqual(0);
    expect(row).toMatchObject({
      type: 'imageRow',
      content: [
        { type: 'image', attrs: { src: '/kittens/ginger.svg' } },
        { type: 'image', attrs: { src: '/kittens/asleep.svg' } },
        { type: 'image', attrs: { src: '/kittens/in-a-box.svg' } },
      ],
    });
  });

  it('treats a declared empty-src image as intentional', () => {
    const doc = parse(PLACEHOLDER);
    const image = parsedImage();

    expect(doc.diagnostics.map((diag) => diag.code)).not.toContain(
      'image-missing-src',
    );
    expect(image).toMatchObject({
      src: '',
      alt: 'A labelled plant-cell diagram',
      attrs: {
        placeholder: 'upload a labelled plant-cell diagram',
        caption: 'Cell anatomy',
        style: 'polaroid',
      },
    });
    expect(print(doc)).toBe(CANONICAL_PLACEHOLDER);
  });

  it('still warns for a genuinely incomplete empty image', () => {
    const doc = parse('![A missing picture]()');
    expect(doc.diagnostics.map((diag) => diag.code)).toContain(
      'image-missing-src',
    );
  });

  it('applies the same empty-source rule to compact image-row entries', () => {
    const intentional = parse(
      '::: image-row\nimage: | alt="A sketch" placeholder="add your sketch"\n:::',
    );
    const incomplete = parse('::: image-row\nimage: | alt="A sketch"\n:::');

    expect(intentional.diagnostics.map((diag) => diag.code)).not.toContain(
      'image-missing-src',
    );
    expect(incomplete.diagnostics.map((diag) => diag.code)).toContain(
      'image-missing-src',
    );
  });

  it('maps the prompt and presentation onto persistent image-node attrs', () => {
    const json = scriptDocToTiptap(parse(PLACEHOLDER), {
      hasNode: () => true,
    });
    const image = json.content?.[0] as {
      type: string;
      attrs: Record<string, unknown>;
    };

    expect(image).toEqual({
      type: 'image',
      attrs: {
        src: '',
        alt: 'A labelled plant-cell diagram',
        placeholder: 'upload a labelled plant-cell diagram',
        caption: 'Cell anatomy',
        frame: 'polaroid',
      },
    });

    expect(
      IMAGE_PLACEHOLDER_ATTRIBUTE.renderHTML(image.attrs),
    ).toEqual({
      'data-image-placeholder': 'upload a labelled plant-cell diagram',
    });
  });

  it('exports a stored placeholder back into the friendly script contract', () => {
    const script = docToScript({
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: {
            src: '',
            alt: 'A labelled plant-cell diagram',
            placeholder: 'upload a labelled plant-cell diagram',
            caption: 'Cell anatomy',
            frame: 'polaroid',
          },
        },
      ],
    });

    expect(script).toBe(CANONICAL_PLACEHOLDER);
    expect(parse(script).diagnostics.map((diag) => diag.code)).not.toContain(
      'image-missing-src',
    );
  });

  it('round-trips Markdown-sensitive image alt text through the shared escape', () => {
    const alt = 'A closing ] and slash \\ on line 1\nline 2';
    const script = docToScript({
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: {
            src: 'https://example.test/field-note.png',
            alt,
          },
        },
      ],
    });

    const parsed = parse(script);
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0]).toMatchObject({
      kind: 'image',
      alt,
      src: 'https://example.test/field-note.png',
    });
    expect(script.trimEnd().split('\n')).toHaveLength(1);
    expect(
      scriptDocToTiptap(parsed, { hasNode: () => true }).content?.[0],
    ).toMatchObject({
      type: 'image',
      attrs: { alt },
    });

    // Before alt escaping existed, a literal trailing backslash was printed
    // directly before the closing bracket. Keep those saved scripts readable.
    expect(
      parse('![Legacy trailing \\](https://example.test/legacy.png)').blocks[0],
    ).toMatchObject({
      kind: 'image',
      alt: 'Legacy trailing \\',
      src: 'https://example.test/legacy.png',
    });
  });

  it('turns malformed raw media URLs into missing media before requesting them', () => {
    for (const source of [
      'week-6-100%.png',
      'https://example.test/%E0%A4',
    ]) {
      const converted = scriptDocToTiptap(
        parse(`![unsafe source](${source})`),
        { hasNode: () => true },
      );
      expect(converted.content?.[0]).toMatchObject({
        type: 'image',
        attrs: { src: '' },
      });
    }
    expect(scriptDocToTiptap(
      parse('![safe source](images/week%206.png)'),
      { hasNode: () => true },
    ).content?.[0]).toMatchObject({
      type: 'image',
      attrs: { src: 'images/week%206.png' },
    });
  });

  it('degrades to readable instructions when the media node is unavailable', () => {
    const json = scriptDocToTiptap(parse(PLACEHOLDER), {
      hasNode: (name) => name !== 'image',
    });

    expect(json.content).toEqual([
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text:
              '[Image to add: upload a labelled plant-cell diagram (A labelled plant-cell diagram) — Cell anatomy]',
          },
        ],
      },
    ]);
  });

  it('degrades placeholders inside image rows instead of creating an invalid row', () => {
    const source = `::: image-row\n${PLACEHOLDER}\n:::`;
    const json = scriptDocToTiptap(parse(source), {
      hasNode: (name) => name !== 'image',
    });

    expect((json.content?.[0] as { type?: string }).type).toBe('paragraph');
    expect(JSON.stringify(json)).toContain('upload a labelled plant-cell diagram');
    expect(JSON.stringify(json)).not.toContain('imageRow');
  });

  it('persists one image and clears only placeholder state', async () => {
    const store = vi.fn().mockResolvedValue({
      src: 'asset://images/cell.png',
      relPath: 'images/cell.png',
    });
    const file = { type: 'image/png' } as File;

    const original = {
      src: '',
      alt: 'A labelled cell',
      placeholder: 'upload a cell diagram',
      caption: 'Cell anatomy',
      frame: 'polaroid',
      widthPct: 72,
    };
    const patch = await persistPlaceholderImage(file, store);

    expect(patch).toEqual({
      src: 'asset://images/cell.png',
      assetRelPath: 'images/cell.png',
      placeholder: null,
    });
    expect({ ...original, ...patch }).toEqual({
      ...original,
      src: 'asset://images/cell.png',
      assetRelPath: 'images/cell.png',
      placeholder: null,
    });
    expect(store).toHaveBeenCalledWith(file);
    expect(
      imagePlaceholderPrompt({
        src: 'asset://images/cell.png',
        placeholder: 'upload a cell diagram',
      }),
    ).toBeNull();
  });

  it('round-trips the durable image path separately from its display URL', () => {
    const rootSpecific =
      'http://asset.localhost/C%3A/Library%20A/assets/images/cell.png';
    const script = docToScript({
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: {
            src: rootSpecific,
            assetRelPath: 'images/cell.png',
            alt: 'A labelled cell',
            caption: 'Cell anatomy',
            frame: 'polaroid',
            widthPct: 72,
            align: 'right',
            rotate: 2,
            tape: 'corner',
          },
        },
      ],
    });

    expect(script).not.toContain('Library%20A');
    expect(script).toContain('asset=images/cell.png');
    expect(script).toContain('width=72');
    const imported = scriptDocToTiptap(parse(script), { hasNode: () => true });
    expect(imported.content?.[0]).toMatchObject({
      type: 'image',
      attrs: {
        src: '',
        assetRelPath: 'images/cell.png',
        alt: 'A labelled cell',
        caption: 'Cell anatomy',
        frame: 'polaroid',
        widthPct: 72,
        align: 'right',
        rotate: 2,
        tape: 'corner',
      },
    });
    expect(
      IMAGE_ASSET_REL_PATH_ATTRIBUTE.renderHTML({
        assetRelPath: 'images/cell.png',
      }),
    ).toEqual({ 'data-asset-rel-path': 'images/cell.png' });
    expect(
      imagePlaceholderPrompt({
        src: '',
        assetRelPath: 'images/cell.png',
        placeholder: 'stale prompt',
      }),
    ).toBeNull();
  });

  it('migrates only legacy local-asset URLs and rebases them to the active root', async () => {
    const legacy =
      'http://asset.localhost/C%3A/Library%20A/assets/images/legacy.png';
    const remote = 'https://example.com/assets/remote.png';
    const data = 'data:image/png;base64,AA==';
    const doc = {
      type: 'doc' as const,
      content: [
        { type: 'image', attrs: { src: legacy, alt: 'legacy', caption: 'kept' } },
        { type: 'image', attrs: { src: remote, alt: 'remote' } },
        { type: 'image', attrs: { src: data, alt: 'inline' } },
      ],
    };
    const resolver = vi.fn(async (relPath: string) =>
      assetSrcFromRoot('D:/Library B/assets', relPath),
    );

    expect(inferAssetRelPathFromSrc(legacy)).toBe('images/legacy.png');
    expect(
      inferAssetRelPathFromSrc(
        'C:\\Library A\\assets\\images\\legacy-windows.png',
      ),
    ).toBe('images/legacy-windows.png');
    expect(
      inferAssetRelPathFromSrc(
        '\\\\archive-server\\Alcove\\assets\\images\\legacy-unc.png',
      ),
    ).toBe('images/legacy-unc.png');
    expect(inferAssetRelPathFromSrc(remote)).toBeNull();
    const rebased = await rebasePageAssetSources(doc, resolver);
    expect(rebased.changed).toBe(true);
    expect(rebased.doc.content?.[0]).toMatchObject({
      attrs: {
        src: 'D:/Library B/assets/images/legacy.png',
        assetRelPath: 'images/legacy.png',
        alt: 'legacy',
        caption: 'kept',
      },
    });
    expect(rebased.doc.content?.[1]).toEqual(doc.content[1]);
    expect(rebased.doc.content?.[2]).toEqual(doc.content[2]);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    'moves a filled placeholder from root A through a %s-lossless bundle into root B',
    async (losslessDocs) => {
      const relPath = 'images/cell-content-hash.png';
      const rootA =
        'http://asset.localhost/C%3A/Library%20A/assets/images/cell-content-hash.png';
      const page = {
        id: 'page-a',
        bookId: 'book-a',
        ord: 0,
        doc: {
          type: 'doc' as const,
          content: [
            {
              type: 'image',
              attrs: {
                src: rootA,
                assetRelPath: relPath,
                alt: 'A labelled cell',
                caption: 'Cell anatomy',
                frame: 'polaroid',
                widthPct: 68,
                align: 'left',
                rotate: -2,
                tape: 'corner',
              },
            },
          ],
        },
        scriptSource: '# stale source from root A\n',
        sourceDirty: false,
        updatedAt: '2026-08-10T00:00:00.000Z',
      };
      const pageSnapshot = pageSnapshotForTransfer(page, 0);
      const snapshot: LibrarySnapshot = {
        bookcases: [],
        books: [
          {
            id: 'book-a',
            title: 'Portable pictures',
            bookcaseId: null,
            floor: 0,
            slot: 0,
            spineSeed: 17,
            coverMeta: null,
            createdAt: page.updatedAt,
            updatedAt: page.updatedAt,
            pages: [pageSnapshot],
          },
        ],
        assets: [
          {
            id: 'asset-a',
            relPath,
            kind: 'image',
            meta: { bytes: 4 },
            bytes: 4,
          },
        ],
        theme: null,
      };
      const options: ExportOptions = {
        includeAssets: true,
        includeCoverStyling: true,
        includeLibraryTheme: false,
        losslessDocs,
        variant: 'bundle',
        layout: 'per-page',
      };
      const selection = new Set(['page-a']);
      const plan = buildExportPlan(snapshot, selection, options);
      const assetBytes = Uint8Array.from([1, 3, 3, 7]);
      const built = buildBundleFiles({
        snapshot,
        plan,
        options,
        label: 'Portable pictures',
        createdAt: page.updatedAt,
        appVersion: 'test',
        assetBytes: new Map([[relPath, assetBytes]]),
      });

      const pageEntry = built.entries.find((entry) =>
        entry.path.startsWith('pages/'),
      );
      const body = pageEntry === undefined ? '' : bytesToText(pageEntry.bytes);
      expect(body).toContain(`asset=${relPath}`);
      expect(body).not.toContain('Library%20A');
      expect(
        built.entries.find((entry) => entry.path === `assets/${relPath}`)?.bytes,
      ).toEqual(assetBytes);

      let importedDoc;
      if (losslessDocs) {
        const docEntry = built.entries.find((entry) =>
          entry.path.startsWith('docs/'),
        );
        expect(docEntry).toBeDefined();
        const exportedJson = bytesToText(docEntry!.bytes);
        expect(exportedJson).not.toContain('Library%20A');
        importedDoc = JSON.parse(exportedJson);
      } else {
        importedDoc = scriptDocToTiptap(parse(body), { hasNode: () => true });
      }

      const rootB = 'D:/Library B/assets';
      const imported = await prepareImportedPageDoc(
        importedDoc,
        async (path) => assetSrcFromRoot(rootB, path),
      );
      const image = imported.content?.[0] as {
        attrs: Record<string, unknown>;
      };
      expect(image.attrs).toMatchObject({
        src: `${rootB}/${relPath}`,
        assetRelPath: relPath,
        alt: 'A labelled cell',
        caption: 'Cell anatomy',
        frame: 'polaroid',
        widthPct: 68,
        align: 'left',
        rotate: -2,
        tape: 'corner',
      });
      expect(JSON.stringify(imported)).not.toContain('Library%20A');
    },
  );

  it.each([true, false])(
    'moves local video from root A through a %s-lossless bundle into root B',
    async (losslessDocs) => {
      const relPath = 'videos/field-note.mp4';
      const rootA =
        'http://asset.localhost/C%3A/Library%20A/assets/videos/field-note.mp4';
      const updatedAt = '2026-08-10T00:00:00.000Z';
      const pageSnapshot = pageSnapshotForTransfer(
        {
          id: 'page-video',
          bookId: 'book-video',
          ord: 0,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'video',
                attrs: {
                  src: rootA,
                  assetRelPath: relPath,
                  caption: 'A field recording',
                  widthPct: 74,
                  align: 'right',
                },
              },
            ],
          },
          scriptSource: '# stale source from root A\n',
          sourceDirty: false,
          updatedAt,
        },
        0,
      );
      const snapshot: LibrarySnapshot = {
        bookcases: [],
        books: [
          {
            id: 'book-video',
            title: 'Portable video',
            bookcaseId: null,
            floor: 0,
            slot: 0,
            spineSeed: 23,
            coverMeta: null,
            createdAt: updatedAt,
            updatedAt,
            pages: [pageSnapshot],
          },
        ],
        assets: [
          {
            id: 'asset-video',
            relPath,
            kind: 'video',
            meta: { bytes: 5 },
            bytes: 5,
          },
        ],
        theme: null,
      };
      const options: ExportOptions = {
        includeAssets: true,
        includeCoverStyling: true,
        includeLibraryTheme: false,
        losslessDocs,
        variant: 'bundle',
        layout: 'per-page',
      };
      const plan = buildExportPlan(snapshot, new Set(['page-video']), options);
      const assetBytes = Uint8Array.from([9, 8, 7, 6, 5]);
      const built = buildBundleFiles({
        snapshot,
        plan,
        options,
        label: 'Portable video',
        createdAt: updatedAt,
        appVersion: 'test',
        assetBytes: new Map([[relPath, assetBytes]]),
      });

      const pageEntry = built.entries.find((entry) =>
        entry.path.startsWith('pages/'),
      );
      const body = pageEntry === undefined ? '' : bytesToText(pageEntry.bytes);
      expect(body).toContain('media=video');
      expect(body).toContain(`asset=${relPath}`);
      expect(body).not.toContain('Library%20A');
      expect(
        built.entries.find((entry) => entry.path === `assets/${relPath}`)?.bytes,
      ).toEqual(assetBytes);

      let importedDoc;
      if (losslessDocs) {
        const docEntry = built.entries.find((entry) =>
          entry.path.startsWith('docs/'),
        );
        expect(docEntry).toBeDefined();
        const exportedJson = bytesToText(docEntry!.bytes);
        expect(exportedJson).not.toContain('Library%20A');
        importedDoc = JSON.parse(exportedJson);
      } else {
        importedDoc = scriptDocToTiptap(parse(body), { hasNode: () => true });
      }

      const rootB = 'D:/Library B/assets';
      const imported = await prepareImportedPageDoc(
        importedDoc,
        async (path) => assetSrcFromRoot(rootB, path),
      );
      expect(imported.content?.[0]).toMatchObject({
        type: 'video',
        attrs: {
          src: `${rootB}/${relPath}`,
          assetRelPath: relPath,
          caption: 'A field recording',
          widthPct: 74,
          align: 'right',
        },
      });
      expect(JSON.stringify(imported)).not.toContain('Library%20A');
    },
  );

  it('does not invent a visible caption for an uncaptained video', () => {
    const relPath = 'videos/uncaptained.mp4';
    const script = docToScript({
      type: 'doc',
      content: [
        {
          type: 'video',
          attrs: {
            src: 'C:/Library A/assets/videos/uncaptained.mp4',
            assetRelPath: relPath,
            caption: null,
          },
        },
      ],
    });

    expect(script).not.toContain('Video');
    const parsed = parse(script);
    expect(parsed.blocks[0]).toMatchObject({
      kind: 'image',
      alt: '',
      attrs: { asset: relPath, media: 'video' },
    });

    const imported = scriptDocToTiptap(parsed, { hasNode: () => true });
    const video = imported.content?.[0] as {
      type: string;
      attrs: Record<string, unknown>;
    };
    expect(video).toMatchObject({
      type: 'video',
      attrs: { src: '', assetRelPath: relPath },
    });
    expect(video.attrs).not.toHaveProperty('caption');
  });

  it('round-trips bracketed, multiline video captions without losing the node', () => {
    const caption = 'A [field] recording]\nsecond \\ take';
    const relPath = 'videos/complex-caption.mp4';
    const script = docToScript({
      type: 'doc',
      content: [
        {
          type: 'video',
          attrs: {
            src: 'C:/Library A/assets/videos/complex-caption.mp4',
            assetRelPath: relPath,
            caption,
            widthPct: 74,
          },
        },
      ],
    });

    // Control characters stay escaped on one physical Script line.
    expect(script.trimEnd().split('\n')).toHaveLength(1);
    expect(script).toContain('\\]');
    expect(script).toContain('\\n');
    const parsed = parse(script);
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0]).toMatchObject({
      kind: 'image',
      alt: caption,
      attrs: { asset: relPath, media: 'video', width: 74 },
    });

    expect(
      scriptDocToTiptap(parsed, { hasNode: () => true }).content?.[0],
    ).toMatchObject({
      type: 'video',
      attrs: {
        src: '',
        assetRelPath: relPath,
        caption,
        widthPct: 74,
      },
    });
  });

  it('ships only selected-page asset bytes, deduplicates references, and honours exclusion', () => {
    const updatedAt = '2026-08-10T00:00:00.000Z';
    const selectedRelPath = 'images/selected.png';
    const selectedVideoRelPath = 'images/selected-video.mp4';
    const selectedStickerRelPath = 'images/study-owl.svg';
    const privateRelPath = 'images/private.png';
    const unusedRelPath = 'images/unused.png';
    const selectedPage = pageSnapshotForTransfer(
      {
        id: 'selected-page',
        bookId: 'book-a',
        ord: 0,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'image',
              attrs: {
                src: '',
                assetRelPath: selectedRelPath,
                alt: 'selected current reference',
              },
            },
            {
              type: 'image',
              attrs: {
                src:
                  'http://asset.localhost/C%3A/Library%20A/assets/images/selected.png',
                alt: 'the same selected asset through a legacy URL',
              },
            },
            {
              type: 'video',
              attrs: {
                src:
                  'http://asset.localhost/C%3A/Library%20A/assets/images/selected-video.mp4',
              },
            },
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Selected sticker' },
                { type: 'sticker', attrs: { stickerId: 'user:study-owl' } },
              ],
            },
          ],
        },
        scriptSource: null,
        sourceDirty: false,
        updatedAt,
      },
      0,
    );
    const unselectedPage = pageSnapshotForTransfer(
      {
        id: 'private-page',
        bookId: 'book-a',
        ord: 1,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'image',
              attrs: {
                src: '',
                assetRelPath: privateRelPath,
                alt: 'private unselected reference',
              },
            },
          ],
        },
        scriptSource: null,
        sourceDirty: false,
        updatedAt,
      },
      1,
    );
    const snapshot: LibrarySnapshot = {
      bookcases: [],
      books: [
        {
          id: 'book-a',
          title: 'Selected pictures',
          bookcaseId: null,
          floor: 0,
          slot: 0,
          spineSeed: 31,
          coverMeta: null,
          createdAt: updatedAt,
          updatedAt,
          pages: [selectedPage, unselectedPage],
        },
      ],
      assets: [
        { relPath: selectedRelPath, kind: 'image', meta: { bytes: 1 } },
        { relPath: selectedVideoRelPath, kind: 'video', meta: { bytes: 2 } },
        {
          relPath: selectedStickerRelPath,
          kind: 'image',
          meta: { bytes: 3, customSticker: 'study-owl' },
        },
        { relPath: privateRelPath, kind: 'image', meta: { bytes: 4 } },
        { relPath: unusedRelPath, kind: 'image', meta: { bytes: 5 } },
      ].map((asset, index) => ({
        id: `asset-${index}`,
        ...asset,
        bytes: index + 1,
      })),
      theme: null,
    };
    const baseOptions: ExportOptions = {
      includeAssets: true,
      includeCoverStyling: true,
      includeLibraryTheme: false,
      losslessDocs: true,
      variant: 'bundle',
      layout: 'per-page',
    };
    const selectedIds = new Set([selectedPage.id]);
    const plan = buildExportPlan(snapshot, selectedIds, baseOptions);

    const selectedAssetPaths = [
      selectedRelPath,
      selectedVideoRelPath,
      selectedStickerRelPath,
    ];
    expect(plan.assets.map((asset) => asset.relPath)).toEqual(selectedAssetPaths);
    expect(plan.counts.assets).toBe(3);

    const bytes = new Map<string, Uint8Array>([
      [selectedRelPath, Uint8Array.from([1, 2, 3])],
      [selectedVideoRelPath, Uint8Array.from([2, 3, 4])],
      [selectedStickerRelPath, Uint8Array.from([3, 4, 5])],
      [privateRelPath, Uint8Array.from([4, 5, 6])],
      [unusedRelPath, Uint8Array.from([7, 8, 9])],
    ]);
    const built = buildBundleFiles({
      snapshot,
      plan,
      options: baseOptions,
      label: 'Selected pictures',
      createdAt: updatedAt,
      appVersion: 'test',
      assetBytes: bytes,
    });
    expect(built.manifest.assets.map((asset) => asset.relPath)).toEqual(
      selectedAssetPaths,
    );
    expect(
      built.entries
        .filter((entry) => entry.path.startsWith('assets/'))
        .map((entry) => entry.path),
    ).toEqual(selectedAssetPaths.map((relPath) => `assets/${relPath}`));
    expect(
      built.entries.find((entry) => entry.path === `assets/${selectedRelPath}`)
        ?.bytes,
    ).toEqual(bytes.get(selectedRelPath));

    const withoutAssets = buildExportPlan(snapshot, selectedIds, {
      ...baseOptions,
      includeAssets: false,
    });
    expect(withoutAssets.assets).toEqual([]);
    expect(withoutAssets.counts.assets).toBe(0);
  });

  it('rejects non-image drops before writing an asset', async () => {
    const store = vi.fn();
    const file = { type: 'text/plain' } as File;

    await expect(persistPlaceholderImage(file, store)).rejects.toThrow(
      'accepts one image file',
    );
    expect(store).not.toHaveBeenCalled();
  });

  it('teaches assistants the click-or-drop placeholder syntax', () => {
    expect(NOTEBOOK_SCRIPT_SPEC).toContain('Images the reader will supply');
    expect(NOTEBOOK_SCRIPT_SPEC).toContain(
      'placeholder="upload a labelled plant-cell diagram"',
    );
    expect(NOTEBOOK_SCRIPT_SPEC).toContain('click it or drop **one image**');
    expect(NOTEBOOK_SCRIPT_SPEC).toContain('intended page role, orientation');
    expect(NOTEBOOK_SCRIPT_SPEC).toContain('aspect ratio and approximate pixel size');
  });
});
