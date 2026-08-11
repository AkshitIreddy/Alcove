import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

describe('script insertion and late image pagination wiring', () => {
  it('addresses the live editor by the dialog page id, never by global focus', () => {
    const source = readFileSync(
      resolve(ROOT, 'src/editor/insert/InsertScriptDialog.tsx'),
      'utf8',
    );

    expect(source).toContain("import { getPageEditor } from '../instances';");
    expect(source).toContain('const editor = getPageEditor(props.pageId);');
    expect(source).not.toContain("from './activeEditor'");
  });

  it('re-runs overflow before grid snapping when a top-level block resizes', () => {
    const source = readFileSync(
      resolve(ROOT, 'src/editor/PageEditor.tsx'),
      'utf8',
    );
    const observer = source.match(
      /const resize = new ResizeObserver\(\(\) => \{([\s\S]*?)\n\s*\}\);/,
    )?.[1];

    expect(observer).toBeDefined();
    expect(observer).toContain('extractOverflow(instance);');
    expect(observer).toContain('queueGridSnap();');
    expect(observer!.indexOf('extractOverflow(instance);')).toBeLessThan(
      observer!.indexOf('queueGridSnap();'),
    );
  });

  it('hydrates a reused mounted starter leaf after all protected pages exist', () => {
    const source = readFileSync(
      resolve(ROOT, 'src/views/BookView.tsx'),
      'utf8',
    );
    const insertion = source.match(
      /const insertPagesAfter = \(([\s\S]*?)\n\s*let flipApi:/,
    )?.[1];

    expect(insertion).toBeDefined();
    expect(insertion).toContain('reusedMountedPages.push');
    expect(insertion).toContain('getPageEditor(reused.id)?.commands.setContent');
    expect(insertion!.indexOf('setPages(await listPages(bookId))')).toBeLessThan(
      insertion!.indexOf('commands.setContent'),
    );
  });

  it('keeps the reading position at the start instead of following imported overflow', () => {
    const source = readFileSync(
      resolve(ROOT, 'src/editor/insert/InsertScriptDialog.tsx'),
      'utf8',
    );

    expect(source).toContain('const insertionStart = editor.state.selection.from;');
    expect(source).toContain('insertContent(content, { updateSelection: false })');
    expect(source).toContain('.setTextSelection(insertionStart)');
    expect(source).not.toContain("chain().focus().insertContent(content)");
  });

  it('locks a multi-page import to the spread and side where it began', () => {
    const dialog = readFileSync(
      resolve(ROOT, 'src/editor/insert/InsertScriptDialog.tsx'),
      'utf8',
    );
    const bookView = readFileSync(
      resolve(ROOT, 'src/views/BookView.tsx'),
      'utf8',
    );

    expect(dialog).toContain('props.onInsertionActivity?.(true);');
    expect(dialog).toContain('await props.onInsertionActivity?.(false);');
    expect(bookView).toContain('scriptInsertionViewLock');
    expect(bookView).toContain('cursorCarried && scriptInsertionViewLock === null');
    expect(bookView).toContain('await carryChain;');
    expect(bookView).toContain('onInsertionActivity={setScriptInsertionActivity}');
  });
});
