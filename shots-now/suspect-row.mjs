/**
 * shots-now/suspect-row.mjs — one suspect binding per slot, standing between
 * two ordinary books.
 *
 * `dice-shelf.mjs` answers "what does a reader get?". This answers the question
 * that comes next: "is THIS one the problem?". A roll only shows a given
 * silhouette every fortieth book, so judging `coptic` from the dice means
 * running the shelf twenty times and hoping. Here each suspect is pinned into a
 * slot with a plain cloth octavo on either side of it — the honest test, because
 * a spine only reads as a stapler when there is a book beside it to fail to
 * match.
 *
 * It is still a SHELF: real slots, real neighbours, real bake path, and shot at
 * the zoom the app opens on as well as close. It is not a specimen board — the
 * suspects are never adjacent to each other.
 *
 * Usage:
 *   node shots-now/suspect-row.mjs --tag=cuts \
 *        --presets=scalloped-primer,wave-head-reader,notched-manual
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const TAG = opt('tag', 'suspects');
const SUSPECTS = opt('presets', '').split(',').filter(Boolean);
/**
 * Ornament STAMPS, by index — the other axis a rolled spine carries, and one a
 * preset cannot express. Given `--ornaments`, every book wears `plain-cloth`
 * and the numbered slots differ only in the brass struck on them.
 */
const ORNAMENTS = opt('ornaments', '').split(',').filter(Boolean).map(Number);
/** The book a suspect has to stand next to without looking like an intruder. */
const FOIL = opt('foil', 'plain-cloth');

if (SUSPECTS.length === 0 && ORNAMENTS.length === 0) {
  console.error('nothing to judge: pass --presets=… or --ornaments=…');
  process.exit(2);
}

mkdirSync('shots-now/dice', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
});
page.on('pageerror', (e) => console.log(`  pageerror: ${e.message.split('\n')[0]}`));
page.on('response', (r) => {
  if (r.status() >= 400) console.log(`  HTTP ${r.status()} ${r.url()}`);
});

const poll = async (fn, timeout = 120000, label = 'condition') => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}`);
    await page.waitForTimeout(250);
  }
};

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => {
  try {
    localStorage.clear();
    localStorage.setItem('nb-tutorial-done', '1');
  } catch {}
});
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await poll(() => globalThis.__shelfWorld !== undefined, 120000, 'world hook');
await poll(() => globalThis.__shelfSetBookStyle !== undefined, 120000, 'style bridge');
for (let a = 0; a < 4; a += 1) {
  const card = page.locator('text=skip the tour').first();
  if ((await card.count()) === 0) break;
  await card.click({ force: true, timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(700);
}
await page.waitForTimeout(1500);

await page.evaluate(() =>
  globalThis.__shelfSaveDesign({
    build: 'plank',
    pattern: 'none',
    wallpaper: { pattern: 'plain', scale: 'medium', depth: 'flat', ink: 'paper' },
  }),
);
await page.waitForTimeout(800);
await page.evaluate(() => globalThis.__shelfEmptyLibrary());
await page.waitForTimeout(1200);

// foil, suspect, foil, suspect, … so no two suspects touch.
const under = SUSPECTS.length > 0 ? SUSPECTS : ORNAMENTS;
const cast = [];
const stamps = [];
under.forEach((_, i) => {
  cast.push(FOIL, SUSPECTS[i] ?? FOIL);
  stamps.push(-1, ORNAMENTS[i] ?? -1);
});
cast.push(FOIL);
stamps.push(-1);

const perFloor = Math.ceil(cast.length / 2);
const titles = cast.map((_, i) => (i % 2 === 1 ? `No ${(i + 1) / 2}` : 'Ordinary'));
await page.evaluate(
  ([t, n]) => globalThis.__shelfSeedBooks(t.slice(0, n), 0),
  [titles, perFloor],
);
await page.evaluate(
  ([t, n]) => globalThis.__shelfSeedBooks(t.slice(n), 1),
  [titles, perFloor],
);
await poll(
  () => (globalThis.__shelfWorld?.store?.get(1)?.length ?? 0) > 0,
  60000,
  'seeded books',
);
await page.waitForTimeout(2500);

const applied = await page
  .evaluate(
    async ([plan, brass]) => {
      const w = globalThis.__shelfWorld;
      const out = [];
      let n = 0;
      for (const floor of [0, 1]) {
        const books = [...(w.store.get(floor) ?? [])].sort((a, b) => a.slot - b.slot);
        for (const b of books) {
          const id = plan[n];
          const stamp = brass[n] ?? -1;
          n += 1;
          if (id === undefined) continue;
          await globalThis.__shelfSaveBinding(b.id, id);
          // Everything except the one axis under test is held flat: same
          // height, no charm, no wear. If the row still has an intruder in it,
          // the intruder is the thing being judged.
          await globalThis.__shelfSetBookStyle(b.id, {
            ornament: stamp,
            charm: 'none',
            wear: 0,
            height: 232,
          });
          out.push({ floor, slot: b.slot, preset: id, ornament: stamp });
        }
      }
      return { out, seen: [0, 1].map((f) => (w.store.get(f) ?? []).length) };
    },
    [cast, stamps],
  )
  .then((r) => {
    console.log(`store rows per floor: ${JSON.stringify(r.seen)}`);
    return r.out;
  });
console.log(`pinned ${applied.length}:`);
for (const a of applied) {
  const brass = a.ornament >= 0 ? `  orn ${a.ornament}` : '';
  console.log(`  f${a.floor} s${String(a.slot).padStart(2)}  ${a.preset}${brass}`);
}
await page.waitForTimeout(4500);

await page.screenshot({ path: `shots-now/dice/${TAG}-open.png` });

const panel = async (floor, part, x0) => {
  await page.evaluate(
    ([f, x]) => {
      const w = globalThis.__shelfWorld;
      const cam = w.camera;
      cam.vx = 0;
      cam.vy = 0;
      cam.anchor = null;
      cam.zoom = 2.6;
      cam.logZoomTarget = Math.log(2.6);
      cam.y = -50 + f * 340;
      cam.x = x;
      w.dirty = true;
    },
    [floor, x0],
  );
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `shots-now/dice/${TAG}-f${floor}${part}.png` });
};
for (const floor of [0, 1]) {
  await panel(floor, 'a', 180);
  await panel(floor, 'b', 570);
}

console.log(`shots-now/dice/${TAG}-*.png`);
await browser.close();
