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

/**
 * A ladder of paragraphs of graded length, so the leaf's real chars-per-line
 * comes out of where the height STEPS rather than out of one 287-character
 * reading — a single paragraph only says the wrap width is somewhere in a band
 * a third as wide as the answer.
 */
const WORDS =
  'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima ' +
  'mike november oscar papa quebec romeo sierra tango uniform victor whisky ' +
  'xray yankee zulu amber cedar hollow meadow lantern harbour thistle willow';
function words(minChars) {
  const list = WORDS.split(' ');
  let out = 'Lx';
  for (let i = 0; out.length < minChars; i += 1) out += ` ${list[i % list.length]}`;
  return out;
}
const LADDER = [24, 40, 56, 72, 88, 104, 120, 150, 180, 220, 260, 300];

/** Every specimen: a name, which payload it holds, and its script. */
const SPECIMENS = [];
const spec = (name, payload, body) => SPECIMENS.push({ name, payload, body });

for (const n of LADDER) {
  const text = words(n);
  spec(`ruler-${String(text.length).padStart(3, '0')}`, 'long', text);
}

spec('heading2', 'short', `## ${SHORT} heading two`);
spec('heading3', 'short', `### ${SHORT} heading three`);
spec('paragraph', 'short', SHORT);
spec('paragraph', 'long', LONG);
spec('quote', 'short', `> ${SHORT}`);
spec('quote', 'long', `> ${LONG}`);
spec('list-3', 'short', `- ${SHORT}\n- ${SHORT}\n- ${SHORT}`);
spec('list-1-long', 'long', `- ${LONG}`);
spec('taskList-3', 'short', `- [ ] ${SHORT}\n- [x] ${SHORT}\n- [ ] ${SHORT}`);
const row = (n) => `| cell ${n} | cell ${n} |`;
for (const rows of [1, 3, 6]) {
  spec(
    `table-${rows}`,
    'short',
    `| A | B |\n| --- | --- |\n${Array.from({ length: rows }, (_, i) => row(i)).join('\n')}`,
  );
}
spec('divider', 'short', '---');
for (const lines of [1, 4, 10]) {
  spec(
    `code-${String(lines).padStart(2, '0')}`,
    'short',
    `\`\`\`js\n${Array.from({ length: lines }, (_, i) => `const v${i} = ${i};`).join('\n')}\n\`\`\``,
  );
}
spec('mathBlock-1', 'short', '$$\nE = mc^2\n$$');
spec('mathBlock-frac', 'short', '$$\n\\frac{a + b}{c + d} = \\sqrt{x^2 + y^2}\n$$');
for (const n of [2, 4, 8]) {
  const kids = Array.from({ length: n }, (_, i) => `  Node ${i}`).join('\n');
  spec(`diagram-tree-${n}`, 'short', `\`\`\`tree\nRoot\n${kids}\n\`\`\``);
}
for (const n of [2, 4, 8]) {
  const entries = Array.from(
    { length: n },
    (_, i) => `19${String(i).padStart(2, '0')} | Entry ${i}`,
  ).join('\n');
  spec(`diagram-timeline-${n}`, 'short', `\`\`\`timeline\n${entries}\n\`\`\``);
}
for (const n of [2, 5]) {
  const edges = Array.from({ length: n }, (_, i) => `N${i} -> N${i + 1}`).join('\n');
  spec(`diagram-graph-${n}`, 'short', `\`\`\`graph\n${edges}\n\`\`\``);
}
spec('image', 'short', `![A kitten](${KITTEN})`);
spec('image-w320', 'short', `![A kitten](${KITTEN}){width=320}`);

