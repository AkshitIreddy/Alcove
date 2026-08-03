/**
 * shots-now/_boot-check.mjs — does the dev server currently boot the shelf?
 *
 * Scratch helper, not part of the QA suite: the dev server is shared with other
 * agents editing this tree, so a probe that cannot open a book may be looking
 * at somebody's half-saved module rather than at a bug. Prints whether
 * __shelfWorld appeared plus any page error, and exits 0 only when it booted.
 */
import { chromium } from 'playwright';

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
const errs = [];
p.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text().slice(0, 200));
});
p.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e).slice(0, 300)));
await p.goto('http://localhost:1420/?fx=force', {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
});
let world = false;
try {
  await p.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
    timeout: 45000,
    polling: 400,
  });
  world = true;
} catch {
  /* reported below */
}
console.log('__shelfWorld present:', world);
console.log('errors:', errs.length);
for (const e of errs.slice(0, 8)) console.log('  -', e);
await b.close();
process.exit(world ? 0 : 1);
