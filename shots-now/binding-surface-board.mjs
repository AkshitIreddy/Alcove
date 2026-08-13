/**
 * True-size refutation board for the reader-facing BOOK surface catalogues.
 *
 * Uses the already-running :1420 app. It never starts/stops a server and never
 * writes book data. Every specimen is drawn by the shipping spine/cover
 * renderer, first at the size used by the shelf/Studio and then enlarged with
 * nearest-neighbour scaling so a suspicious tool can be inspected without
 * pretending it had more source pixels than it really did.
 *
 * Usage:
 *   node shots-now/binding-surface-board.mjs [--tag=now] [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const TAG = opt('tag', 'now');
const SKIP_STUDIO_SHOT = args.includes('--skip-studio-shot');
const APPENDED_EMBLEMS_ONLY = args.includes('--appended-emblems-only');
const OUT = 'shots-now/out';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
});
page.setDefaultTimeout(120000);
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') pageErrors.push(`console: ${message.text()}`);
});

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.waitForFunction(() => globalThis.__shelfVisibleBooks?.().length > 0, null, { polling: 400 });
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click().catch(() => {});

/* Capture the real Studio before replacing the DOM with specimen boards. */
await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  if (list[0]) app.appState.openBook(list[0].id);
});
await page.waitForSelector('.nb-rail', { timeout: 60000 });
await page.waitForTimeout(800);
const studioButton = page.locator('.nb-rail-button[data-tool="customize"]');
if (await studioButton.count()) await studioButton.first().click();
else await page.getByRole('button', { name: /customize this book/i }).click();
await page.waitForSelector('.nb-book-studio', { timeout: 60000 });
await page.waitForTimeout(500);
const studioPath = `${OUT}/book-studio-surface-${TAG}.png`;
if (!SKIP_STUDIO_SHOT) {
  // Capture the owned panel rather than the live WebGL viewport. A full-page
  // screenshot can wait indefinitely on the shelf compositor even though the
  // Studio DOM is already stable; the panel crop is also the useful evidence.
  await page.locator('.nb-book-studio').screenshot({
    path: studioPath,
    animations: 'disabled',
    timeout: 30000,
  });
  console.log('  shot', studioPath);
}

