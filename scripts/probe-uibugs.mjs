/**
 * scripts/probe-uibugs.mjs — visual QA driver for the four shelf/book UI bugs.
 *
 * Stages (env PROBE_STAGES, default all):
 *   shelf  — screenshot the shelf top region; toggle dark-band suspects
 *            (wall shade sprites, backdrop, body background, crown) one at a
 *            time so the band's source is identifiable; dock-overlap shot.
 *   flip   — open the Welcome book, instrument CurlRenderer.setPageTextures
 *            (records whether front/back/revealed bitmaps are real), then
 *            drive a pointer-drag page turn, holding at p≈0.5 / 0.85 / 0.97
 *            for screenshots; checks the WebGL path actually ran.
 *   studio — open the Book Studio (rail brush), screenshot the randomise
 *            controls, press "randomise", screenshot the rerolled preview,
 *            then read cover_meta.style back from the DB to prove (or
 *            disprove) persistence.
 *
 * Output: qa/ui/<prefix>-*.png where prefix = PROBE_PREFIX (default "before").
 *
 * Usage: node scripts/probe-uibugs.mjs
 *        PROBE_PREFIX=after PROBE_STAGES=flip node scripts/probe-uibugs.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PREFIX = process.env.PROBE_PREFIX ?? 'before';
const STAGES = (process.env.PROBE_STAGES ?? 'shelf,flip,studio').split(',');
const OUT_DIR = fileURLToPath(new URL('../qa/ui/', import.meta.url));
mkdirSync(OUT_DIR, { recursive: true });
const out = (name) => `${OUT_DIR}${PREFIX}-${name}.png`;

const URL_BASE = process.env.PROBE_URL ?? 'http://localhost:1420';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(240000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console-err]', m.text().slice(0, 200));
  if (m.text().includes('[rasterCache]')) console.log('[page]', m.text().slice(0, 300));
});

// Suppress the first-run guided tour: a fresh browser profile has no
// completion flag in the stub DB, so the tour overlay auto-starts and eats
// the pointer stream (its own coachmarks drive the app mid-probe). The
// appended assignment rebinds the module's live export before App reads it.
await page.route('**/src/features/tutorial/state.ts*', async (route) => {
  const res = await route.fetch();
  const body = await res.text();
  await route.fulfill({ response: res, body: `${body}\n;readCompleted = async () => true;\n` });
});

// Instrument the REAL flip module instances (query-string-proof): texture
// uploads and controller phases, so we know which faces got real bitmaps
// and which code path a drag took.
await page.route('**/src/flip/curl.ts*', async (route) => {
  const res = await route.fetch();
  const body = await res.text();
  const snippet = `
;(function () {
  const orig = CurlRenderer.prototype.setPageTextures;
  CurlRenderer.prototype.setPageTextures = function (f, b, r) {
    (globalThis.__texLog ??= []).push({ front: f ? f.width : 0, back: b ? b.width : 0, revealed: r ? r.width : 0 });
    return orig.call(this, f, b, r);
  };
})();`;
  await route.fulfill({ response: res, body: body + snippet });
});
await page.route('**/src/flip/PageFlipController.ts*', async (route) => {
  const res = await route.fetch();
  const body = await res.text();
  const snippet = `
;(function () {
  const P = PageFlipController.prototype;
  globalThis.__flipTrace = [];
  const T = (n, d) => { globalThis.__flipTrace.push(Math.round(performance.now()) + ' ' + n + ' ' + d); };
  for (const n of ['beginFlip', 'settle', 'land', 'crossfadeNavigate']) {
    const o = P[n];
    P[n] = function (...a) {
      T(n, JSON.stringify({ p: this.flip?.p, ph: this.phase, gl: this.usesWebGL }));
      return o.apply(this, a);
    };
  }
})();`;
  await route.fulfill({ response: res, body: body + snippet });
});
// Log every raster capture (pageId, ok, width) so a missing front/back face
// can be traced to a failed or never-scheduled capture.
await page.route('**/src/flip/rasterCache.ts*', async (route) => {
  const res = await route.fetch();
  const body = await res.text();
  const snippet = `
;(function () {
  const orig = PageRasterCache.prototype.capture;
  PageRasterCache.prototype.capture = async function (pageId) {
    const entry = await orig.call(this, pageId);
    (globalThis.__capLog ??= []).push({ id: pageId, ok: entry !== null, w: entry ? entry.width : 0 });
    return entry;
  };
})();`;
  await route.fulfill({ response: res, body: body + snippet });
});

