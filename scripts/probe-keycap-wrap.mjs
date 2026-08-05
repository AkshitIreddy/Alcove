/**
 * scripts/probe-keycap-wrap.mjs — is a key cap still one object at the end of
 * a line?
 *
 * Frame 617 of the recorded demo shows the Welcome book's studio callout with
 * the cap `Ctrl Alt N` split across two lines: an open-ended pill trailing off
 * the end of one line and a second one opening the next. A cap is one key, and
 * a key drawn as two halves reads as two keys that are both broken.
 *
 * The measurement is exact rather than visual. A broken inline box reports one
 * client rect PER LINE FRAGMENT, so `getClientRects().length > 1` on a cap is
 * the defect itself, named in numbers. An atomic inline box always reports
 * one — including when its own text wraps inside it, which is the other half
 * of what is being asserted here: the cap must not overflow the column either,
 * and pages in this app have no scrollbar to hide that with.
 *
 * The before/after is taken in ONE run, on the same spread, by injecting a
 * style tag that puts the caps back on `display: inline` — the shape the CSS
 * had at frame 617. Two pictures of the same paper with one declaration
 * between them beats two runs of an app that re-seeds itself.
 *
 * It ends by typing a deliberately over-long cap into a page, because "never
 * break" is easy to buy by letting the cap run off the sheet.
 *
 * Usage: node scripts/probe-keycap-wrap.mjs [outDir] [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const outDir = process.argv[2]?.startsWith('--')
  ? 'qa/tmp/keycap-wrap'
  : (process.argv[2] ?? 'qa/tmp/keycap-wrap');
const URL_BASE =
  process.argv.find((a) => a.startsWith('--url='))?.slice(6) ??
  'http://localhost:1420';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
  ],
});
// The demo was recorded at this size, and where a line breaks is a function of
// the column width — a probe for a line break has to stand where the picture
// was taken.
const page = await browser.newPage({
  viewport: { width: 1360, height: 850 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

/* ------------------------------- arrive ---------------------------------- */
await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
  polling: 400,
  timeout: 90_000,
});
await page.evaluate(async () => {
  await globalThis.__shelfWorld.ready;
});
const skip = page.getByText('skip the tour');
if (await skip.count()) {
  await skip.first().click({ force: true });
  await page.waitForTimeout(900);
}

await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  const welcome = list.find((x) => /welcome/i.test(x.title)) ?? list[0];
  app.appState.openBook(welcome.id);
});
await page.waitForSelector('.nb-prose', { timeout: 60_000 });
await page.waitForTimeout(4000);

/**
 * Every cap a reader can actually see, with the count that matters.
 *
 * Only leaves that are on screen and painted: four prose roots are mounted
 * around a turn, and a cap on a leaf still behind the curl canvas is neither
 * broken nor whole — it is not being looked at.
 */
const CAPS = `(() => {
  const seen = [];
  for (const leaf of document.querySelectorAll('.nb-leaf-paper')) {
    const lr = leaf.getBoundingClientRect();
    if (getComputedStyle(leaf).visibility !== 'visible') continue;
    if (lr.width < 40 || lr.right <= 0 || lr.left >= window.innerWidth) continue;
    const prose = leaf.querySelector('.nb-prose');
    if (prose === null) continue;
    const column = prose.getBoundingClientRect();
    for (const cap of prose.querySelectorAll('code')) {
      if (cap.classList.contains('nb-code-body')) continue;
      const rects = cap.getClientRects();
      const box = cap.getBoundingClientRect();
      seen.push({
        text: (cap.textContent ?? '').trim(),
        fragments: rects.length,
        overflowRight: Math.round(box.right - column.right),
        display: getComputedStyle(cap).display,
      });
    }
  }
  return seen;
})()`;

/**
 * A tight crop of the callout the demo frame is a picture of.
 *
 * The full spread proves the cap is whole; only a crop at this size shows
 * whether the pill still sits on the writing line and still stands the height
 * it always did, which is the thing an inline-block could quietly take away.
 */
const capShot = async (name) => {
  const box = await page.evaluate(() => {
    for (const p of document.querySelectorAll('.nb-prose p')) {
      if (!/opens the studio/.test(p.textContent ?? '')) continue;
      const r = p.getBoundingClientRect();
      if (r.width < 40) continue;
      return { x: r.x - 24, y: r.y - 26, width: r.width + 48, height: r.height + 52 };
    }
    return null;
  });
  if (box === null) return;
  await page.screenshot({ path: `${outDir}/${name}.png`, clip: box }).catch(() => {});
};

