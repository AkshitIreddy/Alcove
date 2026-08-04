/**
 * scripts/probe-block-heights.mjs — MEASURE what a block actually draws on a
 * leaf, in units of the page's own line height, in the RUNNING app.
 *
 * This exists because `features/templates/split.ts` had to guess. Its
 * `blockLineCost` charged every container the same `2 + children` while the
 * real chrome ranges from a hairline (a `tag` is an inline pill) to six lines
 * (a `pressed-flower` has a title plate, a mount and a caption), so a page of
 * small blocks was charged for a full leaf and covered two thirds of one, and a
 * page of keepsakes was charged for two thirds and overflowed. Neither is
 * visible from the source: the estimator's numbers are only wrong RELATIVE to
 * pixels nobody had counted.
 *
 * ## How it measures
 *
 * A specimen book is created through the REAL authored path
 * (`createBookFromScript`, which is what the Markdown import and the templates
 * gallery both call), then opened and walked. For every top-level block on
 * every leaf it records:
 *
 *   - `own`   — the block's own margin box, in laid-out px
 *   - `flow`  — the distance to the next block's top, which is what the page
 *               actually spends on it once margins have collapsed
 *   - `inner` — the summed flow of the block's own children, for a container
 *
 * ...and divides by the leaf's line height (`--page-line-height`, 32px). Every
 * number is LAID-OUT px (`offsetTop`/`offsetHeight`), never
 * `getBoundingClientRect`: a leaf carries a 3D transform, so drawn px and CSS
 * px differ by whatever the spread is scaled to, and only laid-out px are in
 * the same units as the CSS line height they are divided by.
 *
 * Each container is measured twice — once holding one short line, once holding
 * a long paragraph — so the fixed chrome and the per-line slope come out
 * separately instead of being one blended number:
 *
 *   chrome = flow(container) − inner(container)
 *
 * Usage: node scripts/probe-block-heights.mjs [outDir]
 *   JSON=path   also write the raw table there
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const outDir = process.argv[2] ?? 'qa/tmp/block-heights';
mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------------------
// The battery. Every specimen is preceded by nothing and identified by its
// own node type plus the marker word its payload starts with, so a specimen
// that lands on a later leaf (the overflow contract firing) is still matched.
// ---------------------------------------------------------------------------

const SHORT = 'Sx';
const LONG =
  'Lx and then a good deal more of it, because a container is narrower than ' +
  'the leaf it stands on and the only way to learn how much narrower is to ' +
  'let a real sentence wrap inside one and count the lines it took to say ' +
  'itself, which is what this paragraph is doing right now on your behalf.';

/** Containers that hold plain blocks — measured with both payloads. */
const PLAIN_CONTAINERS = [
  ['sticky-note', '{color=lemon}'],
  ['washi-box', '{color=sky}'],
  ['callout', '{variant=tip}'],
  ['card', '{title="A title"}'],
  ['quote-card', '{color=amber}'],
  ['spoiler', ''],
  ['banner', '{color=moss}'],
  ['index-card', '{title="A title"}'],
  ['envelope', '{color=amber}'],
  ['stamp', '{color=terracotta}'],
  ['tag', '{color=moss}'],
  ['marginalia', ''],
  ['pressed-flower', '{title="A title"}'],
  ['ticket-stub', '{title="ADMIT ONE"}'],
  ['postcard', '{title="WISH YOU WERE HERE"}'],
  ['ledger', '{title="A title"}'],
  ['wax-seal', '{title=A}'],
  ['map-pin', '{title="The blue door"}'],
  ['toggle', '{title="A fold", open}'],
];

const KITTEN = '/kittens/ginger.svg';

function containerSpecimens() {
  const out = [];
  for (const [name, attrs] of PLAIN_CONTAINERS) {
    out.push(`::: ${name} ${attrs}\n${SHORT}\n:::`);
    out.push(`::: ${name} ${attrs}\n${LONG}\n:::`);
  }
  // Picture containers need a real picture in them.
  out.push(`::: polaroid\n![A kitten](${KITTEN})\n${SHORT}\n:::`);
  out.push(`::: photo-corner {title="A title"}\n![A kitten](${KITTEN})\n:::`);
  out.push(
    `::: image-row {style=polaroid, cols=3}\n` +
      `![A kitten](${KITTEN}){caption="One"}\n` +
      `![A kitten](${KITTEN}){caption="Two"}\n` +
      `![A kitten](${KITTEN}){caption="Three"}\n:::`,
  );
  // Columns: two colums, the taller one three lines deep.
  out.push(
    `::: columns {gap=lg}\n::: col\n${SHORT}\n:::\n::: col\n${LONG}\n:::\n:::`,
  );
  return out;
}

