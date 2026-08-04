/**
 * scripts/probe-chrome-crosscheck.mjs — an INDEPENDENT re-measurement of the
 * container chrome table, written to refute `probe-block-heights.mjs` rather
 * than to agree with it.
 *
 * It differs from that probe on purpose:
 *
 *   - it builds the specimen book by typing nothing and importing nothing
 *     itself; it goes through `createBookFromScript` and then RELOADS, so what
 *     is measured is what came back out of the store;
 *   - it measures the payload's spend by walking the container's own text
 *     nodes, not by matching a marker word, so a container whose chrome
 *     happens to contain the marker cannot inflate `inner`;
 *   - it re-derives the line height from `.nb-prose` and from the ruled paper
 *     background, so "32px lines" is checked rather than assumed;
 *   - it carries the four media containers (polaroid / photo-corner /
 *     image-row / columns) that `PART=containers` cuts off.
 *
 * Usage: node scripts/probe-chrome-crosscheck.mjs [outDir]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const outDir = process.argv[2] ?? 'qa/tmp/chrome-crosscheck';
mkdirSync(outDir, { recursive: true });

const SHORT = 'Sx';
const LONG =
  'Lx and then a good deal more of it, because a container is narrower than ' +
  'the leaf it stands on and the only way to learn how much narrower is to ' +
  'let a real sentence wrap inside one and count the lines it took to say ' +
  'itself, which is what this paragraph is doing right now on your behalf.';
const KITTEN = '/kittens/ginger.svg';

/** name → script body. A spot-check of the plain containers plus all four media ones. */
const CASES = [
  ['marginalia-short', `::: marginalia\n${SHORT}\n:::`],
  ['callout-short', `::: callout {variant=tip}\n${SHORT}\n:::`],
  ['callout-long', `::: callout {variant=tip}\n${LONG}\n:::`],
  ['card-short', `::: card {title="A title"}\n${SHORT}\n:::`],
  ['card-long', `::: card {title="A title"}\n${LONG}\n:::`],
  ['postcard-short', `::: postcard {title="WISH YOU WERE HERE"}\n${SHORT}\n:::`],
  ['postcard-long', `::: postcard {title="WISH YOU WERE HERE"}\n${LONG}\n:::`],
  ['pressed-flower-short', `::: pressed-flower {title="A title"}\n${SHORT}\n:::`],
  ['polaroid', `::: polaroid\n![A kitten](${KITTEN})\n${SHORT}\n:::`],
  ['photo-corner', `::: photo-corner {title="A title"}\n![A kitten](${KITTEN})\n${SHORT}\n:::`],
  [
    'image-row-3',
    `::: image-row {style=polaroid, cols=3}\n` +
      `![A kitten](${KITTEN}){caption="One"}\n` +
      `![A kitten](${KITTEN}){caption="Two"}\n` +
      `![A kitten](${KITTEN}){caption="Three"}\n:::`,
  ],
  ['columns-2', `::: columns {gap=lg}\n::: col\n${SHORT}\n:::\n::: col\n${LONG}\n:::\n:::`],
];

const marker = (i) => `V${String(i).padStart(2, '0')}`;
const BATTERY = CASES.map(([, body], i) => `# ${marker(i)}\n\n${body}\n`).join('\n');

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
// VIEWPORT=1280x800 re-asks the same question at another window size: chrome
// baked as a constant number of LINES is only a constant if the padding that
// makes it scales with the ruling.
const [vw, vh] = (process.env.VIEWPORT ?? '1600x1000').split('x').map(Number);
const p = await b.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
p.on('pageerror', (e) => console.log('  page error:', e.message));

