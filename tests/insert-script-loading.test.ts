import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { waitForInsertionMaskPaint } from '../src/editor/insert/insertionPaint';

const ROOT = resolve(import.meta.dirname, '..');

describe('Notebook Script insertion waiting state', () => {
  it('waits across two animation frames so the first one can actually paint', async () => {
    const callbacks: FrameRequestCallback[] = [];
    let resolved = false;
    const waiting = waitForInsertionMaskPaint((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    }).then(() => {
      resolved = true;
    });

    expect(callbacks).toHaveLength(1);
    callbacks.shift()?.(10);
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(callbacks).toHaveLength(1);

    callbacks.shift()?.(20);
    await waiting;
    expect(resolved).toBe(true);
  });

  it('commits an opaque accessible mask before synchronous pagination work', () => {
    const dialog = readFileSync(
      resolve(ROOT, 'src/editor/insert/InsertScriptDialog.tsx'),
      'utf8',
    );
    const styles = readFileSync(resolve(ROOT, 'src/styles/insert.css'), 'utf8');
    const firstPaint = dialog.indexOf('await waitForInsertionMaskPaint();');
    const activity = dialog.indexOf('await props.onInsertionActivity?.(true);');
    const dispatch = dialog.indexOf('.insertContent(content, { updateSelection: false })');
    const checking = dialog.indexOf("setInsertionPhase('checking');");
    const settlement = dialog.indexOf('await props.onInsertionActivity?.(false);', checking);
    const successNotice = dialog.indexOf('props.onNotify?.(', checking);

    expect(firstPaint).toBeGreaterThan(0);
    expect(firstPaint).toBeLessThan(activity);
    expect(firstPaint).toBeLessThan(dispatch);
    expect(dialog).toContain('class="nb-ins-progress"');
    expect(dialog).toContain('role="status"');
    expect(dialog).toContain('aria-live="polite"');
    expect(dialog).toContain('inert={inserting()}');
    expect(checking).toBeGreaterThan(dispatch);
    expect(settlement).toBeGreaterThan(checking);
    expect(successNotice).toBeGreaterThan(settlement);
    expect(styles).toMatch(/\.nb-ins-progress\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?background:\s*var\(--paper-aged\);/);
    expect(styles).toMatch(
      /\.nb-ins-overlay\.is-inserting\s*\{[\s\S]*?z-index:\s*calc\(var\(--z-toasts\) \+ 1\);[\s\S]*?94%/,
    );
  });

  it('pins the dialog to its opening page while settlement visits other spreads', () => {
    const bookView = readFileSync(resolve(ROOT, 'src/views/BookView.tsx'), 'utf8');

    expect(bookView).toContain('const [insertPageId, setInsertPageId]');
    expect(bookView).toContain('setInsertPageId(pageId);');
    expect(bookView).toContain(
      '<Show when={insertOpen() ? insertPageId() : null} keyed>',
    );
    expect(bookView).not.toContain(
      '<Show when={insertOpen() ? activePage()?.id : null} keyed>',
    );
  });
});
