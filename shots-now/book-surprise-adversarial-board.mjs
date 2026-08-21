/**
 * Render the production Surprise generator's worst deterministic tail and its
 * historical bad seeds at both native and real shelf scale.
 *
 * The board intentionally uses the object-form generator used by Book Studio.
 * Four forced surviving bindings exercise the closed-composition rules; every
 * other historical case is allowed to pass through the current curated picker
 * so retired constructions cannot hide behind a hand-selected preset.
 *
 * Usage: node shots-now/book-surprise-adversarial-board.mjs [--url=http://localhost:1420]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const hit = process.argv.find((arg) => arg.startsWith('--url='));
const url = hit?.slice('--url='.length) || 'http://localhost:1420';
const sabotage = process.argv.includes('--sabotage');
const outputDir = 'shots-now/out';
const nativePath = `${outputDir}/book-surprise-adversarial-native.png`;
const shelfPath = `${outputDir}/book-surprise-adversarial-shelf.png`;
const reportPath = `${outputDir}/book-surprise-adversarial.json`;
mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1400 } });
page.setDefaultTimeout(120_000);
page.on('pageerror', (error) => console.error('[pageerror]', error.message));
await page.goto(`${url}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });

const report = await page.evaluate(async (sabotage) => {
  const design = await import('/src/art/bookDesign.ts');
  const surprise = await import('/src/art/bookSurprise.ts');
  const style = await import('/src/art/bookStyle.ts');
  const spines = await import('/src/art/spines.ts');
  const covers = await import('/src/art/covers.ts');
  const flat = await import('/src/art/flat.ts');

  await Promise.all([
    document.fonts.load('600 22px "Caveat Variable"'),
    document.fonts.load('400 13px "Nunito Sans"'),
  ].map((job) => job.catch(() => {})));
  await document.fonts.ready;

  const sweepSeed = (directionIndex, seedIndex) => (
    0x51e5a11 ^
    Math.imul(directionIndex + 1, 0x9e3779b1) ^
    Math.imul(seedIndex + 17, 0x85ebca6b)
  ) >>> 0;

  const rows = [];
  const statementLoad = (recipe) => {
    const item = recipe.style;
    return (
      (item.raisedBands ?? 0) * 0.5 +
      ((item.ornament ?? -1) >= 0 ? 1 : 0) +
      ((item.coverMedallion ?? -1) >= 0 ? 1 : 0) +
      ((item.coverFrame ?? 0) >= 30 ? 2 : (item.coverFrame ?? 0) >= 15 ? 1 : 0.25) +
      (item.cornerProtectors ? 1 : 0) +
      (item.insetPlate ? 1 : 0) +
      (item.charm !== undefined && item.charm !== 'none' ? 1 : 0)
    );
  };
  for (let directionIndex = 0; directionIndex < design.BOOK_SURPRISE_DIRECTIONS.length; directionIndex += 1) {
    const direction = design.BOOK_SURPRISE_DIRECTIONS[directionIndex];
    const family = [];
    for (let seedIndex = 0; seedIndex < 256; seedIndex += 1) {
      const seed = sweepSeed(directionIndex, seedIndex);
      const recipe = surprise.surpriseBookRecipe({ direction: direction.id, seed });
      family.push({ seed, recipe });
    }
    const usedSeeds = new Set();
    const select = (kind, title, ordered) => {
      const selected = ordered.find((item) => !usedSeeds.has(item.seed)) ?? ordered[0];
      if (!selected) return;
      usedSeeds.add(selected.seed);
      rows.push({ kind, title, direction: direction.id, ...selected });
    };
    select(
      'automatic worst tail',
      `${direction.label} worst / 256`,
      [...family].sort((a, b) => a.recipe.score - b.recipe.score || a.seed - b.seed),
    );
    select(
      'automatic narrowest tail',
      `${direction.label} narrowest / 256`,
      [...family].sort((a, b) =>
        (a.recipe.style.thickness ?? 0) / Math.max(1, a.recipe.style.height ?? 1) -
          (b.recipe.style.thickness ?? 0) / Math.max(1, b.recipe.style.height ?? 1) ||
        a.recipe.score - b.recipe.score || a.seed - b.seed),
    );
    select(
      'automatic busiest tail',
      `${direction.label} busiest / 256`,
      [...family].sort((a, b) =>
        statementLoad(b.recipe) - statementLoad(a.recipe) ||
        a.recipe.score - b.recipe.score || a.seed - b.seed),
    );
  }

  const historical = [
    // Native-scale emblem failures found during the hard-reset refutation.
    // Keep the exact seeds on this board so a broad active ornament list can
    // never turn the quill/fern/lamp scratches back into an automatic result.
    { title: 'Refuted quill scratch', direction: 'antique', seed: 4_058_589_858 },
    { title: 'Refuted lamp hardware A', direction: 'antique', seed: 498_606_278 },
    { title: 'Refuted fern insect', direction: 'storybook', seed: 3_045_068_971 },
    { title: 'Refuted lamp hardware B', direction: 'cosy', seed: 289_802_484 },
    { title: 'Formal split-binding seed', direction: 'formal', seed: 1_776_248_472 },
    { title: 'Grand old moiré seed A', direction: 'grand', seed: 155_586_223 },
    { title: 'Grand old moiré seed B', direction: 'grand', seed: 47_010_835 },
    { title: 'Antique old parchment seed', direction: 'antique', seed: 1_582_318_512 },
    { title: 'Storybook old moiré seed', direction: 'storybook', seed: 3_176_092_094 },
    { title: 'Cosy old moiré seed', direction: 'cosy', seed: 3_656_100_401 },
    { title: 'Rustic old long-stitch seed', direction: 'rustic', seed: 3_702_186_062 },
    { title: 'Quiet old hollow seed', direction: 'quiet', seed: 3_296_789_740 },
  ];
  for (const item of historical) rows.push({
    ...item,
    kind: 'historical bad seed',
    recipe: surprise.surpriseBookRecipe({ direction: item.direction, seed: item.seed }),
  });

  const forced = [
    { title: 'Closed brocade', direction: 'grand', seed: 1_443_854, preset: 'brocade-anthology' },
    { title: 'Closed cartouche', direction: 'grand', seed: 237_242_436, preset: 'cartouche-armorial' },
    { title: 'Closed semé', direction: 'grand', seed: 0x5e6e_2026, preset: 'seme-royal' },
    { title: 'Antique marbled boards', direction: 'antique', seed: 0x4d41_5242, preset: 'marbled-boards' },
  ];
  for (const item of forced) rows.push({
    ...item,
    kind: 'forced surviving challenge',
    recipe: surprise.surpriseBookRecipe({
      direction: item.direction,
      seed: item.seed,
      guard: (preset) => preset.id === item.preset,
    }),
  });

  const enriched = rows.map((row, index) => {
    const preset = design.bookPreset(row.recipe.preset);
    const resolved = style.resolveBookStyle(row.seed, undefined, row.recipe.style, {
      binding: row.recipe.preset,
    });
    return { ...row, index, preset, resolved };
  });

  const drawArt = (row, shelf) => {
    const sourceHeight = row.resolved.style.height;
    const targetHeight = shelf ? 118 : Math.min(230, sourceHeight);
    const scale = targetHeight / sourceHeight;
    const spineWidth = row.resolved.style.thickness * scale;
    const coverWidth = targetHeight * 0.72;
    const title = [
      'Collected Letters', 'Field Notes', 'The Lantern Atlas', 'Small Histories',
      'Maps of Rain', 'Winter Herbarium', 'The Reading Room', 'A Quiet Ledger',
    ][row.index % 8];

    const art = document.createElement('div');
    art.style.cssText =
      `height:${shelf ? 124 : 238}px;display:flex;gap:${shelf ? 5 : 10}px;` +
      'align-items:flex-end;justify-content:center;overflow:visible;';
    const spine = document.createElement('canvas');
    spine.width = Math.max(10, Math.ceil(spineWidth + (shelf ? 4 : 8)));
    spine.height = Math.ceil(targetHeight + (shelf ? 4 : 8));
    spines.renderSpine(
      spine.getContext('2d'),
      { ...row.resolved.spine, binding: row.recipe.preset },
      shelf ? 2 : 4,
      shelf ? 2 : 4,
      targetHeight,
      scale,
      { hiRes: !shelf },
    );
    const cover = document.createElement('canvas');
    cover.width = Math.ceil(coverWidth + (shelf ? 2 : 4));
    cover.height = Math.ceil(targetHeight + (shelf ? 2 : 4));
    covers.renderCoverInto(
      cover.getContext('2d'),
      coverWidth,
      targetHeight,
      row.resolved.cover,
      title,
    );
    art.append(spine, cover);
    return art;
  };

  const drawCell = (row, shelf) => {
    const cell = document.createElement('section');
    cell.style.cssText =
      `box-sizing:border-box;width:${shelf ? 300 : 420}px;padding:${shelf ? 7 : 10}px;` +
      'background:#f6efe3;border:1.5px solid #56392f;border-radius:13px 10px 14px 11px;';
    const header = document.createElement('header');
    header.style.cssText = 'display:flex;justify-content:space-between;gap:8px;align-items:baseline;';
    const label = document.createElement('strong');
    label.textContent = row.title;
    label.style.cssText = `font:600 ${shelf ? 16 : 19}px "Caveat Variable",cursive;`;
    const score = document.createElement('b');
    score.textContent = `${row.recipe.score}`;
    score.style.cssText = 'font-size:11px;color:#315b50;';
    header.append(label, score);
    cell.append(header, drawArt(row, shelf));

    const binding = document.createElement('div');
    binding.textContent = `${row.recipe.preset} · ${row.preset.shape} · ${row.preset.material}`;
    binding.style.cssText =
      `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:${shelf ? 9 : 10}px;`;
    const finish = document.createElement('div');
    finish.textContent =
      `${row.recipe.archetype} · ${row.recipe.style.raisedBands ?? 0} cords · ` +
      `frame ${row.recipe.style.coverFrame ?? 0} · medallion ${row.recipe.style.coverMedallion ?? 0} · ` +
      `${row.recipe.style.charm ?? 'none'}`;
    finish.style.cssText =
      `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:${shelf ? 8 : 9}px;opacity:.7;`;
    const metrics = document.createElement('div');
    const ratio = row.resolved.style.thickness / row.resolved.style.height;
    metrics.textContent =
      `seed ${row.seed} · v ${row.recipe.constraintViolations} · ` +
      `${row.resolved.style.thickness}×${row.resolved.style.height} · r ${ratio.toFixed(3)}`;
    metrics.style.cssText =
      `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:${shelf ? 8 : 9}px;opacity:.68;`;
    cell.append(binding, finish, metrics);
    return cell;
  };

  document.body.innerHTML = '';
  document.body.style.cssText =
    `margin:0;padding:18px;background:${flat.FLAT.recess};color:${flat.FLAT.ink};` +
    'font:11px "Nunito Sans",system-ui,sans-serif;';
  const native = document.createElement('main');
  native.id = 'adversarial-native';
  native.style.cssText =
    `display:grid;grid-template-columns:repeat(4,420px);gap:10px;padding:14px;background:${flat.FLAT.recess};width:max-content;`;
  const shelf = document.createElement('main');
  shelf.id = 'adversarial-shelf';
  shelf.style.cssText =
    `display:grid;grid-template-columns:repeat(5,300px);gap:8px;padding:14px;background:${flat.FLAT.recess};width:max-content;`;
  enriched.forEach((row) => {
    native.append(drawCell(row, false));
    shelf.append(drawCell(row, true));
  });
  document.body.append(native, shelf);

  const hierarchyRows = enriched.map((row) => ({
    title: row.title,
    titlePlate: row.recipe.style.titlePlate,
    frame: row.recipe.style.coverFrame ?? 0,
    emblem: row.recipe.style.ornament ?? -1,
  }));
  if (sabotage) {
    hierarchyRows.push({
      title: 'SABOTAGE: shaped title + ornate frame + large emblem',
      titlePlate: 'oxford-compartment',
      frame: 48,
      emblem: 20,
    });
  }
  const hierarchyViolations = hierarchyRows.filter((row) => {
    const family = covers.coverCompositionLayout(row.titlePlate, row.frame, row.emblem).family;
    const shapedTitle = family === 'heraldic' || family === 'round' || family === 'panel';
    return shapedTitle && row.frame >= 30 && row.emblem >= 0;
  });

  return {
    generatedAt: new Date().toISOString(),
    automaticSweep: {
      seedsPerDirection: 256,
      directions: design.BOOK_SURPRISE_DIRECTIONS.length,
      recipesEvaluated: 256 * design.BOOK_SURPRISE_DIRECTIONS.length,
    },
    summary: {
      specimens: enriched.length,
      minimumScore: Math.min(...enriched.map((row) => row.recipe.score)),
      constraintViolations: enriched.reduce((sum, row) => sum + row.recipe.constraintViolations, 0),
      widenedSelections: enriched.filter((row) => row.recipe.archetype.endsWith('-widened')).length,
      retiredConstructionSelections: enriched.filter((row) =>
        ['limp', 'creased', 'long-stitch', 'clasped', 'hollow-back', 'cushioned', 'ledger', 'chamfered']
          .includes(row.preset.shape) ||
        ['silk-moire', 'spanish-marble'].includes(row.preset.material),
      ).length,
      minimumNativeSpineWidth: Math.min(...enriched.map((row) => row.resolved.style.thickness)),
      minimumSpineRatio: Math.min(...enriched.map((row) =>
        row.resolved.style.thickness / row.resolved.style.height)),
      hierarchyViolations: hierarchyViolations.length,
    },
    hierarchyViolations,
    specimens: enriched.map((row) => ({
      kind: row.kind,
      title: row.title,
      direction: row.direction,
      seed: row.seed,
      requestedPreset: row.preset && row.kind === 'forced surviving challenge' ? row.preset.id : undefined,
      preset: row.recipe.preset,
      presetLabel: row.preset.label,
      shape: row.preset.shape,
      material: row.preset.material,
      archetype: row.recipe.archetype,
      score: row.recipe.score,
      candidatesEvaluated: row.recipe.candidatesEvaluated,
      constraintViolations: row.recipe.constraintViolations,
      diagnostics: row.recipe.diagnostics.map((item) => item.code),
      dimensions: {
        height: row.resolved.style.height,
        thickness: row.resolved.style.thickness,
        ratio: row.resolved.style.thickness / row.resolved.style.height,
      },
      composition: {
        raisedBands: row.recipe.style.raisedBands ?? 0,
        titlePlate: row.recipe.style.titlePlate,
        coverFrame: row.recipe.style.coverFrame,
        coverMedallion: row.recipe.style.coverMedallion,
        ornament: row.recipe.style.ornament,
        cornerProtectors: row.recipe.style.cornerProtectors,
        insetPlate: row.recipe.style.insetPlate,
        charm: row.recipe.style.charm,
      },
    })),
  };
}, sabotage);

const failures = [];
if (report.summary.minimumScore < 90) failures.push(`minimum score ${report.summary.minimumScore} < 90`);
if (report.summary.constraintViolations > 0) {
  failures.push(`${report.summary.constraintViolations} unlocked hard violations`);
}
if (report.summary.widenedSelections > 0) {
  failures.push(`${report.summary.widenedSelections} widened selections`);
}
if (report.summary.retiredConstructionSelections > 0) {
  failures.push(`${report.summary.retiredConstructionSelections} retired construction selections`);
}
if (report.summary.hierarchyViolations > 0) {
  failures.push(`${report.summary.hierarchyViolations} shaped-title/frame/emblem hierarchy violations`);
}
report.gate = { passed: failures.length === 0, failures };

await page.locator('#adversarial-native').screenshot({ path: nativePath });
await page.locator('#adversarial-shelf').screenshot({ path: shelfPath });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`-> ${nativePath}`);
console.log(`-> ${shelfPath}`);
console.log(`-> ${reportPath}`);
console.log(JSON.stringify(report.summary, null, 2));
console.log(sabotage && !report.gate.passed ? 'GATE ALIVE' : report.gate.passed ? 'GATE PASSED' : 'GATE FAILED');
await browser.close();
if (!report.gate.passed) {
  throw new Error(`Surprise adversarial gate failed:\n${report.gate.failures.join('\n')}`);
}
