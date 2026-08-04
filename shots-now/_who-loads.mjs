/**
 * _who-loads.mjs — which line of app code caused a given module to be fetched.
 *
 * Scratch tool. `perf-boot.mjs` lists WHAT arrived before the shelf was drawn;
 * when one of those is a dependency the code claims is lazy, the next question
 * is who asked for it, and grep cannot answer that for a dynamic import behind
 * three layers of callback. CDP's `Network.requestWillBeSent` carries the
 * initiator's JS stack, which can.
 *
 * Usage: node shots-now/_who-loads.mjs <url-substring> [page-url]
 */
import { chromium } from 'playwright';

const NEEDLE = process.argv[2] || 'howler';
const URL_ = process.argv[3] || 'http://localhost:1420/?fx=force';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');

const hits = [];
cdp.on('Network.requestWillBeSent', (e) => {
  if (!e.request.url.includes(NEEDLE)) return;
  hits.push({ url: e.request.url, ts: e.timestamp, initiator: e.initiator });
});

await page.goto(URL_, { waitUntil: 'domcontentloaded' });
await page
  .waitForFunction(
    () =>
      typeof window.__shelfVisibleBooks === 'function' && window.__shelfVisibleBooks().length > 0,
    null,
    { timeout: 60000 },
  )
  .catch(() => {});
await page.waitForTimeout(1500);

console.log(`\n${hits.length} request(s) matching "${NEEDLE}"\n`);
for (const h of hits) {
  console.log(h.url.split('/').slice(-1)[0]);
  const st = h.initiator.stack;
  if (!st) {
    console.log(`  initiator: ${h.initiator.type} ${h.initiator.url ?? ''}`);
    continue;
  }
  const walk = (frameSet, depth) => {
    for (const f of frameSet.callFrames ?? []) {
      const u = f.url.startsWith('http') ? new globalThis.URL(f.url).pathname : f.url;
      console.log(`  ${'  '.repeat(depth)}${f.functionName || '(anonymous)'}  ${u}:${f.lineNumber + 1}`);
    }
    if (frameSet.parent) {
      console.log(`  ${'  '.repeat(depth)}-- async --`);
      walk(frameSet.parent, depth + 1);
    }
  };
  walk(st, 0);
  console.log('');
}

await browser.close();