/** Leaf blocks, each measured on its own. */
const LEAF_SPECIMENS = [
  `# ${SHORT} heading one`,
  `## ${SHORT} heading two`,
  `### ${SHORT} heading three`,
  SHORT,
  LONG,
  `> ${SHORT}`,
  `> ${LONG}`,
  `- ${SHORT}\n- ${SHORT}\n- ${SHORT}`,
  `- [ ] ${SHORT}\n- [x] ${SHORT}\n- [ ] ${SHORT}`,
  `| A | B |\n| --- | --- |\n| one | two |\n| three | four |\n| five | six |`,
  '---',
  '```js\nconst a = 1;\nconst b = 2;\nconst c = a + b;\nconsole.log(c);\n```',
  '$$\nE = mc^2\n$$',
  '```tree\nRoot\n  One\n  Two\n    Three\n```',
  '```timeline\n1890 | One thing\n1901 | Another thing\n1920 | A third\n```',
  `![A kitten](${KITTEN})`,
];

// One H1 per specimen would start a new page for every one of them, which is
// exactly what is wanted: each specimen is measured on a leaf of its own, so
// nothing it is stacked with can collapse a margin into it.
const BATTERY = [...LEAF_SPECIMENS, ...containerSpecimens()]
  .map((body, i) => `# S${String(i).padStart(2, '0')}\n\n${body}\n`)
  .join('\n');

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

await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
  polling: 500,
  timeout: 90_000,
});
await p.waitForTimeout(4000);
await skipTour();

// Build the specimen book through the authored path — the same call the
// Markdown import makes. It writes to the DB (localStorage-backed in a
// browser), so a reload picks it up no matter which copy of the module a dev
// server that has served HMR updates handed the probe.
const made = await p.evaluate(async (source) => {
  const mod = await import('/src/features/templates/createFromScript.ts');
  const res = await mod.createBookFromScript(source, 'Specimens');
  return { id: res.book.id, title: res.book.title, pages: res.pages.length };
}, BATTERY);
console.log(`  specimen book: "${made.title}" — ${made.pages} pages from the splitter`);

await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
  polling: 500,
  timeout: 90_000,
});
await p.waitForTimeout(4000);
await skipTour();

// Pull it off the shelf by its own label, then Enter to open it.
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
await p
  .locator('.nb-leaf-paper')
  .first()
  .waitFor({ state: 'visible', timeout: 40_000 })
  .catch(() => {});
await p.waitForTimeout(2500);

if ((await p.locator('.nb-book-view').count()) === 0) {
  console.log('  book view never opened — is the dev server up on :1420?');
  await p.screenshot({ path: `${outDir}/failed.png` });
  await b.close();
  process.exit(1);
}

/**
 * Every top-level block on both leaves of the current spread, in laid-out px.
 *
 * `flow` is the distance to the next block's top rather than the block's own
 * height: adjacent margins collapse, and what a page spends on a block is the
 * distance to whatever comes after it, not the box the block draws.
 */