const visibleText = async () =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('.nb-leaf-paper'))
      .filter((leaf) => {
        const r = leaf.getBoundingClientRect();
        return (
          getComputedStyle(leaf).visibility === 'visible' &&
          r.width > 40 &&
          r.right > 0 &&
          r.left < window.innerWidth
        );
      })
      .map((leaf) => (leaf.textContent ?? '').trim())
      .join(' § '),
  );

/* ------------------- 1. walk to the spread frame 617 shows --------------- */
console.log('\n1. finding the studio callout');
const onStudioSpread = async () => /opens the studio/.test(await visibleText());
for (let i = 0; i < 24 && !(await onStudioSpread()); i += 1) {
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1500);
}
if (!(await onStudioSpread())) {
  console.log('  never reached the studio callout.');
  await browser.close();
  process.exit(1);
}
await page.waitForTimeout(2500);
console.log(`  here: ${(await visibleText()).slice(0, 80)}…`);

/* ------------- 2. BEFORE: the caps put back on display: inline ----------- */
console.log('\n2. before — caps as inline runs, the shape frame 617 was drawn in');
// The handle addStyleTag hands back, kept so the tag can be taken away again
// by identity. Reaching for "the last <style> in the head" instead looked
// equivalent and was not: the app is still appending stylesheets while the
// spread settles, so the tag that came off was somebody else's, the "after"
// picture was a second copy of the "before" one, and every check failed in a
// way that read like the fix had never landed.
const beforeTag = await page.addStyleTag({
  content:
    '.nb-prose code:not(.nb-code-body){display:inline;max-width:none;line-height:inherit;}',
});
await page.waitForTimeout(700);
const before = await page.evaluate(CAPS);
const brokenBefore = before.filter((c) => c.fragments > 1);
console.log(`  ${before.length} caps on the spread, ${brokenBefore.length} split across lines`);
for (const c of brokenBefore) console.log(`    split: "${c.text}" (${c.fragments} fragments)`);
await page
  .locator('.nb-book-view')
  .screenshot({ path: `${outDir}/before.png`, timeout: 15_000 })
  .catch(() => {});
await capShot('before-cap');

/* ---------------------- 3. AFTER: the shipped rule ----------------------- */
console.log('\n3. after — the shipped rule');
// That one tag is the only thing standing between the two pictures.
await beforeTag.evaluate((el) => el.remove());
await page.waitForTimeout(700);
const after = await page.evaluate(CAPS);
const brokenAfter = after.filter((c) => c.fragments > 1);
await page
  .locator('.nb-book-view')
  .screenshot({ path: `${outDir}/after.png`, timeout: 15_000 })
  .catch(() => {});
await capShot('after-cap');

check(
  'the spread has caps to judge',
  after.length > 0,
  `${after.length} cap(s)`,
);
check(
  'no cap on the spread is split across lines',
  brokenAfter.length === 0,
  brokenAfter.map((c) => `"${c.text}"×${c.fragments}`).join(', ') || 'all whole',
);
check(
  'no cap hangs past the edge of its column',
  after.every((c) => c.overflowRight <= 1),
  `worst ${Math.max(0, ...after.map((c) => c.overflowRight))}px`,
);
check(
  'the fix is the one under test (caps are atomic boxes)',
  after.every((c) => c.display === 'inline-block'),
  after[0]?.display ?? '—',
);

/* ------------------ 4. the cap adds no leading to its line ---------------- */
console.log('\n4. the rules');
// An inline box hands the line its OWN line-height; an inline-block hands it a
// whole margin box. Either can push a line taller than the paper's rule, and a
// line pushed taller drags every line under it off the ruling for the rest of
// the page — which is the one thing this change could break silently.
//
// So the reading is per paragraph, against that paragraph's own leading: a
// paragraph carrying nothing but text is an exact number of its own lines
// tall, and a cap that costs its line nothing leaves it that way. Measured in
// both states, because the answer is more interesting than pass/fail — the
// inline cap was ALREADY spending 4px a line here, so the atomic one does not
// merely avoid a new debt, it settles an old one.
const leadingOf = () =>
  page.evaluate(() => {
    const out = [];
    for (const leaf of document.querySelectorAll('.nb-leaf-paper')) {
      const prose = leaf.querySelector('.nb-prose');
      if (prose === null) continue;
      if (prose.getBoundingClientRect().width < 40) continue;
      for (const p of prose.querySelectorAll('p')) {
        if (p.querySelector('code') === null) continue;
        const lead = parseFloat(getComputedStyle(p).lineHeight);
        // offsetHeight, not the client rect: half the callouts on this spread
        // are TILTED a degree or so, and a rotated box reports a taller
        // rectangle than it lays out — the first version of this check read
        // 7.77px of "spare leading" off a paragraph whose real crime was
        // sitting on a tag pinned at an angle. Layout height has no rotation
        // in it. It is rounded to whole pixels, which is what the tolerance
        // below is for.
        const h = p.offsetHeight;
        out.push({
          text: (p.textContent ?? '').trim().slice(0, 26),
          lead: Math.round(lead * 100) / 100,
          height: Math.round(h * 100) / 100,
          spare: Math.round((h - Math.round(h / lead) * lead) * 100) / 100,
        });
      }
    }
    return out;
  });
