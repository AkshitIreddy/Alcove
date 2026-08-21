import { getSchema, type Editor } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Card } from '../src/editor/nodes/containers';
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

  it('pastes a copied card as the exact structured block instead of its Notebook Script', async () => {
    let clipboardText = '';
    vi.stubGlobal('navigator', {
      clipboard: {
        read: vi.fn().mockResolvedValue([]),
        readText: vi.fn(async () => clipboardText),
        writeText: vi.fn(async (text: string) => {
          clipboardText = text;
        }),
      },
    });
    const schema = getSchema([StarterKit, Card]);
    const card = {
      type: 'card',
      attrs: { title: 'Exam clue' },
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Greedy choice' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'bold' }], text: 'Take two minimums' },
          ],
        },
      ],
    };
    const doc = schema.nodeFromJSON({ type: 'doc', content: [card] });
    const insertContentAt = vi.fn().mockReturnThis();
    const chain = {
      focus: vi.fn().mockReturnThis(),
      insertContentAt,
      run: vi.fn().mockReturnValue(true),
    };
    const editor = {
      state: EditorState.create({ schema, doc }),
      chain: vi.fn().mockReturnValue(chain),
    } as unknown as Editor;
    const entries = buildBlockContextMenu();
    const copy = entries.find(
      (entry) => entry.kind === 'item' && entry.id === 'copy-useful-content',
    ) as ContextMenuItem | undefined;
    const insert = entries.find(
      (entry) => entry.kind === 'submenu' && entry.id === 'insert',
    ) as { kind: 'submenu'; items: readonly ContextMenuItem[] } | undefined;
    const paste = insert?.items.find((item) => item.id === 'paste');
    const copyNotify = vi.fn();

    copy?.run({ editor, pos: 0, notify: copyNotify });
    await vi.waitFor(() => expect(copyNotify).toHaveBeenCalledWith('block copied'));
    expect(clipboardText).toContain('::: card');

    const pasteNotify = vi.fn();
    paste?.run({ editor, pos: 0, notify: pasteNotify });

    await vi.waitFor(() => {
      expect(insertContentAt).toHaveBeenCalledWith(doc.child(0).nodeSize, card);
    });
    expect(insertContentAt).not.toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(String),
    );
    expect(pasteNotify).toHaveBeenCalledWith('block pasted');
  });

  it('does not expose the removed Copy link command', () => {
    const ids = buildBlockContextMenu().flatMap((entry) =>
      entry.kind === 'submenu' ? [entry.id, ...entry.items.map((item) => item.id)]
        : entry.kind === 'item' ? [entry.id] : [],
    );

    expect(ids).not.toContain('copy-link');
  });

  it('filters whole groups and individual commands from context-menu preferences', () => {
    const entries = buildBlockContextMenu(
      { onDeletePage: vi.fn() },
      { hiddenItems: ['turn-into', 'paste', 'delete-page'] },
    );
    const ids = entries.flatMap((entry) =>
      entry.kind === 'submenu' ? [entry.id, ...entry.items.map((item) => item.id)]
        : entry.kind === 'item' ? [entry.id] : [],
    );

    expect(ids).not.toContain('turn-into');
    expect(ids).not.toContain('paste');
    expect(ids).not.toContain('delete-page');
    expect(ids).toContain('insert-picture');
    expect(entries[0]?.kind).not.toBe('divider');
    expect(entries.at(-1)?.kind).not.toBe('divider');
    entries.forEach((entry, index) => {
      if (entry.kind === 'divider') expect(entries[index - 1]?.kind).not.toBe('divider');
    });
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
