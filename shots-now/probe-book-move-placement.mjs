/**
 * The move outline is a promise: after a reader picks an empty shelf slot,
 * the book must settle in that outline rather than being reclustered beside
 * the nearest books. This probe drives the world's real move verb in a
 * disposable bookcase and compares preview and settled screen centres.
 *
 * Usage: node shots-now/probe-book-move-placement.mjs
 *        (expects the existing dev server on :1420)
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'shots-now/out/book-move-placement';
const URL = 'http://127.0.0.1:1420/?fx=force';
const TARGET_SLOT = 15;
const SLOT_W = 56;
const SLOT_MARGIN_X = 48;
const BOOK_BASELINE = 280;
const targetWorldX = SLOT_MARGIN_X + TARGET_SLOT * SLOT_W + SLOT_W / 2;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120_000);
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

let originalCaseId = null;
let fixtureCaseId = null;
const report = { ok: false, targetSlot: TARGET_SLOT, targetWorldX, pageErrors };

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
  const skip = page.getByText('skip the tour', { exact: false }).first();
  if (await skip.count()) await skip.click().catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});

  const fixture = await page.evaluate(async () => {
    const api = globalThis.__shelfBookcases;
    const original = api.list().activeId;
    const made = await api.create(`QA move placement ${Date.now()}`);
    await api.switch(made.id);
    return { original, made: made.id };
  });
  originalCaseId = fixture.original;
  fixtureCaseId = fixture.made;
  await page.waitForFunction(
    (id) => globalThis.__shelfBookcases?.list().activeId === id,
    fixtureCaseId,
  );

  await page.evaluate(() =>
    globalThis.__shelfSeedBooks(['Aster', 'Birch', 'Cedar', 'Dahlia'], 0),
  );
  await page.waitForFunction(() => globalThis.__shelfVisibleBooks?.().length === 4);
  await page.evaluate(() => globalThis.__shelfWhenSpinesReady?.());

  const moving = await page.evaluate(() => globalThis.__shelfVisibleBooks()[0]);
  report.book = moving;
  report.before = await page.evaluate((id) => globalThis.__shelfSpineRect(id), moving.id);

  report.preview = await page.evaluate(
    ({ id, worldX, baseline }) => {
      const world = globalThis.__shelfWorld;
      const cam = world.camera;
      const cursor = {
        x: (worldX - cam.x) * cam.zoom,
        y: (baseline - cam.y) * cam.zoom,
      };
      world.beginMove(id);
      world.updateMove(cursor);
      return {
        cursor,
        centerX: world.movePreview?.position.x ?? null,
        camera: { x: cam.x, y: cam.y, zoom: cam.zoom },
      };
    },
    { id: moving.id, worldX: targetWorldX, baseline: BOOK_BASELINE },
  );
  await page.screenshot({ path: `${OUT}/01-selected-position.png` });

  await page.evaluate(async ({ worldX, baseline }) => {
    const world = globalThis.__shelfWorld;
    const cam = world.camera;
    await world.commitMove({
      x: (worldX - cam.x) * cam.zoom,
      y: (baseline - cam.y) * cam.zoom,
    });
  }, { worldX: targetWorldX, baseline: BOOK_BASELINE });
  await page.waitForFunction(() => globalThis.__shelfWorld.moveActive === false);
  await page.evaluate(() => globalThis.__shelfWhenSpinesReady?.());

  report.after = await page.evaluate((id) => globalThis.__shelfSpineRect(id), moving.id);
  report.persisted = await page.evaluate((id) => {
    const book = globalThis.__shelfWorld.store.findBook(id);
    return { floor: book?.floor ?? null, slot: book?.slot ?? null };
  }, moving.id);
  report.previewCenterX = report.preview.centerX;
  report.afterCenterX = report.after.x + report.after.width / 2;
  report.deltaPx = Math.abs(report.afterCenterX - report.previewCenterX);
  await page.screenshot({ path: `${OUT}/02-settled-position.png` });

  // It is a placement, not a session-local animation endpoint. Recreate the
  // entire world from persisted rows and demand the same visible centre.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    (id) =>
      globalThis.__shelfWorld !== undefined &&
      globalThis.__shelfBookcases?.list().activeId === id,
    fixtureCaseId,
  );
  await page.evaluate(() => globalThis.__shelfWhenSpinesReady?.());
  report.reloaded = await page.evaluate((id) => globalThis.__shelfSpineRect(id), moving.id);
  report.reloadedCenterX = report.reloaded.x + report.reloaded.width / 2;
  report.reloadDeltaPx = Math.abs(report.reloadedCenterX - report.previewCenterX);
  report.ok =
    report.deltaPx <= 1.5 &&
    report.reloadDeltaPx <= 1.5 &&
    pageErrors.length === 0;
  await page.screenshot({ path: `${OUT}/03-reloaded-position.png` });
} catch (error) {
  report.error = error.stack ?? error.message;
} finally {
  if (originalCaseId !== null) {
    await page.evaluate((id) => globalThis.__shelfBookcases?.switch(id), originalCaseId).catch(() => {});
  }
  if (fixtureCaseId !== null) {
    await page.evaluate((id) => globalThis.__shelfBookcases?.remove(id, true), fixtureCaseId).catch(() => {});
  }
  writeFileSync(`${OUT}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;