const leadAfter = await leadingOf();
const againTag = await page.addStyleTag({
  content:
    '.nb-prose code:not(.nb-code-body){display:inline;max-width:none;line-height:inherit;}',
});
await page.waitForTimeout(700);
const leadBefore = await leadingOf();
await againTag.evaluate((el) => el.remove());
await page.waitForTimeout(500);
for (const [i, a] of leadAfter.entries()) {
  const b = leadBefore[i];
  console.log(
    `    "${a.text}" lead ${a.lead}px · spare ${b === undefined ? '?' : b.spare} -> ${a.spare}px`,
  );
}
check(
  'a paragraph carrying a cap is an exact number of its own lines tall',
  leadAfter.length > 0 && leadAfter.every((g) => Math.abs(g.spare) < 1.2),
  `${leadAfter.length} paragraph(s), worst ${Math.max(0, ...leadAfter.map((g) => Math.abs(g.spare))).toFixed(2)}px spare`,
);

/* ------------- 5. an over-long cap stays inside the column --------------- */
console.log('\n5. a cap far too long for the column');
const LONG = 'Ctrl Alt Shift Meta Super Hyper Compose PrintScreen ScrollLock';
await page.locator('.nb-prose').first().click();
await page.keyboard.press('Control+End');
await page.keyboard.press('Enter');
await page.keyboard.type(`\`${LONG}\` `);
await page.waitForTimeout(900);
const long = (await page.evaluate(CAPS)).filter((c) => c.text.startsWith('Ctrl Alt Shift'));
await page
  .locator('.nb-book-view')
  .screenshot({ path: `${outDir}/long-cap.png`, timeout: 15_000 })
  .catch(() => {});
check(
  'the over-long cap reached the page',
  long.length > 0,
  long.map((c) => `"${c.text.slice(0, 24)}…"`).join(', ') || 'not found',
);
check(
  'it is still one box',
  long.every((c) => c.fragments === 1),
  long.map((c) => c.fragments).join(', '),
);
check(
  'and it did not run off the column',
  long.every((c) => c.overflowRight <= 1),
  `worst ${Math.max(0, ...long.map((c) => c.overflowRight))}px`,
);

/* ------------- 6. the code BLOCK is not a cap and never was -------------- */
console.log('\n6. a code block, which shares the <code> tag and nothing else');
// A block's body is a <code> inside .nb-prose too, and `.nb-prose code` beats
// the single class it is styled with — so a rule written for caps lands on the
// block unless it is told not to. Typing a fence is the only way to find out
// whether the guard holds, because the block is a node view that nothing else
// on this spread mounts.
await page.keyboard.press('Enter');
await page.keyboard.type('```js ');
await page.waitForTimeout(700);
const block = await page.evaluate(() => {
  const body = document.querySelector('.nb-prose .nb-code-body');
  if (body === null) return null;
  const s = getComputedStyle(body);
  return { display: s.display, fontSize: s.fontSize, padding: s.padding };
});
check('a fence still makes a code block', block !== null, JSON.stringify(block));
check(
  "and the block's body is still a block",
  block?.display === 'block',
  block?.display ?? '—',
);

// Put the book back the way it was found. This dev server is shared, and a
// probe that leaves a stray code block and a sixty-character cap in the
// Welcome book has changed what the next agent's probe is looking at.
for (let i = 0; i < 14; i += 1) {
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(120);
}
await page.waitForTimeout(600);
const leftovers = await page.evaluate(
  () =>
    document.body.textContent?.includes('PrintScreen ScrollLock') === true ||
    document.querySelector('.nb-prose .nb-code-body') !== null,
);
check('the Welcome book was left as it was found', !leftovers);

console.log('');
console.log(`  pictures: ${outDir}/`);
console.log('  page errors:', errors.length ? errors.slice(0, 3) : 'none');
console.log(fails.length === 0 ? '\n  all checks passed' : `\n  FAILED: ${fails.join(', ')}`);
await browser.close();
process.exit(fails.length === 0 ? 0 : 1);
