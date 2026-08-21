/**
 * Focused live board for the post-apocalypse cover frame and title furniture.
 * Uses the already-running :1420 app; never starts/stops a server or writes app data.
 *
 * Usage: node shots-now/cover-frame-title-board.mjs [--tag=now]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const value = args.find((arg) => arg.startsWith(`--${name}=`));
  return value ? value.slice(name.length + 3) : fallback;
};
const TAG = option('tag', 'now');
const URL = option('url', 'http://localhost:1420');
const SABOTAGE = args.includes('--sabotage');
const OUT = 'shots-now/out';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120000);
await page.goto(`${URL}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });

const report = await page.evaluate(async () => {
  const cv = await import('/src/art/covers.ts');
  const sp = await import('/src/art/spines.ts');
  const flat = await import('/src/art/flat.ts');
  await document.fonts.ready;

  const COVER_W = 142;
  const COVER_H = 197;
  const GROUND = flat.FLAT.recess;
  const BASE = {
    seed: 0x51ee,
    palette: 29,
    texture: 0,
    material: 'velvet',
    covering: Math.max(0, cv.COVER_TEXTURES.indexOf('smooth-cloth')),
    frame: 0,
    medallion: -1,
    titleFont: 0,
    gilt: true,
    raisedBands: 2,
    bandGilt: true,
    headTail: false,
    headTailStyle: 1,
    titlePlate: 'gilt-direct',
    coverBaseHex: '#475d82',
    coverAccentHex: '#314564',
    toolingHex: '#f1d16f',
    emblemHex: '#f7e09a',
    wear: 0.05,
    edge: 'gilt',
    charm: 'none',
    cornerProtectors: false,
    insetPlate: false,
  };

  document.body.innerHTML = '';
  document.body.style.cssText = `margin:0;background:${GROUND};color:${flat.FLAT.ink};font:11px "Nunito Sans",system-ui,sans-serif;`;

  function canvas(width, height) {
    const node = document.createElement('canvas');
    node.width = width;
    node.height = height;
    node.style.cssText = `display:block;width:${width}px;height:${height}px;`;
    return node;
  }

  function cover(overrides, title) {
    const node = canvas(COVER_W, COVER_H);
    cv.renderCoverInto(node.getContext('2d'), COVER_W, COVER_H, { ...BASE, ...overrides }, title);
    return node;
  }

  function scaled(source, factor) {
    const node = canvas(source.width * factor, source.height * factor);
    const ctx = node.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0, node.width, node.height);
    node.style.imageRendering = 'pixelated';
    return node;
  }

  function reduced(source, width, height) {
    const node = canvas(width, height);
    const ctx = node.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, width, height);
    return node;
  }

  function pixelSignature(source) {
    const thumb = reduced(source, 48, 66);
    const data = thumb.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, 48, 66).data;
    let hash = 2166136261;
    for (let i = 0; i < data.length; i += 4) {
      hash ^= (data[i] >> 3) ^ ((data[i + 1] >> 3) << 5) ^ ((data[i + 2] >> 3) << 10);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  function board(id, columns, cellWidth) {
    const section = document.createElement('section');
    section.id = id;
    section.style.cssText =
      `display:grid;grid-template-columns:repeat(${columns},${cellWidth}px);gap:10px 8px;` +
      `align-items:start;width:max-content;padding:16px;background:${GROUND};`;
    document.body.append(section);
    return section;
  }

  function cell(label, art, width) {
    const figure = document.createElement('figure');
    figure.style.cssText = `margin:0;width:${width}px;display:flex;flex-direction:column;align-items:center;`;
    const caption = document.createElement('figcaption');
    caption.textContent = label;
    caption.style.cssText = 'margin-top:5px;text-align:center;line-height:1.2;max-width:100%;';
    figure.append(art, caption);
    return figure;
  }

  const emblemsTrue = board('emblems-true', 6, 154);
  const emblemsDetail = board('emblems-detail', 4, 300);
  for (const { index, label } of cv.ACTIVE_COVER_EMBLEMS) {
    const natural = cover({ frame: 0, medallion: index, titlePlate: 'gilt-direct' }, 'ALCOVE');
    const caption = `${index} · ${label} · ${cv.coverEmblemProgramme(index)}`;
    emblemsTrue.append(cell(caption, natural, 154));
    emblemsDetail.append(cell(caption, scaled(natural, 2), 300));
  }

  const framesTrue = board('frames-true', 6, 154);
  const framesDetail = board('frames-detail', 4, 300);
  for (const frame of cv.ACTIVE_COVER_FRAMES) {
    const natural = cover({ frame: frame.index }, 'FIELD NOTES');
    const label = `${frame.index} · ${frame.label} · ${frame.tier}`;
    framesTrue.append(cell(label, natural, 154));
    framesDetail.append(cell(label, scaled(natural, 2), 300));
  }

  const title = 'A Quiet Ledger of Small Histories';
  const titlesTrue = board('titles-true', 5, 154);
  const titlesDetail = board('titles-detail', 3, 300);
  const titlesShelf = board('titles-shelf', 8, 104);
  const titlesMaterial = board('titles-material', 5, 154);
  const titlesMaterialShelf = board('titles-material-shelf', 8, 104);
  const titleSignatures = [];
  const materialRows = {
    'direct-blind-title': ['polished-calf', '#795744', '#5d3d31', false],
    'direct-gilt-title': ['morocco-grain', '#71364a', '#4d2434', true],
    'direct-ink-title': ['smooth-cloth', '#7993a0', '#536f7c', false],
    'press-small-caps': ['morocco-grain', '#2f665b', '#20483f', true],
    'printer-floret-imprint': ['polished-calf', '#6b4437', '#4e3029', true],
    'laid-paper-ticket': ['smooth-cloth', '#8d4b42', '#69352f', false],
    'deckled-paper-ticket': ['half-bound', '#355f68', '#24464e', false],
    'vellum-rule-ticket': ['polished-calf', '#5f3f34', '#432c25', false],
    'parchment-slip': ['buckram', '#70445d', '#4f3043', false],
    'morocco-single-rule': ['polished-calf', '#3f6757', '#2a493d', true],
    'morocco-double-rule': ['russia-calf', '#744238', '#522e28', true],
    'morocco-clipped-rule': ['morocco-grain', '#473866', '#312649', true],
    'calf-blind-label': ['polished-calf', '#8a6145', '#62442f', true],
    'two-tone-leather-label': ['half-bound', '#355c64', '#744239', true],
    'library-buckram-label': ['buckram', '#4b6272', '#334552', false],
    'dyed-leather-crossband': ['half-bound', '#8a5944', '#50372e', true],
    'gilt-ruled-crossband': ['morocco-grain', '#5e3550', '#3e2437', true],
    'cloth-inlay-crossband': ['half-cloth-paper', '#86725b', '#405d64', false],
    'split-leather-crossband': ['three-quarter', '#546c5a', '#713f35', true],
    'oxford-blind-compartment': ['polished-calf', '#765344', '#51392f', false],
    'cambridge-calf-compartment': ['russia-calf', '#6a4739', '#493127', false],
    'french-triple-fillet': ['morocco-grain', '#354f63', '#243848', true],
    'ledger-open-field': ['smooth-cloth', '#6c7982', '#4b565e', false],
    'inscription-shoulders': ['morocco-grain', '#395f57', '#27433d', true],
    'renaissance-title-window': ['morocco-grain', '#71413a', '#4e2d29', true],
  };
  function materialOverrides(id) {
    const [material, coverBaseHex, coverAccentHex, gilt] = materialRows[id] ?? ['smooth-cloth', '#475d82', '#314564', true];
    return {
      material,
      covering: Math.max(0, cv.COVER_TEXTURES.indexOf(material)),
      coverBaseHex,
      coverAccentHex,
      gilt,
      toolingHex: gilt ? '#e8c96b' : '#49332c',
      emblemHex: gilt ? '#f3db91' : '#49332c',
    };
  }
  for (const { id, label } of sp.ACTIVE_TITLE_PLATE_OPTIONS) {
    const natural = cover({ frame: 0, titlePlate: id }, title);
    const materialNatural = cover({ frame: 0, titlePlate: id, ...materialOverrides(id) }, title);
    const caption = `${label} · ${cv.coverTitleFurniture(id)}`;
    titleSignatures.push({ id, signature: pixelSignature(natural) });
    titlesTrue.append(cell(caption, natural, 154));
    titlesDetail.append(cell(caption, scaled(natural, 2), 300));
    titlesShelf.append(cell(caption, reduced(natural, 60, 83), 104));
    titlesMaterial.append(cell(caption, materialNatural, 154));
    titlesMaterialShelf.append(cell(caption, reduced(materialNatural, 60, 83), 104));
  }

  const handsTrue = board('hands-true', 5, 154);
  const handsDetail = board('hands-detail', 3, 300);
  for (const { index, label } of cv.ACTIVE_COVER_HANDS) {
    const natural = cover(
      { frame: 0, medallion: -1, titlePlate: 'gilt-direct', titleFont: index },
      'The Quiet Ledger',
    );
    const caption = `${index} · ${label}`;
    handsTrue.append(cell(caption, natural, 154));
    handsDetail.append(cell(caption, scaled(natural, 2), 300));
  }

  const edgesTrue = board('edges-true', 6, 154);
  const edgesDetail = board('edges-detail', 3, 300);
  for (const { id, label } of sp.ACTIVE_EDGE_OPTIONS) {
    const natural = cover(
      { frame: 0, medallion: -1, titlePlate: 'gilt-direct', edge: id },
      'EDGE BOOK',
    );
    const caption = `${label} · ${id}`;
    edgesTrue.append(cell(caption, natural, 154));
    edgesDetail.append(cell(caption, scaled(natural, 2), 300));
  }

  const endbandsTrue = board('endbands-true', 4, 154);
  const endbandsDetail = board('endbands-detail', 4, 300);
  for (const option of [{ index: 0, label: 'none' }, ...sp.ACTIVE_HEAD_TAIL_OPTIONS]) {
    const natural = cover(
      {
        frame: 0,
        medallion: -1,
        titlePlate: 'gilt-direct',
        headTail: option.index !== 0,
        headTailStyle: option.index || 1,
        raisedBands: 2,
      },
      'BINDING',
    );
    const caption = `${option.index} · ${option.label}`;
    endbandsTrue.append(cell(caption, natural, 154));
    endbandsDetail.append(cell(caption, scaled(natural, 2), 300));
  }

  const welcome = board('welcome', 3, 300);
  welcome.style.display = 'flex';
  const welcomeNatural = cover(
    { frame: 48, medallion: 20, titlePlate: 'gilt-direct', titleFont: 44 },
    'Welcome to Alcove ✎',
  );
  welcome.append(
    cell('Grand Welcome · actual 142×197 pixels', welcomeNatural, 154),
    cell('Grand Welcome · nearest-neighbour 2×', scaled(welcomeNatural, 2), 300),
    cell('Grand Welcome · nearest-neighbour 3×', scaled(welcomeNatural, 3), 440),
  );

  return {
    emblems: cv.ACTIVE_COVER_EMBLEMS.map(({ index, label }) => ({
      index,
      label,
      programme: cv.coverEmblemProgramme(index),
    })),
    frames: cv.ACTIVE_COVER_FRAMES,
    titles: sp.ACTIVE_TITLE_PLATE_OPTIONS.map(({ id, label }, index) => ({
      id,
      label,
      furniture: cv.coverTitleFurniture(id),
      layout: cv.coverCompositionLayout(id, 0, -1),
      signature: titleSignatures[index]?.signature ?? '',
    })),
    hands: cv.ACTIVE_COVER_HANDS,
    edges: sp.ACTIVE_EDGE_OPTIONS,
    endbands: sp.ACTIVE_HEAD_TAIL_OPTIONS,
  };
});

await page.waitForTimeout(300);
for (const id of [
  'emblems-true', 'emblems-detail',
  'frames-true', 'frames-detail',
  'titles-true', 'titles-detail',
  'titles-shelf',
  'titles-material', 'titles-material-shelf',
  'hands-true', 'hands-detail',
  'edges-true', 'edges-detail',
  'endbands-true', 'endbands-detail',
  'welcome',
]) {
  const path = `${OUT}/cover-${id}-${TAG}.png`;
  await page.locator(`#${id}`).screenshot({ path, timeout: 120000 });
  console.log('  shot', path);
}
const reportPath = `${OUT}/cover-frame-title-report-${TAG}.json`;
if (SABOTAGE && report.titles.length > 1) {
  report.titles[1].signature = report.titles[0].signature;
}
const uniqueFurniture = new Set(report.titles.map((row) => row.furniture)).size;
const uniqueTitlePixels = new Set(report.titles.map((row) => row.signature)).size;
const gateFailures = [];
if (report.titles.length < 25) gateFailures.push(`only ${report.titles.length} active title treatments`);
if (uniqueFurniture !== report.titles.length) gateFailures.push(`${report.titles.length - uniqueFurniture} duplicate furniture mappings`);
if (uniqueTitlePixels !== report.titles.length) gateFailures.push(`${report.titles.length - uniqueTitlePixels} duplicate shelf pixel signatures`);
if (report.frames.length < 17) gateFailures.push(`only ${report.frames.length} active frame constructions`);
report.gate = { passed: gateFailures.length === 0, failures: gateFailures };
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log('  report', reportPath);
await browser.close();
console.log(SABOTAGE && !report.gate.passed ? 'GATE ALIVE' : report.gate.passed ? 'GATE PASSED' : 'GATE FAILED');
if (!report.gate.passed) throw new Error(report.gate.failures.join('\n'));
