/**
 * Focused long-title proof for the cover compositor.
 *
 * Uses the production renderer through the already-running Vite app, records
 * the literal strings handed to Canvas, and renders every active title
 * treatment at native pull-out and shelf-preview size.
 *
 * Usage: node shots-now/cover-title-fit-board.mjs [--url=http://127.0.0.1:1420]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const hit = process.argv.find((arg) => arg.startsWith('--url='));
const url = hit?.slice('--url='.length) || 'http://127.0.0.1:1420';
const outputDir = 'shots-now/out';
const nativePath = `${outputDir}/cover-title-fit-native.png`;
const shelfPath = `${outputDir}/cover-title-fit-shelf.png`;
const reportPath = `${outputDir}/cover-title-fit.json`;
mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1700, height: 1200 } });
page.setDefaultTimeout(120_000);
page.on('pageerror', (error) => console.error('[pageerror]', error.message));
await page.goto(`${url}/?fx=force`, { waitUntil: 'domcontentloaded' });
await Promise.all([
  page.evaluate(() => document.fonts.load('700 22px "Patrick Hand"')),
  page.evaluate(() => document.fonts.load('600 12px "Nunito Sans"')),
]).catch(() => {});
await page.evaluate(() => document.fonts.ready);

const report = await page.evaluate(async () => {
  const covers = await import('/src/art/covers.ts');
  const style = await import('/src/art/bookStyle.ts');
  const flat = await import('/src/art/flat.ts');

  const titles = [
    'Collected Correspondence from the Reading Room',
    'The Lantern Atlas of Forgotten Roads',
    'Winter Herbarium and Field Notes',
    'A Quiet Ledger of Small Histories',
    'Maps of Rain and Other Observations',
  ];
  const frames = [0, 2, 5, 6, 8, 14, 17, 19, 20, 21, 24, 26, 27, 28, 30];
  const medallions = [0, 2, 5, 12, 17, 20, 23, 26];
  const rows = style.ACTIVE_TITLE_PLATES.map((titlePlate, index) => ({
    titlePlate,
    title: titles[index % titles.length],
    params: {
      seed: (0x51ee + Math.imul(index + 1, 0x9e3779b1)) >>> 0,
      palette: (index * 7 + 3) % 50,
      texture: 0,
      material: ['smooth-cloth', 'polished-calf', 'linen'][index % 3],
      covering: 0,
      frame: frames[index % frames.length],
      medallion: medallions[index % medallions.length],
      titleFont: 2,
      gilt: index % 3 !== 1,
      titlePlate,
    },
  }));

  const drawCover = (row, width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const lines = [];
    const fonts = [];
    const fillText = ctx.fillText.bind(ctx);
    ctx.fillText = (value, ...args) => {
      lines.push(String(value));
      fonts.push(ctx.font);
      return fillText(value, ...args);
    };
    covers.renderCoverInto(ctx, width, height, row.params, row.title);
    return {
      canvas,
      lines,
      fontPx: Number.parseFloat(fonts.at(-1)?.match(/([\d.]+)px/)?.[1] ?? '0'),
    };
  };

  const result = [];
  const makeBoard = (id, width, height, columns) => {
    const board = document.createElement('main');
    board.id = id;
    board.style.cssText =
      `box-sizing:border-box;width:max-content;display:grid;grid-template-columns:repeat(${columns},max-content);` +
      `gap:10px;padding:14px;background:${flat.FLAT.recess};`;
    rows.forEach((row) => {
      const cell = document.createElement('section');
      cell.style.cssText =
        `box-sizing:border-box;width:${width + 26}px;padding:8px;background:#f6efe3;` +
        'border:1.5px solid #56392f;border-radius:12px 10px 13px 11px;text-align:center;';
      const heading = document.createElement('strong');
      heading.textContent = row.titlePlate;
      heading.style.cssText = 'display:block;min-height:18px;font:600 12px "Nunito Sans",sans-serif;';
      const { canvas, lines, fontPx } = drawCover(row, width, height);
      const caption = document.createElement('div');
      caption.textContent = lines.join(' / ');
      caption.style.cssText =
        'box-sizing:border-box;margin-top:5px;max-width:100%;white-space:normal;' +
        'font:600 10px/1.25 "Nunito Sans",sans-serif;color:#56392f;';
      cell.append(heading, canvas, caption);
      board.append(cell);
      result.push({
        board: id,
        titlePlate: row.titlePlate,
        title: row.title,
        lines,
        fontPx,
        complete: lines.join(' ') === row.title,
        hasEllipsis: lines.some((line) => line.includes('…') || line.includes('...')),
      });
    });
    document.body.append(board);
  };

  document.body.innerHTML = '';
  document.body.style.cssText =
    `margin:0;background:${flat.FLAT.recess};color:${flat.FLAT.ink};font-family:"Nunito Sans",sans-serif;`;
  makeBoard('cover-title-native', 166, 230, 5);
  makeBoard('cover-title-shelf', 85, 118, 5);
  return result;
});

await page.locator('#cover-title-native').screenshot({ path: nativePath });
await page.locator('#cover-title-shelf').screenshot({ path: shelfPath });
const failures = report.filter((row) => !row.complete || row.hasEllipsis);
for (const row of report.filter((item) => item.titlePlate === 'gilt-direct')) {
  const native = row.board === 'cover-title-native';
  const minimum = native ? 10 : 6.5;
  const wantedLines = native ? 2 : [2, 3];
  if (row.fontPx < minimum) failures.push({ ...row, reason: `font ${row.fontPx}px < ${minimum}px` });
  if (native ? row.lines.length !== wantedLines : !wantedLines.includes(row.lines.length)) {
    failures.push({ ...row, reason: `unexpected ${row.lines.length}-line setting` });
  }
}
const output = {
  generatedAt: new Date().toISOString(),
  summary: {
    specimens: report.length,
    complete: report.filter((row) => row.complete).length,
    ellipsised: report.filter((row) => row.hasEllipsis).length,
  },
  gate: { passed: failures.length === 0, failures },
  specimens: report,
};
writeFileSync(reportPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`-> ${nativePath}`);
console.log(`-> ${shelfPath}`);
console.log(`-> ${reportPath}`);
console.log(JSON.stringify(output.summary, null, 2));
await browser.close();
if (!output.gate.passed) throw new Error(`Cover title fitting failed in ${failures.length} specimens`);
