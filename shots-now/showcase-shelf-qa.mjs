/**
 * Focused visual check for the shared README/demo showcase library.
 *
 * This intentionally stops after one real shelf render. It writes only to the
 * caller's evidence directory, never to the checked-in README media, and uses
 * a fresh Playwright context so the owner's browser library is untouched.
 *
 *   node shots-now/showcase-shelf-qa.mjs --label=after
 *   node shots-now/showcase-shelf-qa.mjs --url=http://127.0.0.1:1420
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import {
  SHOWCASE_BINDINGS,
  SHOWCASE_FLOORS,
  SHOWCASE_STYLES,
  SHOWCASE_TITLES,
} from './showcase-library.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const label = opt('label', 'showcase');
const url = `${opt('url', 'http://127.0.0.1:1420')}/?fx=force`;
const outDir = resolve(opt('out', 'E:/temp/alcove-showcase-spines'));
const outPath = resolve(outDir, `${label}.png`);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

try {
  const context = await browser.newContext({
    viewport: { width: 1500, height: 940 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
  await page.evaluate(() => {
    globalThis.__showcaseWorldReady = false;
    void globalThis.__shelfWorld.ready.then(() => {
      globalThis.__showcaseWorldReady = true;
    });
  });
  await page.waitForFunction(() => globalThis.__showcaseWorldReady === true, null, { polling: 400 });
  const skip = page.getByText('skip the tour');
  if (await skip.count()) await skip.first().click({ force: true });

  for (let floor = 0; floor < SHOWCASE_FLOORS.length; floor += 1) {
    await page.evaluate(
      ([floorIndex, titles]) => globalThis.__shelfSeedBooks(titles, floorIndex),
      [floor, SHOWCASE_FLOORS[floor]],
    );
    await page.waitForTimeout(1200);
  }

  await page.evaluate(async ({ titles, bindings, styles }) => {
    const visible = globalThis.__shelfVisibleBooks?.() ?? [];
    const byTitle = new Map(visible.map((book) => [book.title, book]));
    for (let index = 0; index < titles.length; index += 1) {
      const book = byTitle.get(titles[index]);
      if (!book) throw new Error(`missing showcase book: ${titles[index]}`);
      await globalThis.__shelfSaveBinding(book.id, bindings[index]);
      const current = globalThis.__shelfBookStyle?.(book.id) ?? {};
      await globalThis.__shelfSetBookStyle(book.id, { ...current, ...styles[index] });
    }
  }, {
    titles: SHOWCASE_TITLES,
    bindings: SHOWCASE_BINDINGS,
    styles: SHOWCASE_STYLES,
  });

  const validation = await page.evaluate(async ({ titles, bindings, styles }) => {
    const design = await import('/src/art/bookDesign.ts');
    const spines = await import('/src/art/spines.ts');
    const covers = await import('/src/art/covers.ts');
    const errors = [];
    for (let index = 0; index < titles.length; index += 1) {
      const style = styles[index];
      const binding = bindings[index];
      if (!design.isBookPresetId(binding)) errors.push(`${titles[index]}: binding ${binding}`);
      if (!spines.isActiveOrnamentIndex(style.ornament)) errors.push(`${titles[index]}: ornament ${style.ornament}`);
      if (!spines.isActiveTitlePlateStyle(style.titlePlate)) errors.push(`${titles[index]}: title ${style.titlePlate}`);
      if (!covers.isActiveCoverFrameIndex(style.coverFrame)) errors.push(`${titles[index]}: frame ${style.coverFrame}`);
    }
    const missingNewEmblems = [];
    for (let emblem = 86; emblem <= 117; emblem += 1) {
      const reachesPlainFocal = styles.some((style, index) =>
        style.ornament === emblem && !design.bookPresetHasAuthoredFocal(bindings[index]));
      if (!reachesPlainFocal) missingNewEmblems.push(emblem);
    }
    return { errors, missingNewEmblems };
  }, { titles: SHOWCASE_TITLES, bindings: SHOWCASE_BINDINGS, styles: SHOWCASE_STYLES });
  if (validation.errors.length || validation.missingNewEmblems.length) {
    throw new Error(`invalid showcase: ${JSON.stringify(validation)}`);
  }

  await page.waitForTimeout(7000);
  const addSlot = page.locator('.shelf-addslot').first();
  if ((await addSlot.count()) === 0 || !(await addSlot.isVisible())) {
    throw new Error('showcase shelf has no visible add-book slot on Floor 1');
  }
  await page.mouse.move(6, 934);
  await page.screenshot({ path: outPath, animations: 'disabled', caret: 'hide' });
  console.log(JSON.stringify({
    outPath,
    books: SHOWCASE_TITLES.length,
    addSlotVisible: true,
    activeChoices: validation.errors.length === 0,
    expandedEmblemsOnFocalFreeBindings: validation.missingNewEmblems.length === 0,
  }));
  await context.close();
} finally {
  await browser.close();
}
