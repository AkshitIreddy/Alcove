import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/editor/extensions', async () => {
  const { default: StarterKit } = await import('@tiptap/starter-kit');
  return { createEditorExtensions: () => [StarterKit] };
});
import type { AiAttachmentData, AiAttachmentMetadata } from '../src/data/aiGateway';
import type { ReviewedDraftReceiptStore } from '../src/data/aiAgentReviewedDraft';
import { getDb } from '../src/data/db';
import {
  missingFetchedImageAssetIds,
  recordAssetRow,
  rollbackFetchedImageAssetPromotions,
  type FetchedImageAssetReceipt,
} from '../src/editor/media/assets';
import type { AgentHashAdapter } from '../src/features/aiAgent/adapters';
import {
  createProductionDraftSandbox,
  pageDocIsMeaningful,
  type DraftGenerationMetadataStore,
  type DraftPreviewAssetStore,
  type StoredDraftGeneration,
} from '../src/features/aiAgent/draftSandbox';
import {
  prepareAiProposalPages,
  verifyPreparedAiProposalDocuments,
} from '../src/features/aiAgent/prepareProposal';
import { buildIntegratedTargetDocument } from '../src/features/aiAgent/integratedTarget';
import type { ReviewedDraftReceipt } from '../src/features/aiAgent/reviewedReceipt';
import type {
  NotebookDraft,
  NotebookSnapshotRef,
} from '../src/features/aiAgent/types';

const NOW = '2026-08-12T12:00:00.000Z';

const hash: AgentHashAdapter = {
  digestText: async (text) => `text:${text.length}:${text}`,
  digestJson: async (value) => `json:${JSON.stringify(value)}`,
};

function generationStore(): DraftGenerationMetadataStore {
  const values = new Map<string, StoredDraftGeneration>();
  return {
    get: (id) => values.get(id) ?? null,
    put: (value) => values.set(value.generation.generationId, value),
    delete: (id) => {
      values.delete(id);
    },
    list: () => [...values.values()],
  };
}

function receiptStore(): ReviewedDraftReceiptStore {
  const values = new Map<string, ReviewedDraftReceipt>();
  return {
    get: async (id) => values.get(id) ?? null,
    put: async (receipt) => {
      values.set(receipt.generationId, receipt);
    },
    delete: async (id) => {
      values.delete(id);
    },
  };
}

function assetStore(): DraftPreviewAssetStore & { readonly deleted: string[] } {
  const values = new Map<string, AiAttachmentData>();
  const deleted: string[] = [];
  return {
    deleted,
    async save(bytes) {
      const identity = [...bytes].join('-');
      const metadata: AiAttachmentMetadata = {
        id: `asset-${identity}`,
        kind: 'png',
        mimeType: 'image/png',
        sizeBytes: bytes.byteLength,
        sha256: `digest-${identity}`,
      };
      values.set(metadata.id, { metadata, bytes: [...bytes] });
      return metadata;
    },
    async read(id) {
      const value = values.get(id);
      if (value === undefined) throw new Error('missing test asset');
      return value;
    },
    async delete(id) {
      deleted.push(id);
      return values.delete(id);
    },
  };
}

function draft(script: string): NotebookDraft {
  return {
    runId: 'run-1',
    version: 1,
    script,
    draftHash: `text:${script.length}:${script}`,
    createdAt: NOW,
  };
}

const snapshot: NotebookSnapshotRef = {
  bookId: 'book-1',
  bookRevision: 'book-revision-1',
  pageIds: ['existing-1', 'existing-2'],
  pageRevisions: {
    'existing-1': 'page-revision-1',
    'existing-2': 'page-revision-2',
  },
  capturedAt: NOW,
};

const renderContext = {
  bookSnapshot: snapshot,
  insertionTarget: { kind: 'book_end' as const },
  signal: new AbortController().signal,
};

