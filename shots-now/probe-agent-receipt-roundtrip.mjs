/**
 * Browser-dev regression for a reviewed draft's durable apply receipt.
 * Exercises the real hidden PageEditor renderer, browser SQLite stand-in and
 * apply preparation without calling a provider or mutating a notebook.
 */
import { chromium } from 'playwright';

const arg = process.argv.find((value) => value.startsWith('--url='));
const base = arg?.slice('--url='.length) || 'http://127.0.0.1:1420';
const sabotage = process.argv.includes('--sabotage');
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 850 } });
  page.setDefaultTimeout(60_000);
  await page.goto(`${base}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
  const skip = page.getByText('skip the tour');
  if (await skip.count()) await skip.first().click({ force: true });
  await page.evaluate(async () => {
    const app = await import('/src/state/app.ts');
    const books = await import('/src/data/books.ts');
    const list = await books.listBooksByFloorRange(0, 20);
    const welcome = list.find((book) => /welcome/i.test(book.title)) ?? list[0];
    if (!welcome) throw new Error('No book is available for the receipt probe.');
    app.appState.openBook(welcome.id);
  });
  await page.waitForSelector('.nb-prose');
  await page.evaluate(() => document.fonts.ready);

  const result = await page.evaluate(async ({ sabotage }) => {
    const [
      { createProductionDraftSandbox },
      { webCryptoAgentHash },
      { prepareAiProposalPages },
      { sqliteReviewedDraftReceiptStore },
    ] =
      await Promise.all([
        import('/src/features/aiAgent/draftSandbox.ts'),
        import('/src/features/aiAgent/adapters.ts'),
        import('/src/features/aiAgent/prepareProposal.ts'),
        import('/src/data/aiAgentReviewedDraft.ts'),
      ]);
    const script = [
      '# Kirby', '', '- Pink hero from Dream Land', '- Copies abilities by inhaling foes', '',
      '::page', '# The Powerpuff Girls', '', '- Blossom leads', '- Bubbles brings heart', '',
      '::page', '# Friendly face-off', '', '- Adaptability versus teamwork',
    ].join('\n');
    const pageIds = Array.from({ length: 48 }, (_, index) => `receipt-probe-page-${index + 1}`);
    const snapshot = {
      bookId: 'receipt-probe-book',
      bookRevision: 'receipt-probe-revision',
      pageIds,
      pageRevisions: Object.fromEntries(pageIds.map((id, index) => [id, `revision-${index + 1}`])),
      capturedAt: new Date().toISOString(),
    };
    const target = { kind: 'after_page', pageId: pageIds[47] };
    const draft = {
      runId: 'receipt-probe-run',
      version: 1,
      script,
      draftHash: await webCryptoAgentHash.digestText(script),
      createdAt: new Date().toISOString(),
    };
    const undefinedPaths = [];
    const findUndefined = (value, path = '$') => {
      if (value === undefined) {
        undefinedPaths.push(path);
        return;
      }
      if (value === null || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach((item, index) => findUndefined(item, `${path}[${index}]`));
        return;
      }
      Object.entries(value).forEach(([key, item]) => findUndefined(item, `${path}.${key}`));
    };
    const receiptStore = {
      get: (id) => sqliteReviewedDraftReceiptStore.get(id),
      put: async (receipt) => {
        findUndefined(receipt);
        await sqliteReviewedDraftReceiptStore.put(sabotage
          ? {
              ...receipt,
              // Witness the gate by corrupting the persisted integrity seal,
              // the same boundary that exposed noncanonical receipt bodies.
              receiptDigest: `sabotaged-${receipt.receiptDigest}`,
            }
          : receipt);
      },
      delete: (id) => sqliteReviewedDraftReceiptStore.delete(id),
    };
    const sandbox = createProductionDraftSandbox({ receipts: receiptStore });
    try {
      const context = {
        bookSnapshot: snapshot,
        insertionTarget: target,
        signal: new AbortController().signal,
      };
      const validation = await sandbox.adapter.validate(draft, context);
      const generation = await sandbox.adapter.render(draft, context);
      const stored = await sqliteReviewedDraftReceiptStore.get(generation.generationId);
      const receiptEvidence = stored === null
        ? { stored: false }
        : await (async () => {
            const { receiptDigest, ...body } = stored;
            return {
              stored: true,
              receiptDigestMatches:
                (await webCryptoAgentHash.digestJson(body)) === receiptDigest,
              targetMatches:
                (await webCryptoAgentHash.digestJson(stored.applicationPlan.insertionTarget)) ===
                (await webCryptoAgentHash.digestJson(target)),
              undefinedPaths,
            };
          })();
      let prepared;
      let failure = null;
      try {
        prepared = await prepareAiProposalPages({
          draftHash: draft.draftHash,
          expectedBookRevision: snapshot.bookRevision,
          preview: {
            generationId: generation.generationId,
            draftHash: draft.draftHash,
            layoutHash: generation.layoutHash,
            bookId: snapshot.bookId,
            expectedBookRevision: snapshot.bookRevision,
            expectedPageIds: pageIds,
            insertionTarget: target,
            expectedPageCount: generation.pageCount,
            pages: generation.pages,
            assumptions: [],
            citations: [],
            imageGenerationPrompts: [],
            sourceCoverage: {
              manifestDigest: '', mode: 'relevant', requiredUnitIds: [], readUnitIds: [],
              citedUnitIds: [], omittedUnitIds: [], staleSourceIds: [], complete: true,
              updatedAt: new Date().toISOString(),
            },
            visualReview: {
              generationId: generation.generationId,
              draftHash: generation.draftHash,
              requiredPageIds: generation.pages.map((item) => item.pageId),
              imageExposures: [],
              inspectedPageIds: generation.pages.map((item) => item.pageId),
              findings: [], complete: true, passed: true, updatedAt: new Date().toISOString(),
            },
            validation,
          },
        });
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        if (!sabotage) {
          throw new Error(`${failure} · evidence=${JSON.stringify(receiptEvidence)}`);
        }
      }
      if (sabotage && failure === null) {
        throw new Error('GATE INERT: a tampered reviewed receipt was accepted');
      }
      return {
        pageCount: generation.pageCount,
        preparedCount: prepared?.length ?? 0,
        receiptEvidence,
        failure,
      };
    } finally {
      await sandbox.disposeAll();
    }
  }, { sabotage });
  if (sabotage) {
    if (
      result.failure === null ||
      !/exact reviewed draft is no longer available/i.test(result.failure) ||
      result.receiptEvidence.receiptDigestMatches !== false
    ) {
      throw new Error(`GATE INERT: ${JSON.stringify(result)}`);
    }
    process.stdout.write('GATE ALIVE · tampered reviewed receipt was rejected\n');
    process.exitCode = 0;
  } else {
    if (result.pageCount !== 3 || result.preparedCount !== 3) {
      throw new Error(`receipt round-trip mismatch: ${JSON.stringify(result)}`);
    }
    process.stdout.write(`agent receipt round-trip: PASS · ${result.preparedCount} reviewed pages\n`);
  }
} finally {
  await browser.close();
}
