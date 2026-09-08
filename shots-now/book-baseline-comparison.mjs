/**
 * Compare the pre-remaster book art with the working-tree revision.
 *
 * The baseline modules under reference-baseline are generated `git show REF:`
 * snapshots. Imports within that five-module graph remain isolated; shared
 * primitives such as flat.ts and noise.ts point at the live source tree. The
 * harness reads the real Welcome record through the world's QA bridges and
 * never writes to the database.
 *
 * Usage: node shots-now/book-baseline-comparison.mjs
 *        node shots-now/book-baseline-comparison.mjs --url=http://127.0.0.1:1420
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { posix } from 'node:path';

const urlArg = process.argv.find((arg) => arg.startsWith('--url='));
const baseUrl = urlArg?.slice('--url='.length) ?? 'http://127.0.0.1:1420';
const outDir = 'shots-now/out';
const imagePath = `${outDir}/book-baseline-comparison.png`;
const reportPath = `${outDir}/book-baseline-comparison.json`;
const baselineRef = process.argv.find((arg) => arg.startsWith('--ref='))?.slice(6) ?? 'b9bf6d1';
const baselineCommit = execFileSync('git', ['rev-parse', '--verify', `${baselineRef}^{commit}`], {
  encoding: 'utf8',
}).trim();
mkdirSync(outDir, { recursive: true });
const baselineModules = ['bookDesign', 'bookStyle', 'bookSurprise', 'covers', 'spines'];
mkdirSync('shots-now/reference-baseline', { recursive: true });
for (const name of baselineModules) {
  const source = execFileSync('git', ['show', `${baselineCommit}:src/art/${name}.ts`], {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  const isolated = source.replace(/(from\s+|import\s*\()(['"])(\.[^'"]+)\2/g,
    (_, prefix, quote, specifier) => {
      const target = posix.normalize(posix.join('src/art', specifier));
      const localName = target.replace(/^src\/art\//, '').replace(/\.ts$/, '');
      const relocated = baselineModules.includes(localName)
        ? `./${localName}.ts`
        : `../../${target}${posix.extname(target) ? '' : '.ts'}`;
      return `${prefix}${quote}${relocated}${quote}`;
    });
  writeFileSync(`shots-now/reference-baseline/${name}.ts`, isolated);
}

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1420, height: 1200 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
page.on('console', (message) => {
  // routeWebSocket is deliberate: Vite reports its blocked HMR channel as a
  // console error even though the page and every requested module are live.
  if (message.type() === 'error' && !message.text().includes('[vite] failed to connect')) {
    errors.push(message.text());
  }
});

try {
  // HMR can split the raster preloader and painter into two module instances.
  // A closed socket keeps this comparison on the graph loaded at navigation.
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.goto(`${baseUrl}/?fx=force`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 300 });
  await page.waitForFunction(() => (globalThis.__shelfVisibleBooks?.().length ?? 0) > 0, null, {
    polling: 300,
  });

  const report = await page.evaluate(async ({ baselineCommit: commit }) => {
    const [
      baselineStyles,
      baselineCovers,
      baselineSpines,
      baselineSurprise,
      revisedStyles,
      revisedCovers,
      revisedSpines,
      revisedSurprise,
    ] = await Promise.all([
      import('/shots-now/reference-baseline/bookStyle.ts'),
      import('/shots-now/reference-baseline/covers.ts'),
      import('/shots-now/reference-baseline/spines.ts'),
      import('/shots-now/reference-baseline/bookSurprise.ts'),
      import('/src/art/bookStyle.ts'),
      import('/src/art/covers.ts'),
      import('/src/art/spines.ts'),
      import('/src/art/bookSurprise.ts'),
    ]);
    await revisedCovers.preloadCoverArtwork?.();
    await Promise.all([
      document.fonts.load('600 28px "Caveat Variable"'),
      document.fonts.load('400 20px "Patrick Hand"'),
      document.fonts.load('500 13px "Nunito Sans"'),
    ]);

    const visible = globalThis.__shelfVisibleBooks();
    const welcomeBook = visible.find((book) => /^welcome to alcove/i.test(book.title));
    if (welcomeBook === undefined) {
      throw new Error(`The actual Welcome book is not visible (${visible.map((book) => book.title).join(', ')})`);
    }
    const welcomeMeta = globalThis.__shelfBookMeta(welcomeBook.id);
    // The public visible-books bridge intentionally exposes only identity and
    // title. Read the already-loaded store object for its seed; this is the
    // same in-memory Book record the metadata bridge resolves and is read-only.
    const loadedWelcome = globalThis.__shelfWorld.store?.findBook?.(welcomeBook.id);
    const welcome = {
      id: welcomeBook.id,
      title: welcomeBook.title,
      seed: loadedWelcome?.spineSeed,
      binding: globalThis.__shelfBinding(welcomeBook.id),
      style: welcomeMeta?.style ?? null,
    };
    if (!Number.isFinite(welcome.seed)) {
      throw new Error(`Welcome bridge omitted spineSeed (${Object.keys(welcomeBook).join(', ')})`);
    }

    const directionSpecs = [
      { direction: 'botanical', title: 'Field Notes', seed: 0x31a67e21 },
      { direction: 'grand', title: 'The Grand Atlas', seed: 0x52bf0d94 },
      { direction: 'quiet', title: 'Quiet Days', seed: 0x183ce7b2 },
      { direction: 'storybook', title: 'The Lantern Atlas', seed: 0x7410c53d },
    ];

    const rows = [{
      kind: 'welcome',
      label: 'Actual Welcome book',
      title: welcome.title,
      seed: welcome.seed,
      baseline: { preset: welcome.binding, style: welcome.style },
      revised: { preset: welcome.binding, style: welcome.style },
    }, ...directionSpecs.map((spec) => ({
      kind: 'direction',
      label: `${spec.direction[0].toUpperCase()}${spec.direction.slice(1)} Surprise`,
      title: spec.title,
      seed: spec.seed,
      baseline: baselineSurprise.surpriseBookRecipe(spec.direction, spec.seed),
      revised: revisedSurprise.surpriseBookRecipe(spec.direction, spec.seed),
    }))];

    document.body.innerHTML = '';
    document.body.style.cssText =
      'margin:0;background:#5c4030;color:#f7edda;font:13px "Nunito Sans",system-ui,sans-serif;';
    const board = document.createElement('main');
    board.id = 'book-baseline-comparison';
    board.style.cssText = 'width:1320px;padding:26px 28px 34px;background:#6b4935;box-sizing:border-box';
    const heading = document.createElement('header');
    heading.innerHTML = `<h1>Book artwork — baseline and revision</h1>` +
      `<p>Left: Git HEAD ${commit} · Right: working tree · identical row intent and title</p>`;
    heading.style.cssText = 'margin:0 0 18px';
    heading.querySelector('h1').style.cssText =
      'font:600 30px "Caveat Variable";margin:0;color:#fff7e7';
    heading.querySelector('p').style.cssText = 'margin:4px 0 0;color:#dbc7ad';
    board.append(heading);

    const columns = document.createElement('div');
    columns.style.cssText =
      'display:grid;grid-template-columns:170px 1fr 1fr;gap:12px;margin:0 0 8px;align-items:end';
    for (const text of ['', 'BASELINE', 'REVISED']) {
      const label = document.createElement('div');
      label.textContent = text;
      label.style.cssText = 'letter-spacing:.12em;font-weight:700;color:#f2d892;padding-left:12px';
      columns.append(label);
    }
    board.append(columns);

    const drawBook = (modules, row, version) => {
      const recipe = row[version];
      const resolved = modules.styles.resolveBookStyle(row.seed, undefined, recipe.style, {
        binding: recipe.preset,
      });
      const shell = document.createElement('section');
      shell.style.cssText =
        'height:304px;background:#f2e8d8;border:2px solid #432b2a;border-radius:5px;display:flex;' +
        'align-items:center;justify-content:center;position:relative;overflow:hidden';
      const canvas = document.createElement('canvas');
      canvas.width = 1000;
      canvas.height = 570;
      canvas.style.cssText = 'width:500px;height:285px;display:block';
      const ctx = canvas.getContext('2d');
      ctx.scale(2, 2);
      const bookH = 260;
      const scale = bookH / resolved.style.height;
      const spineW = Math.max(12, resolved.style.thickness * scale);
      const coverW = bookH * modules.covers.COVER_ASPECT;
      const groupW = spineW + 24 + coverW;
      const startX = (500 - groupW) / 2;
      const y = 12;
      modules.spines.renderSpine(
        ctx,
        { ...resolved.spine, binding: recipe.preset },
        startX,
        y,
        bookH,
        scale,
        { hiRes: true },
      );
      ctx.save();
      ctx.translate(startX + spineW + 24, y);
      modules.covers.renderCoverInto(ctx, coverW, bookH, resolved.cover, row.title);
      ctx.restore();
      shell.append(canvas);
      const detail = document.createElement('div');
      detail.textContent = `${recipe.preset ?? 'seeded binding'} · ${resolved.style.material}`;
      detail.style.cssText =
        'position:absolute;left:10px;bottom:7px;color:#6e5849;font-size:11px;letter-spacing:.02em';
      shell.append(detail);
      return { shell, resolved };
    };

    const results = [];
    for (const row of rows) {
      const line = document.createElement('article');
      line.style.cssText =
        'display:grid;grid-template-columns:170px 1fr 1fr;gap:12px;margin-top:12px;align-items:stretch';
      const label = document.createElement('div');
      label.innerHTML = `<strong>${row.label}</strong><span>${row.title}</span><small>seed ${row.seed}</small>`;
      label.style.cssText =
        'display:flex;flex-direction:column;justify-content:center;padding:12px;background:#53372f;border-radius:5px';
      label.querySelector('strong').style.cssText = 'color:#f5d97e;font-size:14px';
      label.querySelector('span').style.cssText = 'margin-top:7px;color:#fff2df';
      label.querySelector('small').style.cssText = 'margin-top:7px;color:#c7ad93';
      const oldDraw = drawBook({
        styles: baselineStyles,
        covers: baselineCovers,
        spines: baselineSpines,
      }, row, 'baseline');
      const newDraw = drawBook({
        styles: revisedStyles,
        covers: revisedCovers,
        spines: revisedSpines,
      }, row, 'revised');
      line.append(label, oldDraw.shell, newDraw.shell);
      board.append(line);
      results.push({
        label: row.label,
        title: row.title,
        seed: row.seed,
        baseline: {
          preset: row.baseline.preset,
          style: row.baseline.style,
          resolved: oldDraw.resolved.style,
        },
        revised: {
          preset: row.revised.preset,
          style: row.revised.style,
          resolved: newDraw.resolved.style,
        },
      });
    }
    document.body.append(board);
    return { baselineCommit: commit, welcome, rows: results };
  }, { baselineCommit });

  await page.locator('#book-baseline-comparison').screenshot({ path: imagePath });
  report.errors = errors;
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  if (errors.length > 0) throw new Error(`Browser errors: ${errors.join(' | ')}`);
  console.log(`-> ${imagePath}`);
  console.log(`-> ${reportPath}`);
  console.log(JSON.stringify({ baselineCommit, rows: report.rows.length, errors: errors.length }));
} finally {
  await browser.close();
}
