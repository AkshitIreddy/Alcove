import { describe, expect, it, vi } from 'vitest';
import { parse } from '../src/script';
import {
  resolveScriptFetches,
  type ScriptImageFetcher,
} from '../src/editor/script/resolveFetches';

describe('Notebook Script image fetch resolution', () => {
  it('turns image-row searches into durable image blocks', async () => {
    const fetcher: ScriptImageFetcher = vi.fn(async (query) => [
      {
        id: `id-${query}`,
        relPath: `images/${query}.png`,
        src: `asset://images/${query}.png`,
        url: `https://example.test/${query}`,
        thumbUrl: null,
        attribution: 'Example',
        license: 'CC0',
        sha256: `sha-${query}`,
        sizeBytes: 4,
      },
    ]);
    const resolved = await resolveScriptFetches(
      parse([
        '::: image-row {cols=2}',
        'fetch: tabby kitten | caption=Mittens',
        'fetch: orange kitten',
        ':::',
      ].join('\n')),
      fetcher,
    );

    const row = resolved.blocks[0];
    expect(row?.kind).toBe('container');
    if (row?.kind !== 'container') throw new Error('expected image row');
    expect(row.children).toHaveLength(2);
    expect(row.children[0]).toMatchObject({
      kind: 'image',
      src: 'asset://images/tabby kitten.png',
      attrs: {
        asset: 'images/tabby kitten.png',
        caption: 'Mittens',
        style: 'polaroid',
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledWith('tabby kitten', 1);
  });

  it('degrades an unavailable search to a real upload card', async () => {
    const resolved = await resolveScriptFetches(
      parse('::fetch{query="watercolor forest", caption="A quiet forest"}'),
      async () => [],
    );

    expect(resolved.blocks[0]).toMatchObject({
      kind: 'image',
      src: '',
      alt: 'watercolor forest',
      attrs: {
        placeholder: 'add an image for watercolor forest',
        caption: 'A quiet forest',
        style: 'polaroid',
      },
    });
  });

  it('caps a standalone multi-image request at four results', async () => {
    const fetcher: ScriptImageFetcher = vi.fn(async (_query, count) =>
      Array.from({ length: count }, (_, index) => ({
        id: `id-${index}`,
        relPath: `images/${index}.png`,
        src: `asset://images/${index}.png`,
        url: `https://example.test/${index}`,
        thumbUrl: null,
        attribution: 'Example',
        license: 'CC0',
        sha256: `sha-${index}`,
        sizeBytes: 4,
      })),
    );
    const resolved = await resolveScriptFetches(
      parse('::fetch{query="clouds", count=99}'),
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith('clouds', 4);
    expect(resolved.blocks).toHaveLength(4);
  });
});