const readSpread = async () =>
  p.evaluate(() => {
    const measureRoot = (root) => {
      const kids = Array.from(root.children).filter(
        (el) => el.nodeType === 1 && !el.classList.contains('ProseMirror-trailingBreak'),
      );
      const out = [];
      for (let i = 0; i < kids.length; i += 1) {
        const el = kids[i];
        const cs = getComputedStyle(el);
        const mt = Number.parseFloat(cs.marginTop) || 0;
        const mb = Number.parseFloat(cs.marginBottom) || 0;
        const next = kids[i + 1];
        const flow =
          next === undefined ? el.offsetHeight + mb : next.offsetTop - el.offsetTop;
        out.push({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('data-type'),
          cls: el.className,
          text: (el.textContent ?? '').trim().slice(0, 34),
          own: el.offsetHeight + mt + mb,
          flow,
          el,
        });
      }
      return out;
    };

    const leaves = [];
    for (const paper of document.querySelectorAll('.nb-leaf-paper')) {
      const root = paper.querySelector('.nb-prose');
      if (paper.querySelector('.nb-leaf-blank') !== null || root === null) continue;
      const ps = getComputedStyle(paper);
      const rs = getComputedStyle(root);
      const line = Number.parseFloat(rs.lineHeight) || 32;
      const capacity =
        paper.clientHeight -
        (Number.parseFloat(ps.paddingTop) || 0) -
        (Number.parseFloat(ps.paddingBottom) || 0);
      const blocks = measureRoot(root).map((b) => {
        /*
         * A container's inner spend: the margin boxes of the PAYLOAD
         * paragraphs inside it, found by the marker word they start with.
         *
         * Not "the flow of its element children" — half these containers put
         * a title plate, a stamp or a set of paper corners in beside the
         * prose, and those are chrome. Not a descent down a wrapper chain
         * either: some are node views with a content host and some are plain
         * `renderHTML` divs whose content hole IS the div, so there is no one
         * chain to walk. The payload is the only thing that is the same shape
         * in all of them.
         */
        const marked = Array.from(b.el.querySelectorAll('p')).filter((el) =>
          /\b(Sx|Lx)\b/.test(el.textContent ?? ''),
        );
        const deepest = marked.filter(
          (el) => !marked.some((other) => other !== el && el.contains(other)),
        );
        let inner = deepest.length === 0 ? null : 0;
        for (const el of deepest) {
          const cs = getComputedStyle(el);
          inner +=
            el.offsetHeight +
            (Number.parseFloat(cs.marginTop) || 0) +
            (Number.parseFloat(cs.marginBottom) || 0);
        }
        return {
          tag: b.tag,
          type: b.type,
          cls: b.cls,
          text: b.text,
          own: b.own,
          flow: b.flow,
          inner,
        };
      });
      leaves.push({
        side: paper.getAttribute('data-side') ?? '?',
        line,
        capacity,
        paper: paper.clientHeight,
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

const SPREADS = Number(process.env.SPREADS ?? 40);
const seen = [];
let previous = '';
let geometry = null;
for (let spread = 0; spread < SPREADS; spread++) {
  await p.waitForTimeout(1200);
  let read = await readSettled();
  for (let retry = 0; retry < 3; retry++) {
    const signature = read.map((l) => l.blocks.map((b) => b.text).join('~')).join('|');
    if (spread === 0 || signature !== previous) break;
    await p.keyboard.press('ArrowRight');
    await p.waitForTimeout(1400);
    read = await readSettled();
  }
  previous = read.map((l) => l.blocks.map((b) => b.text).join('~')).join('|');
  if (read.length === 0) break;
  for (const leaf of read) {
    geometry ??= { line: leaf.line, capacity: leaf.capacity, paper: leaf.paper };
    seen.push(leaf);
  }
  if (spread === 0) {
    await p.screenshot({ path: `${outDir}/spread-01.png` });
  }
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
  `  leaf: ${geometry.paper}px tall, ${geometry.capacity}px of capacity, ` +
    `${L}px lines  →  ${(geometry.capacity / L).toFixed(2)} lines per leaf`,
);
console.log('');

// ---------------------------------------------------------------------------
// Fold the walk into one row per specimen.
// ---------------------------------------------------------------------------

const rows = new Map();
for (const leaf of seen) {
  for (const block of leaf.blocks) {
    const kind =
      block.type !== null
        ? block.type
        : block.tag === 'div' && /nb-diagram|diagram/.test(block.cls)
          ? 'diagram'
          : block.tag;
    const payload = block.text.includes('Lx') ? 'long' : 'short';
    const key = `${kind}|${payload}`;
    if (block.text.startsWith('S') && block.tag === 'h1') continue; // the marker heading
    if (rows.has(key)) continue;
    rows.set(key, {
      kind,
      payload,
      flow: block.flow / L,
      own: block.own / L,
      inner: block.inner === null ? null : block.inner / L,
      chrome: block.inner === null ? null : (block.flow - block.inner) / L,
      text: block.text,
    });
  }
}

const table = [...rows.values()].sort(
  (a, b) => a.kind.localeCompare(b.kind) || a.payload.localeCompare(b.payload),
);
const pad = (s, n) => String(s).padEnd(n);
console.log(
  `  ${pad('block', 18)}${pad('payload', 8)}${pad('flow', 8)}${pad('own', 8)}${pad('inner', 8)}chrome`,
);
for (const r of table) {
  console.log(
    `  ${pad(r.kind, 18)}${pad(r.payload, 8)}${pad(r.flow.toFixed(2), 8)}` +
      `${pad(r.own.toFixed(2), 8)}${pad(r.inner === null ? '—' : r.inner.toFixed(2), 8)}` +
      (r.chrome === null ? '—' : r.chrome.toFixed(2)),
  );
}

const jsonPath = process.env.JSON ?? `${outDir}/measured.json`;
writeFileSync(
  jsonPath,
  `${JSON.stringify({ geometry, lineHeight: L, rows: table }, null, 2)}\n`,
);
console.log('');
console.log(`  raw table: ${jsonPath}`);

await b.close();
