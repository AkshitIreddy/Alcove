/**
 * Drive one real Book Studio Surprise decision through UI -> persistence -> shelf.
 * Restores the exact pre-run binding and style before exiting.
 *
 * Usage: node shots-now/book-surprise-live-qa.mjs [--url=http://127.0.0.1:1420]
 *        [--direction=grand] [--sabotage=plain-frame]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const hit = process.argv.find((arg) => arg.startsWith('--url='));
const base = hit?.slice('--url='.length) || 'http://127.0.0.1:1420';
const directionName = process.argv.find(arg=>arg.startsWith('--direction='))?.slice('--direction='.length) || 'botanical';
const sabotagePlainFrame = process.argv.includes('--sabotage=plain-frame');
const expansion = process.argv.includes('--expansion');
const GRAND_ORNATE_FRAMES = new Set([43, 48, 51, 52, 54, 55, 59, 60, 61]);
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
  // Keep a single module graph while the shared development server is edited.
  await page.routeWebSocket('**', socket => socket.close());
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
  await direction.getByRole('button', { name: directionName, exact: true }).click();
  // From this point onward every exit path must restore the captured recipe.
  appearanceMutated = true;
  await page.getByRole('button', { name: /dress this book/i }).click();
  await page.waitForTimeout(1400);

  let applied = await page.evaluate((id) => ({
    binding: globalThis.__shelfBinding(id),
    style: globalThis.__shelfBookMeta(id)?.style ?? null,
  }), original.id);
  if (typeof applied.binding !== 'string' || applied.binding === original.binding) {
    throw new Error(`Surprise did not apply a new binding (${String(original.binding)} -> ${String(applied.binding)})`);
  }
  if (applied.style === null) throw new Error('Surprise did not persist its style recipe');
  if (expansion) {
    await page.evaluate(async id => globalThis.__shelfSaveBinding(id, 'plain-cloth'), original.id);
    const plate = page.getByRole('group', {name:'Title plate', exact:true});
    await plate.getByRole('button', {name:/more/i}).click();
    await plate.getByRole('button', {name:/^whispered rules$/i}).click();
    const emblem = page.getByRole('group', {name:'Book emblem',exact:true});
    await emblem.getByRole('button', {name:/more/i}).click();
    await emblem.getByRole('button', {name:/^single ginkgo$/i}).click();
    await page.getByRole('button', {name:/\d+ more frames/i}).click();
    await page.getByRole('group', {name:'Cover frame',exact:true})
      .getByRole('button', {name:/^soft mitre$/i}).click();
    await page.waitForFunction(id => {
      const style=globalThis.__shelfBookMeta(id)?.style;
      return style?.titlePlate==='whisper-rules' && style?.ornament===114 && style?.coverFrame===79;
    },original.id);
    applied=await page.evaluate(id=>({binding:globalThis.__shelfBinding(id),style:globalThis.__shelfBookMeta(id)?.style}),original.id);
  }
  if (applied.style.composition != null || applied.style.spineCharacter != null) {
    throw new Error('Surprise revived the rejected sparse layout instead of the established binding');
  }
  if (sabotagePlainFrame) {
    await page.evaluate(async ({ id, style }) => {
      await globalThis.__shelfSetBookStyle(id, { ...style, coverFrame: 2 });
    }, { id: original.id, style: applied.style });
    applied = await page.evaluate((id) => ({
      binding: globalThis.__shelfBinding(id),
      style: globalThis.__shelfBookMeta(id)?.style ?? null,
    }), original.id);
    if (applied.style?.coverFrame !== 2) {
      throw new Error('plain-frame sabotage did not reach the saved appearance');
    }
  }
  if (
    directionName === 'grand'
    && !expansion
    && !GRAND_ORNATE_FRAMES.has(applied.style.coverFrame)
    && (applied.style.ornament ?? -1) < 0
    && !['gothic-pointed-panel','fanfare-pediment','crown-quatrefoil','imperial-fan-panel',
      'morocco-clipped-rule','inscription-shoulders','two-tone-leather-label'].includes(applied.style.titlePlate)
  ) {
    throw new Error(
      `Grand Surprise lost its ornate perimeter in the live Studio path (frame ${String(applied.style.coverFrame)})`,
    );
  }

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
  await page.waitForFunction(() => globalThis.__shelfWorld?.frozen === false);
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
    coverFrameApplied: applied.style.coverFrame,
    compositionApplied: applied.style.composition,
    spineCharacterApplied: applied.style.spineCharacter,
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
