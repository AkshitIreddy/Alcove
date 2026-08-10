import { describe, expect, it, vi } from 'vitest';

// SpineFactory's authority lives above its Pixi atlas write. The test replaces
// that write below, so loading a browser-only WebGL adapter in Node would add
// machinery without exercising another line of the race.
vi.mock('pixi.js', () => ({
  CanvasSource: class CanvasSource {},
  Rectangle: class Rectangle {},
  Texture: class Texture {},
}));

import type { ArtOffload, SpinePaint } from '../src/features/bookshelf/artOffload';
import { SpineFactory } from '../src/features/bookshelf/spineFactory';
import type { Book } from '../src/data/types';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function book(title: string): Book {
  return {
    id: 'book-under-edit',
    title,
    floor: 0,
    slot: 0,
    spineSeed: 0x51a7,
    coverMeta: null,
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
  };
}

describe('SpineFactory per-book bake authority', () => {
  it('discards an old worker result that resolves after the replacement', async () => {
    const jobs: Deferred<SpinePaint | null>[] = [];
    const completions: string[] = [];
    const offload = {
      available: true,
      size: 1,
      warmUp: vi.fn(),
      spine: vi.fn(() => {
        const pending = deferred<SpinePaint | null>();
        jobs.push(pending);
        return pending.promise;
      }),
    } as unknown as ArtOffload;
    const factory = new SpineFactory({ offload, hiEnabled: false, dpr: 1 });
    const landed: string[] = [];

    // The authority check lives immediately in front of this call. Replacing
    // the atlas write keeps the test headless while exercising the production
    // request -> worker -> invalidate -> completion path above it.
    (factory as unknown as {
      blit(book: Book, variant: 'lo' | 'hi', w: number, h: number, bitmap: ImageBitmap): void;
    }).blit = (finished) => landed.push(finished.title);

    const oldBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const newBitmap = { close: vi.fn() } as unknown as ImageBitmap;

    try {
      factory.request(book('A'), 'lo', 0);
      expect(jobs).toHaveLength(1);

      factory.invalidate('book-under-edit');
      factory.request(book('B'), 'lo', 0);
      expect(jobs).toHaveLength(2);

      completions.push('B');
      jobs[1]!.resolve({ bitmap: newBitmap, ms: 2 });
      await Promise.resolve();
      expect(landed).toEqual(['B']);

      completions.push('A');
      jobs[0]!.resolve({ bitmap: oldBitmap, ms: 8 });
      await Promise.resolve();

      // Negative control: this assertion proves the harness delivered the
      // adversarial order. A generation-blind "last promise wins" pipeline
      // would therefore finish on A and make the landed assertion fail.
      expect(completions).toEqual(['B', 'A']);
      expect(landed).toEqual(['B']);
      expect(oldBitmap.close).toHaveBeenCalledOnce();
      expect(newBitmap.close).toHaveBeenCalledOnce();
    } finally {
      factory.destroy();
    }
  });
});
