/**
 * Live regression for fixed-page rulings beside a sliding book panel.
 *
 * The ruled plane is paint, not document JSON. This probe therefore captures
 * the empty right leaf before, while and after Page style is open, decodes the
 * PNG in Chromium, and verifies that the expected horizontal ink bands remain
 * present across the complete middle of the page. It also pins the canonical
 * leaf/prose layout box so a responsive-width repair cannot make the visual
 * assertion pass by quietly reflowing the document.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'qa/ruling-panel';
mkdirSync(OUT, { recursive: true });
const sabotage = process.argv.includes('--sabotage');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
page.setDefaultTimeout(60_000);
const report = { ok: false };

async function measuredState(name) {
  const paper = page.locator('.nb-flip-leaf-right .nb-sheet-paper');
  const pageRoot = paper.locator(':scope > .nb-page');
  const prose = paper.locator('.nb-prose');
  const layout = await pageRoot.evaluate((root) => {
    const paper = root.closest('.nb-sheet-paper');
    const prose = root.querySelector('.nb-prose');
    const frame = root.closest('.nb-spread-fit-frame');
    const style = getComputedStyle(root);
    if (!(paper instanceof HTMLElement) || !(prose instanceof HTMLElement) || !(frame instanceof HTMLElement)) {
      throw new Error('canonical ruling elements are missing');
    }
    return {
      paper: { width: paper.clientWidth, height: paper.clientHeight },
      prose: { width: prose.clientWidth, height: prose.clientHeight },
      frame: { width: frame.offsetWidth, height: frame.offsetHeight },
      drawnFrame: frame.getBoundingClientRect().toJSON(),
      backgroundImage: style.backgroundImage,
      backgroundSize: style.backgroundSize,
      backgroundPosition: style.backgroundPosition,
      backgroundRepeat: style.backgroundRepeat,
      // The authored pitch is the document's line-height attribute. Custom
      // property serialization can remain a var() expression in Chromium, so
      // reading the resolved editor line-height is the stable numeric form.
      rulePitch: Number.parseFloat(getComputedStyle(prose).lineHeight),
    };
  });

  const png = await paper.screenshot({
    path: `${OUT}/${name}.png`,
    caret: 'hide',
    animations: 'disabled',
  });
  const pixels = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);

    // The empty page has no content ink. Sample its broad central writing
    // plane, away from the cover, fore-edge shadows and gutter.
    const x0 = Math.round(canvas.width * 0.16);
    const x1 = Math.round(canvas.width * 0.84);
    const y0 = Math.round(canvas.height * 0.13);
    const y1 = Math.round(canvas.height * 0.87);
    const rowMean = [];
    for (let y = y0; y < y1; y += 1) {
      let total = 0;
      let count = 0;
      for (let x = x0; x < x1; x += 2) {
        const at = (y * canvas.width + x) * 4;
        total += data[at] * 0.2126 + data[at + 1] * 0.7152 + data[at + 2] * 0.0722;
        count += 1;
      }
      rowMean.push(total / Math.max(1, count));
    }
    // A line row is darker than the paper immediately around it. Group
    // adjacent dark pixels because a sub-pixel scaled rule may cover two rows.
    const candidates = [];
    for (let index = 2; index + 2 < rowMean.length; index += 1) {
      const surround = (rowMean[index - 2] + rowMean[index + 2]) / 2;
      if (surround - rowMean[index] > 0.65) candidates.push(index + y0);
    }
    const bands = [];
    for (const y of candidates) {
      if (bands.length === 0 || y - bands.at(-1).at(-1) > 2) bands.push([y]);
      else bands.at(-1).push(y);
    }
    const centres = bands.map((band) => band.reduce((a, b) => a + b, 0) / band.length);
    const gaps = centres.slice(1).map((y, index) => y - centres[index]);
    const sorted = [...gaps].sort((a, b) => a - b);
    const medianGap = sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)];
    const largestGap = gaps.length === 0 ? Infinity : Math.max(...gaps);
    return {
      width: canvas.width,
      height: canvas.height,
      lineBands: centres.length,
      medianGap,
      largestGap,
      uninterrupted: centres.length >= 12 && largestGap <= medianGap * 1.65,
    };
  }, png.toString('base64'));
  return { layout, pixels };
}

try {
  await page.goto('http://127.0.0.1:1420/?fx=force', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
  const skip = page.getByText('skip the tour', { exact: false }).first();
  if (await skip.count()) await skip.click({ force: true }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});

  report.fixture = await page.evaluate(async () => {
    const books = await import('/src/data/books.ts');
    const pages = await import('/src/data/pages.ts');
    const app = await import('/src/state/app.ts');
    const id = `qa-ruling-panel-${Date.now()}`;
    const book = await books.createBook({
      id,
      title: 'QA uninterrupted rulings',
      floor: 0,
      slot: 48,
      spineSeed: 447711,
    });
    await pages.createPage({
      bookId: book.id,
      ord: 0,
      doc: {
        type: 'doc',
        attrs: { pageStyle: 'ruled', lineHeightPx: 32 },
        content: [{ type: 'paragraph' }],
      },
    });
    app.appState.openBook(book.id);
    return { bookId: book.id };
  });
  await page.waitForSelector('.nb-flip-leaf-right .nb-page[data-style="ruled"]');
  await page.waitForTimeout(1_000);

  if (sabotage) {
    // Deliberately remove a band from the middle of the ruling plane. This is
    // the shape of the reported compositor defect, and proves the pixel gate
    // notices missing paint rather than merely re-reading CSS declarations.
    await page.addStyleTag({
      content: `
        .nb-page[data-style='ruled']::after {
          content: '';
          position: absolute;
          z-index: 20;
          left: 0;
          right: 0;
          top: 42%;
          height: 84px;
          background: var(--paper-cream);
          pointer-events: none;
        }
      `,
    });
  }

  report.closedBefore = await measuredState('01-closed-before');
  await page.locator('.nb-rail-button[data-tool="page-style"]').click();
  await page.waitForSelector('.nb-rail-panel[aria-label="Page style"][aria-hidden="false"]');
  await page.waitForFunction(() => !document.querySelector('.nb-rail-panel[aria-label="Page style"]')?.classList.contains('is-sliding'));
  report.open = await measuredState('02-panel-open');

  await page.getByRole('button', { name: 'Close Page style' }).click();
  await page.waitForFunction(() => document.querySelector('.nb-rail-panel[aria-label="Page style"]')?.getAttribute('aria-hidden') === 'true');
  await page.waitForFunction(() => !document.querySelector('.nb-rail-panel[aria-label="Page style"]')?.classList.contains('is-sliding'));
  await page.waitForTimeout(250);
  report.closedAfter = await measuredState('03-closed-after');

  const sameLayout = (a, b) => JSON.stringify({ paper: a.paper, prose: a.prose, frame: a.frame }) === JSON.stringify({ paper: b.paper, prose: b.prose, frame: b.frame });
  const samePaintContract = (a, b) =>
    a.backgroundImage === b.backgroundImage &&
    a.backgroundSize === b.backgroundSize &&
    a.backgroundPosition === b.backgroundPosition &&
    a.backgroundRepeat === b.backgroundRepeat &&
    a.rulePitch === b.rulePitch;

  report.canonicalLayoutStable =
    sameLayout(report.closedBefore.layout, report.open.layout) &&
    sameLayout(report.closedBefore.layout, report.closedAfter.layout);
  report.paintContractStable =
    samePaintContract(report.closedBefore.layout, report.open.layout) &&
    samePaintContract(report.closedBefore.layout, report.closedAfter.layout);
  report.rulingsUninterrupted = [report.closedBefore, report.open, report.closedAfter]
    .every((state) => state.pixels.uninterrupted);
  report.closedPaintRecovered =
    Math.abs(report.closedBefore.pixels.medianGap - report.closedAfter.pixels.medianGap) <= 0.25 &&
    Math.abs(report.closedBefore.pixels.largestGap - report.closedAfter.pixels.largestGap) <= 0.5;
  report.ok =
    report.canonicalLayoutStable &&
    report.paintContractStable &&
    report.rulingsUninterrupted &&
    report.closedPaintRecovered;
} catch (error) {
  report.error = error.stack ?? error.message;
} finally {
  if (report.fixture?.bookId) {
    await page.evaluate(async (bookId) => {
      const app = await import('/src/state/app.ts');
      const books = await import('/src/data/books.ts');
      app.appState.closeBook();
      await books.deleteBook(bookId);
    }, report.fixture.bookId).catch(() => {});
  }
  writeFileSync(`${OUT}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
if (sabotage) console.log(report.ok ? 'GATE INERT' : 'GATE ALIVE');
process.exitCode = sabotage ? (report.ok ? 1 : 0) : (report.ok ? 0 : 1);