const shot = async (name, clip) => {
  try {
    await page.screenshot({ path: out(name), ...(clip ? { clip } : {}), timeout: 90000 });
    console.log(`[shot] ${PREFIX}-${name}.png`);
  } catch (e) {
    console.log(`[warn] screenshot ${name} failed: ${String(e).slice(0, 140)}`);
  }
};

console.log(`== probe-uibugs: stages=${STAGES.join(',')} prefix=${PREFIX} ==`);
const t0 = Date.now();
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 180000 });

// Wait for the world object, then for its data-ready promise, then for the
// event loop to become responsive again (the startup bake blocks the main
// thread; screenshots taken during it time out).
try {
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
    timeout: 300000,
    polling: 500,
  });
  console.log(`[boot] world object after ${Date.now() - t0}ms`);
  await page.evaluate(() => {
    globalThis.__worldReady = false;
    void globalThis.__shelfWorld.ready.then(() => {
      globalThis.__worldReady = true;
    });
  });
  await page.waitForFunction(() => globalThis.__worldReady === true, null, {
    timeout: 300000,
    polling: 500,
  });
  console.log(`[boot] world.ready after ${Date.now() - t0}ms`);
} catch {
  console.log('[warn] world never became ready — continuing anyway');
}

// Event-loop responsiveness probe: 0ms-timeout latency under 60ms twice.
for (let i = 0; i < 120; i += 1) {
  const latency = await page.evaluate(
    () => new Promise((resolve) => {
      const s = performance.now();
      setTimeout(() => resolve(Math.round(performance.now() - s)), 0);
    }),
  );
  if (latency < 60) {
    const again = await page.evaluate(
      () => new Promise((resolve) => {
        const s = performance.now();
        setTimeout(() => resolve(Math.round(performance.now() - s)), 0);
      }),
    );
    if (again < 60) {
      console.log(`[boot] event loop responsive (${latency}/${again}ms) after ${Date.now() - t0}ms`);
      break;
    }
  }
  await page.waitForTimeout(2000);
}
// Let the first painted frames land.
await page.waitForTimeout(2500);