const report = await page.evaluate(async (appendedEmblemsOnly) => {
  const sp = await import('/src/art/spines.ts');
  const cv = await import('/src/art/covers.ts');
  const charms = await import('/src/art/charms.ts');
  const flat = await import('/src/art/flat.ts');

  const studioText = document.querySelector('.nb-book-studio')?.textContent?.toLowerCase() ?? '';
  const studio = {
    hasEmblem: studioText.includes('emblem'),
    hasCoverTitle: studioText.includes('cover title'),
    hasFrame: studioText.includes('frame'),
    hasEdges: studioText.includes('edges'),
    hasCharmControl:
      studioText.includes('ribbon marker') ||
      studioText.includes('charm colour') ||
      document.querySelector('[data-book-control="charm-kind"], [data-book-control="charm-colour"]') !== null,
    hasHardwareControl:
      studioText.includes('corner protector') ||
      studioText.includes('inset plate'),
  };

  const GROUND = flat.FLAT.recess;
  const INK = flat.FLAT.ink;
  const COVER_W = 142;
  const COVER_H = 197;
  const SPINE_W = 30;
  const SPINE_H = 190;
  const PAD = 7;
  const smoothCovering = Math.max(0, cv.COVER_TEXTURES.indexOf('smooth-cloth'));

  document.body.innerHTML = '';
  document.body.style.cssText = `margin:0;background:${GROUND};color:${INK};font:11px "Nunito Sans",system-ui,sans-serif;`;

  function naturalCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.style.cssText = `display:block;width:${width}px;height:${height}px;`;
    return canvas;
  }

  function scaledClone(source, scale) {
    const canvas = naturalCanvas(source.width * scale, source.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    canvas.style.imageRendering = 'pixelated';
    return canvas;
  }

  function drawCover(over, seed, title = 'ALCOVE') {
    const canvas = naturalCanvas(COVER_W, COVER_H);
    const base = cv.deriveCoverParams(seed);
    cv.renderCoverInto(
      canvas.getContext('2d'),
      COVER_W,
      COVER_H,
      {
        ...base,
        seed,
        palette: (seed >>> 5) % cv.COVER_PALETTE_COUNT,
        covering: smoothCovering,
        frame: 0,
        medallion: -1,
        titlePlate: 'gilt-direct',
        edge: 'plain',
        charm: 'none',
        cornerProtectors: false,
        insetPlate: false,
        gilt: true,
        wear: 0.08,
        ...over,
      },
      title,
    );
    return canvas;
  }

  function drawSpine(over, seed) {
    const canvas = naturalCanvas(SPINE_W + PAD * 2, SPINE_H + PAD * 2);
    const params = {
      ...sp.deriveSpineParams(seed),
      w: SPINE_W,
      hJitter: 0,
      lean: 0,
      binding: 'plain-cloth',
      raisedBands: 0,
      headTail: false,
      ornament: -1,
      ornamentOn: false,
      charm: 'none',
      wear: 0.04,
      ...over,
    };
    sp.renderSpine(canvas.getContext('2d'), params, PAD, PAD, SPINE_H, 1);
    return canvas;
  }

  function board(id, columns, cellWidth) {
    const node = document.createElement('section');
    node.id = id;
    node.style.cssText =
      `display:grid;grid-template-columns:repeat(${columns},${cellWidth}px);gap:10px 8px;` +
      `align-items:start;width:max-content;padding:14px;background:${GROUND};`;
    document.body.append(node);
    return node;
  }

  function cell(label, pieces, width) {
    const node = document.createElement('figure');
    node.style.cssText = `margin:0;width:${width}px;display:flex;flex-direction:column;align-items:center;`;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:5px;align-items:flex-end;justify-content:center;';
    for (const piece of pieces) row.append(piece);
    const caption = document.createElement('figcaption');
    caption.textContent = label;
    caption.style.cssText = 'margin-top:4px;text-align:center;line-height:1.15;max-width:100%;';
    node.append(row, caption);
    return node;
  }

  /* One emblem on the shelf spine and the matching cover: same index, no
     competing authored focal programme. */
  const activeEmblems = appendedEmblemsOnly
    ? sp.ACTIVE_ORNAMENTS.filter(({ index }) => index >= 66)
    : sp.ACTIVE_ORNAMENTS;
  const emblemTrue = board('emblems-true', appendedEmblemsOnly ? 5 : 6, 205);
  const emblemDetail = board('emblems-detail', 4, 390);
  activeEmblems.forEach(({ index, label }, position) => {
    const seed = (0xe10000 + position * 0x9e37) >>> 0;
    const spine = drawSpine({ ornament: index, ornamentOn: true }, seed);
    const cover = drawCover({ frame: 0, medallion: index, titlePlate: 'gilt-direct' }, seed);
    emblemTrue.append(cell(`${index} · ${label}`, [spine, cover], 205));
    emblemDetail.append(
      cell(
        `${index} · ${label}`,
        [scaledClone(spine, 3), scaledClone(cover, 2)],
        390,
      ),
    );
  });

  const frameTrue = board('frames-true', 7, 154);
  const frameDetail = board('frames-detail', 4, 300);
  cv.ACTIVE_COVER_FRAMES.forEach((frame, position) => {
    const seed = 0xf20000;
    const cover = drawCover({ frame: frame.index, medallion: -1, titlePlate: 'gilt-direct' }, seed);
    const label = `${frame.index} · ${frame.label}`;
    frameTrue.append(cell(label, [cover], 154));
    frameDetail.append(cell(label, [scaledClone(cover, 2)], 300));
  });

  const titleTrue = board('titles-true', 7, 154);
  const titleDetail = board('titles-detail', 4, 300);
  sp.ACTIVE_TITLE_PLATE_OPTIONS.forEach(({ id, label }, position) => {
    const seed = 0x710000;
    const cover = drawCover({ frame: 0, medallion: -1, titlePlate: id }, seed, 'FIELD NOTES');
    titleTrue.append(cell(label, [cover], 154));
    titleDetail.append(cell(label, [scaledClone(cover, 2)], 300));
  });

  /* At actual size an edge owns only the sliver left of the fore board. The
     magnified half-height crop exposes whether that sliver is secretly a
     wallpaper pattern. */
  const edgeTrue = board('edges-true', 8, 116);
  const edgeDetail = board('edges-detail', 6, 150);
  sp.ACTIVE_EDGE_OPTIONS.forEach(({ id, label }, position) => {
    const seed = 0xed0000;
    const cover = drawCover({ edge: id, frame: 0, medallion: -1 }, seed);
    const crop = naturalCanvas(16, COVER_H);
    crop.getContext('2d').drawImage(cover, COVER_W - 16, 0, 16, COVER_H, 0, 0, 16, COVER_H);
    const head = naturalCanvas(16, Math.round(COVER_H * 0.48));
    head.getContext('2d').drawImage(crop, 0, 0, 16, head.height, 0, 0, 16, head.height);
    edgeTrue.append(cell(label, [crop], 116));
    edgeDetail.append(cell(label, [scaledClone(head, 6)], 150));
  });

  const endbandTrue = board('endbands-true', 7, 112);
  const endbandDetail = board('endbands-detail', 4, 280);
  const endbandRows = [
    ...sp.ACTIVE_HEAD_TAIL_OPTIONS.map(({ index, label }) => ({
      label: `endband ${index} · ${label}`,
      over: { headTail: true, headTailStyle: index, raisedBands: 0 },
    })),
    ...Array.from({ length: sp.MAX_RAISED_BANDS + 1 }, (_, bands) => ({
      label: `${bands} raised cord${bands === 1 ? '' : 's'}`,
      over: { binding: 'plain-calf', headTail: false, raisedBands: bands, bandGilt: true },
    })),
  ];
  endbandRows.forEach(({ label, over }, position) => {
    const seed = 0xeb0000;
    const spine = drawSpine(over, seed);
    endbandTrue.append(cell(label, [spine], 112));
    const top = naturalCanvas(spine.width, 46);
    top.getContext('2d').drawImage(spine, 0, 0, spine.width, 46, 0, 0, spine.width, 46);
    const bottom = naturalCanvas(spine.width, 46);
    bottom.getContext('2d').drawImage(
      spine,
      0,
      spine.height - 46,
      spine.width,
      46,
      0,
      0,
      spine.width,
      46,
    );
    endbandDetail.append(
      cell(label, [scaledClone(top, 4), scaledClone(bottom, 4)], 280),
    );
  });

  return {
    counts: {
      emblems: activeEmblems.length,
      frames: cv.ACTIVE_COVER_FRAMES.length,
      titles: sp.ACTIVE_TITLE_PLATE_OPTIONS.length,
      edges: sp.ACTIVE_EDGE_OPTIONS.length,
      endbands: sp.ACTIVE_HEAD_TAIL_OPTIONS.length,
      maxRaisedBands: sp.MAX_RAISED_BANDS,
      charms: charms.ACTIVE_CHARMS.length,
    },
    activeCharms: [...charms.ACTIVE_CHARMS],
    studio,
    ids: {
      emblems: activeEmblems,
      frames: cv.ACTIVE_COVER_FRAMES,
      titles: sp.ACTIVE_TITLE_PLATE_OPTIONS,
      edges: sp.ACTIVE_EDGE_OPTIONS,
      endbands: sp.ACTIVE_HEAD_TAIL_OPTIONS,
    },
  };
}, APPENDED_EMBLEMS_ONLY);

