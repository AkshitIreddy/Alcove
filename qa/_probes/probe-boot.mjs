/**
 * probe-boot.mjs — what is the main thread doing during the FIRST N ms?
 *
 * probe-freeze aggregates a whole 45s profile, which drowns the boot block in
 * everything that happens afterwards. This windows the CPU samples to the
 * opening stretch and reports both self time and the module each frame came
 * from, so "is the boot block art-module evaluation?" has an answer.
 *
 * node qa/_probes/probe-boot.mjs [--url=…] [--window=5000]
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (n, d) => args.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const URL_BASE = opt('url', 'http://localhost:1445');
const WINDOW = Number(opt('window', '5000'));

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const session = await context.newCDPSession(page);
await session.send('Profiler.enable');
await session.send('Profiler.setSamplingInterval', { interval: 100 });
await session.send('Profiler.start');
await page.goto(`${URL_BASE}/?fx=force&bakeprof=1`, { waitUntil: 'domcontentloaded', timeout: 300000 });
await page.waitForTimeout(WINDOW);
const { profile } = await session.send('Profiler.stop');
await browser.close();

const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parentOf = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parentOf.set(c, n.id);
const self = new Map();
const byFile = new Map();
/** Who ASKED for the paint: first frame outside the low-level art modules. */
const LOW = new RegExp(process.env.LOWRE ?? 'brush\.ts|noise\.ts|simplex-noise');
const blame = new Map();
let total = 0;
// timeDeltas[i] is the gap BEFORE samples[i]; accumulate wall time per node.
let t = profile.startTime;
for (let i = 0; i < profile.samples.length; i++) {
  t += profile.timeDeltas[i] ?? 0;
  const rel = (t - profile.startTime) / 1000;
  if (rel > WINDOW) break;
  const n = byId.get(profile.samples[i]);
  if (!n) continue;
  const f = n.callFrame;
  const file = (f.url || '(vm)').split('/').slice(-1)[0].split('?')[0];
  const name = `${f.functionName || '(anonymous)'} @ ${file}:${f.lineNumber + 1}`;
  self.set(name, (self.get(name) ?? 0) + 1);
  byFile.set(file, (byFile.get(file) ?? 0) + 1);
  if (LOW.test(f.url || '')) {
    let cur = profile.samples[i];
    let hops = 0;
    while (cur !== undefined && hops++ < 60) {
      const node = byId.get(cur);
      if (!node) break;
      if (!LOW.test(node.callFrame.url || '')) {
        const cf = node.callFrame;
        const cfile = (cf.url || '(vm)').split('/').slice(-1)[0].split('?')[0];
        const key = `${cf.functionName || '(anonymous)'} @ ${cfile}:${cf.lineNumber + 1}`;
        blame.set(key, (blame.get(key) ?? 0) + 1);
        break;
      }
      cur = parentOf.get(cur);
    }
  }
  total++;
}
const perSample = WINDOW / Math.max(1, total);
console.log(`\nfirst ${WINDOW}ms — ${total} samples, ~${perSample.toFixed(2)}ms each\n`);
console.log('by file:');
for (const [file, n] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 16)) {
  console.log(`  ${(n * perSample).toFixed(0).padStart(6)}ms  ${((n / total) * 100).toFixed(1).padStart(5)}%  ${file}`);
}
console.log('\nwho asked for the brush work (nearest non-brush caller):');
for (const [name, n] of [...blame].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  console.log(`  ${(n * perSample).toFixed(0).padStart(6)}ms  ${((n / total) * 100).toFixed(1).padStart(5)}%  ${name}`);
}
console.log('\nby function:');
for (const [name, n] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 24)) {
  console.log(`  ${(n * perSample).toFixed(0).padStart(6)}ms  ${((n / total) * 100).toFixed(1).padStart(5)}%  ${name}`);
}
