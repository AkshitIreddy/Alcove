/**
 * Media barrier for the raster-to-DOM handoff at the end of a page turn.
 *
 * The curl's flat end frame already contains the destination page's images.
 * Keep that frame on the glass until the newly mounted live images can paint;
 * otherwise captions can arrive one frame before their pictures.
 */

const DEFAULT_CAP_MS = 1200;

function hasSource(image: HTMLImageElement): boolean {
  return image.currentSrc.length > 0 || image.src.length > 0;
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
  if (!hasSource(image)) return;
  if (typeof image.decode === 'function') {
    try {
      // `complete` only means the bytes arrived. decode() is the browser's
      // promise that inserting/painting this image will not produce an empty
      // frame first.
      await image.decode();
      return;
    } catch {
      // A source can change while decode() is in flight. If the replacement
      // is still loading, its load/error event is the useful boundary.
    }
  }
  await waitForLoadOrError(image);
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
  const images = Array.from(root.querySelectorAll<HTMLImageElement>('img')).filter(hasSource);
  if (images.length === 0) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, Math.max(0, capMs));
  });
  await Promise.race([
    Promise.allSettled(images.map((image) => settleImage(image))).then(() => undefined),
    cap,
  ]);
  if (timer !== undefined) clearTimeout(timer);
}
