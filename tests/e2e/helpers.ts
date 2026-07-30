/**
 * Shared helpers for the Playwright E2E suite.
 *
 * The shelf world is a WebGL canvas (no DOM per book), so shelf-state
 * assertions work optically: take a screenshot, decode it inside the page
 * (2D canvas + getImageData) and locate the seeded welcome book by its warm
 * amber spine color — robust to camera position and art-pipeline changes as
 * long as the amber palette stays the amber palette.
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

/** Load the shelf and wait until the world has booted and lists books. */
export async function gotoShelf(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('canvas.shelf-canvas')).toBeVisible({
    timeout: 45_000,
  });
  // The a11y mirror lists one focusable row per visible book.
  await expect(page.locator('.shelf-a11y button').first()).toBeAttached({
    timeout: 45_000,
  });
}

/**
 * Optically locate the welcome book's warm amber spine in the current frame.
 * Returns null when no amber region is on screen. Coordinates are CSS px.
 */
export async function spineRegion(page: Page): Promise<SpineRegion | null> {
  const shot = await page.screenshot({ type: 'png' });
  const region = await page.evaluate(async (b64: string) => {
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
    // Amber spine top duo ≈ rgb(208,153,57): saturated warm orange.
    // Excludes shelf wood (~rgb(138,106,72)) and cream paper (blue-rich).
    const isAmber = (i: number): boolean => {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      return r > 170 && b < 120 && r - b > 85 && g - b > 40;
    };

    // A library theme's own brass — gilt cornice beading, floor plates, the
    // drawer pull — is amber too, and it is spread thinly across the whole
    // frame. The BOOK is a tall narrow amber column, so lock onto the densest
    // column first and keep only pixels near it; otherwise the centroid drifts
    // off the spine onto bare shelf and every "click the book" test misses.
    const cols = new Int32Array(Math.ceil(width / 2));
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        if (isAmber((y * width + x) * 4)) cols[x >> 1] += 1;
      }
    }
    let peak = 0;
    for (let c = 1; c < cols.length; c += 1) if (cols[c] > cols[peak]) peak = c;
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
      for (let x = Math.max(0, peakX - band); x < Math.min(width, peakX + band); x += 2) {
        if (!isAmber((y * width + x) * 4)) continue;
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
    return { cx: sx / count, cy: sy / count, minX, minY, maxX, maxY, count, imgWidth: width };
  }, shot.toString('base64'));
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

/** Open the focused book view via the dev view switcher (deterministic). */
export async function openBookView(page: Page): Promise<void> {
  await page.goto('/');
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
