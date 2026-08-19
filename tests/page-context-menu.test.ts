import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildBlockContextMenu,
  type ContextMenuItem,
} from '../src/editor/menu/registry';

describe('page deletion in the editor context menu', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
      selectionAware: true,
    });
    const context = {
      editor: {} as never,
      pos: 7,
      selectionRange: { from: 8, to: 31 },
    };
    item?.run(context);
    expect(onMoveBlockToPrevious).toHaveBeenCalledWith(context);
  });

  it('offers a plain Paste option in Insert for clipboard text/media', () => {
    const insert = buildBlockContextMenu().find(
      (entry) => entry.kind === 'submenu' && entry.id === 'insert',
    ) as { kind: 'submenu'; items: readonly ContextMenuItem[] } | undefined;

    expect(insert?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'paste', title: 'Paste' }),
    ]));
  });

  it('pastes clipboard text after the right-clicked block without replacing it', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        read: vi.fn().mockResolvedValue([]),
        readText: vi.fn().mockResolvedValue('clipboard note'),
      },
    });
    const insertContentAt = vi.fn().mockReturnThis();
    const chain = {
      focus: vi.fn().mockReturnThis(),
      insertContentAt,
      run: vi.fn().mockReturnValue(true),
    };
    const notify = vi.fn();
    const editor = {
      state: {
        doc: {
          content: { size: 99 },
          nodeAt: vi.fn().mockReturnValue({ nodeSize: 8 }),
        },
      },
      chain: vi.fn().mockReturnValue(chain),
    } as never;
    const insert = buildBlockContextMenu().find(
      (entry) => entry.kind === 'submenu' && entry.id === 'insert',
    ) as { kind: 'submenu'; items: readonly ContextMenuItem[] } | undefined;
    const paste = insert?.items.find((item) => item.id === 'paste');

    paste?.run({ editor, pos: 7, notify });

    await vi.waitFor(() => {
      expect(insertContentAt).toHaveBeenCalledWith(15, 'clipboard note');
    });
    expect(notify).toHaveBeenCalledWith('paste completed');
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
