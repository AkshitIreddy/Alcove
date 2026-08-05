/**
 * scripts/probe-jank-callers.mjs — WHO calls the expensive native functions.
 *
 * `probe-jank-profile.mjs` gives self time, and self time attributes a stall to
 * `getPropertyValue` — a native leaf that no one wrote and everyone calls. That
 * names the symptom. This walks the profile TREE upward from the heaviest
 * leaves to the nearest frame in `src/`, which names the line to change.
 *
 * The distinction has already cost a wrong fix here once: the same 175ms was
 * read as "the SVG inliner", which is a plausible caller of exactly this
 * function and, as it turns out, is not the one running.
 *
 *   node scripts/probe-jank-callers.mjs --tool=share
 */
import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};
const URL_BASE = arg('url', 'http://localhost:1420');
const TOOL = arg('tool', 'share');

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const cdp = await page.context().newCDPSession(page);

await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(() => {
  globalThis.__worldReady = false;
  void globalThis.__shelfWorld.ready.then(() => { globalThis.__worldReady = true; });
});
await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400 });
const skip = page.getByText('skip the tour');
if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(900); }
await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  const welcome = list.find((b) => /welcome/i.test(b.title)) ?? list[0];
  app.appState.openBook(welcome.id);
});
await page.waitForSelector('.nb-prose p', { timeout: 60_000 });
await page.waitForTimeout(6000);

/*
 * Two places to look, because the reader named two: the rail panels inside a
 * book, and the library studio out on the shelf. `--tool=studio` opens it,
 * `--tool=studio-change` profiles PRESSING a design, which is the expensive
 * one (215ms to open, a 1337ms frame gap to change).
 */
const onShelf = TOOL.startsWith('studio');
if (onShelf) {
  await page.evaluate(async () => {
    const app = await import('/src/state/app.ts');
    app.appState.closeBook();
  });
  await page.waitForSelector('.shelf-dock', { timeout: 30_000 });
  await page.waitForTimeout(2500);
}

let act;
if (TOOL === 'studio') {
  const b = page.getByLabel('Library studio').first();
  act = async () => { await b.click(); await page.waitForTimeout(1800); };
} else if (TOOL === 'studio-change') {
  await page.getByLabel('Library studio').first().click();
  await page.waitForTimeout(2500);
  const swatch = page.locator('.nb-studio button, .nbq-studio button, [data-preset-id]').nth(6);
  if ((await swatch.count()) === 0) { console.log('no studio swatch'); await browser.close(); process.exit(1); }
  act = async () => { await swatch.click(); await page.waitForTimeout(2200); };
} else {
  const btn = page.locator(`.nb-rail-button[data-tool="${TOOL}"]`).first();
  if ((await btn.count()) === 0) { console.log(`no rail button for "${TOOL}"`); await browser.close(); process.exit(1); }
  act = async () => { await btn.click({ force: true }); await page.waitForTimeout(1400); };
}

await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
await cdp.send('Profiler.start');
await act();
const { profile } = await cdp.send('Profiler.stop');

// ---- build the tree and attribute every sample to a src/ ancestor ----
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);

const label = (n) => {
  const f = n.callFrame;
  const url = (f.url ?? '').replace(/^https?:\/\/[^/]+\//, '').split('?')[0];
  return { name: f.functionName || '(anonymous)', url, line: f.lineNumber + 1 };
};
const isOurs = (n) => {
  const u = n.callFrame.url ?? '';
  return u.includes('/src/') && !u.includes('node_modules');
};

// samples per node
const hits = new Map();
for (const id of profile.samples) hits.set(id, (hits.get(id) ?? 0) + 1);
const totalMs = (profile.endTime - profile.startTime) / 1000;
const msPerSample = totalMs / profile.samples.length;

// For each heavy leaf, walk up to the first frame in src/ and attribute.
const blame = new Map();
for (const [id, count] of hits) {
  const node = byId.get(id);
  if (node === undefined) continue;
  let cur = node;
  let depth = 0;
  const chain = [];
  while (cur !== undefined && depth < 60) {
    chain.push(cur);
    if (isOurs(cur)) break;
    const pid = parent.get(cur.id);
    cur = pid === undefined ? undefined : byId.get(pid);
    depth += 1;
  }
  const owner = cur !== undefined && isOurs(cur) ? cur : null;
  const key = owner === null
    ? `(no src/ frame) ${label(node).name}`
    : `${label(owner).name}  ${label(owner).url}:${label(owner).line}`;
  const entry = blame.get(key) ?? { ms: 0, leaves: new Map() };
  entry.ms += count * msPerSample;
  const ln = label(node).name;
  entry.leaves.set(ln, (entry.leaves.get(ln) ?? 0) + count * msPerSample);
  blame.set(key, entry);
}

console.log(`\n=== "${TOOL}" panel: ${Math.round(totalMs)}ms profiled, blamed on the nearest src/ frame ===\n`);
const ranked = [...blame.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 14);
for (const [key, e] of ranked) {
  if (e.ms < 3) continue;
  const top = [...e.leaves.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([n, ms]) => `${n} ${ms.toFixed(0)}ms`).join(', ');
  console.log(`${e.ms.toFixed(1).padStart(8)}ms  ${key}`);
  console.log(`            spent in: ${top}`);
}
await browser.close();
