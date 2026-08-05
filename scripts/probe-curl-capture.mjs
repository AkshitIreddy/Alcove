/**
 * scripts/probe-curl-capture.mjs — does the page curl survive being recorded?
 *
 * The reader, of the demo: *"page turn animation is not even visible in the
 * gif"*. Measured on the recording: every page change is a SINGLE-frame cut,
 * while rail panels animate over 4-10 frames. So the DOM animates in the
 * capture and the curl does not.
 *
 * The curl is the one thing on screen drawn by WebGL rather than by the DOM
 * (`src/flip/`), and the recording is a CDP `Page.startScreencast`. Two
 * candidates: the curl never runs under puppeteer, or it runs and the
 * screencast does not composite it. This tells them apart by doing both at
 * once — asking the app what phase the flip is in, AND capturing the same
 * moment two ways (a screencast frame and a `Page.captureScreenshot`).
 */
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('qa/demo/curl', { recursive: true });
const URL_BASE = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:1420';

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1360, height: 850 });
await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, { polling: 400, timeout: 60_000 });
await page.evaluate(async () => { await globalThis.__shelfWorld.ready; });
await page.evaluate(() => {
  const s = [...document.querySelectorAll('button,a')].find((e) => /skip the tour/i.test(e.textContent ?? ''));
  s?.click();
});
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  const w = list.find((b) => /welcome/i.test(b.title)) ?? list[0];
  app.appState.openBook(w.id);
});
await page.waitForSelector('.nb-prose', { timeout: 60_000 });
await new Promise((r) => setTimeout(r, 6000));

// A screencast, exactly as gifsmith runs one.
const client = await page.createCDPSession();
const shots = [];
client.on('Page.screencastFrame', async (e) => {
  shots.push({ at: Date.now(), data: e.data });
  try { await client.send('Page.screencastFrameAck', { sessionId: e.sessionId }); } catch { /* dropped */ }
});
await client.send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1 });

// Watch the flip's own state while it happens.
await page.evaluate(() => {
  globalThis.__phase = [];
  globalThis.__on = true;
  const tick = () => {
    if (!globalThis.__on) return;
    const c = document.querySelector('canvas.nb-flip-canvas, canvas');
    globalThis.__phase.push({
      t: Math.round(performance.now()),
      curling: c?.classList.contains('is-flipping') ?? false,
      surface: document.querySelector('.nb-flip-surface.is-flip-gesture') !== null,
      fold: document.querySelector('.nb-rigid-fold, [data-rigid-fold]') !== null,
    });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

// Blur first, or ArrowRight is a caret move: `arrowFlipAction` returns null
// when the active element is a typing target, and the caret sits in the page.
await page.evaluate(() => { const el = document.activeElement; if (el instanceof HTMLElement) el.blur(); });
await new Promise((r) => setTimeout(r, 400));

const t0 = Date.now();
await page.keyboard.press('ArrowRight');
// A direct screenshot mid-curl, the other way of capturing the same moment.
await new Promise((r) => setTimeout(r, 220));
const mid = await page.screenshot({ encoding: 'base64' });
writeFileSync('qa/demo/curl/screenshot-mid-curl.png', Buffer.from(mid, 'base64'));
await new Promise((r) => setTimeout(r, 1800));

const phases = await page.evaluate(() => { globalThis.__on = false; return globalThis.__phase; });
await client.send('Page.stopScreencast');

const curling = phases.filter((p) => p.curling);
const surf = phases.filter((p) => p.surface);
const folds = phases.filter((p) => p.fold);
console.log('\nwhat the APP did:');
console.log(`  ${phases.length} frames sampled`);
console.log(`  canvas.is-flipping true on ${curling.length} frames`);
console.log(`  flip surface engaged on  ${surf.length} frames`);
console.log(`  rigid fold present on    ${folds.length} frames`);

// Save the screencast frames that landed inside the curl window.
const during = shots.filter((s) => s.at - t0 > 60 && s.at - t0 < 900);
console.log(`\nwhat the SCREENCAST caught: ${shots.length} frames total, ${during.length} inside the curl window`);
during.slice(0, 6).forEach((s, i) => {
  writeFileSync(`qa/demo/curl/screencast-${String(i + 1).padStart(2, '0')}-at${s.at - t0}ms.png`, Buffer.from(s.data, 'base64'));
});
console.log('  wrote qa/demo/curl/screencast-*.png and screenshot-mid-curl.png — LOOK at them');
await browser.close();
