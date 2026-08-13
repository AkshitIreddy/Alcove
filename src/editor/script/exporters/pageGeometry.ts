/**
 * Transform-free page geometry shared by export, flip and AI preview staging.
 *
 * A page may be drawn through several ancestor transforms (rail-panel fit,
 * focus zoom, or a documentation camera). `getBoundingClientRect()` therefore
 * describes the glass, not the fixed leaf that pagination lays out. Computed
 * width/height retain the leaf's authored border box and are the dimensions an
 * offscreen PageEditor must reproduce.
 *
 * Keep this module deliberately DOM-light. The AI sandbox imports it while
 * building its cache identity; pulling in capture.ts there would eagerly load
 * html-to-image, TipTap and the editor before a preview is requested.
 */

export interface OffscreenPageSize {
  /** CSS px, typically measured from a mounted `.nb-sheet-paper`. */
  width: number;
  height: number;
}

/**
 * The sheet's untransformed border-box size, retaining fractional CSS pixels.
 *
 * `clientWidth`/`clientHeight` round to integers; staging a 577.656px live leaf
 * at 578px is enough to move a threshold word to another line. The global reset
 * pins `box-sizing:border-box`, so computed width/height are both transform-free
 * and the exact box we need. A detached or auto-sized element falls back to the
 * integer client box.
 */
export function measureUntransformedSheet(element: HTMLElement): OffscreenPageSize {
  try {
    const style = getComputedStyle(element);
    const width = Number.parseFloat(style.width);
    const height = Number.parseFloat(style.height);
    if (Number.isFinite(width) && width > 1 && Number.isFinite(height) && height > 1) {
      return { width, height };
    }
  } catch {
    // Detached test doubles and a tearing-down WebView can have no style.
  }
  return { width: element.clientWidth, height: element.clientHeight };
}

/**
 * Sheet size of the mounted book leaf, or a book-ish default. Scans every
 * mounted sheet (the collapsed left leaf of a single-page spread measures
 * 0x0) and takes the largest laid-out one.
 */
export function measureMountedSheet(): OffscreenPageSize {
  let best: OffscreenPageSize = { width: 620, height: 875 };
  let bestArea = 0;
  for (const paper of document.querySelectorAll<HTMLElement>(
    '.nb-sheet-paper:not(.nb-export-sheet)',
  )) {
    const { width, height } = measureUntransformedSheet(paper);
    if (width < 120 || height < 160) continue;
    if (width * height > bestArea) {
      bestArea = width * height;
      best = { width, height };
    }
  }
  return best;
}

/** Chromium lays CSS boxes on 1/64px units; three decimals remove string noise. */
function stableCssPx(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

/**
 * Cache-safe layout identity for the exact fixed leaf a preview will mount.
 * No drawn rectangle or transform is admitted here: opening a rail panel may
 * scale the book, but it must not invalidate or repaginate the reviewed pages.
 */
export function mountedSheetLayoutFingerprint(): {
  readonly widthCssPx: number;
  readonly heightCssPx: number;
} {
  const size = measureMountedSheet();
  return {
    widthCssPx: stableCssPx(size.width),
    heightCssPx: stableCssPx(size.height),
  };
}
