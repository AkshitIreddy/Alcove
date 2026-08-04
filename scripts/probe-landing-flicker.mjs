/**
 * scripts/probe-landing-flicker.mjs — what arrives LATE after a page turn.
 *
 * The reader: *"When turning pages, after the page turn and we go to the next
 * page, there is a flicker for a second where it then puts all the processing
 * effects we have on it — for example the shadow effect in the middle and so
 * on. It either needs to be there from the start as soon as the page turn
 * begins, or needs to be really, really fast."*
 *
 * Guessing which effect it is has already failed twice — the gutter is rendered
 * unconditionally and `.snapshotting` only hides chrome. So this stops guessing
 * and photographs the landing: a burst of screenshots from the moment the turn
 * commits, each diffed against the LAST one in the burst (the settled page).
 * Whatever is missing early and present late shows up as the frames where the
 * difference is large, and the picture pair says what it is.
 *
 * Deliberately compares against the SETTLED frame rather than the previous one:
 * "how far is this from where it ends up" is the question, and consecutive-frame
 * diffs go quiet during a slow fade even though the page is still wrong.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL_BASE = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:1420';
const OUT = 'qa/turn/landing';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
/*
 * FORCE FULL MOTION, or none of this measures the thing being asked about.
 *
 * Headless Chromium reports `prefers-reduced-motion: reduce`, and
 * `programmaticFlip` answers that by calling `crossfadeNavigate` — skipping the
 * curl entirely. The first run of this probe showed the page 32% different at
 * 0ms and 0% by 70ms, which is not a page turn settling, it is a page turn that
 * never happened. Every earlier flip probe in this repo was measuring the same
 * shortcut without knowing it.
 */
await page.emulateMedia({ reducedMotion: 'no-preference' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

console.log('1. open the welcome book');
await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(() => {
  globalThis.__worldReady = false;
  void globalThis.__shelfWorld.ready.then(() => {
    globalThis.__worldReady = true;
  });
});
await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400 });
const skip = page.getByText('skip the tour');
if (await skip.count()) {
  await skip.first().click();
  await page.waitForTimeout(900);
}
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
 * Only the spread — the rail and the shelf behind it are not the subject.
 *
 * The box is resolved ONCE and every shot is a clip of the page, rather than a
 * locator screenshot per frame. A locator screenshot re-resolves its element
 * and waits for navigation to settle, and with agents editing the tree the dev
 * server fires HMR mid-burst: the first version of this timed out at 30s
 * "waiting for navigation to finish", which measured the harness rather than
 * the app. A clip cannot be invalidated by a reload.
 */
const spreadBox = await page.locator('.nb-flip-surface').first().boundingBox();
const clip = {
  x: Math.round(spreadBox.x),
  y: Math.round(spreadBox.y),
  width: Math.round(spreadBox.width),
  height: Math.round(spreadBox.height),
};
const spread = { screenshot: () => page.screenshot({ clip }) };

console.log('\n2. turn, and sample what is on the page every frame');
/*
 * DOM state per frame rather than a burst of screenshots.
 *
 * Screenshotting a WebGL canvas every 70ms fails under load — Chromium answers
 * `Protocol error (Page.captureScreenshot): Unable to capture screenshot` when
 * the compositor is busy, which it is whenever anything else runs on this
 * machine. Sampling the DOM costs nothing, is rAF-accurate rather than paced by
 * a 50ms screenshot round trip, and answers the same question: what is present
 * once the page settles that was NOT present the frame after the turn.
 */
await page.evaluate(() => {
  const snap = () => {
    const surface = document.querySelector('.nb-flip-surface');
    const canvas = document.querySelector('canvas');
    const leaves = [...document.querySelectorAll('.nb-flip-leaf')];
    const prose = document.querySelector('.nb-prose');
    return {
      t: Math.round(performance.now()),
      flipping: surface?.classList.contains('is-flip-gesture') ?? false,
      canvasUp: canvas?.classList.contains('is-flipping') ?? false,
      leafHidden: leaves.filter((l) => l.style.visibility === 'hidden').length,
      gutter: document.querySelector('.nb-spread-gutter') !== null,
      curl: document.querySelector('.nb-page-curl') !== null,
      effects: document.querySelectorAll(
        '[data-tape],[data-washi],[data-frame],[data-paper],[data-shadow],[data-underline],[data-color],[data-ink]',
      ).length,
      /*
       * Split by WHERE it is, or the number means nothing. The offscreen
       * staging area is also in the DOM (parked at left:-12000px), so a bare
       * count of `.snapshotting` cannot tell the page the reader is looking at
       * from the hidden copy — which is exactly the distinction the fix turns
       * on. Only the first of these is a defect.
       */
      snapOnVisible: [...document.querySelectorAll('.snapshotting')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.right > 0 && r.left < window.innerWidth && r.width > 0;
      }).length,
      snapOffscreen: [...document.querySelectorAll('.snapshotting')].filter((el) => {
        const r = el.getBoundingClientRect();
        return !(r.right > 0 && r.left < window.innerWidth && r.width > 0);
      }).length,
      blocks: prose === null ? 0 : prose.children.length,
      // WHICH element is carrying the class, so a miscount cannot be mistaken
      // for a diagnosis. Class list, size and position, first one only.
      snapWho: (() => {
        const el = document.querySelector('.snapshotting');
        if (el === null) return '';
        const r = el.getBoundingClientRect();
        return `${String(el.className).trim().split(/\s+/).slice(0, 3).join('.')} @${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
      })(),
    };
  };
  /*
   * Started BEFORE the key is pressed, and left running.
   *
   * The first version awaited the sampler inside one evaluate and pressed the
   * key from node afterwards — so it recorded 110 frames of a page nobody had
   * turned, and every field read "never changed". The turn has to happen while
   * the sampler is alive, which means the sampler cannot block the call.
   */
  globalThis.__trace = [snap()];
  const until = performance.now() + 2200;
  const tick = () => {
    globalThis.__trace.push(snap());
    if (performance.now() < until) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

await page.keyboard.press('ArrowRight');
await page.waitForTimeout(2400);
const trace = await page.evaluate(() => globalThis.__trace);

console.log('\n3. what changed, and when');
const first = trace[0];
const last = trace[trace.length - 1];
const keys = ['flipping', 'canvasUp', 'leafHidden', 'gutter', 'curl', 'effects', 'snapOnVisible', 'snapOffscreen', 'blocks'];
let lastChange = 0;
for (const k of keys) {
  const changes = [];
  for (let i = 1; i < trace.length; i += 1) {
    if (trace[i][k] !== trace[i - 1][k]) {
      const at = trace[i].t - first.t;
      changes.push(`${at}ms ${String(trace[i - 1][k])}->${String(trace[i][k])}`);
      if (at > lastChange) lastChange = at;
    }
  }
  console.log(
    `   ${k.padEnd(13)} ${String(first[k]).padEnd(6)} -> ${String(last[k]).padEnd(6)}` +
      (changes.length === 0 ? '  (never changed)' : `  ${changes.slice(0, 4).join(' · ')}`),
  );
}
const who = [...new Set(trace.map((f) => f.snapWho).filter((w) => w !== ''))];
console.log('\n   elements seen carrying .snapshotting:');
for (const w of who) console.log(`     ${w}`);
console.log(`\n   ${trace.length} frames; the page stopped changing ${lastChange}ms after the turn.`);

console.log('\nerrors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();
