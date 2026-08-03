/**
 * shots-now/room-firstrun-sweep.mjs — every room preset, as a FIRST-RUN SCREEN.
 *
 * A room card is 148x102 and shows a case the size of a postage stamp against
 * a wall magnified 0.85 of the card's short side. That is the right picture for
 * a picker and the wrong one for judging a room: at true shelf zoom a paper is
 * three times finer, an arcade is the largest object on screen, and the value
 * step between timber and recess decides whether the carpentry reads at all.
 * Presets ranked off the cards ranked well as cards.
 *
 * So this drives the REAL app at the zoom it opens on, with a real shelf of
 * books in it, and applies each preset through the world's own bridges
 * (`__libraryPrefs.save` + `__shelfSaveDesign`) — never a probe-side import of
 * the store, which can resolve to a second copy on an HMR'd dev server.
 *
 * Every screenshot waits on the APPLIED state (`__shelfDesign()`), never on the
 * save: a preset that stores correctly and leaves the case alone is a real bug
 * and looks identical to success from the store's side.
 *
 * Usage:
 *   node shots-now/room-firstrun-sweep.mjs                 # all of ROOM_PRESETS
 *   node shots-now/room-firstrun-sweep.mjs --only=a,b,c    # named preset ids
 *   node shots-now/room-firstrun-sweep.mjs --set=<json>    # ad-hoc looks
 *       [{"id":"try-1","theme":"walnut","build":"gothic",
 *         "pattern":"trefoil","paper":"diaper-chapel"}]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const DIR = opt('dir', 'shots-now/room-rank');
const TAG = opt('tag', 'room');
const ONLY = opt('only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const SET = opt('set', '');
const BOOKS = Number(opt('books', '9'));

mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
const errors = new Set();
page.on('pageerror', (e) => errors.add(String(e.message).split('\n')[0].slice(0, 200)));

const poll = async (fn, arg, timeout = 90000, label = 'condition') => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, arg).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}`);
    await page.waitForTimeout(200);
  }
};

await page.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 120000 });
await poll(() => globalThis.__shelfDesign !== undefined, null, 120000, 'design bridge');
await poll(() => globalThis.__libraryPrefs !== undefined, null, 120000, 'library prefs bridge');
await poll(() => document.querySelector('.shelf-a11y button') !== null, null, 120000, 'a11y mirror');
for (let i = 0; i < 10; i += 1) {
  const skip = page.getByText('skip the tour');
  if ((await skip.count()) === 0) break;
  await skip.first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(600);
}
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(1200);

/* A shelf with books on it. An empty case hides the one thing a room has to do
 * — stand behind books without swallowing them. */
if (BOOKS > 0) {
  await page.evaluate(async (n) => {
    const titles = [
      'Cell Biology', 'Kanji Practice', 'Watercolour Basics', 'Tea Tasting Journal',
      'Linear Algebra', 'SQL Spellbook', 'Birdwatching Notes', 'Bread and Salt',
      'The Long Walk', 'Letters Home', 'Pocket Astronomy', 'Kitchen Latin',
    ].slice(0, n);
    await globalThis.__shelfSeedBooks(titles.slice(0, Math.ceil(n / 2)), 0);
    await globalThis.__shelfSeedBooks(titles.slice(Math.ceil(n / 2)), 1);
  }, BOOKS);
  await page.waitForTimeout(2200);
}

/** The looks to photograph, read out of the app's own table unless overridden. */
const looks =
  SET.length > 0
    ? JSON.parse(SET)
    : await page.evaluate(async (only) => {
        const o = await import('/src/views/rail/designOptions.ts');
        return o.ROOM_PRESETS.filter((p) => only.length === 0 || only.includes(p.id)).map((p) => ({
          id: p.id,
          name: p.name,
          group: p.group,
          theme: p.theme,
          build: p.build,
          pattern: p.pattern,
          paper: p.paper,
        }));
      }, ONLY);

console.log(`photographing ${looks.length} rooms`);

/**
 * Ask for a room, and keep asking until the WORLD is wearing it.
 *
 * The re-save is not belt and braces. A design change that lands while the
 * previous bake is still in flight is dropped by the world often enough to
 * stall a 55-room sweep halfway through, and the failure is silent: the store
 * holds the new room and the case keeps the old one. Re-issuing the save every
 * few seconds turns that from a dead run into a hiccup.
 */
async function wear(look) {
  const wantShelf = `${look.build}.${look.pattern}`;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page
      .evaluate(async (l) => {
        const paper = await import('/src/art/wallpaperDesign.ts');
        await globalThis.__libraryPrefs.save({ theme: l.theme, shelf: null, wall: null });
        await globalThis.__shelfSaveDesign({
          build: l.build,
          pattern: l.pattern,
          wallpaper: paper.wallpaperSpec(l.paper),
        });
      }, look)
      .catch(() => {});
    const t0 = Date.now();
    for (;;) {
      const got = await page
        .evaluate(
          (w) => {
            const d = globalThis.__shelfDesign();
            return d.shelf === w.shelf && d.libraryKey.includes(w.theme) ? d : null;
          },
          { shelf: wantShelf, theme: look.theme },
        )
        .catch(() => null);
      if (got) return;
      if (Date.now() - t0 > 12000) break;
      await page.waitForTimeout(250);
    }
    const now = await page.evaluate(() => globalThis.__shelfDesign()).catch(() => null);
    console.log(
      `  … re-asking for ${look.id} (attempt ${attempt + 2}); world holds ` +
        `${now?.shelf ?? '?'} / ${String(now?.libraryKey ?? '?').slice(0, 40)}`,
    );
  }
  throw new Error(`${look.id} never reached the case (wanted ${wantShelf} / ${look.theme})`);
}

/*
 * A run degrades after a dozen-odd room changes under SwiftShader — the world
 * stops picking the design up and every re-ask times out. `--from`/`--to` are
 * how a long sweep is taken in chunks, one fresh browser each; nothing about
 * the pictures depends on which chunk they were shot in.
 */
const TO = Number(opt('to', String(looks.length)));
let i = Number(opt('from', '1')) - 1;
for (const look of looks.slice(i, TO)) {
  i += 1;
  const wantShelf = `${look.build}.${look.pattern}`;
  await wear(look);
  await page.waitForTimeout(1500);
  const slug = String(look.id).replace(/[^a-z0-9]+/gi, '-');
  const name = `${DIR}/${TAG}-${String(i).padStart(2, '0')}-${slug}.png`;
  await page.screenshot({
    path: name,
    animations: 'disabled',
    caret: 'hide',
    timeout: 120000,
    clip: { x: 176, y: 0, width: 1324, height: 950 },
  });
  console.log(`  ${name}  ${look.theme} / ${wantShelf} / ${look.paper}`);
}

if (errors.size) console.log('errors:\n  ' + [...errors].join('\n  '));
await browser.close();
