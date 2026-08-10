import { describe, expect, it } from 'vitest';

import type { BookStyle } from '../src/art/bookStyle';
import {
  bookBinding,
  loadDesignPrefs,
  publishedBookBinding,
  saveBookBinding,
  subscribeBookBindings,
} from '../src/data/designPrefs';
import {
  createOrderedBookAppearanceWriter,
  persistBookStyle,
  subscribeBookAppearances,
} from '../src/features/bookshelf/bookIdentity';

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

describe('combined book appearance publication', () => {
  it('publishes no bake input until the new binding and matching style are both ready', async () => {
    await loadDesignPrefs();
    const bookId = 'atomic-appearance-publication';
    await saveBookBinding(bookId, null);

    const styleWriteStarted = deferred<void>();
    const finishStyleWrite = deferred<void>();
    let persistedStyle: BookStyle | null = null;
    const bakeInputs: Array<{
      source: 'binding' | 'appearance';
      binding: string | null;
      thickness: number | null;
    }> = [];

    const snapshot = (source: 'binding' | 'appearance'): void => {
      bakeInputs.push({
        source,
        binding: publishedBookBinding(bookId),
        thickness: persistedStyle?.thickness ?? null,
      });
    };
    const unsubscribeBindings = subscribeBookBindings((ids) => {
      if (ids.includes(bookId)) snapshot('binding');
    });
    const unsubscribeAppearances = subscribeBookAppearances((ids) => {
      if (ids.includes(bookId)) snapshot('appearance');
    });

    const writer = createOrderedBookAppearanceWriter({
      saveBinding: (id, binding) => saveBookBinding(id, binding),
      saveStyle: (write) => persistBookStyle(
        write.bookId,
        write.style,
        {
          binding: write.projectionBinding,
          bindingPinned: write.bindingPinned,
          materialPinned: write.materialPinned,
        },
        async (_id, style) => {
          styleWriteStarted.resolve();
          await finishStyleWrite.promise;
          persistedStyle = style as BookStyle | null;
        },
      ),
    });

    try {
      const saving = writer({
        bookId,
        binding: 'plain-vellum',
        projectionBinding: 'plain-vellum',
        bindingPinned: true,
        style: { thickness: 47 },
      });

      await styleWriteStarted.promise;
      // The optimistic designPrefs store has moved, but no Pixi subscriber has
      // been allowed to bake it over the old Book row.
      expect(bookBinding(bookId)).toBe('plain-vellum');
      expect(publishedBookBinding(bookId)).toBeNull();
      expect(persistedStyle).toBeNull();
      expect(bakeInputs).toEqual([]);

      finishStyleWrite.resolve();
      await saving;

      // One canonical publication, and its snapshot contains both matching
      // halves. A binding notification here would be a second invalidation.
      expect(bakeInputs).toEqual([{
        source: 'appearance',
        binding: 'plain-vellum',
        thickness: 47,
      }]);
    } finally {
      unsubscribeAppearances();
      unsubscribeBindings();
      await saveBookBinding(bookId, null);
    }
  });

  it('restores the previous binding when the style half rejects', async () => {
    await loadDesignPrefs();
    const bookId = 'atomic-appearance-rollback';
    await saveBookBinding(bookId, 'gilt-quarto');
    const bindingEvents: string[][] = [];
    const unsubscribe = subscribeBookBindings((ids) => {
      if (ids.includes(bookId)) bindingEvents.push([...ids]);
    });
    // `subscribeBookBindings` intentionally reports an already-pinned binding
    // to a newly attached world. That hydration is not part of the edit below.
    await Promise.resolve();
    await Promise.resolve();
    bindingEvents.length = 0;
    const styleFailure = new Error('synthetic style persistence failure');
    const bindingWrites: Array<string | null> = [];
    const writer = createOrderedBookAppearanceWriter({
      saveBinding: async (id, binding) => {
        bindingWrites.push(binding);
        await saveBookBinding(id, binding);
      },
      saveStyle: async () => {
        throw styleFailure;
      },
    });

    try {
      await expect(writer({
        bookId,
        binding: 'plain-vellum',
        projectionBinding: 'plain-vellum',
        bindingPinned: true,
        style: { thickness: 47 },
      })).rejects.toBe(styleFailure);

      expect(bindingWrites).toEqual(['plain-vellum', 'gilt-quarto']);
      expect(bookBinding(bookId)).toBe('gilt-quarto');
      expect(publishedBookBinding(bookId)).toBe('gilt-quarto');
      // Neither the failed optimistic half nor its compensation should ask the
      // shelf to bake. The texture it already has remains the correct answer.
      expect(bindingEvents).toEqual([]);
    } finally {
      unsubscribe();
      await saveBookBinding(bookId, null);
    }
  });
});
