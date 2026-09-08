import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BOOK_RASTER_ARTWORK_MANIFEST,
  BOOK_RASTER_RECOLOUR_CACHE_LIMIT,
  alphaBoundsFromRgba,
  bookRasterArtworkIds,
  bookRasterArtworkStatus,
  clearBookRasterArtworkCache,
  getBookRasterArtwork,
  paintBookRasterArtwork,
  preloadBookRasterArtwork,
} from '../src/art/bookRasterArtwork';

afterEach(() => {
  clearBookRasterArtworkCache();
  vi.unstubAllGlobals();
});

describe('generated book raster artwork resources', () => {
  it('derives the exact non-transparent crop from arbitrary source margins', () => {
    const pixels = new Uint8ClampedArray(7 * 6 * 4);
    for (const [x, y, alpha] of [[2, 1, 80], [4, 1, 255], [3, 4, 180]] as const) {
      pixels[(y * 7 + x) * 4 + 3] = alpha;
    }
    expect(alphaBoundsFromRgba(pixels, 7, 6)).toEqual({
      x: 2,
      y: 1,
      width: 3,
      height: 4,
    });
    expect(alphaBoundsFromRgba(new Uint8ClampedArray(7 * 6 * 4), 7, 6)).toBeNull();
  });

  it('publishes unique category-qualified ids and rejects unknown preload ids', async () => {
    const ids = bookRasterArtworkIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(BOOK_RASTER_ARTWORK_MANIFEST.map((entry) => entry.id));
    expect(ids.some((id) => /-alpha$/i.test(id))).toBe(false);
    for (const entry of BOOK_RASTER_ARTWORK_MANIFEST) {
      expect(entry.id.startsWith(`${entry.category}/`)).toBe(true);
    }
    await expect(preloadBookRasterArtwork(['emblems/definitely-missing'])).rejects.toThrow(
      /unknown asset/,
    );
  });

  it('keeps hot painters synchronous and returns false before an asset is loaded', () => {
    expect(getBookRasterArtwork('emblems/definitely-missing', '#432934')).toBeUndefined();
    expect(paintBookRasterArtwork(
      {} as never,
      'emblems/definitely-missing',
      { ground: '#f2e6ce', ink: '#432934', tooling: '#c5a465' },
      0,
      0,
      20,
      20,
    )).toBe(false);
  });

  it('evicts the least-recently-used recolour beyond the bounded canvas budget', async () => {
    const id = bookRasterArtworkIds()[0];
    expect(id).toBeDefined();
    if (id === undefined) throw new Error('generated artwork manifest is empty');

    class FakeContext {
      imageSmoothingEnabled = false;
      imageSmoothingQuality: ImageSmoothingQuality = 'low';
      clearRect(): void {}
      drawImage(): void {}
      putImageData(): void {}
      getImageData(_x: number, _y: number, width: number, height: number): ImageData {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < data.length; i += 4) {
          data[i] = 0x43;
          data[i + 1] = 0x29;
          data[i + 2] = 0x34;
          data[i + 3] = i === 0 ? 0 : 255;
        }
        return { data, width, height, colorSpace: 'srgb' } as ImageData;
      }
    }
    class FakeCanvas {
      constructor(public width: number, public height: number) {}
      private readonly ctx = new FakeContext();
      getContext(): FakeContext { return this.ctx; }
    }

    vi.stubGlobal('OffscreenCanvas', FakeCanvas);
    const pngHeader = new Uint8Array(24);
    pngHeader.set([137, 80, 78, 71, 13, 10, 26, 10]);
    pngHeader.set([73, 72, 68, 82], 12);
    new DataView(pngHeader.buffer).setUint32(16, 2, false);
    new DataView(pngHeader.buffer).setUint32(20, 2, false);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob([pngHeader], { type: 'image/png' }),
    })));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 2,
      height: 2,
      close: vi.fn(),
    })));

    await preloadBookRasterArtwork([id]);
    for (let i = 0; i < BOOK_RASTER_RECOLOUR_CACHE_LIMIT + 7; i++) {
      const colour = `#${i.toString(16).padStart(6, '0')}`;
      expect(getBookRasterArtwork(id, colour)).toBeDefined();
    }
    expect(bookRasterArtworkStatus().recoloured).toBe(BOOK_RASTER_RECOLOUR_CACHE_LIMIT);
  });
});
