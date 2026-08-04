/**
 * scripts/probe-spread-fit.mjs — does the whole book stay in the window while
 * a rail sheet is out?
 *
 * The defect this exists for: every rail panel — Customize, Page style,
 * Catalogue, Contents, History, In and out — pushed the spread right by the
 * sheet's own width and nothing else. On a 1440×900 window that put the right
 * leaf's fore-edge at x=1711 (271px past the glass) and the dog-ear curl
 * entirely off screen, so the last words of every line on the right page were
 * gone and the page-turn affordance the tour teaches could not be reached
 * while any panel was open. 2351 unit tests passed through all of it, because
 * every one of them is either DOM-free or reads a stylesheet as text: nothing
 * in the suite ever laid the book out beside an open sheet and looked at where
 * the pixels landed.
 *
 * So this drives the real app, at several window sizes, and asserts on the
 * BOXES — not on the custom properties that produce them, which is the same
 * mistake as asserting on what was merely saved:
 *
 *   1. every panel: cover, right leaf and curl corner all inside the viewport;
 *   2. every panel: the book's left edge clears the open sheet, or it is being
 *      covered rather than pushed, which is the bug pushing was introduced for;
 *   3. panel shut: the book is exactly where it was — a fit that "helps" at
 *      rest is a regression on the ninety per cent case;
 *   4. the reader's book does not REPAGINATE on the way in or out. The fit is
 *      a transform for this reason: narrowing the leaf instead would reflow
 *      the text, and the pagination contract peels blocks forward without ever
 *      pulling them back, so closing the panel would not undo it.
 *
 * Sizes are deliberately plural. The bug measured identically at 1280, 1440
 * and 1920 — but the amount of room a 340px sheet leaves does not, and 960×620
 * (the app's own minimum, src-tauri/tauri.conf.json) is where a fit that only
 * translates and never shrinks would still fall off the edge.
 *
 * Usage: node scripts/probe-spread-fit.mjs [--url=http://localhost:1420]
 *                                          [--sizes=1440x900,1280x800]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const SIZES = opt('sizes', '1920x1080,1440x900,1280x800,960x620')
  .split(',')
  .map((pair) => {
    const [width, height] = pair.split('x').map(Number);
    return { width, height };
  });

/** Every sheet the book's rail can open, by its `data-tool` id. */
const PANELS = ['customize', 'page-style', 'catalogue', 'toc', 'history', 'share'];

/** Sub-pixel slack: layout lands on fractions, and a rect is rounded here. */
const SLACK = 1;

mkdirSync('qa/ui', { recursive: true });

const failures = [];
const errors = new Map();
const fail = (message) => {
  failures.push(message);
  console.log(`  FAIL  ${message}`);
};
const pass = (message) => console.log(`  ok    ${message}`);

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

/**
 * Read the boxes that matter, in viewport px, plus the two numbers that say
 * whether the book was reflowed rather than re-fitted.
 *
 * `.nb-page-curl` only renders when there is a page to turn to, which is the
 * point: the affordance being absent is a different failure from it being off
 * screen, and the caller distinguishes them.
 */
const geometry = (page) =>
  page.evaluate(() => {
    const box = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: Math.round(r.left),
        right: Math.round(r.right),
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
      };
    };
    const sheet = [...document.querySelectorAll('.nb-rail-panel')].find(
      (el) => el.getAttribute('aria-hidden') === 'false',
    );
    const counts = document.querySelector('.nb-rail-counts');
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      cover: box('.nb-book-cover'),
      leftLeaf: box('.nb-leaf-paper[data-side="left"]'),
      rightLeaf: box('.nb-leaf-paper[data-side="right"]'),
      curl: box('.nb-page-curl'),
      title: box('.nb-book-title-plate'),
      sheet: sheet ? box(`.${[...sheet.classList].join('.')}`) : null,
      sheetOpen: sheet !== undefined,
      // The page's own word count and which spread is showing: if opening a
      // sheet reflowed the book, one of these moves.
      words: counts?.textContent?.trim() ?? '',
      spread: document.querySelector('.nb-spread-stage')?.dataset.spreadIndex ?? '',
    };
  });

/** Everything the reader can see of the book must be on the glass. */
const checkInside = (label, geom) => {
  const { viewport } = geom;
  for (const part of ['cover', 'leftLeaf', 'rightLeaf', 'title']) {
    const b = geom[part];
    if (!b) {
      fail(`${label}: ${part} is not in the DOM at all`);
      continue;
    }
    if (b.right > viewport.width + SLACK) {
      fail(
        `${label}: ${part} ends at x=${b.right}, ${b.right - viewport.width}px past the ${viewport.width}px window`,
      );
    } else if (b.left < -SLACK) {
      fail(`${label}: ${part} starts at x=${b.left}, off the left edge`);
    }
    if (b.bottom > viewport.height + SLACK || b.top < -SLACK) {
      fail(
        `${label}: ${part} spans y=${b.top}..${b.bottom} outside a ${viewport.height}px window`,
      );
    }
  }
  // The curl is the affordance the tour teaches; it lives in the far corner,
  // which is exactly the corner a push walks off the screen.
  if (!geom.curl) {
    fail(`${label}: no page-curl corner rendered (nothing to turn to?)`);
  } else if (
    geom.curl.right > viewport.width + SLACK ||
    geom.curl.bottom > viewport.height + SLACK
  ) {
    fail(
      `${label}: curl corner at ${geom.curl.left}..${geom.curl.right} × ${geom.curl.top}..${geom.curl.bottom} is outside the window`,
    );
  }
};

