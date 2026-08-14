import { readFileSync } from 'node:fs';
import { Schema } from '@tiptap/pm/model';
import {
  EditorState,
  NodeSelection,
  TextSelection,
} from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import {
  keyboardWritingCaretAffinity,
  nearestWritingCaretAffinity,
  writingCaretPosition,
  writingCaretRuleGeometry,
} from '../src/editor/writingCaret';

const editorCss = readFileSync(new URL('../src/styles/editor.css', import.meta.url), 'utf8');
const caretSource = readFileSync(
  new URL('../src/editor/writingCaret.ts', import.meta.url),
  'utf8',
);

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'text*', group: 'block' },
    blockAtom: { group: 'block', atom: true },
    text: { group: 'inline' },
  },
});

const doc = schema.node('doc', null, [
  schema.node('paragraph', null, schema.text('write here')),
  schema.node('blockAtom'),
]);

function cssBlock(selector: string): string {
  const start = editorCss.indexOf(selector);
  expect(start, `${selector} exists`).toBeGreaterThanOrEqual(0);
  const open = editorCss.indexOf('{', start);
  const close = editorCss.indexOf('}', open);
  return editorCss.slice(open + 1, close);
}

describe('ruled-paper writing caret', () => {
  it('preserves both visual affinities of one soft-wrap document position', () => {
    const upstream = { left: 696, right: 696, top: 124.8, bottom: 151.8 };
    const downstream = { left: 227, right: 227, top: 156.8, bottom: 183.8 };

    expect(
      nearestWritingCaretAffinity({ x: 231, y: 170 }, upstream, downstream),
    ).toBe(1);
    expect(
      nearestWritingCaretAffinity({ x: 694, y: 139 }, upstream, downstream),
    ).toBe(-1);
    expect(keyboardWritingCaretAffinity('ArrowRight')).toBe(1);
    expect(keyboardWritingCaretAffinity('Home')).toBe(1);
    expect(keyboardWritingCaretAffinity('ArrowLeft')).toBe(-1);
    expect(keyboardWritingCaretAffinity('End')).toBe(-1);
    expect(keyboardWritingCaretAffinity('a')).toBeNull();
  });

  it('appears only for a collapsed inline text selection', () => {
    const caret = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 3),
    });
    expect(writingCaretPosition(caret)).toBe(3);

    const range = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 2, 5),
    });
    expect(writingCaretPosition(range)).toBeNull();

    const atomPos = doc.child(0).nodeSize;
    const node = EditorState.create({
      doc,
      selection: NodeSelection.create(doc, atomPos),
    });
    expect(writingCaretPosition(node)).toBeNull();
  });

  it('anchors above the real ruled-line phase at every fit scale and rule gap', () => {
    // Exact clean fixture from the live wrap-start regression: the browser's
    // font-sized caret ends below the second rule, but the writing mark must
    // stop 2.1px before that rule starts.
    const native = writingCaretRuleGeometry(
      180.188,
      115.281,
      32,
      1,
      17.2,
      2.1,
      0,
    );
    expect(native?.line).toBe(2);
    expect(native?.ruleStart).toBeCloseTo(178.281, 6);
    expect(native?.ruleEnd).toBeCloseTo(179.281, 6);
    expect(native?.top).toBeCloseTo(158.981, 6);
    expect(native?.bottom).toBeCloseTo(176.181, 6);

    const fitted = writingCaretRuleGeometry(
      180.188 * 0.7436,
      115.281 * 0.7436,
      32,
      0.7436,
      17.2,
      2.1,
      0,
    );
    expect(fitted?.line).toBe(2);
    expect((fitted?.ruleStart ?? 0) - (fitted?.bottom ?? 0)).toBeCloseTo(
      2.1 * 0.7436,
      6,
    );

    const raised = writingCaretRuleGeometry(
      180.188,
      115.281,
      32,
      1,
      17.2,
      2.1,
      6,
    );
    const lowered = writingCaretRuleGeometry(
      180.188,
      115.281,
      32,
      1,
      17.2,
      2.1,
      -6,
    );
    expect(raised?.bottom).toBeCloseTo(170.181, 6);
    expect(lowered?.bottom).toBeCloseTo(176.181, 6);

    for (const gap of [-12, -6, 0, 6, 12]) {
      const geometry = writingCaretRuleGeometry(
        180.188,
        115.281,
        32,
        1,
        17.2,
        2.1,
        gap,
      );
      expect(geometry).not.toBeNull();
      const overlapsTarget =
        (geometry?.top ?? 0) < (geometry?.ruleEnd ?? 0) &&
        (geometry?.bottom ?? 0) > (geometry?.ruleStart ?? 0);
      const previousRuleStart = (geometry?.ruleStart ?? 0) - 32;
      const overlapsPrevious =
        (geometry?.top ?? 0) < previousRuleStart + 1 &&
        (geometry?.bottom ?? 0) > previousRuleStart;
      const nextRuleStart = (geometry?.ruleStart ?? 0) + 32;
      const overlapsNext =
        (geometry?.top ?? 0) < nextRuleStart + 1 &&
        (geometry?.bottom ?? 0) > nextRuleStart;
      expect(overlapsTarget || overlapsPrevious || overlapsNext).toBe(false);
    }
    expect(writingCaretRuleGeometry(10, 0, 0, 1, 17.2, 2.1, 0)).toBeNull();
  });

  it('stays outside prose layout and is positioned as a capped page overlay', () => {
    const anchor = cssBlock('.nb-writing-caret {');
    expect(anchor).toContain('position: absolute;');
    expect(anchor).toContain('display: none;');
    expect(anchor).toContain('width: 1.5px;');
    expect(editorCss).toContain('.nb-writing-caret.is-visible');
    expect(caretSource).toContain('host.appendChild(caret)');
    expect(caretSource).not.toContain('Decoration.widget');
    expect(caretSource).toContain('safeFontSize * 0.86');
    expect(caretSource).toContain('safeProseFontSize * 0.105');
    expect(caretSource).toContain('writingCaretRuleGeometry');
    expect(caretSource).toContain('Number.parseFloat(proseStyle.lineHeight)');
    expect(editorCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(editorCss).toContain('@media (forced-colors: active)');
  });

  it('restores the native caret for IME/nested editors and stays out of snapshots', () => {
    expect(editorCss).toContain('.nb-prose.ProseMirror-focused.nb-is-composing');
    expect(editorCss).toContain("[contenteditable='true']");
    expect(caretSource).toContain("setAttribute('data-snapshot-hide', '')");
  });
});
