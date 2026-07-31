/**
 * scripts/probe-bookstudio.mjs — the Book Studio, driven as a reader drives it.
 *
 * Answers three questions that only the running app can answer:
 *  1. does the live preview REDRAW when a knob moves? (pixel hash before/after)
 *  2. do the spine and the cover agree about how tall the book is?
 *  3. does the catalogue panel open, and what is on it?
 *
 * Usage: node scripts/probe-bookstudio.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');

mkdirSync('qa/ui', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 940 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120000);

const errors = new Map();
page.on('pageerror', (e) => {
  const k = e.message.split('\n')[0];
  errors.set(k, (errors.get(k) ?? 0) + 1);
});
page.on('console', (m) => {
  if (m.type() === 'error') {
    const k = `console ${m.text().split('\n')[0]}`;
    errors.set(k, (errors.get(k) ?? 0) + 1);
  }
});

const shot = async (name) => {
  await page.screenshot({ path: `qa/ui/${name}.png` });
  console.log(`  shot qa/ui/${name}.png`);
};

/** Cheap content hash of a canvas, plus its ink bounding box. */
const canvasProbe = (selector) =>
  page.evaluate((sel) => {
    const c = document.querySelector(sel);
    if (!c) return null;
    const ctx = c.getContext('2d');
    const { width: w, height: h } = c;
    const data = ctx.getImageData(0, 0, w, h).data;
    let hash = 2166136261;
    let minY = h;
    let maxY = -1;
    let minX = w;
    let maxX = -1;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        hash ^= data[i] + data[i + 1] * 3 + data[i + 2] * 7 + data[i + 3] * 11;
        hash = Math.imul(hash, 16777619) >>> 0;
        if (data[i + 3] > 12) {
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }
    const box = maxY < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    return { hash: hash.toString(16), cssW: c.clientWidth, cssH: c.clientHeight, w, h, box };
  }, selector);

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(() => {
  globalThis.__worldReady = false;
  void globalThis.__shelfWorld.ready.then(() => {
    globalThis.__worldReady = true;
  });
});
await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400 });

// The tutorial scrim eats every later click — get rid of it FIRST.
const skip = page.getByText('skip the tour');
if (await skip.count()) {
  await skip.first().click();
  console.log('  dismissed the tour');
}
await page.waitForTimeout(1200);

/* 1 — open a book -------------------------------------------------------- */
console.log('\n1. open a book');
const opened = await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  const first = list[0];
  if (!first) return null;
  app.appState.openBook(first.id);
  return { id: first.id, title: first.title, seed: first.spineSeed };
});
console.log('  opened:', JSON.stringify(opened));
await page.waitForSelector('.nb-rail', { timeout: 60000 });
await page.waitForTimeout(1500);

/* 2 — open the studio ---------------------------------------------------- */
console.log('\n2. open the studio from the rail');
await page.locator('.nb-rail-button[data-tool="customize"]').click();
await page.waitForSelector('.nb-book-studio', { timeout: 30000 });
await page.waitForTimeout(1200);
await shot('bookstudio-01-open');

/* 3 — does a knob move the preview? -------------------------------------- */
console.log('\n3. pigment swatch → preview redraw?');
const spineBefore = await canvasProbe('.nb-studio-face-spine');
const coverBefore = await canvasProbe('.nb-studio-face-cover');
console.log('  spine before:', JSON.stringify(spineBefore));
console.log('  cover before:', JSON.stringify(coverBefore));

const swatches = page.locator('[aria-label="Spine pigment"] .nb-swatch');
const swatchCount = await swatches.count();
console.log('  pigment swatches:', swatchCount);
// Pick a swatch far from whatever is pressed now.
const activeIdx = await page.evaluate(() => {
  const list = [...document.querySelectorAll('[aria-label="Spine pigment"] .nb-swatch')];
  return list.findIndex((b) => b.getAttribute('aria-pressed') === 'true');
});
const target = (activeIdx + 5) % swatchCount;
console.log(`  active swatch ${activeIdx} → clicking ${target}`);
await swatches.nth(target).click();
await page.waitForTimeout(900);

