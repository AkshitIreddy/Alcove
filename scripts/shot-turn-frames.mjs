/**
 * scripts/shot-turn-frames.mjs — photograph a page turn, frame by frame.
 *
 * probe-landing-effects.mjs measures the turn; this LOOKS at it. The numbers
 * can be right while the page still reads wrong, and the frame the reader is
 * actually complaining about — the last GL frame, held on screen while the main
 * thread finishes mounting the new spread — is not a state any single
 * screenshot is guaranteed to land on. So: press the key, then shoot as fast as
 * the harness can, recording for every shot whether the overlay was still up.
 *
 * The interesting picture is the LAST shot with `canvas UP` after the DOM has
 * swapped. That is the picture the reader stares at for up to half a second,
 * and everything the resting spread wears which that frame does not is the bug.
 *
 * Usage: node scripts/shot-turn-frames.mjs --tag=before [--shots=16]
 * Writes qa/turn/frames/<tag>-NN-<up|down>[-swapped].png plus a state line each.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL_BASE =
  process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:1420';
const TAG = process.argv.find((a) => a.startsWith('--tag='))?.slice(6) ?? 'now';
const SHOTS = Number(process.argv.find((a) => a.startsWith('--shots='))?.slice(8) ?? 16);
const DELAY = Number(process.argv.find((a) => a.startsWith('--delay='))?.slice(8) ?? 0);
const DRAG = Number(process.argv.find((a) => a.startsWith('--drag='))?.slice(7) ?? 0);
const COLD = process.argv.includes('--cold');
const OUT = 'qa/turn/frames';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
// Headless Chromium reports `reduce`, and the controller answers that with a
// crossfade — a code path the reader never takes. Same note as the probe.
await page.emulateMedia({ reducedMotion: 'no-preference' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(async () => {
  await globalThis.__shelfWorld.ready;
});
const skip = page.getByText('skip the tour');
if (await skip.count()) {
  await skip.first().click({ force: true });
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

const box = await page.locator('.nb-spread').first().boundingBox();
const clip = {
  x: Math.round(box.x),
  y: Math.round(box.y),
  width: Math.round(box.width),
  height: Math.round(box.height),
};
/* The two pieces of drawing this is about, close enough to judge: a band either
   side of the crease, and the bottom-right corner where the dog-ear lives. */
const gutterClip = {
  x: Math.round(box.x + box.width / 2 - 90),
  y: Math.round(box.y + box.height * 0.25),
  width: 180,
  height: Math.round(box.height * 0.5),
};
const cornerClip = {
  x: Math.round(box.x + box.width - 170),
  y: Math.round(box.y + box.height - 170),
  width: 170,
  height: 170,
};

/** Everything a frame's LOOK is made of, read at the moment of the shot. */
const readState = () =>
  page.evaluate(() => {
    const canvas = document.querySelector('canvas.nb-flip-canvas');
    const gutter = document.querySelector('.nb-spread-gutter');
    const curl = document.querySelector('.nb-page-curl');
    const rightLeaf = document.querySelector('.nb-flip-leaf-right');
    const cs = (el) => (el === null ? null : getComputedStyle(el));
    const z = (el) => cs(el)?.zIndex ?? 'none';
    return {
      up: canvas?.classList.contains('is-flipping') ?? false,
      // The rigid fold never shows the canvas, so "a turn is in flight" has to
      // be asked of the surface, not of the overlay.
      gesture: document.querySelector('.nb-flip-surface')?.classList.contains('is-flip-gesture') ?? false,
      spread: Number(
        document.querySelector('.nb-spread-stage')?.getAttribute('data-spread-index') ?? -1,
      ),
      gutterZ: z(gutter),
      canvasZ: z(canvas),
      curlOpacity: cs(curl)?.opacity ?? 'absent',
      leafVis: rightLeaf?.style.visibility === 'hidden' ? 'hidden' : 'visible',
    };
  });

/*
 * WHICH FACES THIS TURN WILL HAVE TO DRAW WITH.
 *
 * At p=1 the moving sheet is reflected about the spine, so the whole OTHER leaf
 * of the landing frame is `back` — and `back` is the one face beginFlip does not
 * require before choosing the curl. If it were ever cold, the frame the reader
 * sits on would have a blank cream half, which is a different way to arrive
 * "whitish". Asked rather than assumed.
 */
