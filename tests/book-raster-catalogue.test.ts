import { describe, expect, it } from 'vitest';
import { BOOK_RASTER_ARTWORK_MANIFEST } from '../src/art/bookRasterArtwork';
import { BOOK_EMBLEM_MASTERS } from '../src/art/bookEmblemArtwork';
import { REMASTERED_FRAME_MASTERS } from '../src/art/bookFrameArtwork';
import { REMASTERED_TITLE_IDS } from '../src/art/bookTitleArtwork';

describe('complete generated book artwork catalogue', () => {
  it('preserves a master for every existing named emblem, frame and visible title treatment', () => {
    const expected = [
      ...Object.values(BOOK_EMBLEM_MASTERS).map(m => `emblems/${m.id}`),
      ...REMASTERED_FRAME_MASTERS.map(m => `frames/${m.id}`),
      ...REMASTERED_TITLE_IDS.filter(id => id !== 'none').map(id => `titles/${id}`),
    ].sort();
    const raster = BOOK_RASTER_ARTWORK_MANIFEST.map(m => m.id).sort();
    // Original ImageGen masters remain intact; the append-only expansion is
    // native vector artwork, rendered in the same cover and worker pipelines.
    expect(raster).toHaveLength(72);
    for (const id of raster) expect(expected, id).toContain(id);
    expect(expected).toHaveLength(144);
  });
});