/* --------------------------------- stage: shelf ------------------------- */
if (STAGES.includes('shelf')) {
  try {
    const TOP = { x: 0, y: 0, width: 1440, height: 300 };
    await shot('shelf-full');
    await shot('shelf-top', TOP);

    // Identify the dark band by subtraction: hide each suspect, reshoot.
    const suspects = await page.evaluate(() => {
      const w = globalThis.__shelfWorld;
      const info = { children: [], ok: w !== undefined };
      if (!w) return info;
      const world = w['world'];
      info.children = world.children.slice(0, 6).map((c) => ({
        type: c.constructor.name,
        x: Math.round(c.x),
        y: Math.round(c.y),
        w: Math.round(c.width),
        h: Math.round(c.height),
        rot: Number(c.rotation?.toFixed?.(3) ?? 0),
        alpha: c.alpha,
      }));
      // Suspect 1: the wall-AO shade sprites (first children of world).
      globalThis.__shadeSprites = world.children.slice(0, 3);
      // Suspect 2: the crown sprite (4th child).
      globalThis.__crownSprite = world.children[3] ?? null;
      // Suspect 3: the backdrop tiling sprite.
      globalThis.__backdropSprite = w['backdrop'];
      return info;
    });
    console.log('[shelf] world children:', JSON.stringify(suspects.children));

    await page.evaluate(() => globalThis.__shadeSprites.forEach((s) => (s.visible = false)));
    await page.waitForTimeout(700);
    await shot('band-no-shades', TOP);
    await page.evaluate(() => globalThis.__shadeSprites.forEach((s) => (s.visible = true)));

    if (suspects.children.length > 3) {
      await page.evaluate(() => { if (globalThis.__crownSprite) globalThis.__crownSprite.visible = false; });
      await page.waitForTimeout(700);
      await shot('band-no-crown', TOP);
      await page.evaluate(() => { if (globalThis.__crownSprite) globalThis.__crownSprite.visible = true; });
    }

    await page.evaluate(() => { globalThis.__backdropSprite.visible = false; });
    await page.waitForTimeout(700);
    await shot('band-no-backdrop', TOP);
    await page.evaluate(() => { globalThis.__backdropSprite.visible = true; });

    await page.addStyleTag({ content: 'body { background-image: none !important; }' });
    await page.waitForTimeout(400);
    await shot('band-no-bodybg', TOP);
    await page.addStyleTag({ content: 'body { background-image: unset !important; }' }).catch(() => {});
    await page.evaluate(() => {
      // Restore the real stylesheet-driven body background.
      document.querySelectorAll('style').forEach((s) => {
        if (s.textContent?.includes('background-image: unset')) s.remove();
      });
    });

    // Dock geometry vs the case top (overlap measurement for bug 1).
    await page.waitForSelector('.shelf-dock', { timeout: 30000 }).catch(() => {});
    const dock = await page.evaluate(() => {
      const el = document.querySelector('.shelf-dock');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
    console.log('[shelf] dock rect:', JSON.stringify(dock));
  } catch (e) {
    console.log('[shelf] stage failed:', String(e).slice(0, 300));
  }
}

/* --------------------------------- stage: flip -------------------------- */
if (STAGES.includes('flip') || STAGES.includes('studio')) {
  try {
    // Open the seeded Welcome book via the accessibility mirror (the same
    // command as a canvas tap, without depending on canvas hit-testing).
    // dispatchEvent skips actionability checks (the mirror is sr-only) and
    // one retry rides out a hot-reload remount from parallel file edits.
    let opened = false;
    for (let attempt = 0; attempt < 2 && !opened; attempt += 1) {
      await page.waitForSelector('.shelf-a11y button', { state: 'attached', timeout: 30000 });
      await page.locator('.shelf-a11y button').first().dispatchEvent('click');
      opened = await page
        .waitForSelector('.nb-flip-surface', { timeout: 45000 })
        .then(() => true)
        .catch(() => false);
      if (!opened) console.log(`[book] open attempt ${attempt + 1} missed — retrying`);
    }
    if (!opened) throw new Error('book did not open after 2 attempts');
    await page.waitForSelector('.nb-prose', { timeout: 60000 });
    console.log(`[book] opened after ${Date.now() - t0}ms`);
    // Idle-time snapshot warmup (debounced re-raster + eager neighbours,
    // including offscreen staging of the adjacent spread).
    await page.waitForTimeout(6000);
  } catch (e) {
    console.log('[book] open failed:', String(e).slice(0, 300));
  }
}

if (STAGES.includes('flip')) {
  try {
    // Raw pointer stream on the flip root (capture phase) — proves the
    // gesture actually reaches the engine.
    await page.evaluate(() => {
      globalThis.__ptrLog = [];
      const root = document.querySelector('.nb-flip-surface');
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
        root.addEventListener(
          type,
          (e) => {
            if (type === 'pointermove' && globalThis.__ptrLog.length > 50) return;
            globalThis.__ptrLog.push(
              `${type} x=${Math.round(e.clientX)} id=${e.pointerId} btn=${e.buttons}`,
            );
          },
          { capture: true },
        );
      }
    });

    const leaf = await page.locator('.nb-flip-leaf-right').boundingBox();
    console.log('[flip] right leaf rect:', JSON.stringify(leaf));
    if (leaf) {
      const midY = leaf.y + leaf.height * 0.55;
      const startX = leaf.x + leaf.width - 12;
      await page.mouse.move(startX, midY);
      await page.mouse.down();
      const holds = [0.5, 0.85, 0.97];
      for (const p of holds) {
        const x = leaf.x + leaf.width * (1 - 2 * p);
        await page.mouse.move(x, midY, { steps: 10 });
        await page.waitForTimeout(600); // let throttled rAF renders land
        const state = await page.evaluate(() => ({
          flipping:
            document.querySelector('.nb-flip-canvas')?.classList.contains('is-flipping') ??
            false,
          rightHidden: document.querySelector('.nb-flip-leaf-right')?.style.visibility ?? '',
        }));
        console.log(`[flip] held p=${p}`, JSON.stringify(state));
        await shot(`flip-p${Math.round(p * 100)}`);
      }
      await page.mouse.up();
      await page.waitForTimeout(2500); // settle tween + landing swap
      await shot('flip-landed');
      const tex = await page.evaluate(() => globalThis.__texLog ?? []);
      console.log('[flip] setPageTextures calls:', JSON.stringify(tex));
      const caps = await page.evaluate(() => globalThis.__capLog ?? []);
      console.log('[flip] captures:', JSON.stringify(caps));
      const trace = await page.evaluate(() => globalThis.__flipTrace ?? []);
      console.log('[flip] controller trace:', JSON.stringify(trace));
      const ptr = await page.evaluate(() => globalThis.__ptrLog ?? []);
      console.log(`[flip] pointer events seen: ${ptr.length}`, JSON.stringify(ptr.slice(0, 8)));
      const spreadAfter = await page.evaluate(
        () => document.querySelectorAll('.nb-prose').length,
      );
      console.log(`[flip] editors mounted after landing: ${spreadAfter}`);
    } else {
      console.log('[flip] no right leaf — skipped drag');
    }
  } catch (e) {
    console.log('[flip] stage failed:', String(e).slice(0, 300));
  }
}

/* -------------------------------- stage: studio ------------------------- */
if (STAGES.includes('studio')) {
  try {
    // dispatchEvent skips actionability — the rail button stays clickable
    // even while idle offscreen captures saturate the main thread.
    await page.waitForSelector('button[data-tool="customize"]', { state: 'attached', timeout: 30000 });
    await page.locator('button[data-tool="customize"]').first().dispatchEvent('click');
    await page.waitForSelector('.nb-book-studio', { state: 'attached', timeout: 30000 });
    await page.waitForTimeout(1200); // preview canvases paint
    await shot('studio-initial');

    const hasRandomise = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.nb-book-studio button')];
      return btns.some((b) => b.textContent?.trim() === 'randomise');
    });
    console.log(`[studio] randomise button present: ${hasRandomise}`);

    // Per-field re-roll buttons (added by the fix; absent before).
    const rerollCount = await page.locator('.nb-book-studio .nb-reroll').count();
    console.log(`[studio] per-field reroll buttons: ${rerollCount}`);
    if (rerollCount > 0) {
      const styleBefore = await page.evaluate(async () => {
        const app = await import('/src/state/app.ts');
        const books = await import('/src/data/books.ts');
        const book = await books.getBook(app.appState.openBookId());
        return JSON.stringify(book?.coverMeta?.style ?? null);
      });
      await page.locator('.nb-book-studio .nb-reroll').first().dispatchEvent('click');
      await page.waitForTimeout(1500);
      const styleAfter = await page.evaluate(async () => {
        const app = await import('/src/state/app.ts');
        const books = await import('/src/data/books.ts');
        const book = await books.getBook(app.appState.openBookId());
        return JSON.stringify(book?.coverMeta?.style ?? null);
      });
      console.log(`[studio] reroll changed persisted style: ${styleBefore !== styleAfter}`);
      await shot('studio-rerolled');
    }

    if (hasRandomise) {
      const before = await page.evaluate(() => {
        const c = document.querySelector('.nb-studio-face-spine');
        return c ? c.toDataURL().length : 0;
      });
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll('.nb-book-studio button')];
        btns.find((b) => b.textContent?.trim() === 'randomise')?.click();
      });
      await page.waitForTimeout(1200);
      const after = await page.evaluate(() => {
        const c = document.querySelector('.nb-studio-face-spine');
        return c ? c.toDataURL().length : 0;
      });
      console.log(`[studio] preview dataURL len before=${before} after=${after}`);
      await shot('studio-randomised');
    }

    // Persistence: does cover_meta.style actually hold the rerolled style?
    const persisted = await page.evaluate(async () => {
      const app = await import('/src/state/app.ts');
      const books = await import('/src/data/books.ts');
      const id = app.appState.openBookId();
      if (!id) return { ok: false, reason: 'no openBookId' };
      const book = await books.getBook(id);
      const style = book?.coverMeta?.style ?? null;
      const cover = book?.coverMeta?.cover ?? null;
      return {
        ok: true,
        hasStyle: style !== null,
        styleKeys: style ? Object.keys(style).length : 0,
        hasCover: cover !== null,
      };
    });
    console.log('[studio] persistence:', JSON.stringify(persisted));
  } catch (e) {
    console.log('[studio] stage failed:', String(e).slice(0, 300));
  }
}

console.log(`== done in ${Date.now() - t0}ms ==`);
await browser.close();
