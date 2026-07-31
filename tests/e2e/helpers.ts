/**
 * Shared helpers for the Playwright E2E suite.
 *
 * The shelf world is a WebGL canvas (no DOM per book), so shelf-state
 * assertions work optically: take a screenshot, decode it inside the page
 * (2D canvas + getImageData) and find the seeded book's spine as a tall narrow
 * run of one colour.
 *
 * WHICH colour is asked of the running app, not assumed. This used to hunt for
 * "warm amber" on the reasoning that the welcome book's seed pins palette 0 —
 * which was true of the palette and not of the screen: a spine's cloth is
 * resolved against the ROOM, and the day the default room moved from athenaeum
 * to verdigris the seeded book stopped being amber. Every optical shelf test
 * then locked onto the nearest amber thing in frame (the gilt cornice studs)
 * and right-clicked the cornice. So `spineRegion` reads the spine's rect from
 * the world hook, samples the colour actually painted there, and only then
 * scans. Amber stays as the fallback for the pages that boot without `?fx=`.
 *
 * SwiftShader (headless WebGL) can throttle rAF to ~10fps, so every helper
 * polls for state instead of fixed-waiting.
 */
import { expect, type Page } from 'playwright/test';

export const WELCOME_TITLE = 'Welcome to Notebook ✎';

/** Bounding box + centroid of the amber spine, in CSS pixels. */
export interface SpineRegion {
  cx: number;
  cy: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  count: number;
}

/**
 * Suppress the first-run tour for this page — call BEFORE the first goto.
 *
 * The tour is not just a scrim (that is `pointer-events: none` now); the CARD
 * is a real 350x600 element parked over the right of the viewport, and it
 * lands squarely on the shelf spot menu, the studio sheet and the dev
 * switcher. It also owns a window keydown listener, so a spec driving the
 * keyboard is driving two things at once.
 *
 * The completion flag has to be written by an init script: setting it after a
 * navigation races the overlay's mount, and stopping the overlay afterwards
 * leaves behind whatever it has already taken (focus, a step's key handler).
 * Every spec's own goto helper calls this first.
 */
export async function suppressTour(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('appState:tutorialCompleted', 'true');
    } catch {
      // Private-mode storage failures are not this helper's problem; callers
      // that care also stop() the overlay once the app is up.
    }
  });
}

/**
 * Load the shelf and wait until the world has booted and lists books.
 *
 * `?fx=force` is not decoration: it is what exposes `__shelfWorld`, and
 * `spineRegion` needs it to ask which colour the seeded spine is actually
 * wearing. Every other shelf spec already boots this way.
 */
export async function gotoShelf(page: Page): Promise<void> {
  await suppressTour(page);
  await page.goto('/?fx=force');
  await expect(page.locator('canvas.shelf-canvas')).toBeVisible({
    timeout: 45_000,
  });
  // The a11y mirror lists one focusable row per visible book.
  await expect(page.locator('.shelf-a11y button').first()).toBeAttached({
    timeout: 45_000,
  });
}

/**
 * Optically locate the seeded book's spine in the current frame.
 * Returns null when no such region is on screen. Coordinates are CSS px.
 */
