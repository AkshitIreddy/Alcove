/**
 * Drive one real Book Studio Surprise decision through UI -> persistence -> shelf.
 * Restores the exact pre-run binding and style before exiting.
 *
 * Usage: node shots-now/book-surprise-live-qa.mjs [--url=http://127.0.0.1:1420]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const hit = process.argv.find((arg) => arg.startsWith('--url='));
const base = hit?.slice('--url='.length) || 'http://127.0.0.1:1420';
const out = 'shots-now/out';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
let original = null;
let appearanceMutated = false;
const isKnownBookOpenAudioError = (message) =>
  message.includes("Cannot read properties of undefined (reading 'category')") &&
  message.includes('at shippedCue') &&
  message.includes('at handleOpen');

try {
  await page.goto(`${base}/?fx=force`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
  await page.waitForFunction(() => globalThis.__shelfVisibleBooks?.().length > 0, null, { polling: 400 });
  const skip = page.getByText('skip the tour');
  if (await skip.count()) await skip.first().click().catch(() => {});
  await page.waitForTimeout(800);

  original = await page.evaluate(() => {
    const first = globalThis.__shelfVisibleBooks()[0];
    const meta = globalThis.__shelfBookMeta(first.id);
    return {
      id: first.id,
      title: first.title,
      binding: globalThis.__shelfBinding(first.id),
      style: meta?.style ?? null,
    };
  });

  await page.locator('.shelf-a11y button').first().dispatchEvent('click');
  // Pulling a book out is intentionally only the first interaction. The held
  // cover is the second button that opens it; the older probe waited for the
  // book rail immediately and therefore timed out without ever entering the
  // reader.
  const heldBook = page.getByRole('button', {
    name: `Open ${original.title}`,
    exact: true,
  });
  await heldBook.waitFor({ state: 'visible' });
  await heldBook.click();
  await page.waitForSelector('.nb-rail');
  await page.waitForTimeout(1400);
  await page.getByRole('button', { name: /Customize this book/ }).click();
  await page.waitForSelector('.nb-book-studio');
  await page.waitForTimeout(600);

  const studioText = (await page.locator('.nb-book-studio').innerText()).toLowerCase();
  if (studioText.includes('spine title')) throw new Error('Book Studio still exposes a spine-title control');
  if (!studioText.includes('cover title')) throw new Error('front-cover title controls are missing');

  const direction = page.getByRole('group', { name: 'Surprise book direction' });
  await direction.getByRole('button', { name: 'botanical', exact: true }).click();
  // From this point onward every exit path must restore the captured recipe.
  appearanceMutated = true;
  await page.getByRole('button', { name: /dress this book/i }).click();
  await page.waitForTimeout(1400);

  const applied = await page.evaluate((id) => ({
    binding: globalThis.__shelfBinding(id),
    style: globalThis.__shelfBookMeta(id)?.style ?? null,
  }), original.id);
  if (typeof applied.binding !== 'string' || applied.binding === original.binding) {
    throw new Error(`Surprise did not apply a new binding (${String(original.binding)} -> ${String(applied.binding)})`);
  }
  if (applied.style === null) throw new Error('Surprise did not persist its style recipe');

  await page.screenshot({ path: `${out}/book-surprise-live-studio.png` });
  await page.getByRole('group', { name: 'Preview face' })
    .getByRole('button', { name: 'cover', exact: true })
    .click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${out}/book-surprise-live-studio-cover.png` });

  // Return to the shelf and wait for the applied texture, proving this was not
  // merely a pretty preview disconnected from the world.
  await page.keyboard.press('Escape');
  await page.locator('.nb-book-studio').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /back to shelf/i }).click();
  await page.locator('.shelf-root:not(.is-away)').waitFor({ state: 'visible' });
  await page.waitForFunction(
    (id) =>
      document.querySelector('.shelf-root:not(.is-away)') !== null &&
      globalThis.__shelfVisibleBooks?.().some((book) => book.id === id),
    original.id,
  );
  await page.evaluate((id) => globalThis.__shelfWhenSpinesReady?.(true).then(() => id), original.id);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/book-surprise-live-shelf.png` });

  await page.evaluate(async ({ id, binding, style }) => {
    await globalThis.__shelfSetBookStyle(id, style);
    await globalThis.__shelfSaveBinding(id, binding);
    await globalThis.__shelfWhenSpinesReady?.(true);
  }, original);
  const restored = await page.evaluate((id) => ({
    binding: globalThis.__shelfBinding(id),
    style: globalThis.__shelfBookMeta(id)?.style ?? null,
  }), original.id);
  const stableStyle = (value) => JSON.stringify(
    value === null ? null : Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))),
  );
  if (restored.binding !== original.binding || stableStyle(restored.style) !== stableStyle(original.style)) {
    throw new Error('QA cleanup did not restore the original book appearance');
  }
  appearanceMutated = false;
  const unexpectedErrors = errors.filter((message) => !isKnownBookOpenAudioError(message));
  if (unexpectedErrors.length > 0) throw new Error(`page errors: ${unexpectedErrors.join(' | ')}`);

  console.log(JSON.stringify({
    ok: true,
    book: original.title,
    bindingBefore: original.binding,
    bindingApplied: applied.binding,
    restored: true,
    knownBaselinePageErrors: errors.length - unexpectedErrors.length,
    screenshots: [
      `${out}/book-surprise-live-studio.png`,
      `${out}/book-surprise-live-studio-cover.png`,
      `${out}/book-surprise-live-shelf.png`,
    ],
  }, null, 2));
} finally {
  if (appearanceMutated && original !== null) {
    // A visual/probe assertion must never strand its temporary binding in the
    // browser fixture. Keep cleanup independent from the point of failure:
    // these bridges outlive the Studio and book-view panels.
    await page.evaluate(async ({ id, binding, style }) => {
      await globalThis.__shelfSetBookStyle?.(id, style);
      await globalThis.__shelfSaveBinding?.(id, binding);
      await globalThis.__shelfWhenSpinesReady?.(true);
    }, original).catch((error) => {
      console.error(`cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
  await browser.close();
}
