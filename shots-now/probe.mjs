/**
 * shots-now/probe.mjs — is the authored spine atlas actually reaching the shelf?
 *
 * The clean screenshot showed a single flat-tinted book, which is what the
 * fallback placeholder looks like, so the question is whether the atlas was
 * fetched at all, whether it errored, and how long the main thread was busy.
 * Reports console errors, every /spines/ request, and the paint timings the
 * reset is measured against.
 */
import { chromium } from 'playwright';

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });

const errors = [];
const spineReqs = [];
p.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text().slice(0, 200)}`);
});
p.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
p.on('response', (r) => {
  if (r.url().includes('/spines/')) spineReqs.push(`${r.status()} ${r.url().split('/').slice(-1)[0]}`);
});

await p.goto('http://localhost:1420?fx=force', { waitUntil: 'networkidle' });
await p.evaluate(() => { try { localStorage.setItem('nb-tutorial-done', '1'); } catch {} });
await p.reload({ waitUntil: 'networkidle' });
await new Promise((r) => setTimeout(r, 9000));

const paint = await p.evaluate(() => {
  const fp = performance.getEntriesByType('paint').map((e) => `${e.name}=${Math.round(e.startTime)}ms`);
  const longest = performance
    .getEntriesByType('longtask')
    .reduce((m, e) => Math.max(m, e.duration), 0);
  const canvas = document.querySelector('canvas');
  return {
    paint: fp.join(' '),
    longestTask: Math.round(longest),
    canvas: canvas ? `${canvas.width}x${canvas.height}` : 'none',
    books: document.querySelectorAll('[data-book-id]').length,
  };
});

console.log('spine requests :', spineReqs.length ? spineReqs.join(', ') : 'NONE — atlas never fetched');
console.log('canvas         :', paint.canvas);
console.log('paint          :', paint.paint);
console.log('longest task   :', paint.longestTask, 'ms');
console.log('errors         :', errors.length);
for (const e of errors.slice(0, 12)) console.log('   ', e);

await b.close();