for (const viewport of SIZES) {
  const label = `${viewport.width}×${viewport.height}`;
  console.log(`\n=== ${label} ===`);
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.setDefaultTimeout(120_000);
  page.on('pageerror', (e) => {
    const key = e.message.split('\n')[0];
    errors.set(key, (errors.get(key) ?? 0) + 1);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const key = `console ${m.text().split('\n')[0]}`;
    errors.set(key, (errors.get(key) ?? 0) + 1);
  });

  // The first-run tour drives the app itself and eats the pointer stream, so
  // its completion flag goes into the stub DB before the first navigation —
  // dismissing it afterwards races its own mount.
  await page.addInitScript(
    ([storageKey, tutorialKey]) => {
      try {
        const raw = window.localStorage.getItem(storageKey);
        const blob = raw === null ? {} : JSON.parse(raw);
        const rows = Array.isArray(blob.settings) ? blob.settings : [];
        const at = rows.findIndex((r) => r?.key === tutorialKey);
        const row = { key: tutorialKey, value: '1' };
        if (at >= 0) rows[at] = row;
        else rows.push(row);
        blob.settings = rows;
        window.localStorage.setItem(storageKey, JSON.stringify(blob));
      } catch {
        // Storage refused; the stop() below is the backstop.
      }
    },
    ['notebook.stubdb.v1', 'appState:tutorialCompleted'],
  );

  await page.goto(`${URL_BASE}/?fx=force&dev=1`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.__nbTutorial?.stop?.());
  await page.locator('.nb-dev-switcher button', { hasText: 'book' }).click();
  await page.waitForSelector('.nb-prose', { timeout: 120_000 });
  // The cover art and the first pagination pass both land after mount; the fit
  // is measured off the settled boxes, so let them settle.
  await page.waitForTimeout(1500);

  const rest = await geometry(page);
  checkInside('panel shut', rest);
  await page.screenshot({ path: `qa/ui/spreadfit-${viewport.width}-closed.png` });

  for (const tool of PANELS) {
    await page.click(`.nb-rail-button[data-tool="${tool}"]`);
    // Past the slide (the `slow` step) plus a frame for the fit to publish.
    await page.waitForTimeout(900);
    const open = await geometry(page);

    if (!open.sheetOpen) {
      fail(`${tool}: the sheet never opened`);
    } else {
      checkInside(tool, open);
      if (open.sheet && open.cover && open.cover.left < open.sheet.right) {
        fail(
          `${tool}: the book starts at x=${open.cover.left}, under a sheet that ends at x=${open.sheet.right} — covered, not pushed`,
        );
      }
      if (open.words !== rest.words || open.spread !== rest.spread) {
        fail(
          `${tool}: the book reflowed on opening (was "${rest.words}" spread ${rest.spread}, now "${open.words}" spread ${open.spread})`,
        );
      }
    }
    await page.screenshot({ path: `qa/ui/spreadfit-${viewport.width}-${tool}.png` });

    await page.click(`.nb-rail-button[data-tool="${tool}"]`);
    await page.waitForTimeout(900);
    const shut = await geometry(page);
    // Closing must put the book back exactly, not approximately: a fit that
    // does not return to the identity accumulates over a session.
    for (const part of ['cover', 'rightLeaf']) {
      const before = rest[part];
      const after = shut[part];
      if (!before || !after) continue;
      if (
        Math.abs(before.left - after.left) > SLACK ||
        Math.abs(before.right - after.right) > SLACK
      ) {
        fail(
          `${tool}: after closing, ${part} is ${after.left}..${after.right} instead of ${before.left}..${before.right}`,
        );
      }
    }
  }

  if (failures.length === 0) {
    pass(`${label}: every panel keeps the whole spread on the glass`);
  }
  console.log(
    `  measured: closed cover ${rest.cover?.left}..${rest.cover?.right}, curl ends ${rest.curl?.right}, window ${viewport.width}`,
  );
  await page.close();
}

console.log('\n=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [key, n] of errors) console.log(`  x${n}  ${key}`);

console.log('\n=== verdict ===');
if (failures.length === 0) {
  console.log('the spread stays inside the window at every panel and every size');
} else {
  console.log(`${failures.length} failure(s):`);
  for (const message of failures) console.log(`  - ${message}`);
}

await browser.close();
process.exit(failures.length === 0 && errors.size === 0 ? 0 : 1);
