/**
 * Media barrier for the raster-to-DOM handoff at the end of a page turn.
 *
 * The curl's flat end frame already contains the destination page's images.
 * Keep that frame on the glass until the newly mounted live images can paint;
 * otherwise captions can arrive one frame before their pictures.
 */

const DEFAULT_CAP_MS = 1200;

function sourceOf(image: HTMLImageElement): string {
  return image.currentSrc.length > 0 ? image.currentSrc : image.src;
}

function hasSource(image: HTMLImageElement): boolean {
  return sourceOf(image).length > 0;
}

/**
 * Solid commits the destination synchronously, but custom node-view effects
 * are allowed to resolve presentation state in a microtask. In particular a
 * portable image first mounts its inline missing-image drawing, then replaces
 * that source with the real blob/asset URL. Inventorying in the navigation
 * task sees only the cheap placeholder and releases the curl one frame early.
 */
function afterPaintOpportunity(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function waitForLoadOrError(image: HTMLImageElement): Promise<void> {
  if (image.complete) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      image.removeEventListener('load', done);
      image.removeEventListener('error', done);
      resolve();
    };
    image.addEventListener('load', done, { once: true });
    image.addEventListener('error', done, { once: true });
  });
}

async function settleImage(image: HTMLImageElement): Promise<void> {
  // A node view may replace `src` while the previous source is decoding. Do
  // not mistake a decoded placeholder for the destination image: repeat until
  // the source that settled is still the source mounted on the page.
  for (let pass = 0; pass < 4 && hasSource(image); pass += 1) {
    const source = sourceOf(image);
    if (typeof image.decode === 'function') {
      try {
        // `complete` only means the bytes arrived. decode() is the browser's
        // promise that inserting/painting this image will not produce an empty
        // frame first.
        await image.decode();
      } catch {
        // A source can change while decode() is in flight. If the replacement
        // is still loading, its load/error event is the useful boundary.
        await waitForLoadOrError(image);
      }
    } else {
      await waitForLoadOrError(image);
    }
    // Let a resolved portable URL publish before accepting the source we just
    // decoded. This is deliberately a microtask, not another full frame.
    await Promise.resolve();
    if (sourceOf(image) === source) return;
  }
}

/**
 * Resolve when every image currently mounted under `root` is paint-ready.
 * The cap is a deadlock guard for a broken custom protocol or user asset; a
 * failed image settles through its `error` event and normally never reaches it.
 */
export async function waitForLandingMedia(
  root: ParentNode,
  capMs = DEFAULT_CAP_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, Math.max(0, capMs));
  });
  await Promise.race([
    (async () => {
      // First let destination node views mount their real presentation source.
      await afterPaintOpportunity();
      const images = Array.from(root.querySelectorAll<HTMLImageElement>('img'))
        .filter(hasSource);
      await Promise.allSettled(images.map((image) => settleImage(image)));
    })(),
    cap,
  ]);
  if (timer !== undefined) clearTimeout(timer);
}