const skipTour = async () => {
  for (let i = 0; i < 25; i++) {
    const skip = p.locator('text=skip the tour').first();
    if ((await skip.count()) === 0) {
      if (i > 2) break;
    } else {
      await skip.click({ force: true, timeout: 4000 }).catch(() => {});
    }
    await p.waitForTimeout(600);
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

const made = await p.evaluate(async (source) => {
  const mod = await import('/src/features/templates/createFromScript.ts');
  const res = await mod.createBookFromScript(source, 'Crosscheck');
  return { id: res.book.id, title: res.book.title, pages: res.pages.length };
}, BATTERY);
console.log(`  specimen book: "${made.title}" — ${made.pages} pages`);

await p.reload({ waitUntil: 'domcontentloaded' });
await boot();

for (let attempt = 0; attempt < 6; attempt++) {
  if ((await p.locator('.nb-book-view').count()) > 0) break;
  if ((await p.locator('[data-testid="pulled-book-hand"]').count()) === 0) {
    await p
      .locator('.shelf-a11y button', { hasText: made.title })
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
await p.locator('.nb-leaf-paper').first().waitFor({ state: 'visible', timeout: 40_000 }).catch(() => {});
await p.waitForTimeout(2500);

if ((await p.locator('.nb-book-view').count()) === 0) {
  console.log('  book view never opened — is the dev server up on :1420?');
  await p.screenshot({ path: `${outDir}/failed.png` });
  await b.close();
  process.exit(1);
}

const readSpread = async () =>
  p.evaluate(() => {
    const out = [];
    for (const paper of document.querySelectorAll('.nb-leaf-paper')) {
      const root = paper.querySelector('.nb-prose');
      if (paper.querySelector('.nb-leaf-blank') !== null || root === null) continue;
      const ps = getComputedStyle(paper);
      const rs = getComputedStyle(root);
      const line = Number.parseFloat(rs.lineHeight) || 0;
      // Independent read of the ruling: the paper's own line-height custom prop.
      const ruled = Number.parseFloat(
        getComputedStyle(paper).getPropertyValue('--page-line-height'),
      );
      const capacity =
        paper.clientHeight -
        (Number.parseFloat(ps.paddingTop) || 0) -
        (Number.parseFloat(ps.paddingBottom) || 0);
      const kids = Array.from(root.children).filter(
        (el) => el.nodeType === 1 && !el.classList.contains('ProseMirror-trailingBreak'),
      );
      const blocks = kids.map((el, i) => {
        const cs = getComputedStyle(el);
        const mb = Number.parseFloat(cs.marginBottom) || 0;
        const next = kids[i + 1];
        const flow = next === undefined ? el.offsetHeight + mb : next.offsetTop - el.offsetTop;
        /*
         * `inner`: the union of the line boxes the PAYLOAD text occupies,
         * found from the text nodes themselves via Range rects rather than
         * from a marker match on a <p>. A container that prints its own title
         * cannot be counted, because the title is not the payload text.
         */
        let inner = null;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let top = Infinity;
        let bottom = -Infinity;
        let found = false;
        for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
          if (!/\b(Sx|Lx)\b/.test(n.textContent ?? '')) continue;
          const r = document.createRange();
          r.selectNodeContents(n);
          const list = Array.from(r.getClientRects());
          if (list.length === 0) continue;
          found = true;
          for (const rect of list) {
            top = Math.min(top, rect.top);
            bottom = Math.max(bottom, rect.bottom);
          }
        }
        if (found) {
          // Client rects are in DRAWN px (the leaf carries a 3D transform);
          // convert back to laid-out px with the element's own scale factor.
          const box = el.getBoundingClientRect();
          const scale = el.offsetHeight > 0 ? box.height / el.offsetHeight : 1;
          inner = (bottom - top) / (scale || 1);
        }
        return {
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('data-type'),
          text: (el.textContent ?? '').trim().slice(0, 30),
          own: el.offsetHeight + (Number.parseFloat(cs.marginTop) || 0) + mb,
          flow,
          innerTextRun: inner,
        };
      });
      out.push({ line, ruled, capacity, paper: paper.clientHeight, blocks });
    }
    return out;
  });

const readSettled = async () => {
  let last = await readSpread();
  for (let i = 0; i < 8; i++) {
    await p.waitForTimeout(700);
    const next = await readSpread();
    if (JSON.stringify(next) === JSON.stringify(last)) return next;
    last = next;
  }
  return last;
};

const rows = new Map();
let geometry = null;
let previous = '';
for (let spread = 0; spread < 12; spread++) {
  await p.waitForTimeout(1200);
  let read = await readSettled();
  for (let retry = 0; retry < 3; retry++) {
    const sig = read.map((l) => l.blocks.map((x) => x.text).join('~')).join('|');
    if (spread === 0 || sig !== previous) break;
    await p.keyboard.press('ArrowRight');
    await p.waitForTimeout(1400);
    read = await readSettled();
  }
  previous = read.map((l) => l.blocks.map((x) => x.text).join('~')).join('|');
  if (read.length === 0) break;
  for (const leaf of read) {
    geometry ??= { line: leaf.line, ruled: leaf.ruled, capacity: leaf.capacity, paper: leaf.paper };
    let m = null;
    for (const block of leaf.blocks) {
      const hit = /^V\d\d$/.exec(block.text);
      if (block.tag === 'h1' && hit !== null) {
        m = hit[0];
        continue;
      }
      if (m === null || rows.has(m)) continue;
      const i = Number(m.slice(1));
      if (CASES[i] === undefined) continue;
      rows.set(m, { marker: m, name: CASES[i][0], ...block });
    }
  }
  await p
    .locator('.nb-book-view')
    .screenshot({
      path: `${outDir}/spread-${String(spread + 1).padStart(2, '0')}.png`,
      animations: 'disabled',
      timeout: 15_000,
    })
    .catch(() => {});
  await p.keyboard.press('ArrowRight');
}

if (geometry === null) {
  console.log('  nothing measured.');
  await b.close();
  process.exit(1);
}
const L = geometry.line;
console.log('');
console.log(
  `  leaf ${geometry.paper}px · capacity ${geometry.capacity}px · prose line ${L}px · ` +
    `--page-line-height ${geometry.ruled}px  →  ${(geometry.capacity / L).toFixed(2)} lines/leaf`,
);
console.log('');
const pad = (s, n) => String(s).padEnd(n);
console.log(`  ${pad('case', 22)}${pad('flow', 9)}${pad('own', 9)}${pad('textRun', 9)}node`);
for (const r of [...rows.values()].sort((a, b) => a.marker.localeCompare(b.marker))) {
  console.log(
    `  ${pad(r.name, 22)}${pad((r.flow / L).toFixed(2), 9)}${pad((r.own / L).toFixed(2), 9)}` +
      `${pad(r.innerTextRun === null ? '—' : (r.innerTextRun / L).toFixed(2), 9)}${r.type ?? r.tag}`,
  );
}
const missing = CASES.map((_, i) => marker(i)).filter((m) => !rows.has(m));
if (missing.length > 0) {
  console.log(`  NOT MEASURED: ${missing.map((m) => CASES[Number(m.slice(1))][0]).join(', ')}`);
}
writeFileSync(
  `${outDir}/crosscheck.json`,
  `${JSON.stringify({ geometry, rows: [...rows.values()] }, null, 2)}\n`,
);
console.log('');
console.log(`  raw: ${outDir}/crosscheck.json`);
await b.close();
