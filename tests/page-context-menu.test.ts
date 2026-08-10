import { describe, expect, it, vi } from 'vitest';
import {
  buildBlockContextMenu,
  type ContextMenuItem,
} from '../src/editor/menu/registry';

describe('page deletion in the editor context menu', () => {
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