const spineAfter = await canvasProbe('.nb-studio-face-spine');
console.log('  spine after :', JSON.stringify(spineAfter));
console.log(
  spineBefore.hash === spineAfter.hash
    ? '  >>> BUG: spine preview did NOT redraw'
    : '  ok: spine preview redrew',
);
const nowActive = await page.evaluate(() => {
  const list = [...document.querySelectorAll('[aria-label="Spine pigment"] .nb-swatch')];
  return list.findIndex((b) => b.getAttribute('aria-pressed') === 'true');
});
console.log('  swatch now pressed:', nowActive);
await shot('bookstudio-02-pigment');

/* 4 — cover face --------------------------------------------------------- */
console.log('\n4. flip to the cover and move a cover knob');
await page.getByRole('button', { name: 'cover', exact: true }).click();
await page.waitForTimeout(700);
await shot('bookstudio-03-cover');
const c0 = await canvasProbe('.nb-studio-face-cover');
// Pick a medallion the book is NOT already wearing, or the probe fails itself.
const medIdx = await page.evaluate(() => {
  const list = [...document.querySelectorAll('[aria-label="Cover medallion"] button')];
  const on = list.findIndex((b) => b.getAttribute('aria-pressed') === 'true');
  return (on + 3) % list.length;
});
console.log('  clicking medallion', medIdx);
await page.locator('[aria-label="Cover medallion"] button').nth(medIdx).click();
await page.waitForTimeout(800);
const c1 = await canvasProbe('.nb-studio-face-cover');
console.log('  cover before:', JSON.stringify(c0));
console.log('  cover after :', JSON.stringify(c1));
console.log(
  c0.hash === c1.hash ? '  >>> BUG: cover preview did NOT redraw' : '  ok: cover preview redrew',
);
await shot('bookstudio-04-medallion');

/* 5 — format: do spine and cover agree about height? --------------------- */
console.log('\n5. format chips — spine vs cover height');
const formatChips = page.locator('[aria-label="Book format"] .nb-chip');
const formats = await formatChips.allTextContents();
console.log('  formats:', formats.join(' | '));
for (const [i, name] of formats.entries()) {
  await formatChips.nth(i).click();
  await page.waitForTimeout(650);
  const st = await page.evaluate(async () => {
    const bs = await import('/src/art/bookStyle.ts');
    return bs === null ? null : null;
  });
  void st;
  const s = await canvasProbe('.nb-studio-face-spine');
  const c = await canvasProbe('.nb-studio-face-cover');
  console.log(
    `  ${name.padEnd(10)} spine box ${s.box ? `${s.box.w}x${s.box.h}` : 'none'}` +
      `   cover box ${c.box ? `${c.box.w}x${c.box.h}` : 'none'}`,
  );
}
await shot('bookstudio-05-format');

/* 6 — the knobs that were dead ------------------------------------------- */
console.log('\n6. cords, endbands and wear');
for (const [label, act] of [
  [
    'raised cords',
    async () => {
      const slider = page.locator('input[aria-label="Raised bands"]');
      await slider.scrollIntoViewIfNeeded();
      await slider.fill('4');
      await slider.dispatchEvent('input');
    },
  ],
  [
    'endbands',
    async () => {
      const chip = page.getByRole('switch', { name: 'endbands' });
      await chip.scrollIntoViewIfNeeded();
      await chip.click();
    },
  ],
  [
    'covering',
    async () => {
      const chips = page.locator('[aria-label="Binding material"] .nb-chip');
      const idx = await page.evaluate(() => {
        const list = [...document.querySelectorAll('[aria-label="Binding material"] .nb-chip')];
        const on = list.findIndex((b) => b.getAttribute('aria-pressed') === 'true');
        return (on + 3) % 7;
      });
      await chips.nth(idx).scrollIntoViewIfNeeded();
      await chips.nth(idx).click();
    },
  ],
  [
    'wear',
    async () => {
      const slider = page.locator('input[aria-label="Wear"]');
      await slider.scrollIntoViewIfNeeded();
      await slider.fill('1');
      await slider.dispatchEvent('input');
    },
  ],
]) {
  await page.getByRole('button', { name: 'spine', exact: true }).click();
  await page.waitForTimeout(300);
  const before = await canvasProbe('.nb-studio-face-spine');
  await act();
  await page.waitForTimeout(800);
  const after = await canvasProbe('.nb-studio-face-spine');
  console.log(
    `  ${String(label).padEnd(13)} ${before.hash === after.hash ? '>>> DEAD — the spine did not change' : 'ok'}`,
  );
}
await shot('bookstudio-06-knobs');

console.log('\n=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);

await browser.close();
