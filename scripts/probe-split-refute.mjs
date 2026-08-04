/**
 * scripts/probe-split-refute.mjs — an INDEPENDENT check of the two claims the
 * page-fill work rests on, measured in the running app rather than read out of
 * the table the same work wrote.
 *
 * (1) A container has a MINIMUM: `max(min, chrome + children)`.
 * (2) A container NARROWS what it holds, so the same 287 characters wrap to a
 *     different number of lines in each one — and the estimator has to cost
 *     children in the container's frame, not the page's.
 *
 * For every specimen it prints, side by side:
 *   applied   the laid-out flow of the block on its own leaf, in page lines
 *   estimate  what `blockLineCost` in src/features/templates/split.ts says
 *
 * Then it runs the payoff: a keepsake-heavy document through
 * `createBookFromScript` (the call the Markdown import and the templates
 * gallery both make), and asks whether every page the splitter made fits the
 * leaf it landed on — a book that comes back with MORE leaves than pages is the
 * overflow contract firing, which is the failure the whole model exists to stop.
 *
 * Usage: node scripts/probe-split-refute.mjs [outDir]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const outDir = process.argv[2] ?? 'qa/tmp/split-refute';
mkdirSync(outDir, { recursive: true });

/** The very 287 characters the claim quotes. */
const LONG =
  'Lx and then a good deal more of it, because a container is narrower than ' +
  'the leaf it stands on and the only way to learn how much narrower is to ' +
  'let a real sentence wrap inside one and count the lines it took to say ' +
  'itself, which is what this paragraph is doing right now on your behalf.';
const SHORT = 'Sx';

/** [name, script] — one specimen per leaf. */
const SPECIMENS = [
  ['page-long', LONG],
  ['card-long', `::: card {title="A title"}\n${LONG}\n:::`],
  ['banner-long', `::: banner {color=moss}\n${LONG}\n:::`],
  ['postcard-long', `::: postcard {title="WISH YOU WERE HERE"}\n${LONG}\n:::`],
  ['quote-card-long', `::: quote-card {color=amber}\n${LONG}\n:::`],
  ['pressed-flower-long', `::: pressed-flower {title="A title"}\n${LONG}\n:::`],
  // The minimum side: one short line in things that are object-sized whatever
  // is written on them.
  ['index-card-short', `::: index-card {title="A title"}\n${SHORT}\n:::`],
  ['pressed-flower-short', `::: pressed-flower {title="A title"}\n${SHORT}\n:::`],
  ['postcard-short', `::: postcard {title="WISH YOU WERE HERE"}\n${SHORT}\n:::`],
  ['wax-seal-short', `::: wax-seal {title=A}\n${SHORT}\n:::`],
  ['ticket-stub-short', `::: ticket-stub {title="ADMIT ONE"}\n${SHORT}\n:::`],
  ['callout-short', `::: callout {variant=tip}\n${SHORT}\n:::`],
  ['marginalia-short', `::: marginalia\n${SHORT}\n:::`],
];

const marker = (i) => `R${String(i).padStart(2, '0')}`;
const BATTERY = SPECIMENS.map((s, i) => `# ${marker(i)}\n\n${s[1]}\n`).join('\n');

/*
 * The payoff document: keepsakes and prose mixed, no headings after the first,
 * so every cut is the estimator's own decision. Deliberately heavier on the
 * containers that narrow hardest — a postcard sets 27 characters to a line —
 * because that is the case the claim says used to overflow.
 */
const PARA =
  'The estimator has to decide this without a browser, which is the whole ' +
  'difficulty: it is handed a parsed block and has to say how much of a leaf ' +
  'the block will take once a font it cannot see has wrapped it in a column ' +
  'it cannot measure.';
const fill = ['# A keepsake import with one heading in it\n'];
for (let i = 0; i < 20; i += 1) {
  fill.push(`${PARA} Section ${i}.\n`);
  if (i % 3 === 0) fill.push(`::: postcard {title="WISH YOU WERE HERE"}\n${PARA}\n:::\n`);
  if (i % 3 === 1) fill.push(`::: index-card {title="A keepsake"}\n${PARA}\n:::\n`);
  if (i % 4 === 2) fill.push(`::: quote-card {color=amber}\n${PARA}\n:::\n`);
  if (i % 5 === 3) fill.push(`- ${PARA}\n- A short line on its own.\n`);
  if (i % 6 === 4) fill.push(`::: pressed-flower {title="A pressing"}\nOne line.\n:::\n`);
}
const FILL_SOURCE = fill.join('\n');

// ---------------------------------------------------------------------------

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
p.on('pageerror', (e) => console.log('  page error:', e.message));

