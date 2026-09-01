/** Visual gate for the Welcome spreads reported with heading/special-block drift. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const outDir = 'qa/ruled-baseline';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1706, height: 1066 },
  deviceScaleFactor: 2,
});
page.setDefaultTimeout(60_000);

async function goToSpread(target) {
  for (let attempts = 0; attempts < 12; attempts += 1) {
    const current = await page.locator('[data-spread-index]').first().getAttribute('data-spread-index');
    const index = Number(current);
    if (index === target) return;
    const selector = index < target ? '.nb-flip-hotspot-next' : '.nb-flip-hotspot-prev';
    await page.locator(selector).click({ force: true });
    await page.waitForFunction(
      (prior) =>
        !document.querySelector('.nb-flip-canvas.is-flipping') &&
        Number(document.querySelector('[data-spread-index]')?.getAttribute('data-spread-index')) !== prior,
      index,
    );
  }
  throw new Error(`could not reach Welcome spread ${target}`);
}

async function inspectSpread(name, target) {
  await goToSpread(target);
  await page.waitForTimeout(250);
  const report = await page.locator('.nb-book-view').evaluate((view) => {
    const measureBaseline = (node) => {
      const prose = node.closest('.nb-prose');
      if (!(prose instanceof HTMLElement)) throw new Error('prose root missing');
      const proseRect = prose.getBoundingClientRect();
      const pitch = Number.parseFloat(getComputedStyle(prose).lineHeight);
      const scale = proseRect.height > 0 ? prose.offsetHeight / proseRect.height : 1;
      const marker = document.createElement('span');
      marker.style.cssText = 'display:inline-block;width:1px;height:0;padding:0;margin:0;border:0;vertical-align:baseline';
      node.insertBefore(
        marker,
        node.querySelector('.ProseMirror-separator, .ProseMirror-trailingBreak'),
      );
      const baseline = (marker.getBoundingClientRect().top - proseRect.top) * scale;
      const nearestRule = Math.round(baseline / pitch) * pitch - 1;
      marker.remove();
      return baseline - nearestRule;
    };

    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const headings = Array.from(view.querySelectorAll('.nb-prose h1'))
      .filter(visible)
      .map((node) => ({
        text: node.textContent,
        baselineToRule: measureBaseline(node),
      }));
    const columns = Array.from(view.querySelectorAll("[data-type='columns'] p"))
      .filter(visible)
      .map((node) => ({
        text: node.textContent?.trim(),
        baselineToRule: measureBaseline(node),
      }));
    const surfaces = Array.from(
      view.querySelectorAll(
        "[data-type='map-pin'], [data-type='marginalia'], [data-type='wax-seal']",
      ),
    )
      .filter(visible)
      .map((node) => ({
        type: node.getAttribute('data-type'),
        text: node.textContent?.trim(),
        declared: node.hasAttribute('data-nb-ruling-surface'),
        backgroundColor: getComputedStyle(node).backgroundColor,
      }));
    return { headings, columns, surfaces };
  });

  const path = `${outDir}/${name}.png`;
  await page.locator('.nb-book-view').screenshot({ path, caret: 'hide' });
  console.log(JSON.stringify({ path, report }, null, 2));
  if (report.headings.length < 2) {
    throw new Error(`${name}: expected at least the two active H1 headings`);
  }
  if (report.headings.some(({ baselineToRule }) => Math.abs(baselineToRule) > 1.25)) {
    throw new Error(`${name}: heading is off its printed rule`);
  }
  if (report.columns.some(({ baselineToRule }) => Math.abs(baselineToRule) > 1.25)) {
    throw new Error(`${name}: column writing is off its printed rule`);
  }
  if (
    report.surfaces.some(({ declared, backgroundColor }) =>
      !declared || backgroundColor === 'rgba(0, 0, 0, 0)' || backgroundColor === 'transparent',
    )
  ) {
    throw new Error(`${name}: special writing surface still exposes page rules`);
  }
  return path;
}

try {
  await page.goto('http://127.0.0.1:1420/?fx=force', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
  const skip = page.getByText('skip the tour', { exact: false }).first();
  if (await skip.count()) await skip.click({ force: true }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});

  await page.evaluate(async () => {
    const books = await import('/src/data/books.ts');
    const app = await import('/src/state/app.ts');
    const all = await books.listBooksByFloorRange(-10_000, 10_000);
    const welcome = all.find((row) => row.title.startsWith('Welcome to Alcove'));
    if (welcome === undefined) throw new Error('Welcome book missing');
    app.appState.openBook(welcome.id);
  });
  await page.locator('.nb-book-view .nb-prose').first().waitFor({ state: 'visible' });

  await inspectSpread('welcome-map-pin', 1);
  await inspectSpread('welcome-paper-and-beginnings', 3);
  console.log('WELCOME SPECIAL TYPOGRAPHY PASS');
} finally {
  await browser.close();
}
