/**
 * shots-now/own-colour-book.mjs — the book studio's two colour doors, driven.
 *
 * Covers the half of vfy-2-own-colour.mjs that was failing, plus the charm
 * colour that had no door at all. Everything is asserted on the APPLIED state:
 * the row SQLite actually holds, and the spine pixels the shelf actually
 * paints — never on what the panel merely said.
 *
 * Three claims:
 *
 *  1. THE FIRST EDIT STICKS. This is the regression that made the feature look
 *     unshipped: `coverOverridesFromStyle` was handed a partial override blob,
 *     emitted every cover key as `undefined`, and `deriveCoverParams`' spread
 *     wrote that over the seed's own `frame` — so `paintFrame` indexed
 *     `FRAMES[NaN]`, threw, and the throw came back up through `onStyleChange`
 *     and killed the `persistBookStyle` on the next line. Only the FIRST edit
 *     of a session was lost, because Solid does not re-run a computation that
 *     has already thrown — which is exactly why it survived so long, and why
 *     this probe types a colour as the very FIRST thing it does. A probe that
 *     nudges any other knob first will pass against the broken build.
 *  2. THE CLOTH REACHES THE SPINE, measured in pixels off the shelf.
 *  3. THE CHARM TAKES A COLOUR OF ITS OWN, round-tripped through a reload.
 *
 * Usage: node shots-now/own-colour-book.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'shots-now/out';
mkdirSync(OUT, { recursive: true });

const CLOTH = '#00b3a4'; // teal — nowhere near the warm parchment palette
const CHARM = '#7a3f8c'; // violet

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(90_000);

const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));

const results = [];
const note = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

const hexToRgb = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

async function meanRgb(buf) {
  return page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    let r = 0, gg = 0, b = 0;
    for (let i = 0; i < px.length; i += 4) { r += px[i]; gg += px[i + 1]; b += px[i + 2]; }
    const n = px.length / 4;
    return [Math.round(r / n), Math.round(gg / n), Math.round(b / n)];
  }, buf.toString('base64'));
}

const boot = async () => {
  await page.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
  await page.evaluate(() => {
    globalThis.__worldReady = false;
    void globalThis.__shelfWorld.ready.then(() => { globalThis.__worldReady = true; });
  });
  await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400 });
  for (let i = 0; i < 4; i++) {
    const skip = page.locator('text=skip the tour').first();
    if ((await skip.count()) === 0) break;
    await skip.click({ force: true, timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(2500);
};

const styleRow = async (id) =>
  page.evaluate(async (bookId) => {
    const mod = await import('/src/data/books.ts');
    return (await mod.getBook(bookId))?.coverMeta?.style ?? null;
  }, id);

const spineClip = (r) => ({
  x: Math.round(r.x + r.width * 0.15),
  y: Math.round(r.y + r.height * 0.35),
  width: Math.max(6, Math.round(r.width * 0.7)),
  height: Math.max(6, Math.round(r.height * 0.25)),
});

const openStudio = async () => {
  await page.locator('.shelf-a11y button').first().dispatchEvent('click');
  await page.waitForTimeout(4000);
  const readIt = page.getByRole('button', { name: 'read it' });
  if (await readIt.count()) await readIt.click().catch(() => {});
  await page.waitForSelector('.nb-rail', { timeout: 60_000 });
  await page.locator('.nb-rail-button[data-tool="customize"]').click();
  await page.waitForSelector('.nb-book-studio', { timeout: 30_000 });
  await page.waitForTimeout(1800);
};

const backToShelf = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  const back = page.getByRole('button', { name: /back to shelf/i });
  if (await back.count()) await back.first().click().catch(() => {});
  await page.waitForTimeout(4500);
};

/** Type into an OwnColour group and commit with Enter. */
const typeOwn = async (group, hex) => {
  const field = group.locator('.nb-own-colour-hex');
  await field.scrollIntoViewIfNeeded();
  await field.click();
  await field.type(hex, { delay: 25 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1800);
  return field;
};

await boot();
const BOOK = (await page.evaluate(() => globalThis.__shelfVisibleBooks()))[0].id;
let rect = await page.evaluate((id) => globalThis.__shelfSpineRect(id), BOOK);
const spineBefore = await meanRgb(await page.screenshot({ clip: spineClip(rect) }));

await openStudio();

/* ---- 1. the very FIRST edit of the session is a colour of my own ---- */
const clothGroup = page.locator('.nb-book-studio .nb-own-colour').first();
const clothField = await typeOwn(clothGroup, CLOTH);

const draftAfter = await clothField.inputValue();
note(
  'committing clears the field (the handler ran to the end)',
  draftAfter === '',
  `field=${JSON.stringify(draftAfter)}`,
);

const row1 = await styleRow(BOOK);
note(
  'the FIRST edit of a session reaches SQLite',
  row1?.clothHex === CLOTH,
  `cover_meta.style.clothHex = ${JSON.stringify(row1?.clothHex ?? null)}`,
);
await page.locator('.nb-book-studio').screenshot({ path: `${OUT}/own-book-1-cloth.png` }).catch(() => {});

/* ---- 2. the charm's own colour ---- */
// The charm colour row only exists once the book HAS a charm; pick one.
const charmGroup = page.locator('.nb-book-studio [aria-label="Charm"]');
await charmGroup.scrollIntoViewIfNeeded();
await charmGroup.locator('.nb-chip').nth(1).click();
await page.waitForTimeout(1200);

const charmSwatches = await page.locator('.nb-swatch-grid-charm .nb-swatch').count();
note('the charm colour row folds at twenty', charmSwatches <= 20, `${charmSwatches} swatches shown`);

const charmMore = page.locator('.nb-book-studio .nb-chip-ghost', { hasText: /^\d+ more$/ });
note('…with the rest behind a count', (await charmMore.count()) >= 1, `${await charmMore.count()} "N more" buttons in the sheet`);

const ownGroups = page.locator('.nb-book-studio .nb-own-colour');
note(
  'the book sheet now offers TWO colour doors (cloth + charm)',
  (await ownGroups.count()) >= 2,
  `${await ownGroups.count()} "colour of your own" groups`,
);

await typeOwn(ownGroups.nth(1), CHARM);
const row2 = await styleRow(BOOK);
note(
  'a charm colour of my own reaches SQLite',
  row2?.charmColor === CHARM,
  `cover_meta.style.charmColor = ${JSON.stringify(row2?.charmColor ?? null)}`,
);
await page.locator('.nb-book-studio').screenshot({ path: `${OUT}/own-book-2-charm.png` }).catch(() => {});

/* ---- 3. the shelf actually repaints ---- */
await backToShelf();
rect = await page.evaluate((id) => globalThis.__shelfSpineRect(id), BOOK);
const spineAfter = await meanRgb(await page.screenshot({ clip: spineClip(rect) }));
await page.screenshot({ path: `${OUT}/own-book-3-shelf.png` });
const wantCloth = hexToRgb(CLOTH);
note(
  'the SPINE on the shelf repaints to the typed cloth',
  dist(spineAfter, wantCloth) < dist(spineBefore, wantCloth) - 20,
  `spine mean ${JSON.stringify(spineBefore)} -> ${JSON.stringify(spineAfter)}; distance ${dist(spineBefore, wantCloth).toFixed(1)} -> ${dist(spineAfter, wantCloth).toFixed(1)}`,
);

/* ---- 4. survives a reload ---- */
await boot();
const row3 = await styleRow(BOOK);
note(
  'both colours survive a full reload',
  row3?.clothHex === CLOTH && row3?.charmColor === CHARM,
  `clothHex=${JSON.stringify(row3?.clothHex ?? null)} charmColor=${JSON.stringify(row3?.charmColor ?? null)}`,
);
await page.screenshot({ path: `${OUT}/own-book-4-reload.png` });

note('no uncaught page errors along the way', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(bad.length === 0 ? `\n  all ${results.length} checks held` : `\n  ${bad.length} of ${results.length} FAILED: ${bad.map((b) => b.name).join(' | ')}`);
process.exit(bad.length === 0 ? 0 : 1);