const skipTour = async () => {
  for (let i = 0; i < 30; i++) {
    const skip = p.locator('text=skip the tour').first();
    if ((await skip.count()) === 0) {
      if (i > 2) break;
    } else {
      await skip.click({ force: true, timeout: 4000 }).catch(() => {});
    }
    await p.waitForTimeout(700);
  }
};

const boot = async () => {
  await p.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
    polling: 500,
    timeout: 90_000,
  });
  await p.waitForTimeout(4000);
  await skipTour();
};

await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await boot();

const made = await p.evaluate(
  async ([battery, fillSource]) => {
    const mod = await import('/src/features/templates/createFromScript.ts');
    const a = await mod.createBookFromScript(battery, 'Refute battery');
    const c = await mod.createBookFromScript(fillSource, 'Refute fill');
    return {
      battery: { title: a.book.title, pages: a.pages.length },
      fill: { title: c.book.title, pages: c.pages.length },
    };
  },
  [BATTERY, FILL_SOURCE],
);
console.log(`  battery book "${made.battery.title}" — ${made.battery.pages} pages`);
console.log(`  fill book    "${made.fill.title}" — ${made.fill.pages} pages`);

/** What the estimator says, per specimen — the SAME module the splitter uses. */
const estimates = await p.evaluate(async (specimens) => {
  const split = await import('/src/features/templates/split.ts');
  const script = await import('/src/script/index.ts');
  return specimens.map(([name, body]) => {
    const blocks = script.parse(body).blocks;
    return {
      name,
      blocks: blocks.length,
      estimate: blocks.reduce((n, blk) => n + split.blockLineCost(blk), 0),
    };
  });
}, SPECIMENS);

const openBook = async (title) => {
  await p.reload({ waitUntil: 'domcontentloaded' });
  await boot();
  for (let attempt = 0; attempt < 6; attempt++) {
    if ((await p.locator('.nb-book-view').count()) > 0) break;
    if ((await p.locator('[data-testid="pulled-book-hand"]').count()) === 0) {
      await p
        .locator('.shelf-a11y button', { hasText: title })
        .first()
        .dispatchEvent('click')
        .catch(() => {});
      await p
        .locator('[data-testid="pulled-book-hand"]')
        .waitFor({ state: 'visible', timeout: 20_000 })
        .catch(() => {});
    }
    await p.keyboard.press('Enter');
    await p.waitForTimeout(2500);
  }
  await p
    .locator('.nb-leaf-paper')
    .first()
    .waitFor({ state: 'visible', timeout: 40_000 })
    .catch(() => {});
  await p.waitForTimeout(2500);
  return (await p.locator('.nb-book-view').count()) > 0;
};

/** Laid-out px only — a leaf carries a 3D transform, so rects are in drawn px. */
const readSpread = async () =>
  p.evaluate(() => {
    const leaves = [];
    for (const paper of document.querySelectorAll('.nb-leaf-paper')) {
      const root = paper.querySelector('.nb-prose');
      if (paper.querySelector('.nb-leaf-blank') !== null || root === null) continue;
      const ps = getComputedStyle(paper);
      const line = Number.parseFloat(getComputedStyle(root).lineHeight) || 32;
      const capacity =
        paper.clientHeight -
        (Number.parseFloat(ps.paddingTop) || 0) -
        (Number.parseFloat(ps.paddingBottom) || 0);
      const kids = Array.from(root.children).filter(
        (el) => el.nodeType === 1 && !el.classList.contains('ProseMirror-trailingBreak'),
      );
      const inked = (el) =>
        (el.textContent ?? '').trim() !== '' ||
        el.querySelector('img, svg, canvas, hr, table') !== null;
      const blocks = kids.map((el, i) => {
        const cs = getComputedStyle(el);
        const next = kids[i + 1];
        const mb = Number.parseFloat(cs.marginBottom) || 0;
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.textContent ?? '').trim().slice(0, 30),
          flow: next === undefined ? el.offsetHeight + mb : next.offsetTop - el.offsetTop,
        };
      });
      let last = kids.length - 1;
      while (last >= 0 && !inked(kids[last])) last -= 1;
      const bottom = last < 0 ? 0 : kids[last].offsetTop + kids[last].offsetHeight;
      leaves.push({
        line,
        capacity,
        used: bottom,
        fill: bottom / capacity,
        overflowing: bottom > capacity,
        blocks,
      });
    }
    return leaves;
  });

const readSettled = async () => {
  let last = await readSpread();
  for (let i = 0; i < 8; i++) {
    await p.waitForTimeout(800);
    const next = await readSpread();
    if (JSON.stringify(next) === JSON.stringify(last)) return next;
    last = next;
  }
  return last;
};