describe('production AI draft sandbox', () => {
  it('rolls back only asset rows newly promoted by an abandoned apply', async () => {
    const asset = (id: string): FetchedImageAssetReceipt => ({
      id,
      relPath: `images/${id}.png`,
      url: `https://images.example/${id}`,
      thumbUrl: null,
      attribution: 'Test artist',
      license: 'CC0',
      sha256: `sha-${id}`,
      sizeBytes: 123,
      provider: 'test',
      query: 'test',
    });
    const existing = asset('ai-existing-reviewed-asset');
    const created = asset('ai-new-reviewed-asset');
    await recordAssetRow(existing.id, existing.relPath);
    const missing = await missingFetchedImageAssetIds([existing, created]);
    expect(missing).toEqual([created.id]);
    await recordAssetRow(created.id, created.relPath);

    await rollbackFetchedImageAssetPromotions([existing, created], missing);
    const db = await getDb();
    expect(await db.select<Array<{ id: string }>>(
      'SELECT id FROM assets WHERE id = $1 LIMIT 1',
      [existing.id],
    )).toHaveLength(1);
    expect(await db.select<Array<{ id: string }>>(
      'SELECT id FROM assets WHERE id = $1 LIMIT 1',
      [created.id],
    )).toHaveLength(0);
  });

  it('removes receipt, generation metadata and render bytes when cancellation races publication', async () => {
    const controller = new AbortController();
    const assets = assetStore();
    const generations = generationStore();
    const values = new Map<string, ReviewedDraftReceipt>();
    const deletedReceipts: string[] = [];
    const receipts: ReviewedDraftReceiptStore = {
      get: async (id) => values.get(id) ?? null,
      put: async (receipt) => {
        values.set(receipt.generationId, receipt);
        controller.abort();
      },
      delete: async (id) => {
        deletedReceipts.push(id);
        values.delete(id);
      },
    };
    const sandbox = createProductionDraftSandbox({
      hash,
      now: () => NOW,
      assets,
      generations,
      receipts,
      hasNode: () => true,
      resolveFetches: async (doc) => doc,
      renderPages: async ({ pages }) => [{
        doc: pages[0]!.doc,
        pngBytes: new Uint8Array([91, 92]),
        width: 100,
        height: 200,
        producedOverflow: false,
        diagnostics: [],
      }],
    });

    await expect(sandbox.adapter.render(draft('# Cancelled publication'), {
      ...renderContext,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(generations.list()).toEqual([]);
    expect(values.size).toBe(0);
    expect(deletedReceipts).toHaveLength(1);
    expect(assets.deleted).toEqual(['asset-91-92']);
  });

  it('accepts exact settled structural docs and rejects post-review pagination changes', async () => {
    const reviewed = [{
      source: '# Reviewed',
      doc: {
        type: 'doc' as const,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Exact page' }] }],
      },
      protectedStart: true,
    }];
    await expect(verifyPreparedAiProposalDocuments({
      pageIds: ['installed-1'],
      pages: reviewed,
      readPageDoc: () => reviewed[0]!.doc,
      hash,
    })).resolves.toBeUndefined();
    await expect(verifyPreparedAiProposalDocuments({
      pageIds: ['installed-1'],
      pages: reviewed,
      readPageDoc: () => ({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Moved later' }] }],
      }),
      hash,
    })).rejects.toThrow('changed while the exact reviewed application was settling');
  });

  it('renders and receipts the exact integrated selection result, not a standalone fragment', async () => {
    const receipts = receiptStore();
    const targetDoc = {
      type: 'doc' as const,
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Original surrounding sentence.' }],
      }],
    };
    const selectionTarget = {
      kind: 'replace_selection' as const,
      pageId: 'existing-1',
      from: 1,
      to: 9,
      selectionDigest: 'selection-anchor',
    };
    const integratedContext = {
      bookSnapshot: snapshot,
      insertionTarget: selectionTarget,
      targetPage: {
        pageId: 'existing-1',
        revision: 'page-revision-1',
        documentDigest: await hash.digestJson(targetDoc),
        doc: targetDoc,
      },
      signal: new AbortController().signal,
    };
    const sandbox = createProductionDraftSandbox({
      hash,
      now: () => NOW,
      assets: assetStore(),
      generations: generationStore(),
      receipts,
      hasNode: () => true,
      resolveFetches: async (doc) => doc,
      renderPages: async ({ pages, targetPage, insertionTarget }) => {
        if (
          targetPage === undefined ||
          (insertionTarget.kind !== 'caret' && insertionTarget.kind !== 'replace_selection')
        ) throw new Error('missing integrated target');
        const doc = await buildIntegratedTargetDocument({
          targetDoc: targetPage.doc,
          draftDoc: pages[0]!.doc,
          target: insertionTarget,
        });
        return [{
          doc,
          pngBytes: new Uint8Array([31]),
          width: 100,
          height: 200,
          producedOverflow: false,
          diagnostics: [],
        }];
      },
    });
    const replacement = draft('A much warmer opening');
    const generation = await sandbox.adapter.render(replacement, integratedContext);
    const receipt = await receipts.get(generation.generationId);

    expect(receipt?.applicationPlan).toMatchObject({
      kind: 'integrated_target',
      targetPageId: 'existing-1',
      expectedTargetDocumentDigest: await hash.digestJson(targetDoc),
      targetPageIndex: 0,
      insertedPageStartIndex: 1,
    });
    expect(receipt?.pages[0]?.protectedStart).toBe(false);
    expect(JSON.stringify(receipt?.pages[0]?.doc)).toContain('A much warmer opening');
    expect(JSON.stringify(receipt?.pages[0]?.doc)).toContain('surrounding sentence');
  });

  it('rejects an integrated preview whose target bytes do not match their digest', async () => {
    const targetDoc = {
      type: 'doc' as const,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Current' }] }],
    };
    const sandbox = createProductionDraftSandbox({
      hash,
      now: () => NOW,
      assets: assetStore(),
      generations: generationStore(),
      hasNode: () => true,
      resolveFetches: async (doc) => doc,
      renderPages: async () => [],
    });

    await expect(sandbox.adapter.validate(draft('Replacement'), {
      bookSnapshot: snapshot,
      insertionTarget: {
        kind: 'caret',
        pageId: 'existing-1',
        position: 1,
      },
      targetPage: {
        pageId: 'existing-1',
        revision: 'page-revision-1',
        documentDigest: 'tampered-digest',
        doc: targetDoc,
      },
      signal: new AbortController().signal,
    })).rejects.toThrow('content digest');
  });

  it('runs the real parser, fetch resolver and schema-aware TipTap mapping', async () => {
    let resolutions = 0;
    const assets = assetStore();
    const sandbox = createProductionDraftSandbox({
      hash,
      now: () => NOW,
      assets,
      generations: generationStore(),
      hasNode: () => true,
      resolveFetches: async (doc) => {
        resolutions += 1;
        return doc;
      },
      renderPages: async ({ pages }) =>
        pages.map((page, index) => ({
          doc: page.doc,
          pngBytes: new Uint8Array([index + 1, 9]),
          width: 1240,
          height: 1750,
          sourceStart: page.sourceStart,
          sourceEnd: page.sourceEnd,
          producedOverflow: false,
          diagnostics: [],
        })),
    });
    const source = '# A real page\n\nA paragraph with **mapped emphasis**.';
    const validation = await sandbox.adapter.validate(draft(source), renderContext);
    expect(validation.valid).toBe(true);
    expect(resolutions).toBe(1);

    const generation = await sandbox.adapter.render(draft(source), renderContext);
    expect(generation.pageCount).toBe(1);
    expect(generation.parserValid).toBe(true);
    expect(generation.layoutValid).toBe(true);
    expect(generation.pages[0]?.width).toBe(1240);
    expect(sandbox.renderUrlFor(generation.pages[0]!.image)).toMatch(/^(?:blob:|data:image\/png)/);
  });

  it('blocks broken containers and empty explicit boundaries before layout', async () => {
    const sandbox = createProductionDraftSandbox({
      hash,
      now: () => NOW,
      assets: assetStore(),
      generations: generationStore(),
      hasNode: () => true,
      resolveFetches: async (doc) => doc,
      renderPages: async () => [],
    });
    const source = [
      '::page',
      '# Start',
      '',
      '::card',
      'This fence is malformed and never closes.',
    ].join('\n');
    const validation = await sandbox.adapter.validate(draft(source), renderContext);
    expect(validation.valid).toBe(false);
    expect(validation.parserDiagnostics.some((item) => item.severity === 'error')).toBe(true);
    expect(validation.staticDiagnostics.some((item) => item.code === 'page.empty-boundary')).toBe(true);
  });

  it('detects full-page duplication introduced by pagination', async () => {
    const repeated = {
      type: 'doc' as const,
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'This deliberately long paragraph is repeated by a simulated pagination defect. '.repeat(3),
            },
          ],
        },
      ],
    };
    const sandbox = createProductionDraftSandbox({
      hash,
      now: () => NOW,
      assets: assetStore(),
      generations: generationStore(),
      hasNode: () => true,
      resolveFetches: async (doc) => doc,
      renderPages: async () => [
        {
          doc: repeated,
          pngBytes: new Uint8Array([1]),
          width: 100,
          height: 200,
          producedOverflow: true,
          diagnostics: [],
        },
        {
          doc: repeated,
          pngBytes: new Uint8Array([2]),
          width: 100,
          height: 200,
          producedOverflow: false,
          diagnostics: [],
        },
      ],
    });
    const source = '# One authored page\n\nContent that the mounted editor will paginate.';
    const generation = await sandbox.adapter.render(draft(source), renderContext);
    expect(generation.layoutValid).toBe(false);
    expect(generation.diagnostics.some((item) => item.code === 'layout.duplicate-page')).toBe(true);
  });

  it('treats a settled pagination spill as valid continuation flow', async () => {
    const pageDoc = (text: string) => ({
      type: 'doc' as const,
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    });
    const sandbox = createProductionDraftSandbox({
      hash,
      now: () => NOW,
      assets: assetStore(),
      generations: generationStore(),
      hasNode: () => true,
      resolveFetches: async (doc) => doc,
      renderPages: async () => [
        {
          doc: pageDoc('The opening explanation remains on the first settled leaf.'),
          pngBytes: new Uint8Array([11]),
          width: 100,
          height: 200,
          producedOverflow: true,
          diagnostics: [
            {
              severity: 'warning',
              code: 'layout.spill-page-created',
              message: 'Content continued onto a generated spill page.',
              pageNumber: 1,
            },
          ],
        },
        {
          doc: pageDoc('The carried blocks finish normally on the continuation leaf.'),
          pngBytes: new Uint8Array([12]),
          width: 100,
          height: 200,
          producedOverflow: false,
          diagnostics: [],
        },
      ],
    });

    const generation = await sandbox.adapter.render(
      draft('# One authored page\n\nEnough content to continue naturally.'),
      renderContext,
    );

    expect(generation.layoutValid).toBe(true);
    expect(generation.pageCount).toBe(2);
    expect(generation.pages[0]).toMatchObject({
      paginationSpill: true,
      residualOverflow: false,
    });
    expect(generation.pages[1]).toMatchObject({
      paginationSpill: false,
      residualOverflow: false,
    });
  });

  it('rehydrates cached opaque images and deletes them on disposal', async () => {
    const assets = assetStore();
    const generations = generationStore();
    let renders = 0;
    const options = {
      hash,
      now: () => NOW,
      assets,
      generations,
      hasNode: () => true,
      resolveFetches: async <T,>(doc: T): Promise<T> => doc,
      renderPages: async ({ pages }: Parameters<NonNullable<Parameters<typeof createProductionDraftSandbox>[0]['renderPages']>>[0]) => {
        renders += 1;
        return pages.map((page) => ({
          doc: page.doc,
          pngBytes: new Uint8Array([7, 8, 9]),
          width: 1240,
          height: 1750,
          sourceStart: page.sourceStart,
          sourceEnd: page.sourceEnd,
          producedOverflow: false,
          diagnostics: [],
        }));
      },
    };
    const source = '# Cached\n\nA stable preview.';
    const first = createProductionDraftSandbox(options);
    const generated = await first.adapter.render(draft(source), renderContext);
    expect(renders).toBe(1);

    const second = createProductionDraftSandbox(options);
    const reused = await second.adapter.render(draft(source), renderContext);
    expect(reused.generationId).toBe(generated.generationId);
    expect(renders).toBe(1);
    expect(second.renderUrlFor(reused.pages[0]!.image)).not.toBe('');

    second.releaseUrls();
    expect(second.renderUrlFor(reused.pages[0]!.image)).toBe('');
    expect(generations.get(generated.generationId)).not.toBeNull();
    expect(
      await second.adapter.getGeneration(
        generated.generationId,
        new AbortController().signal,
      ),
    ).not.toBeNull();
    expect(second.renderUrlFor(reused.pages[0]!.image)).not.toBe('');

    await second.disposeAll();
    expect(generations.get(generated.generationId)).toBeNull();
    expect(assets.deleted).toEqual([generated.pages[0]!.image.resourceId]);
  });

  it('rehydrates across transform-only drawing changes but rerenders for a different fixed leaf', async () => {
    const assets = assetStore();
    const generations = generationStore();
    const receipts = receiptStore();
    let livePage = {
      widthCssPx: 648.75,
      heightCssPx: 832.719,
      // Deliberately absent from renderEnvironment below. This is the rail/focus
      // transform: it changes the drawn rect, never the laid-out leaf.
      drawnTransform: 'none',
    };
    let renders = 0;
    const options = {
      hash,
      now: () => NOW,
      assets,
      generations,
      receipts,
      hasNode: () => true,
      resolveFetches: async <T,>(doc: T): Promise<T> => doc,
      renderEnvironment: () => ({
        pageLayout: {
          widthCssPx: livePage.widthCssPx,
          heightCssPx: livePage.heightCssPx,
        },
        bodyScale: '1',
      }),
      renderPages: async ({ pages }: Parameters<NonNullable<Parameters<typeof createProductionDraftSandbox>[0]['renderPages']>>[0]) => {
        renders += 1;
        return pages.map((page) => ({
          doc: page.doc,
          pngBytes: new Uint8Array([renders, 17]),
          width: Math.round(livePage.widthCssPx * 2),
          height: Math.round(livePage.heightCssPx * 2),
          sourceStart: page.sourceStart,
          sourceEnd: page.sourceEnd,
          producedOverflow: false,
          diagnostics: [],
        }));
      },
    };
    const source = '# Geometry-bound preview\n\nThe same script can paginate differently on a shorter leaf.';
    const firstSandbox = createProductionDraftSandbox(options);
    const first = await firstSandbox.adapter.render(draft(source), renderContext);
    expect(renders).toBe(1);

    // Opening a rail panel changes the glass only. The production fingerprint
    // reads computed width/height, so the existing reviewed generation remains
    // exact and can be hydrated without a second render.
    livePage = { ...livePage, drawnTransform: 'scale(0.65)' };
    const transformedSandbox = createProductionDraftSandbox(options);
    const transformed = await transformedSandbox.adapter.render(draft(source), renderContext);
    expect(livePage.drawnTransform).toBe('scale(0.65)');
    expect(transformed.generationId).toBe(first.generationId);
    expect(renders).toBe(1);
    expect(
      await transformedSandbox.adapter.getGeneration(
        first.generationId,
        new AbortController().signal,
      ),
    ).not.toBeNull();

    // A viewport resize changes the fixed page itself. Direct persisted
    // hydration must fail, and rendering the same draft must produce a new
    // generation/receipt rather than serving the page reviewed at size A.
    livePage = {
      widthCssPx: 577.656,
      heightCssPx: 742.719,
      drawnTransform: 'none',
    };
    expect(
      await transformedSandbox.adapter.getGeneration(
        first.generationId,
        new AbortController().signal,
      ),
    ).toBeNull();
    const resized = await transformedSandbox.adapter.render(draft(source), renderContext);
    expect(resized.generationId).not.toBe(first.generationId);
    expect(renders).toBe(2);
    expect(
      await transformedSandbox.adapter.getGeneration(
        resized.generationId,
        new AbortController().signal,
      ),
    ).not.toBeNull();
  });

  it('applies the exact reviewed fetch result even when the search later changes', async () => {
    const receipts = receiptStore();
    let remoteVersion = 'first-reviewed-byte-set';
    let fetchCalls = 0;
    let promotions = 0;
    let promotedPath = '';
    const sandbox = createProductionDraftSandbox({
      hash,
      now: () => NOW,
      assets: assetStore(),
      generations: generationStore(),
      receipts,
      hasNode: () => true,
      stageImages: async (query) => {
        fetchCalls += 1;
        return [{
          id: `id-${remoteVersion}`,
          relPath: `images/${remoteVersion}.png`,
          src: `asset://images/${remoteVersion}.png`,
          url: `https://example.test/${remoteVersion}.png`,
          thumbUrl: null,
          attribution: `Example ${remoteVersion}`,
          license: 'CC0',
          sha256: `sha-${remoteVersion}`,
          sizeBytes: 4,
        }];
      },
      renderPages: async ({ pages }) => pages.map((page) => ({
        // Mount-only identity proves apply consumes the post-pagination doc,
        // not a fresh parse of the source after approval.
        doc: {
          ...page.doc,
          attrs: { reviewedSentinel: 'exact-mounted-document' },
        },
        pngBytes: new Uint8Array([4, 2]),
        width: 1240,
        height: 1750,
        sourceStart: page.sourceStart,
        sourceEnd: page.sourceEnd,
        producedOverflow: false,
        diagnostics: [],
      })),
    });
    const notebookDraft = draft('::fetch{query="a mutable remote image"}');
    const db = await getDb();
    const generation = await sandbox.adapter.render(notebookDraft, renderContext);

    // Rendering is isolated: the normal-asset promotion seam is not reached.
    expect(fetchCalls).toBe(1);
    expect(promotions).toBe(0);
    expect(
      await db.select<Array<{ id: string }>>(
        'SELECT id FROM assets WHERE id = $1',
        ['id-first-reviewed-byte-set'],
      ),
    ).toEqual([]);
    expect(JSON.stringify(generation)).not.toContain('second-unreviewed-byte-set');

    // Simulate Openverse returning different bytes/path after the reader saw
    // the preview. Apply preparation must not search again.
    remoteVersion = 'second-unreviewed-byte-set';
    const prepared = await prepareAiProposalPages(
      {
        draftHash: notebookDraft.draftHash,
        expectedBookRevision: snapshot.bookRevision,
        preview: {
          generationId: generation.generationId,
          draftHash: notebookDraft.draftHash,
          layoutHash: generation.layoutHash,
          bookId: snapshot.bookId,
          expectedBookRevision: snapshot.bookRevision,
          insertionTarget: renderContext.insertionTarget,
          expectedPageCount: generation.pageCount,
          pages: generation.pages,
          assumptions: [],
          citations: [],
          sourceCoverage: {
            manifestDigest: '',
            mode: 'relevant',
            requiredUnitIds: [],
            readUnitIds: [],
            citedUnitIds: [],
            omittedUnitIds: [],
            staleSourceIds: [],
            complete: true,
            updatedAt: NOW,
          },
          visualReview: {
            generationId: generation.generationId,
            draftHash: notebookDraft.draftHash,
            requiredPageIds: generation.pages.map((page) => page.pageId),
            inspectedPageIds: generation.pages.map((page) => page.pageId),
            findings: [],
            complete: true,
            passed: true,
            updatedAt: NOW,
          },
          validation: await sandbox.adapter.validate(notebookDraft, renderContext),
        },
      },
      {
        receiptStore: receipts,
        hash,
        promoteAssets: async (assets) => {
          promotions += 1;
          promotedPath = assets[0]?.relPath ?? '';
        },
      },
    );

    expect(fetchCalls).toBe(1);
    expect(promotions).toBe(1);
    expect(promotedPath).toBe('images/first-reviewed-byte-set.png');
    expect(JSON.stringify(prepared)).toContain('images/first-reviewed-byte-set.png');
    expect(JSON.stringify(prepared)).not.toContain('second-unreviewed-byte-set');
    expect(prepared[0]?.doc.attrs).toEqual({
      reviewedSentinel: 'exact-mounted-document',
    });
  });

  it('treats visual-only pages as meaningful and empty paragraphs as empty', () => {
    expect(
      pageDocIsMeaningful({
        type: 'doc',
        content: [{ type: 'image', attrs: { src: 'https://example.com/p.png' } }],
      }),
    ).toBe(true);
    expect(pageDocIsMeaningful({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe(false);
  });

  it('rejects a direct HTTPS image instead of previewing mutable remote bytes', async () => {
    let rendered = false;
    const sandbox = createProductionDraftSandbox({
      hash,
      now: () => NOW,
      assets: assetStore(),
      generations: generationStore(),
      hasNode: () => true,
      resolveFetches: async (doc) => doc,
      renderPages: async () => {
        rendered = true;
        return [];
      },
    });
    const source = '![mutable remote](https://example.test/image.png)';
    const validation = await sandbox.adapter.validate(draft(source), renderContext);

    expect(validation.valid).toBe(false);
    expect(validation.imageDiagnostics).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'image.remote-source-unstaged',
    }));
    await expect(
      sandbox.adapter.render(draft(source), renderContext),
    ).rejects.toThrow(/deterministic validation/i);
    expect(rendered).toBe(false);
  });
});
