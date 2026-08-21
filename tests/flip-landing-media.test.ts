import { describe, expect, it, vi } from 'vitest';
import { waitForLandingMedia } from '../src/flip/landingMedia';

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('page-flip landing media barrier', () => {
  it('does not release the raster endpoint for a placeholder decoded before its real source arrives', async () => {
    const realDecode = deferred();
    let source = 'data:image/svg+xml,temporary-placeholder';
    const image = {
      get currentSrc() { return source; },
      get src() { return source; },
      get complete() { return source.includes('placeholder'); },
      decode: vi.fn(() =>
        source.includes('placeholder') ? Promise.resolve() : realDecode.promise),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLImageElement;
    const root = {
      querySelectorAll: () => [image],
    } as unknown as ParentNode;

    let released = false;
    const barrier = waitForLandingMedia(root, 500).then(() => { released = true; });
    // Portable image node views resolve their saved asset path asynchronously.
    // The first render deliberately carries an inline missing-image source.
    await Promise.resolve();
    source = 'blob:real-page-image';
    // The landing barrier owns at least one paint opportunity before it
    // inventories node-view images. Let that boundary run in Node too.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(released).toBe(false);
    expect(image.decode).toHaveBeenCalled();

    realDecode.resolve();
    await barrier;
    expect(released).toBe(true);
  });

  it('restarts decode when a node view replaces src during an in-flight decode', async () => {
    const firstDecode = deferred();
    const secondDecode = deferred();
    let source = 'blob:first';
    const image = {
      get currentSrc() { return source; },
      get src() { return source; },
      complete: false,
      decode: vi.fn(() => source === 'blob:first' ? firstDecode.promise : secondDecode.promise),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLImageElement;
    const root = { querySelectorAll: () => [image] } as unknown as ParentNode;

    let released = false;
    const barrier = waitForLandingMedia(root, 500).then(() => { released = true; });
    await vi.waitFor(() => expect(image.decode).toHaveBeenCalledTimes(1));
    source = 'blob:second';
    firstDecode.resolve();
    await vi.waitFor(() => expect(image.decode).toHaveBeenCalledTimes(2));
    expect(released).toBe(false);

    secondDecode.resolve();
    await barrier;
    expect(released).toBe(true);
  });

  it('still releases at its cap for a broken decoder', async () => {
    const never = deferred();
    const image = {
      currentSrc: 'blob:broken',
      src: 'blob:broken',
      complete: false,
      decode: () => never.promise,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLImageElement;
    const root = { querySelectorAll: () => [image] } as unknown as ParentNode;
    const started = performance.now();
    await waitForLandingMedia(root, 20);
    expect(performance.now() - started).toBeGreaterThanOrEqual(15);
  });
});