const walk = async (spreads, tag) => {
  const seen = [];
  let previous = '';
  for (let spread = 0; spread < spreads; spread++) {
    await p.waitForTimeout(1200);
    let read = await readSettled();
    for (let retry = 0; retry < 3; retry++) {
      const signature = read.map((l) => l.blocks.map((x) => x.text).join('~')).join('|');
      if (spread === 0 || signature !== previous) break;
      await p.keyboard.press('ArrowRight');
      await p.waitForTimeout(1400);
      read = await readSettled();
    }
    previous = read.map((l) => l.blocks.map((x) => x.text).join('~')).join('|');
    if (read.length === 0) break;
    for (const leaf of read) seen.push(leaf);
    await p
      .locator('.nb-book-view')
      .screenshot({
        path: `${outDir}/${tag}-${String(spread + 1).padStart(2, '0')}.png`,
        animations: 'disabled',
        timeout: 15_000,
      })
      .catch(() => {});
    await p.keyboard.press('ArrowRight');
  }
  return seen;
};

// --- part A: the two claims ------------------------------------------------

if (!(await openBook(made.battery.title))) {
  console.log('  battery book never opened — is the dev server up on :1420?');
  await p.screenshot({ path: `${outDir}/failed.png` });
  await b.close();
  process.exit(1);
}
const batteryLeaves = await walk(20, 'battery');

const rows = [];
for (const leaf of batteryLeaves) {
  let name = null;
  for (const block of leaf.blocks) {
    const hit = /^R\d\d$/.exec(block.text);
    if (block.tag === 'h1' && hit !== null) {
      const i = Number(hit[0].slice(1));
      name = SPECIMENS[i] === undefined ? null : SPECIMENS[i][0];
      continue;
    }
    if (name === null) continue;
    if (rows.some((r) => r.name === name)) continue;
    const est = estimates.find((e) => e.name === name);
    rows.push({
      name,
      applied: block.flow / leaf.line,
      estimate: est === undefined ? null : est.estimate,
    });
    name = null;
  }
}

const pad = (s, n) => String(s).padEnd(n);
console.log('');
console.log(`  --- part A: applied vs blockLineCost (leaf line ${batteryLeaves[0]?.line ?? '?'}px) ---`);
console.log(`  ${pad('specimen', 24)}${pad('applied', 10)}${pad('estimate', 10)}error`);
let worst = 0;
for (const r of rows) {
  const err = r.estimate === null ? null : r.estimate - r.applied;
  if (err !== null) worst = Math.max(worst, Math.abs(err));
  console.log(
    `  ${pad(r.name, 24)}${pad(r.applied.toFixed(2), 10)}` +
      `${pad(r.estimate === null ? '—' : r.estimate.toFixed(2), 10)}` +
      (err === null ? '—' : (err > 0 ? '+' : '') + err.toFixed(2)),
  );
}
const missed = SPECIMENS.map((s) => s[0]).filter((n) => !rows.some((r) => r.name === n));
if (missed.length > 0) console.log(`  NOT MEASURED: ${missed.join(', ')}`);
console.log(`  worst error: ${worst.toFixed(2)} lines`);

// --- part B: does an imported book fit the leaves it landed on? ------------

if (!(await openBook(made.fill.title))) {
  console.log('  fill book never opened.');
  await b.close();
  process.exit(1);
}
const fillLeaves = await walk(20, 'fill');
const fills = fillLeaves.map((l) => l.fill).sort((a, b) => a - b);
const over = fillLeaves.filter((l) => l.overflowing);
console.log('');
console.log('  --- part B: the splitter against the leaves ---');
console.log(
  `  leaves walked ${fillLeaves.length}, pages the splitter made ${made.fill.pages}`,
);
if (fills.length > 0) {
  console.log(
    `  fill: min ${(fills[0] * 100).toFixed(0)}%  median ${(
      fills[fills.length >> 1] * 100
    ).toFixed(0)}%  max ${(fills[fills.length - 1] * 100).toFixed(0)}%`,
  );
}
console.log(
  fillLeaves.length > made.fill.pages
    ? `  OVERFLOWED: the book grew ${fillLeaves.length - made.fill.pages} leaves`
    : '  no leaf gained a page after it was made',
);
if (over.length > 0) console.log(`  ${over.length} leaf/leaves drawn past capacity`);

writeFileSync(
  `${outDir}/refute.json`,
  `${JSON.stringify({ made, rows, fillLeaves }, null, 2)}\n`,
);
console.log('');
console.log(`  raw: ${outDir}/refute.json`);

await b.close();