const PART = process.env.PART ?? 'all';
const LEAF_COUNT = SPECIMENS.length;
for (const [name, attrs] of PLAIN_CONTAINERS) {
  spec(name, 'short', `::: ${name} ${attrs}\n${SHORT}\n:::`);
  spec(name, 'long', `::: ${name} ${attrs}\n${LONG}\n:::`);
}
const CONTAINER_COUNT = SPECIMENS.length - LEAF_COUNT;
spec('polaroid', 'short', `::: polaroid\n![A kitten](${KITTEN})\n${SHORT}\n:::`);
spec(
  'photo-corner',
  'short',
  `::: photo-corner {title="A title"}\n![A kitten](${KITTEN})\n${SHORT}\n:::`,
);
spec(
  'image-row-3',
  'short',
  `::: image-row {style=polaroid, cols=3}\n` +
    `![A kitten](${KITTEN}){caption="One"}\n` +
    `![A kitten](${KITTEN}){caption="Two"}\n` +
    `![A kitten](${KITTEN}){caption="Three"}\n:::`,
);
spec(
  'columns-2',
  'long',
  `::: columns {gap=lg}\n::: col\n${SHORT}\n:::\n::: col\n${LONG}\n:::\n:::`,
);

/*
 * The third group: everything the FIRST two runs proved the estimator was
 * blind to. Costing the welcome book against the fills measured in the running
 * app agreed to within three points on twenty-five of its thirty-two leaves
 * and was out by twenty-four, thirty-three and twelve on three of them — the
 * page of decorated paragraphs, the mindmap page and the maths page. A block
 * effect, a radial layout and a real equation are all height the first battery
 * never asked about.
 */
const EFFECTS = [
  ['underline-squiggle', '{underline=squiggle}'],
  ['underline-circled', '{underline=circled}'],
  ['rotate', '{rotate=-2}'],
  ['tape', '{tape=top}'],
  ['washi', '{washi=top}'],
  ['frame-scallop', '{frame=scallop}'],
  ['paper-torn', '{paper=torn}'],
  ['shadow-lifted', '{shadow=lifted}'],
  ['tape-and-rotate', '{rotate=-2, tape=top}'],
  ['torn-and-framed', '{paper=torn, frame=scallop}'],
];
const EFFECT_TEXT = 'Lx a decorated line of ordinary length on the page';
spec('effect-none', 'long', EFFECT_TEXT);
for (const [name, attrs] of EFFECTS) {
  spec(`effect-${name}`, 'long', `${EFFECT_TEXT} ${attrs}`);
}
for (const depth of [2, 3, 4]) {
  let body = 'Bookbinding';
  const branches = ['Sewing', 'Covering', 'Tools'];
  for (const branch of branches) {
    body += `\n  ${branch}`;
    if (depth >= 3) body += `\n    ${branch} one\n    ${branch} two`;
    if (depth >= 4) body += `\n      ${branch} deeper`;
  }
  spec(`mindmap-d${depth}`, 'short', `\`\`\`mindmap\n${body}\n\`\`\``);
}
spec('math-euler', 'short', '$$\ne^{i\\pi} + 1 = 0\n$$');
spec('math-sum', 'short', '$$\n\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}\n$$');
spec('math-int', 'short', '$$\n\\int_{0}^{\\infty} e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}\n$$');
spec(
  'table-code-4',
  'short',
  '| Write this | Or just this |\n| --- | --- |\n' +
    '| `:::callout {variant=info}` | `:::info` |\n' +
    '| `:::callout {variant=tip}` | `:::tip` or `:::hint` |\n' +
    '| `:::callout {variant=warn}` | `:::warn` or `:::caution` |\n' +
    '| `:::callout {variant=star}` | `:::star` or `:::important` |',
);
spec(
  'callout-56',
  'short',
  '::: callout {variant=info}\n**Lx** — the plain one, for what a reader needs\n:::',
);
spec(
  'graph-shaped',
  'short',
  '```graph\nIdea {shape=cloud, color=amber}\nIdea -> Draft, Notes\n' +
    'Draft -> Page: eventually\nNotes -> Page\n```',
);
// Every leaf of the welcome book opens with `# Title {sticker=…}`, and a
// sticker is an inline picture — so whether a heading that carries one is
// taller than a heading that does not is worth exactly one line on every page
// in the book. Measured on an H2, which shares the H1's two-band line box.
spec('heading2-plain', 'short', `## ${SHORT} a heading`);
spec('heading2-sticker', 'short', `## ${SHORT} a heading {sticker=star}`);
spec('heading2-long', 'short', `## ${SHORT} a heading long enough to have to wrap somewhere`);
spec('heading3-long', 'short', `### ${SHORT} a heading long enough to have to wrap somewhere`);
// Inline code is set in a monospace face that is wider than the body hand, so
// a line of it does not hold as many characters. The welcome book is full of
// it, and every page of it came out under-predicted.
spec('para-code', 'long', LONG.split(' ').map((w) => `\`${w}\``).join(' '));
spec('para-bold', 'long', `**${LONG}**`);
spec(
  'table-plain-4',
  'short',
  '| Write this | Or just this |\n| --- | --- |\n' +
    '| callout variant info | info |\n| callout variant tip | tip or hint |\n' +
    '| callout variant warn | warn or caution |\n| callout variant star | star or important |',
);
spec(
  'timeline-long',
  'short',
  '```timeline\n1665: Hooke looks down a microscope and names the cell\n' +
    '1839: Schwann — animal cells\n1855: Virchow — cells come from cells | color=amber\n' +
    '1931: The electron microscope\n```',
);