const faces = await page.evaluate(() => globalThis.__flipCache?.facesFor('next') ?? null);
console.log(
  faces === null
    ? '   (no __flipCache bridge — faces unknown)'
    : `   faces for this turn: front ${faces.hasFront}, back ${faces.hasBack}, revealed ${faces.hasRevealed}`,
);

const before = await readState();
writeFileSync(`${OUT}/${TAG}-00-rest.png`, await page.screenshot({ clip }));
console.log(`00 rest      spread ${before.spread}  gutter z ${before.gutterZ} vs canvas z ${before.canvasZ}`);

/*
 * --drag=<0..1> holds the turn instead of taking it: grab the right leaf's
 * outer edge, pull it to that fraction of the way over, and STOP. The keyboard
 * turn is over in ~400ms here, which is one screenshot, and the one it lands on
 * is p≈0 where nothing has lifted yet. A held drag is the only way to look at a
 * sheet that is genuinely half over — which is the frame where a band drawn
 * above the overlay could look wrong.
 */
/*
 * --cold empties the raster cache first, which forces the OTHER turn: with no
 * bitmap for the front or the revealed face the controller refuses the curl and
 * takes the rigid CSS 3D fold instead (PageFlipController.beginFlip), whose
 * front face is the live leaf. Nothing photographs that path otherwise, and it
 * is the path a reader's very first turn in a book takes.
 */
if (COLD) {
  const cleared = await page.evaluate(() => {
    globalThis.__flipCache?.clear();
    return globalThis.__flipCache !== undefined;
  });
  console.log(cleared ? '   (raster cache cleared — expect the rigid fold)' : '   (no __flipCache bridge)');
}
await page.evaluate(() => document.activeElement?.blur?.());
if (DRAG > 0) {
  const leaf = await page.locator('.nb-flip-leaf-right').first().boundingBox();
  const y = Math.round(leaf.y + leaf.height * 0.5);
  await page.mouse.move(Math.round(leaf.x + leaf.width - 12), y);
  await page.mouse.down();
  // dragToP: p = (W - leafLocalX) / 2W, so the pointer travels 2·W·p inward.
  await page.mouse.move(Math.round(leaf.x + leaf.width - 12 - 2 * leaf.width * DRAG), y, {
    steps: 12,
  });
} else {
  await page.keyboard.press('ArrowRight');
}
/* A screenshot over a live WebGL canvas costs ~300ms under SwiftShader, so the
   loop below only ever catches ONE frame with the overlay up — and left to
   itself that frame is p≈0, where nothing has lifted yet. --delay puts the
   camera part-way through the curl instead. */
if (DELAY > 0) await page.waitForTimeout(DELAY);

let downStreak = 0;
for (let i = 1; i <= SHOTS && downStreak < 3; i += 1) {
  const state = await readState();
  const swapped = state.spread !== before.spread;
  const turning = state.up || state.gesture;
  const name = `${TAG}-${String(i).padStart(2, '0')}-${turning ? 'up' : 'down'}${swapped ? '-swapped' : ''}`;
  try {
    writeFileSync(`${OUT}/${name}.png`, await page.screenshot({ clip }));
    if (turning) {
      writeFileSync(`${OUT}/${name}-gutter.png`, await page.screenshot({ clip: gutterClip }));
      writeFileSync(`${OUT}/${name}-corner.png`, await page.screenshot({ clip: cornerClip }));
    }
  } catch (err) {
    console.log(`${name}  (shot failed: ${String(err).split('\n')[0]})`);
    continue;
  }
  console.log(
    `${String(i).padStart(2, '0')} ` +
      `${state.up ? 'OVERLAY UP  ' : state.gesture ? 'FOLDING     ' : 'overlay down'} ` +
      `spread ${state.spread}${swapped ? ' (SWAPPED)' : ''}  ` +
      `gutter z ${state.gutterZ}  dog-ear opacity ${state.curlOpacity}  moving leaf ${state.leafVis}`,
  );
  downStreak = turning ? 0 : downStreak + 1;
}

if (DRAG > 0) await page.mouse.up();
await page.waitForTimeout(2500);
writeFileSync(`${OUT}/${TAG}-99-settled.png`, await page.screenshot({ clip }));
writeFileSync(`${OUT}/${TAG}-99-settled-gutter.png`, await page.screenshot({ clip: gutterClip }));
writeFileSync(`${OUT}/${TAG}-99-settled-corner.png`, await page.screenshot({ clip: cornerClip }));
console.log('99 settled');
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();
