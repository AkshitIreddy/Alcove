import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const outDir = process.argv[2] ?? 'qa/tmp/verify778';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1360, height: 850 },
  deviceScaleFactor: 1,
});
await page.emulateMedia({ reducedMotion: 'no-preference' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

const boot = async () => {
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
    polling: 400, timeout: 120_000,
  });
  await page.evaluate(async () => { await globalThis.__shelfWorld.ready; });
  const skip = page.getByText('skip the tour');
  if (await skip.count()) { await skip.first().click({ force: true }); await page.waitForTimeout(900); }
};

await page.goto('http://localhost:1420/?fx=force&dev=0', { waitUntil: 'domcontentloaded' });
await boot();

const welcome = await page.evaluate(() => {
  const books = globalThis.__shelfVisibleBooks?.() ?? [];
  const b = books.find((x) => /welcome/i.test(x.title)) ?? books[0];
  if (b) globalThis.__shelfPullOut(b.id);
  return b ? { id: b.id, title: b.title } : null;
});
console.log('book:', JSON.stringify(welcome));
await page.waitForSelector('.pulled-book', { timeout: 60_000 });
await page.waitForTimeout(1400);
const cover = await page.locator('.pulled-book').first().boundingBox();
if (cover) await page.mouse.click(cover.x + cover.width / 2, cover.y + cover.height / 2);
await page.waitForSelector('.nb-book-view', { timeout: 60_000 });
await page.waitForTimeout(3000);

const measure = () => page.evaluate(() => {
  const leaves = Array.from(document.querySelectorAll('.nb-leaf-paper'));
  const out = [];
  leaves.forEach((leaf, i) => {
    const rails = Array.from(leaf.querySelectorAll('.nb-footnote-rail'))
      .filter((r) => r.getBoundingClientRect().height > 1);
    const prose = leaf.querySelector('.nb-prose');
    if (rails.length === 0 || !prose) return;
    const rail = rails[0];
    const rr = rail.getBoundingClientRect();
    const hits = [];
    for (const kid of Array.from(prose.children)) {
      const kr = kid.getBoundingClientRect();
      const ov = Math.min(rr.bottom, kr.bottom) - Math.max(rr.top, kr.top);
      const ovx = Math.min(rr.right, kr.right) - Math.max(rr.left, kr.left);
      if (ov > 1 && ovx > 1) {
        hits.push({
          type: kid.getAttribute('data-type') ?? kid.tagName.toLowerCase(),
          text: (kid.textContent ?? '').slice(0, 34).replace(/\s+/g, ' '),
          overlapPx: Math.round(ov),
        });
      }
    }
    const last = prose.lastElementChild?.getBoundingClientRect();
    out.push({
      leaf: i,
      head: (prose.textContent ?? '').slice(0, 34).replace(/\s+/g, ' '),
      blocks: prose.children.length,
      rail: [Math.round(rr.top), Math.round(rr.bottom)],
      railText: (rail.textContent ?? '').replace(/\s+/g, ' ').slice(0, 50),
      padBottom: getComputedStyle(prose).paddingBottom,
      proseBottom: Math.round(prose.getBoundingClientRect().bottom),
      lastBlockBottom: last ? Math.round(last.bottom) : null,
      hits,
    });
  });
  return out;
});

const log = [];
const snap = async (tag) => {
  const m = await measure();
  if (m.length) {
    log.push({ tag, m });
    console.log(tag, JSON.stringify(m));
    await page.screenshot({ path: `${outDir}/${tag}.png` });
  }
  return m;
};

await snap('t00-settled');
for (let turn = 1; turn <= 7; turn += 1) {
  await page.evaluate(() => { const el = document.activeElement; if (el instanceof HTMLElement) el.blur(); });
  await page.waitForTimeout(250);
  await page.keyboard.press('ArrowRight');
  for (const t of [200, 200, 200, 300, 400, 500]) {
    await page.waitForTimeout(t);
    await snap(`t${String(turn).padStart(2, '0')}-mid-${Date.now() % 100000}`);
  }
  await page.waitForTimeout(1500);
  await snap(`t${String(turn).padStart(2, '0')}-settled`);
}

writeFileSync(`${outDir}/log.json`, JSON.stringify({ errors, log }, null, 1));
console.log('errors:', errors);
await browser.close();