// `PART=leaf` / `PART=containers` / `PART=extras` narrow the run to one group —
// the whole battery is ninety-odd leaves to walk, and a second pass usually
// only wants one group of it back.
if (PART === 'leaf') SPECIMENS.length = LEAF_COUNT;
else if (PART === 'containers') {
  SPECIMENS.splice(LEAF_COUNT + CONTAINER_COUNT);
  SPECIMENS.splice(0, LEAF_COUNT);
} else if (PART === 'extras') SPECIMENS.splice(0, LEAF_COUNT + CONTAINER_COUNT);

// One H1 per specimen, and an H1 starts a new page — so every specimen is
// measured on a leaf of its own, where nothing it is stacked with can collapse
// a margin into it, and the marker names the row it belongs to.
const markerOf = (i) => `S${String(i).padStart(2, '0')}`;
const BATTERY = SPECIMENS.map(
  (s, i) => `# ${markerOf(i)}\n\n${s.body}\n`,
).join('\n');

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
        /*
         * How wide a line inside this block is, and in what type.
         *
         * A container narrows the text it holds, and several of them change
         * its size as well — so "a container costs its chrome plus its
         * children" is only true if the children are costed at the width the
         * container gives them. `measureText` in the payload's own font turns
         * the two into one number the estimator can use: characters per line.
         */
        const host =
          deepest[0] ??
          (/^(P|H1|H2|H3|H4|LI|BLOCKQUOTE)$/.test(b.el.tagName) ? b.el : null);
        let wrap = null;
        if (host !== null) {
          const cs = getComputedStyle(host);
          const ctx = document.createElement('canvas').getContext('2d');
          ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily}`;
          const sample =
            'the quick brown fox jumps over a lazy dog and then walks home again';
          const per = ctx.measureText(sample).width / sample.length;
          wrap = {
            width: host.clientWidth,
            fontPx: Number.parseFloat(cs.fontSize) || 0,
            linePx: Number.parseFloat(cs.lineHeight) || 0,
            charPx: per,
            charsPerLine: per > 0 ? host.clientWidth / per : 0,
          };
        }
        return {
          tag: b.tag,
          type: b.type,
          cls: b.cls,
          text: b.text,
          own: b.own,
          flow: b.flow,
          inner,
          wrap,
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
  `  leaf: ${geometry.paper}px tall, ${geometry.capacity}px of capacity, ` +
    `${L}px lines  →  ${(geometry.capacity / L).toFixed(2)} lines per leaf`,
);
console.log('');

// ---------------------------------------------------------------------------
// Fold the walk into one row per specimen.
// ---------------------------------------------------------------------------

/*
 * Fold the walk into one row per specimen, keyed by the marker heading its
 * leaf opens with. Not by node type: three of these draw as a bare `div` with
 * no `data-type` on it (a callout's fallback, a diagram, an image row), and
 * keying on the tag silently merged them into one row that reported whichever
 * arrived first. The marker is authored, so it cannot collide.
 */
const rows = new Map();
const h1Flows = [];
for (const leaf of seen) {
  let marker = null;
  for (const block of leaf.blocks) {
    const asMarker = /^S\d\d$/.exec(block.text);
    if (block.tag === 'h1' && asMarker !== null) {
      marker = asMarker[0];
      // Every leaf opens with one, so the markers ARE the H1 measurement —
      // an H1 specimen of its own would have started a page of its own and
      // left nothing to be the marker of.
      h1Flows.push(block.flow / L);
      continue;
    }
    if (marker === null) continue; // a tail carried in from the leaf before
    if (rows.has(marker)) continue; // only the first block after the marker
    const index = Number(marker.slice(1));
    const specimen = SPECIMENS[index];
    if (specimen === undefined) continue;
    rows.set(marker, {
      marker,
      kind: specimen.name,
      payload: specimen.payload,
      node: block.type ?? block.tag,
      chars: specimen.body.length,
      flow: block.flow / L,
      own: block.own / L,
      inner: block.inner === null ? null : block.inner / L,
      chrome: block.inner === null ? null : (block.flow - block.inner) / L,
      wrap: block.wrap,
    });
  }
}

const table = [...rows.values()].sort((a, b) => a.marker.localeCompare(b.marker));
const pad = (s, n) => String(s).padEnd(n);

// The ladder first: where the height steps is what the wrap width really is.
console.log('  --- wrap ladder (top-level paragraphs) ---');
console.log(`  ${pad('chars', 8)}${pad('lines', 8)}${pad('chars/line', 12)}measured chars/line`);
for (const r of table.filter((x) => x.kind.startsWith('ruler-'))) {
  const chars = Number(r.kind.slice(6));
  console.log(
    `  ${pad(chars, 8)}${pad(r.flow.toFixed(2), 8)}` +
      `${pad((chars / r.flow).toFixed(1), 12)}` +
      (r.wrap === null ? '—' : r.wrap.charsPerLine.toFixed(1)),
  );
}
console.log('');
console.log('  --- blocks ---');
console.log(
  `  ${pad('block', 18)}${pad('payload', 8)}${pad('flow', 8)}${pad('own', 8)}` +
    `${pad('inner', 8)}${pad('chrome', 8)}${pad('c/line', 8)}${pad('linePx', 8)}node`,
);
for (const r of table) {
  if (r.kind.startsWith('ruler-')) continue;
  console.log(
    `  ${pad(r.kind, 18)}${pad(r.payload, 8)}${pad(r.flow.toFixed(2), 8)}` +
      `${pad(r.own.toFixed(2), 8)}${pad(r.inner === null ? '—' : r.inner.toFixed(2), 8)}` +
      `${pad(r.chrome === null ? '—' : r.chrome.toFixed(2), 8)}` +
      `${pad(r.wrap === null ? '—' : r.wrap.charsPerLine.toFixed(1), 8)}` +
      `${pad(r.wrap === null ? '—' : r.wrap.linePx.toFixed(1), 8)}${r.node}`,
  );
}
const missing = SPECIMENS.map((s, i) => markerOf(i)).filter((m) => !rows.has(m));
if (missing.length > 0) {
  console.log(
    `  NOT MEASURED: ${missing
      .map((m) => `${m} ${SPECIMENS[Number(m.slice(1))].name}`)
      .join(', ')}`,
  );
}
console.log('');
if (h1Flows.length > 0) {
  const sorted = h1Flows.slice().sort((a, b) => a - b);
  console.log(
    `  heading1 (the ${h1Flows.length} markers): min ${sorted[0].toFixed(2)} ` +
      `median ${sorted[sorted.length >> 1].toFixed(2)} max ${sorted[sorted.length - 1].toFixed(2)}`,
  );
}
console.log(
  `  payload widths: SHORT ${SHORT.length} chars, LONG ${LONG.length} chars`,
);

const jsonPath = process.env.JSON ?? `${outDir}/measured.json`;
writeFileSync(
  jsonPath,
  `${JSON.stringify({ geometry, lineHeight: L, rows: table }, null, 2)}\n`,
);
console.log('');
console.log(`  raw table: ${jsonPath}`);

await b.close();
