/**
 * Prove the flat landing raster stays up until destination images decode.
 *
 * The welcome book supplies a real three-picture row. We turn to it once to
 * locate the spread, turn back, then delay only the browser's decode promise
 * for kitten images. The GL landing must remain visible through that delay.
 * `--sabotage` drops the canvas as soon as landing begins and must be rejected.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL_BASE =
  process.argv.find((arg) => arg.startsWith('--url='))?.slice(6) ?? 'http://localhost:1420';
const SABOTAGE = process.argv.includes('--sabotage');
const DELAY_MS = 260;
const OUT = 'qa/turn/media-landing';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
await page.emulateMedia({ reducedMotion: 'no-preference' });
await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(async () => globalThis.__shelfWorld.ready);
const skip = page.getByText('skip the tour');
if (await skip.count()) {
  await skip.first().click({ force: true });
  await page.waitForTimeout(900);
}
await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  const welcome = list.find((book) => /welcome/i.test(book.title)) ?? list[0];
  app.appState.openBook(welcome.id);
});
await page.waitForSelector('.nb-prose p', { timeout: 60_000 });
await page.waitForTimeout(5000);

const spreadIndex = () =>
  page.locator('.nb-spread-stage').getAttribute('data-spread-index').then(Number);
const turn = async (direction) => {
  const before = await spreadIndex();
  await page.locator(`.nb-flip-hotspot-${direction}`).click({ force: true });
  await page.waitForFunction(
    (old) => Number(document.querySelector('.nb-spread-stage')?.getAttribute('data-spread-index')) !== old,
    before,
    { timeout: 5000 },
  );
  await page.waitForFunction(
    () => !document.querySelector('.nb-flip-canvas')?.classList.contains('is-flipping'),
    null,
    { timeout: 5000 },
  );
};

// Locate the first real image-row spread without depending on seed slot counts.
let turns = 0;
while ((await page.locator('.nb-image-row img').count()) < 3 && turns < 20) {
  const disabled = await page.locator('.nb-flip-hotspot-next').evaluate((el) => el.classList.contains('is-disabled'));
  const headings = await page.locator('.nb-prose h1').allTextContents();
  console.log(`scan spread ${await spreadIndex()}: ${headings.join(' | ') || '(no h1)'}`);
  if (disabled) break;
  await turn('next');
  turns += 1;
}
if ((await page.locator('.nb-image-row img').count()) < 3) {
  throw new Error('welcome book never reached its three-picture row');
}
console.log(`located picture spread ${await spreadIndex()} after ${turns} turns`);
await turn('prev');

await page.evaluate(({ delayMs, sabotage }) => {
  const proto = HTMLImageElement.prototype;
  const originalDecode = proto.decode;
  globalThis.__mediaLanding = {
    calls: 0,
    pending: 0,
    landingAt: null,
    canvasDownAt: null,
  };
  proto.decode = function delayedKittenDecode() {
    const original = originalDecode.call(this).catch(() => undefined);
    if (!this.src.includes('/kittens/')) return original;
    globalThis.__mediaLanding.calls += 1;
    globalThis.__mediaLanding.pending += 1;
    return new Promise((resolve) => setTimeout(resolve, delayMs))
      .then(() => original)
      .finally(() => {
        globalThis.__mediaLanding.pending -= 1;
      });
  };

  const surface = document.querySelector('.nb-flip-surface');
  const canvas = document.querySelector('.nb-flip-canvas');
  const observe = () => {
    if (surface?.classList.contains('is-flip-landing') && globalThis.__mediaLanding.landingAt === null) {
      globalThis.__mediaLanding.landingAt = performance.now();
      if (sabotage) canvas?.classList.remove('is-flipping');
    }
    if (
      globalThis.__mediaLanding.landingAt !== null &&
      !canvas?.classList.contains('is-flipping') &&
      globalThis.__mediaLanding.canvasDownAt === null
    ) {
      globalThis.__mediaLanding.canvasDownAt = performance.now();
    }
  };
  new MutationObserver(observe).observe(surface, { attributes: true, subtree: true });
}, { delayMs: DELAY_MS, sabotage: SABOTAGE });

const before = await spreadIndex();
await page.locator('.nb-flip-hotspot-next').click({ force: true });
await page.waitForFunction(
  () => globalThis.__mediaLanding?.landingAt !== null,
  null,
  { timeout: 5000 },
);
await page.waitForTimeout(60);
const held = await page.evaluate(() => ({
  ...globalThis.__mediaLanding,
  canvasUp: document.querySelector('.nb-flip-canvas')?.classList.contains('is-flipping') ?? false,
  pictures: Array.from(document.querySelectorAll('.nb-image-row img')).map((image) => ({
    complete: image.complete,
    width: image.naturalWidth,
  })),
  spread: Number(document.querySelector('.nb-spread-stage')?.getAttribute('data-spread-index')),
}));
writeFileSync(`${OUT}/${SABOTAGE ? 'sabotage' : 'held'}.png`, await page.screenshot());

await page.waitForFunction(
  () => globalThis.__mediaLanding?.canvasDownAt !== null,
  null,
  { timeout: 5000 },
);
const settled = await page.evaluate(() => ({
  ...globalThis.__mediaLanding,
  canvasUp: document.querySelector('.nb-flip-canvas')?.classList.contains('is-flipping') ?? false,
  pictures: Array.from(document.querySelectorAll('.nb-image-row img')).map((image) => ({
    complete: image.complete,
    width: image.naturalWidth,
  })),
}));
writeFileSync(`${OUT}/${SABOTAGE ? 'sabotage-final' : 'settled'}.png`, await page.screenshot());

const heldMs = settled.canvasDownAt - settled.landingAt;
const picturesReady = settled.pictures.length >= 3 && settled.pictures.every((image) => image.complete && image.width > 0);
const passes =
  held.spread !== before &&
  held.calls >= 3 &&
  held.pending >= 3 &&
  held.canvasUp &&
  heldMs >= DELAY_MS - 30 &&
  picturesReady &&
  !settled.canvasUp;
console.log({ before, held, settled, heldMs, picturesReady });

if (SABOTAGE) {
  if (passes) {
    console.error('GATE INERT — early canvas removal escaped detection');
    process.exitCode = 1;
  } else {
    console.log('GATE ALIVE — early canvas removal was rejected');
  }
} else if (passes) {
  console.log('PASS — landing raster stayed until all three pictures decoded');
} else {
  console.error('FAIL — landing raster did not cover the destination media boundary');
  process.exitCode = 1;
}

await browser.close();