export async function spineRegion(page: Page): Promise<SpineRegion | null> {
  // Where the world says the first visible spine is, when the hook is up. Used
  // only to SAMPLE the colour — the bounding box below is still measured off
  // real pixels, so "the world painted it" and "it shrank when I zoomed out"
  // stay claims about the screen.
  const hint = await page.evaluate(() => {
    const g = globalThis as Record<string, unknown>;
    const world = g['__shelfWorld'] as
      | { spineRectOf(id: string): { x: number; y: number; width: number; height: number } | null }
      | undefined;
    const list = g['__shelfVisibleBooks'] as (() => Array<{ id: string }>) | undefined;
    if (world === undefined || list === undefined) return null;
    const books = list();
    if (books.length === 0) return null;
    const r = world.spineRectOf(books[0]!.id);
    return r === null ? null : r;
  });

  const shot = await page.screenshot({ type: 'png' });
  const region = await page.evaluate(
    async ([b64, box]: [string, { x: number; y: number; width: number; height: number } | null]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);
      const { data, width, height } = ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const scale = width / window.innerWidth;

      // Fallback predicate: warm amber, which is what the seeded spine wore in
      // every room this suite knew about before the vocabulary grew.
      // Excludes shelf wood (~rgb(138,106,72)) and cream paper (blue-rich).
      let match = (i: number): boolean => {
        const r = data[i] as number;
        const g = data[i + 1] as number;
        const b = data[i + 2] as number;
        return r > 170 && b < 120 && r - b > 85 && g - b > 40;
      };

      if (box !== null && box.width > 2 && box.height > 8) {
        // Median of a column down the middle of the spine, so a gilt band or a
        // label plate does not become "the spine colour".
        const cx = Math.round((box.x + box.width / 2) * scale);
        const samples: Array<[number, number, number]> = [];
        for (let t = 0.2; t <= 0.8; t += 0.02) {
          const y = Math.round((box.y + box.height * t) * scale);
          if (y < 0 || y >= height || cx < 0 || cx >= width) continue;
          const i = (y * width + cx) * 4;
          samples.push([data[i] as number, data[i + 1] as number, data[i + 2] as number]);
        }
        if (samples.length >= 8) {
          const mid = (k: 0 | 1 | 2): number => {
            const v = samples.map((s) => s[k]).sort((a, b) => a - b);
            return v[Math.floor(v.length / 2)] as number;
          };
          const [tr, tg, tb] = [mid(0), mid(1), mid(2)];
          match = (i: number): boolean =>
            Math.abs((data[i] as number) - tr) < 26 &&
            Math.abs((data[i + 1] as number) - tg) < 26 &&
            Math.abs((data[i + 2] as number) - tb) < 26;
        }
      }

      // The case's own timber can share the spine's colour family, and it is
      // spread thinly across the whole frame. The BOOK is a tall narrow column
      // of it, so lock onto the densest column first and keep only pixels near
      // it; otherwise the centroid drifts onto bare shelf and every "click the
      // book" test misses.
      const cols = new Int32Array(Math.ceil(width / 2));
      for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x += 2) {
          if (match((y * width + x) * 4)) cols[x >> 1] += 1;
        }
      }
      let peak = 0;
      for (let c = 1; c < cols.length; c += 1) {
        if ((cols[c] as number) > (cols[peak] as number)) peak = c;
      }
      const peakX = peak * 2;
      // Half a slot each side: wide enough for one spine, narrow enough to
      // exclude the crown and the floor plates.
      const band = Math.max(24, Math.round(width * 0.035));

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -1;
      let maxY = -1;
      let count = 0;
      let sx = 0;
      let sy = 0;
      for (let y = 0; y < height; y += 2) {
        for (
          let x = Math.max(0, peakX - band);
          x < Math.min(width, peakX + band);
          x += 2
        ) {
          if (!match((y * width + x) * 4)) continue;
          count += 1;
          sx += x;
          sy += y;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      if (count < 30) return null;
      return {
        cx: sx / count,
        cy: sy / count,
        minX,
        minY,
        maxX,
        maxY,
        count,
        imgWidth: width,
      };
    },
    [shot.toString('base64'), hint] as [
      string,
      { x: number; y: number; width: number; height: number } | null,
    ],
  );
  if (region === null) return null;
  // Screenshots are device pixels (dpr 1.5); map back to CSS px.
  const viewport = page.viewportSize();
  const scale = viewport ? region.imgWidth / viewport.width : 1;
  return {
    cx: region.cx / scale,
    cy: region.cy / scale,
    minX: region.minX / scale,
    minY: region.minY / scale,
    maxX: region.maxX / scale,
    maxY: region.maxY / scale,
    width: (region.maxX - region.minX) / scale,
    height: (region.maxY - region.minY) / scale,
    count: region.count,
  };
}

