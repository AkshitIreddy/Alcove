import { describe, expect, it, vi } from 'vitest';

vi.mock('pixi.js', () => ({
  CanvasSource: class CanvasSource {},
  Rectangle: class Rectangle {},
  Texture: class Texture {
    destroyed = false;

    destroy(): void {
      this.destroyed = true;
    }
  },
}));

import type { ArtOffload } from '../src/features/bookshelf/artOffload';
import { SpineFactory } from '../src/features/bookshelf/spineFactory';

describe('SpineFactory live texture retirement', () => {
  it('keeps the mounted texture valid until listeners have repointed it', () => {
    const offload = {
      available: false,
      size: 0,
      warmUp: vi.fn(),
    } as unknown as ArtOffload;
    const factory = new SpineFactory({ offload, hiEnabled: false, dpr: 1 });
    const oldTexture = {
      destroyed: false,
      destroy(): void {
        this.destroyed = true;
      },
    };
    const internals = factory as unknown as {
      loTextures: Map<string, typeof oldTexture>;
      releaseRetired(): void;
    };
    internals.loTextures.set('book-under-edit', oldTexture);

    const observations: Array<{
      destroyed: boolean;
      picked: unknown;
    }> = [];
    factory.onTexturesChanged((ids) => {
      if (!ids.includes('book-under-edit')) return;
      observations.push({
        destroyed: oldTexture.destroyed,
        picked: factory.get('book-under-edit', 'lo'),
      });
    });

    try {
      factory.invalidate('book-under-edit');

      expect(observations).toEqual([{
        destroyed: false,
        picked: oldTexture,
      }]);
      expect(oldTexture.destroyed).toBe(false);

      // The watchdog path also announces before freeing: on the callback the
      // sprite can safely switch to its placeholder; only afterwards may Pixi
      // have the Texture destroyed.
      internals.releaseRetired();
      expect(observations).toEqual([
        { destroyed: false, picked: oldTexture },
        { destroyed: false, picked: undefined },
      ]);
      expect(oldTexture.destroyed).toBe(true);
    } finally {
      factory.destroy();
    }
  });
});
