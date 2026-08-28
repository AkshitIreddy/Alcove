import { describe, expect, it } from 'vitest';
import type { PageDoc } from '../src/data/types';
import {
  PageThumbnailCache,
  pageThumbnailLookSignature,
  type PageThumbnailKey,
} from '../src/views/pageThumbnails';

class FakeBitmap {
  closed = false;

  constructor(readonly name: string) {}

  close(): void {
    this.closed = true;
  }
}

const doc = (text: string): PageDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const key = (
  pageDoc: PageDoc,
  side: PageThumbnailKey['side'] = 'left',
  look = 'parchment|sepia',
): PageThumbnailKey => ({ doc: pageDoc, side, look });

describe('PageThumbnailCache', () => {
  it('keys every page-paint setting but ignores animated panel geometry', () => {
    const fakeRoot = (
      paper: string,
      panelPush: string,
      theme = 'parchment',
    ): HTMLElement => {
      const names = ['--paper-cream', '--nb-panel-push'] as unknown as CSSStyleDeclaration;
      const values: Record<string, string> = {
        '--paper-cream': paper,
        '--nb-panel-push': panelPush,
      };
      Object.assign(names, {
        getPropertyValue: (name: string) => values[name] ?? '',
      });
      return {
        className: 'nb-no-doodles',
        style: names,
        getAttribute: (name: string) =>
          ({
            'data-theme': theme,
            'data-ink': 'sepia',
            'data-appearance': 'house-parchment',
            'data-code-frame': 'ruled',
            'data-code-numbers': 'on',
          })[name] ?? null,
      } as unknown as HTMLElement;
    };

    const original = pageThumbnailLookSignature(fakeRoot('#f7f1e3', '0px'));
    const panelMoved = pageThumbnailLookSignature(fakeRoot('#f7f1e3', '280px'));
    const paperChanged = pageThumbnailLookSignature(fakeRoot('#fff2d2', '280px'));
    const themeChanged = pageThumbnailLookSignature(fakeRoot('#f7f1e3', '0px', 'night'));

    expect(panelMoved).toBe(original);
    expect(paperChanged).not.toBe(original);
    expect(themeChanged).not.toBe(original);
  });

  it('deduplicates one real page render and reuses its tiny bitmap', async () => {
    const cache = new PageThumbnailCache<FakeBitmap>({ capacity: 4, concurrency: 1 });
    const pageDoc = doc('the actual page');
    let renders = 0;
    const render = async (): Promise<FakeBitmap> => {
      renders += 1;
      return new FakeBitmap(`render-${renders}`);
    };

    const [first, second] = await Promise.all([
      cache.request('page-1', key(pageDoc), render),
      cache.request('page-1', key(pageDoc), render),
    ]);
    const third = await cache.request('page-1', key(pageDoc), render);

    expect(renders).toBe(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('recaptures when document pixels, physical side, or page look changes', async () => {
    const cache = new PageThumbnailCache<FakeBitmap>({ capacity: 4, concurrency: 1 });
    const original = doc('before edit');
    const edited = doc('after edit with an image and a diagram');
    const bitmaps: FakeBitmap[] = [];
    const render = async (): Promise<FakeBitmap> => {
      const bitmap = new FakeBitmap(`render-${bitmaps.length + 1}`);
      bitmaps.push(bitmap);
      return bitmap;
    };

    await cache.request('page-1', key(original), render);
    await cache.request('page-1', key(edited), render);
    await cache.request('page-1', key(edited, 'right'), render);
    await cache.request('page-1', key(edited, 'right', 'night|graphite'), render);

    expect(bitmaps).toHaveLength(4);
    expect(bitmaps.slice(0, -1).every((bitmap) => bitmap.closed)).toBe(true);
    expect(bitmaps.at(-1)?.closed).toBe(false);
  });

  it('does not start obsolete offscreen work after a thumbnail leaves view', async () => {
    const cache = new PageThumbnailCache<FakeBitmap>({ capacity: 4, concurrency: 1 });
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let secondRenders = 0;
    const controller = new AbortController();

    const first = cache.request('page-1', key(doc('one')), async () => {
      await firstGate;
      return new FakeBitmap('one');
    });
    const second = cache.request(
      'page-2',
      key(doc('two')),
      async () => {
        secondRenders += 1;
        return new FakeBitmap('two');
      },
      controller.signal,
    );
    controller.abort();
    releaseFirst();

    await expect(first).resolves.toBeInstanceOf(FakeBitmap);
    await expect(second).resolves.toBeNull();
    expect(secondRenders).toBe(0);
  });

  it('bounds retained thumbnail pixels and closes them on disposal', async () => {
    const cache = new PageThumbnailCache<FakeBitmap>({ capacity: 2, concurrency: 1 });
    const one = await cache.request('page-1', key(doc('one')), async () => new FakeBitmap('one'));
    const two = await cache.request('page-2', key(doc('two')), async () => new FakeBitmap('two'));
    const three = await cache.request('page-3', key(doc('three')), async () => new FakeBitmap('three'));

    expect(one?.closed).toBe(true);
    expect(two?.closed).toBe(false);
    expect(three?.closed).toBe(false);

    cache.dispose();
    expect(two?.closed).toBe(true);
    expect(three?.closed).toBe(true);
  });
});
