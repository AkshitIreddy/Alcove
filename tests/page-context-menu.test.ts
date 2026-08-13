import { describe, expect, it, vi } from 'vitest';
import {
  buildBlockContextMenu,
  type ContextMenuItem,
} from '../src/editor/menu/registry';

describe('page deletion in the editor context menu', () => {
  it('offers useful copy and download actions for every block type', () => {
    const entries = buildBlockContextMenu();
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'item', id: 'copy-useful-content', title: 'Copy content' }),
      expect.objectContaining({ kind: 'item', id: 'download-useful-content', title: 'Download / save…' }),
    ]));
  });

  it('offers a backward-flow action when a previous page exists', () => {
    const onMoveBlockToPrevious = vi.fn();
    const item = buildBlockContextMenu({ onMoveBlockToPrevious }).find(
      (entry) =>
        entry.kind !== 'divider' &&
        entry.id === 'move-block-to-previous-page',
    ) as ContextMenuItem | undefined;

    expect(item).toMatchObject({
      kind: 'item',
      title: 'Move to previous page',
    });
    const context = { editor: {} as never, pos: 7 };
    item?.run(context);
    expect(onMoveBlockToPrevious).toHaveBeenCalledWith(context);
  });

  it('offers page insertion before and after the right-clicked leaf', () => {
    const onInsertPageBefore = vi.fn();
    const onInsertPageAfter = vi.fn();
    const entries = buildBlockContextMenu({
      onInsertPageBefore,
      onInsertPageAfter,
    });
    const before = entries.find(
      (entry) => entry.kind !== 'divider' && entry.id === 'insert-page-before',
    ) as ContextMenuItem | undefined;
    const after = entries.find(
      (entry) => entry.kind !== 'divider' && entry.id === 'insert-page-after',
    ) as ContextMenuItem | undefined;

    expect(before).toMatchObject({ kind: 'item', title: 'Add page before' });
    expect(after).toMatchObject({ kind: 'item', title: 'Add page after' });
    before?.run({ editor: {} as never, pos: 0 });
    after?.run({ editor: {} as never, pos: 0 });
    expect(onInsertPageBefore).toHaveBeenCalledOnce();
    expect(onInsertPageAfter).toHaveBeenCalledOnce();
  });

  it('offers a dangerous page action only when another page can survive', () => {
    expect(
      buildBlockContextMenu().some(
        (entry) => entry.kind !== 'divider' && entry.id === 'delete-page',
      ),
    ).toBe(false);

    const onDeletePage = vi.fn();
    const item = buildBlockContextMenu({ onDeletePage }).find(
      (entry) => entry.kind !== 'divider' && entry.id === 'delete-page',
    ) as ContextMenuItem | undefined;

    expect(item).toMatchObject({
      kind: 'item',
      title: 'Delete this page',
      danger: true,
    });
    item?.run({ editor: {} as never, pos: 0 });
    expect(onDeletePage).toHaveBeenCalledOnce();
  });
});