/** Poll until the amber spine is on screen (rendering can lag on SwiftShader). */
export async function waitForSpine(page: Page): Promise<SpineRegion> {
  let region: SpineRegion | null = null;
  await expect
    .poll(
      async () => {
        region = await spineRegion(page);
        return region !== null;
      },
      { timeout: 30_000, message: 'amber welcome-book spine never rendered' },
    )
    .toBe(true);
  return region as unknown as SpineRegion;
}

/**
 * Fraction of sampled pixels that differ between two PNG screenshots
 * (decoded inside the page; channel delta > 24 counts as different).
 * Used to detect world motion on the shelf canvas after pointer release.
 */
export async function screenDiffRatio(
  page: Page,
  a: Buffer,
  b: Buffer,
): Promise<number> {
  return page.evaluate(
    async ([b64a, b64b]: [string, string]) => {
      const decode = async (b64: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
      };
      const [ia, ib] = await Promise.all([decode(b64a), decode(b64b)]);
      if (!ia || !ib || ia.data.length !== ib.data.length) return 1;
      let diff = 0;
      let total = 0;
      for (let i = 0; i < ia.data.length; i += 16) {
        total += 1;
        if (
          Math.abs(ia.data[i] - ib.data[i]) > 24 ||
          Math.abs(ia.data[i + 1] - ib.data[i + 1]) > 24 ||
          Math.abs(ia.data[i + 2] - ib.data[i + 2]) > 24
        ) {
          diff += 1;
        }
      }
      return total === 0 ? 0 : diff / total;
    },
    [a.toString('base64'), b.toString('base64')] as [string, string],
  );
}

/**
 * Open the focused book view via the dev view switcher (deterministic).
 *
 * The first-run tutorial auto-starts and its `.nbt-scrim` path covers the
 * viewport, so the view-switcher click was being intercepted and the whole
 * e2e suite timed out here before a single test body ran. The completion flag
 * lives in localStorage under `TUTORIAL_KEY`, and it has to be set BEFORE the
 * first navigation — dismissing the overlay afterwards races its mount.
 *
 * (A report that `.nb-book-view` was also dead turned out to be wrong: it is
 * still applied by BookView. Left as-is deliberately.)
 */
export async function openBookView(page: Page): Promise<void> {
  await suppressTour(page);
  await page.goto('/');
  await page.evaluate(() => window.__nbTutorial?.stop?.());
  // Poll rather than race: stop() is one shot, and a tour that mounts a beat
  // later (storage refused, or a reload between the two) would still be there
  // when the click lands.
  await expect
    .poll(() => page.locator('.nbt-card').count(), {
      timeout: 15_000,
      message: 'the first-run tour never went away',
    })
    .toBe(0);
  await page.getByRole('button', { name: 'book', exact: true }).click();
  await expect(page.locator('.nb-book-view')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.nb-prose').first()).toBeVisible({
    timeout: 30_000,
  });
  // The seeded welcome book's first page is on the left leaf.
  await expect(
    page.locator('.nb-leaf-paper[data-side="left"] .nb-prose h1').first(),
  ).toContainText('Welcome to Notebook', { timeout: 30_000 });
}

/**
 * Append a blank page with the "+ page" tool and return a locator for its
 * (empty) editor. The book seeds 5 pages, so the new page lands on the right
 * leaf of the last spread.
 */
export async function openBlankPage(page: Page) {
  await openBookView(page);
  await page.getByRole('button', { name: 'Add a page' }).click();
  const prose = page.locator('.nb-leaf-paper[data-side="right"] .nb-prose');
  await expect(prose).toBeVisible({ timeout: 30_000 });
  // Jumping spreads remounts the right leaf with the fresh page: wait until
  // it is actually the blank one (the seeded page 4 holds diagrams).
  await expect
    .poll(async () => (await prose.innerText()).trim().length, {
      timeout: 30_000,
    })
    .toBeLessThan(2);
  return prose;
}
