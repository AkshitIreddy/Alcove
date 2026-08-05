/**
 * scripts/probe-blank-spread.mjs — when does a mounted leaf go blank?
 *
 * The reader, watching the demo GIF: *"noticed in the gif in the end their are
 * blank pages also"*. The frames show it plainly — a turn from one spread to
 * the next passes through four frames of a completely empty book: both leaves
 * blank, the rail and the title tab still there.
 *
 * `probe-turn.mjs` reported ZERO blank frames, so something about how it turns
 * differs from what the demo does. The demo turns AFTER opening and closing a
 * rail panel, and closing a panel resizes the spread — which runs
 * `remeasureCapacityWhenSettled`, which can repaginate. So this separates the
 * two: a bare turn, and a turn that follows a panel close.
 */
import { chromium } from 'playwright';

const URL_BASE = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:1420';
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1360, height: 850 } });
// Full motion, or the curl never happens — see probe-turn.mjs.
await page.emulateMedia({ reducedMotion: 'no-preference' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(async () => { await globalThis.__shelfWorld.ready; });
const skip = page.getByText('skip the tour');
if (await skip.count()) { await skip.first().click({ force: true }); await page.waitForTimeout(900); }
/*
 * Open the book through the SHELF'S OWN BRIDGES, not through
 * `import('/src/state/app.ts')`.
 *
 * That URL exists only while Vite is serving source, and this probe has to be
 * able to run against `vite preview` on a build — which is where the defect it
 * is chasing was actually seen (the demo GIF is recorded against a build). The
 * bridges are handed out under `?fx=` in both.
 *
 * `__shelfPullOut` flies the book out and leaves it standing; the cover is then
 * the button, and it wants a REAL pointer press — a synthetic `.click()` on it
 * does nothing.
 */
await page.evaluate(() => {
  const books = globalThis.__shelfVisibleBooks?.() ?? [];
  const welcome = books.find((b) => /welcome/i.test(b.title)) ?? books[0];
  if (welcome) globalThis.__shelfPullOut(welcome.id);
});
await page.waitForSelector('.pulled-book', { timeout: 30_000 });
await page.waitForTimeout(1600);
const cover = await page.locator('.pulled-book').first().boundingBox();
if (cover !== null) {
  await page.mouse.click(cover.x + cover.width / 2, cover.y + cover.height / 2);
}
await page.waitForSelector('.nb-prose', { timeout: 60_000 });
await page.waitForTimeout(6000);

/** Watch every frame for a mounted leaf with no words on it. */
const watch = async (label, act) => {
  await page.evaluate(() => {
    globalThis.__b = [];
    globalThis.__on = true;
    const tick = () => {
      if (!globalThis.__on) return;
      /*
       * A LEAF WITH NO PROSE AT ALL IS THE BLANK ONE — and missing that is why
       * the first version of this probe reported zero while the demo GIF showed
       * four frames of an empty book. It filtered to leaves that HAVE a
       * `.nb-prose` and then asked which of those were empty; a leaf whose
       * editor has been torn out has no `.nb-prose`, so it was not counted as
       * blank, it was not counted at all.
       */
      const leaves = [...document.querySelectorAll('.nb-flip-leaf')].filter((l) => {
        // On screen and carrying a page — an `is-empty` leaf is the cream face
        // of a spread with an odd page count, which is by design.
        const r = l.getBoundingClientRect();
        return r.width > 40 && !l.classList.contains('is-empty');
      });
      const inked = (l) => {
        const prose = l.querySelector('.nb-prose');
        return prose !== null && (prose.textContent ?? '').trim().length > 0;
      };
      /*
       * AND THE CURL, which is where the real one was hiding.
       *
       * During a WebGL flip the DOM leaves are set `visibility: hidden` and the
       * canvas draws the textures — but the hidden leaves KEEP their text, so
       * every DOM-based check reads "inked" while the reader is looking at
       * whatever the shader managed to sample. A curl running with no bitmap
       * for the revealed face draws bare paper, and that is the blank spread.
       *
       * So: a frame counts as blank if the leaves are empty OR if a curl is up
       * with a face missing from the cache.
       */
      const flipping = document.querySelector('canvas.is-flipping') !== null;
      const faces = globalThis.__flipCache?.facesFor?.('next') ?? null;
      const curlBlank =
        flipping && faces !== null && (!faces.hasFront || !faces.hasRevealed);
      globalThis.__b.push({
        t: Math.round(performance.now()),
        mounted: leaves.length,
        blank: leaves.filter((l) => !inked(l)).length + (curlBlank ? 1 : 0),
        noProse: leaves.filter((l) => l.querySelector('.nb-prose') === null).length,
        flipping,
        curlBlank,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await act();
  await page.waitForTimeout(2200);
  const frames = await page.evaluate(() => { globalThis.__on = false; return globalThis.__b; });
  /*
   * Reported SEPARATELY, because they are different defects with different
   * fixes and a combined count cannot tell you which one you just changed.
   *
   * A residual "curl with a missing face 2" at the END of a turn is a
   * measurement artefact, not a defect: once the flip commits, `ids()` has
   * moved on, so `facesFor('next')` is asking about the turn AFTER this one —
   * which is of course not warm yet — while `is-flipping` is still on the
   * canvas for a frame or two. What matters is a run in the MIDDLE of a curl.
   */
  const leafBad = frames.filter((f) => f.blank - (f.curlBlank ? 1 : 0) > 0);
  const curlBad = frames.filter((f) => f.curlBlank);
  const span = (list) => (list.length === 0 ? 0 : list[list.length - 1].t - list[0].t);
  const flip = frames.filter((f) => f.flipping).length;
  console.log(
    `  ${leafBad.length + curlBad.length === 0 ? 'ok  ' : 'BLANK'} ${label.padEnd(34)} ` +
      `${String(frames.length).padStart(3)} frames (${flip} curling) · ` +
      `leaf blank ${String(leafBad.length).padStart(2)} (~${span(leafBad)}ms) · ` +
      `curl with a missing face ${String(curlBad.length).padStart(2)} (~${span(curlBad)}ms)`,
  );
  return leafBad.length + curlBad.length;
};

console.log('\n1. a bare turn, nothing else touched');
for (let i = 0; i < 3; i += 1) {
  await watch(`turn ${i + 1}`, async () => { await page.keyboard.press('ArrowRight'); });
}

console.log('\n2. a turn straight after closing a rail panel');
for (const [name, sel] of [
  ['Page style', '.nb-pagestyle'],
  ['Catalogue', '.nb-catalogue'],
  ['Table of contents', '.nb-toc'],
]) {
  const btn = page.locator('.nb-rail').getByRole('button', { name: new RegExp(name) }).first();
  if ((await btn.count()) === 0) { console.log(`  (no rail button for ${name})`); continue; }
  await btn.click({ force: true });
  await page.waitForTimeout(1800);
  const close = page.getByRole('button', { name: new RegExp(`Close ${name}`) }).first();
  if (await close.count()) await close.click({ force: true });
  await page.waitForTimeout(1400);
  await watch(`turn after closing ${name}`, async () => { await page.keyboard.press('ArrowRight'); });
}

console.log('\nerrors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();