const paths = [
  ['#emblems-true', `binding-surface-emblems-true-${TAG}.png`],
  ['#emblems-detail', `binding-surface-emblems-detail-${TAG}.png`],
  ['#frames-true', `binding-surface-frames-true-${TAG}.png`],
  ['#frames-detail', `binding-surface-frames-detail-${TAG}.png`],
  ['#titles-true', `binding-surface-titles-true-${TAG}.png`],
  ['#titles-detail', `binding-surface-titles-detail-${TAG}.png`],
  ['#edges-true', `binding-surface-edges-true-${TAG}.png`],
  ['#edges-detail', `binding-surface-edges-detail-${TAG}.png`],
  ['#endbands-true', `binding-surface-endbands-true-${TAG}.png`],
  ['#endbands-detail', `binding-surface-endbands-detail-${TAG}.png`],
].filter(([selector]) => !APPENDED_EMBLEMS_ONLY || selector.startsWith('#emblems-'));
for (const [selector, filename] of paths) {
  const path = `${OUT}/${filename}`;
  await page.locator(selector).screenshot({ path });
  console.log('  shot', path);
}

const reportPath = `${OUT}/binding-surface-report-${TAG}.json`;
writeFileSync(
  reportPath,
  `${JSON.stringify({
    ...report,
    pageErrors,
    screenshots: [
      ...(SKIP_STUDIO_SHOT ? [] : [studioPath]),
      ...paths.map(([, name]) => `${OUT}/${name}`),
    ],
  }, null, 2)}\n`,
);
console.log('  report', reportPath);
await browser.close();
