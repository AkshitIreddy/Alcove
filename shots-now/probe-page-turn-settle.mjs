/**
 * Compare destination-face ink and live layout after real Welcome page turns.
 * Run against the exclusive :1420 server in an isolated browser context.
 * --sabotage-grid restores the old snapshot rule and must exit nonzero.
 * --scale=0.85 or --scale=1.15 exercises the reading-size endpoints.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const out = process.argv.find(a => a.startsWith('--out='))?.slice(6) ?? 'E:/temp/alcove-turn-settle';
const testScale = Number(process.argv.find(a => a.startsWith('--scale='))?.slice(8) ?? 1);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1360, height: 850 } });
page.setDefaultTimeout(120000);
try {
  if (process.argv.includes('--sabotage-grid')) {
    // The actual old snapshot-only rule, without changing live source files.
    await page.route('**/src/flip/snapshotFidelity.ts*', route => route.fulfill({
      contentType: 'application/javascript',
      body: `import { proseGridCorrections } from '/src/editor/proseGrid.ts';
        export function snapshotGridCorrections(blocks, pitch) {
          return proseGridCorrections(blocks, pitch).filter(({ index }) => !blocks[index - 1].ordinary);
        }`,
    }));
  }
  await page.goto('http://127.0.0.1:1420/?fx=force', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!globalThis.__shelfWorld?.ready && typeof globalThis.__shelfVisibleBooks === 'function');
  await page.evaluate(() => globalThis.__shelfWorld.ready);
  await page.evaluate(scale => {
    document.documentElement.style.setProperty('--page-text-scale', String(scale));
    document.documentElement.style.setProperty('--page-text-size', `${20 * scale}px`);
  }, testScale);
  await page.evaluate(async () => {
    const book = globalThis.__shelfVisibleBooks().find(b => /Welcome/i.test(b.title)) ?? globalThis.__shelfVisibleBooks()[0];
    const { appState } = await import('/src/state/app.ts');
    appState.openBook(book.id);
  });
  await page.waitForSelector('.nb-flip-surface .ProseMirror h1');
  await page.getByText('skip the tour', { exact: true }).waitFor({ timeout: 5000 }).then(() => page.getByText('skip the tour', { exact: true }).click()).catch(() => {});
  await page.evaluate(async () => (await import('/src/features/tutorial/state.ts')).stopTutorial(true));
  await page.evaluate(() => document.fonts.ready);
  const reports = [];
  const turns = Number(process.argv.find(a => a.startsWith('--turns='))?.slice(8) ?? 4);
  for (let turn = 0; turn < turns; turn++) {
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.evaluate(() => globalThis.__flipCache.prepare('next'));
      const faces = await page.evaluate(() => globalThis.__flipCache.facesFor('next'));
      if (faces?.hasBack && faces.hasRevealed && faces.hasFront && faces.aheadPending === 0) break;
    }
    const faces = await page.evaluate(() => globalThis.__flipCache.facesFor('next'));
    for (const [side, id] of [['left', faces.back], ['right', faces.revealed]]) {
      const png = await page.evaluate(id => globalThis.__flipCache.bitmapPng(id), id);
      if (!png) throw new Error(`Missing ${side} destination raster`);
      writeFileSync(`${out}/${turn}-${side}-raster.png`, Buffer.from(png.split(',')[1], 'base64'));
    }
    const before = await page.locator('[data-spread-index]').getAttribute('data-spread-index');
    await page.evaluate(() => {
      globalThis.__settleFrames = [];
      globalThis.__settleRunning = true;
      const sample = () => {
        const readings = [];
        for (const side of ['left', 'right']) {
          const sheet = document.querySelector(`.nb-flip-leaf-${side} .nb-sheet-paper`);
          const root = sheet?.getBoundingClientRect();
          if (!root) continue;
          const scale = root.width / sheet.offsetWidth;
          for (const [index, node] of [...sheet.querySelectorAll('.ProseMirror h1, .ProseMirror p, .ProseMirror li')].entries()) {
            const text = node.textContent.trim();
            if (!text) continue;
            const box = node.getBoundingClientRect();
            readings.push({ key: `${side}:${index}:${text}`, x: (box.x-root.x)/scale, y: (box.y-root.y)/scale, w: box.width/scale, h: box.height/scale });
          }
        }
        globalThis.__settleFrames.push({ time: performance.now(), spread: document.querySelector('[data-spread-index]')?.getAttribute('data-spread-index'), moving: !!document.querySelector('.nb-flip-canvas.is-flipping'), readings });
        if (globalThis.__settleRunning) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.locator('.nb-flip-hotspot-next').click({ force: true });
    await page.waitForFunction(index => document.querySelector('[data-spread-index]')?.getAttribute('data-spread-index') !== index && !document.querySelector('.nb-flip-canvas.is-flipping'), before);
    // Observe the whole landing window, including deferred alignment work.
    await page.waitForTimeout(1500);
    const frames = await page.evaluate(() => { globalThis.__settleRunning = false; return globalThis.__settleFrames; });
    for (const side of ['left', 'right']) await page.locator(`.nb-flip-leaf-${side} .nb-sheet-paper`).screenshot({ path: `${out}/${turn}-${side}-live.png` });
    const landed = frames.filter(f => f.spread !== before && !f.moving);
    const ranges = new Map();
    for (const frame of landed) for (const r of frame.readings) {
      const previous = ranges.get(r.key) ?? { key: r.key, minY: r.y, maxY: r.y, first: r, last: r };
      previous.minY = Math.min(previous.minY, r.y); previous.maxY = Math.max(previous.maxY, r.y); previous.last = r;
      ranges.set(r.key, previous);
    }
    const shifts = [...ranges.values()].filter(r => r.maxY-r.minY > 1).map(r => ({ ...r, shift: r.maxY-r.minY }));
    reports.push({ turn, before, faces, shifts, frames });
    console.log(JSON.stringify({ turn, shifts: shifts.map(s => ({ text: s.key.slice(0,100), shift: s.shift })), landedFrames: landed.length }));
  }
  // Compare the ink itself: DOM boxes cannot see the preceding raster owner.
  // Normalise only pixel density/viewport scale, keeping page-relative layout.
  const ink = await page.evaluate(async ({ raster, live }) => {
    const load = source => new Promise((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = source;
    });
    const [a,b] = await Promise.all([load(raster), load(live)]);
    const w=b.width, h=b.height;
    const bands = image => {
      const canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h;
      const context=canvas.getContext('2d'); context.drawImage(image,0,0,w,h);
      const pixels=context.getImageData(0,0,w,h).data;
      const groups=[];
      for (let y=Math.floor(h*.14);y<Math.floor(h*.245);y++) {
        let ink=0;
        for(let x=Math.floor(w*.14);x<Math.floor(w*.60);x++) {
          const i=(y*w+x)*4;
          if(Math.max(pixels[i],pixels[i+1],pixels[i+2])<160) ink++;
        }
        if(ink<=6) continue;
        if(!groups.length || y>groups.at(-1).at(-1)+1) groups.push([]);
        groups.at(-1).push(y);
      }
      return groups.filter(g=>g.length>2).map(g=>[g[0],g.at(-1)]);
    };
    const rasterBands=bands(a), liveBands=bands(b);
    const delta=rasterBands.length && liveBands.length ? liveBands[0][0]-rasterBands[0][0] : null;
    return { rasterBands, liveBands, downwardShiftPixels:delta, ok:delta!==null && Math.abs(delta)<=2 };
  }, {
    raster: `data:image/png;base64,${readFileSync(`${out}/0-left-raster.png`).toString('base64')}`,
    live: `data:image/png;base64,${readFileSync(`${out}/0-left-live.png`).toString('base64')}`,
  });
  writeFileSync(`${out}/report.json`, JSON.stringify({ scale:testScale, ink, turns:reports }, null, 2));
  console.log(JSON.stringify({ ink }));
  if (!ink.ok || reports.some(r => r.shifts.length)) process.exitCode = 1;
} finally { await browser.close(); }
