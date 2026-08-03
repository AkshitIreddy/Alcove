// @vitest-environment node
/**
 * tests/editor-depth.test.ts — the Notion-depth writing features: nested
 * toggles, columns and footnotes.
 *
 * These three share one failure mode and it is why they are tested together:
 * each is a CONTAINER whose value is entirely in what it may hold and where it
 * ends up on the page, and each can be shipped as a schema that looks right in
 * the document JSON while doing nothing a reader would notice. Columns already
 * did exactly that once — two nodes, no flex rule, no way to add a column, no
 * way to move a divider — so the assertions below are about behaviour that
 * survives a round trip, never about the presence of a node type.
 *
 * Everything here is pure: the schema is derived with `getSchema()` and the
 * commands' hard parts (`recountColumns`, `resizeColumnWeights`,
 * `collectFootnotes`) are DOM-free functions that take real ProseMirror nodes.
 */
import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import {
  MAX_COLUMNS,
  MIN_COLUMNS,
  MIN_COLUMN_SHARE,
  evenColumnWeights,
  isEmptyLayout,
  recountColumns,
  resizeColumnWeights,
} from '../src/editor/nodes/columns';
import { collectFootnotes } from '../src/editor/nodes/footnote';
import {
  KNOWN_MACROS,
  atomHeight,
  mathToHtml,
  parseMath,
} from '../src/editor/nodes/mathTex';

/** Same DOM shim as tests/editor.test.ts — Solid node views register roots. */
const globals = globalThis as Record<string, unknown>;
if (typeof globals.window === 'undefined') {
  globals.window = globals;
  globals.document = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
}

const { createEditorExtensions } = await import('../src/editor/extensions');
const schema = getSchema(createEditorExtensions());

function para(text: string): Record<string, unknown> {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

/** Build a node from JSON, failing the test with the schema's own message. */
function node(json: Record<string, unknown>): ProseMirrorNode {
  return schema.nodeFromJSON(json);
}

/* ------------------------------ nested toggles ---------------------------- */

describe('toggles nest', () => {
  it('accepts a details inside a details, at depth', () => {
    const inner = {
      type: 'details',
      content: [
        { type: 'detailsSummary', content: [{ type: 'text', text: 'inner' }] },
        { type: 'detailsContent', content: [para('the innermost note')] },
      ],
    };
    const outer = node({
      type: 'details',
      content: [
        { type: 'detailsSummary', content: [{ type: 'text', text: 'outer' }] },
        { type: 'detailsContent', content: [para('above'), inner] },
      ],
    });
    outer.check();

    // The nesting has to be real containment, not two siblings that happen to
    // serialize next to each other.
    const summaries: string[] = [];
    outer.descendants((child) => {
      if (child.type.name === 'detailsSummary') summaries.push(child.textContent);
      return true;
    });
    expect(summaries).toEqual(['outer', 'inner']);
    expect(JSON.parse(JSON.stringify(outer.toJSON()))).toMatchObject({
      type: 'details',
    });
  });

  it('lets a toggle hold the other containers, and them hold a toggle', () => {
    const detailsContent = schema.nodes.detailsContent;
    expect(detailsContent).toBeDefined();
    // `block+` is the promise the slash menu makes when it offers /toggle
    // inside a callout, a column or another toggle.
    expect(detailsContent?.spec.content).toBe('block+');

    // A column is the container this most matters in: /toggle inside a column
    // is how a two-up study page gets its answers hidden.
    const column = node({
      type: 'columns',
      content: [
        {
          type: 'col',
          content: [
            {
              type: 'details',
              content: [
                { type: 'detailsSummary', content: [{ type: 'text', text: 'q' }] },
                { type: 'detailsContent', content: [para('a')] },
              ],
            },
          ],
        },
        { type: 'col', content: [para('beside it')] },
      ],
    });
    column.check();

    // …and the other way round: a toggle holding a whole layout.
    const toggle = node({
      type: 'details',
      content: [
        { type: 'detailsSummary', content: [{ type: 'text', text: 'workings' }] },
        {
          type: 'detailsContent',
          content: [
            {
              type: 'columns',
              content: [
                { type: 'col', content: [para('left')] },
                { type: 'col', content: [para('right')] },
              ],
            },
          ],
        },
      ],
    });
    toggle.check();
  });
});

/* --------------------------------- columns -------------------------------- */

describe('column weights', () => {
  it('spreads evenly by default', () => {
    expect(evenColumnWeights(3)).toEqual([1, 1, 1]);
    expect(evenColumnWeights(0)).toEqual([]);
    expect(evenColumnWeights(-2)).toEqual([]);
  });

  it('moves only the pair either side of the dragged divider', () => {
    const next = resizeColumnWeights([1, 1, 1], 0, 0.75);
    expect(next[2]).toBe(1);
    expect(next[0]! + next[1]!).toBeCloseTo(2, 5);
    expect(next[0]! / (next[0]! + next[1]!)).toBeCloseTo(0.75, 3);
  });

  it('keeps a column wide enough to hold a word', () => {
    const squashed = resizeColumnWeights([1, 1], 0, 0.001);
    expect(squashed[0]! / (squashed[0]! + squashed[1]!)).toBeCloseTo(
      MIN_COLUMN_SHARE,
      3,
    );
    const stretched = resizeColumnWeights([1, 1], 0, 0.999);
    expect(stretched[1]! / (stretched[0]! + stretched[1]!)).toBeCloseTo(
      MIN_COLUMN_SHARE,
      3,
    );
  });

  it('is total: junk weights and impossible dividers change nothing fatal', () => {
    // Every junk weight reads as 1 first, so an even drag stays even.
    expect(resizeColumnWeights([0, Number.NaN, -3], 0, 0.5)).toEqual([1, 1, 1]);
    expect(resizeColumnWeights([0, Number.NaN], 0, 0.75)).toEqual([1.5, 0.5]);
    expect(resizeColumnWeights([1, 1], 5, 0.5)).toEqual([1, 1]);
    expect(resizeColumnWeights([1, 1], -1, 0.5)).toEqual([1, 1]);
    expect(resizeColumnWeights([1, 1], 0, Number.NaN)).toEqual([1, 1]);
  });
});

describe('changing the column count never eats prose', () => {
  const layout = (...columns: string[][]): ProseMirrorNode =>
    node({
      type: 'columns',
      content: columns.map((blocks) => ({
        type: 'col',
        content: blocks.map(para),
      })),
    });

  const columnTexts = (columns: ProseMirrorNode): string[] => {
    const out: string[] = [];
    columns.forEach((col) => out.push(col.textContent));
    return out;
  };

  it('grows with empty columns and keeps what was there', () => {
    const grown = recountColumns(layout(['left'], ['right']), 4);
    expect(grown).not.toBeNull();
    grown?.check();
    expect(grown?.childCount).toBe(4);
    expect(columnTexts(grown!)).toEqual(['left', 'right', '', '']);
  });

  it('shrinks by merging the surplus into the last survivor', () => {
    const shrunk = recountColumns(layout(['one'], ['two'], ['three']), 2);
    expect(shrunk).not.toBeNull();
    shrunk?.check();
    expect(shrunk?.childCount).toBe(2);
    expect(columnTexts(shrunk!)).toEqual(['one', 'twothree']);
    // Merged, not concatenated into one paragraph: both blocks survive.
    expect(shrunk?.child(1).childCount).toBe(2);
  });

  it('resets hand-dragged widths so the new column is not the odd one out', () => {
    const weighted = node({
      type: 'columns',
      content: [
        { type: 'col', attrs: { width: 2.4 }, content: [para('wide')] },
        { type: 'col', attrs: { width: 0.6 }, content: [para('narrow')] },
      ],
    });
    const grown = recountColumns(weighted, 3);
    expect(grown).not.toBeNull();
    grown?.forEach((col) => expect(col.attrs.width).toBeNull());
  });

  it('refuses a count the schema could not hold, and a no-op', () => {
    const two = layout(['a'], ['b']);
    expect(recountColumns(two, 2)).toBeNull();
    expect(recountColumns(two, Number.NaN)).toBeNull();
    // Out of range clamps into col{2,4} rather than throwing; 9 becomes 4.
    expect(recountColumns(two, 9)?.childCount).toBe(MAX_COLUMNS);
    expect(recountColumns(layout(['a'], ['b'], ['c']), 0)?.childCount).toBe(
      MIN_COLUMNS,
    );
  });

  /**
   * Backspace at the start of column one deletes the layout when — and only
   * when — there is nothing in it to lose. The keyboard is otherwise inert
   * inside an empty columns block (`col` is isolating, so there is nothing for
   * a backspace to join), which strands a reader who made one by accident.
   */
  it('knows an empty layout from one holding something', () => {
    const blank = { type: 'paragraph' };
    const bare = node({
      type: 'columns',
      content: [
        { type: 'col', content: [blank] },
        { type: 'col', content: [blank] },
      ],
    });
    expect(isEmptyLayout(bare)).toBe(true);
    expect(isEmptyLayout(layout(['   '], ['  ']))).toBe(true);
    expect(isEmptyLayout(layout(['a word'], ['  ']))).toBe(false);
    // A formula, an image or a diagram carries no text and must still count.
    const withMath = node({
      type: 'columns',
      content: [
        { type: 'col', content: [{ type: 'math', attrs: { latex: 'x^2' } }] },
        { type: 'col', content: [blank] },
      ],
    });
    expect(isEmptyLayout(withMath)).toBe(false);
  });

  it('keeps the layout attributes it was given', () => {
    const gapped = node({
      type: 'columns',
      attrs: { gap: 'lg' },
      content: [
        { type: 'col', content: [para('a')] },
        { type: 'col', content: [para('b')] },
      ],
    });
    expect(recountColumns(gapped, 3)?.attrs.gap).toBe('lg');
  });
});

/* -------------------------------- footnotes ------------------------------- */

describe('footnotes', () => {
  const withNote = (
    lead: string,
    note: string,
    tail = '',
  ): Record<string, unknown> => ({
    type: 'paragraph',
    content: [
      { type: 'text', text: lead },
      { type: 'footnote', attrs: { text: note } },
      ...(tail === '' ? [] : [{ type: 'text', text: tail }]),
    ],
  });

  it('numbers in reading order', () => {
    const doc = node({
      type: 'doc',
      content: [withNote('first', 'note one'), withNote('second', 'note two')],
    });
    expect(collectFootnotes(doc).map((ref) => ref.text)).toEqual([
      'note one',
      'note two',
    ]);
  });

  it('counts the ones nobody can see, which is why numbering is not a CSS counter', () => {
    // A note inside a CLOSED toggle is `display: none`, and a CSS counter
    // cannot count it — every marker after it would be numbered one low.
    const doc = node({
      type: 'doc',
      content: [
        {
          type: 'details',
          attrs: { open: false },
          content: [
            { type: 'detailsSummary', content: [{ type: 'text', text: 'hidden' }] },
            { type: 'detailsContent', content: [withNote('inside', 'note one')] },
          ],
        },
        withNote('after', 'note two'),
      ],
    });
    expect(collectFootnotes(doc).map((ref) => ref.text)).toEqual([
      'note one',
      'note two',
    ]);
  });

  it('reaches into columns and tables', () => {
    const doc = node({
      type: 'doc',
      content: [
        {
          type: 'columns',
          content: [
            { type: 'col', content: [withNote('left', 'in a column')] },
            { type: 'col', content: [para('right')] },
          ],
        },
      ],
    });
    expect(collectFootnotes(doc).map((ref) => ref.text)).toEqual(['in a column']);
  });

  it('is empty and total on a document with no notes', () => {
    expect(collectFootnotes(node({ type: 'doc', content: [para('plain')] }))).toEqual(
      [],
    );
  });

  /**
   * The pagination promise, tested where it is actually kept.
   *
   * PageEditor peels a trailing block, serializes it to JSON and hands it to
   * BookView, which prepends it to the next page (src/editor/pagination.ts).
   * The note rides along ONLY because it is an attribute of the marker inside
   * that block — so the property to pin is that a block's JSON carries the
   * note, and that re-parsing that JSON on another page finds it again.
   */
  it('travels inside the block the pagination contract carries', () => {
    const doc = node({
      type: 'doc',
      content: [para('stays'), withNote('flows onward', 'the note follows')],
    });
    const carried = doc.child(doc.childCount - 1).toJSON();
    const serialized = JSON.stringify(carried);
    expect(serialized).toContain('the note follows');

    // …and the next page parses that same JSON into a page of its own.
    const nextPage = node({
      type: 'doc',
      content: [JSON.parse(serialized) as Record<string, unknown>, para('was here')],
    });
    nextPage.check();
    expect(collectFootnotes(nextPage).map((ref) => ref.text)).toEqual([
      'the note follows',
    ]);
    // And it left the page it came from.
    const sourcePage = node({ type: 'doc', content: [para('stays')] });
    expect(collectFootnotes(sourcePage)).toEqual([]);
  });

  it('round-trips through the storage format', () => {
    const before = node({ type: 'doc', content: [withNote('x', 'a note', ' tail')] });
    const after = schema.nodeFromJSON(JSON.parse(JSON.stringify(before.toJSON())));
    after.check();
    expect(after.textContent).toBe('x tail');
    expect(collectFootnotes(after)[0]?.text).toBe('a note');
  });

  it('is an inline atom, so it cannot be typed into', () => {
    const type = schema.nodes.footnote;
    expect(type).toBeDefined();
    expect(type?.isInline).toBe(true);
    expect(type?.isAtom).toBe(true);
    // A note with no text is legal — it is what /footnote inserts.
    const empty = node({ type: 'doc', content: [withNote('y', '')] });
    empty.check();
    expect(collectFootnotes(empty)[0]?.text).toBe('');
  });
});

/* ---------------------------------- maths --------------------------------- */

describe('the TeX subset', () => {
  it('sets letters as variables and numbers upright', () => {
    const html = mathToHtml('2x');
    expect(html).toContain('nb-m-num">2<');
    expect(html).toContain('nb-m-var">x<');
  });

  it('stacks a fraction over a rule', () => {
    const atoms = parseMath('\\frac{a+1}{b}');
    expect(atoms).toHaveLength(1);
    expect(atoms[0]?.kind).toBe('frac');
    const html = mathToHtml('\\frac{a+1}{b}');
    expect(html).toContain('nb-m-frac-num');
    expect(html).toContain('nb-m-frac-den');
    // The numerator keeps its whole expression, not just the first token.
    expect(html.indexOf('nb-m-frac-den')).toBeGreaterThan(html.indexOf('+'));
  });

  it('reads both scripts in either order, and nests them', () => {
    for (const source of ['x^2_i', 'x_i^2']) {
      const atoms = parseMath(source);
      const first = atoms[0];
      expect(first?.kind).toBe('script');
      if (first?.kind !== 'script') continue;
      expect(first.sup).not.toBeNull();
      expect(first.sub).not.toBeNull();
    }
    expect(mathToHtml('x^{y^{z}}')).toContain('nb-m-sup');
  });

  it('stacks limits on a sum only when displayed, and never on an integral', () => {
    const sum = mathToHtml('\\sum_{i=1}^{n} i', { display: true });
    expect(sum).toContain('nb-m-limits');
    // Inline, the same source sets its limits at the side.
    expect(mathToHtml('\\sum_{i=1}^{n} i')).not.toContain('nb-m-limits');
    // A bound stacked on a ∫ collides with the line above it — side always.
    expect(mathToHtml('\\int_0^1 x', { display: true })).not.toContain(
      'nb-m-limits',
    );
  });

  it('grows a delimiter to the height of what it holds', () => {
    expect(atomHeight(parseMath('x'))).toBe(1);
    expect(atomHeight(parseMath('\\frac{a}{b}'))).toBeGreaterThan(1.9);
    const tall = mathToHtml('\\left(\\frac{a}{b}\\right)');
    expect(tall).toContain('scaleY(');
    const flat = mathToHtml('\\left(x\\right)');
    expect(flat).not.toContain('scaleY(');
  });

  it('sets function names upright and prose in the body hand', () => {
    expect(mathToHtml('\\sin x')).toContain('nb-m-text');
    expect(mathToHtml('\\text{if } x > 0')).toContain('if ');
  });

  it('says so when it does not know a macro, instead of dropping it', () => {
    const html = mathToHtml('\\begin{matrix}');
    expect(html).toContain('nb-m-unknown');
    expect(html).toContain('\\begin');
  });

  it('escapes what a reader types — the source is not markup', () => {
    const html = mathToHtml('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;');
  });

  it('shows a placeholder rather than nothing for an empty formula', () => {
    expect(mathToHtml('')).toContain('nb-m-placeholder');
    expect(mathToHtml('   ', { display: true })).toContain('equation');
  });

  it('knows the macros it advertises', () => {
    for (const macro of ['frac', 'sqrt', 'sum', 'alpha', 'leq', 'to', 'text']) {
      expect(KNOWN_MACROS).toContain(macro);
    }
    expect(new Set(KNOWN_MACROS).size).toBeGreaterThan(120);
  });

  /**
   * Totality, the same contract src/script/ holds itself to: a reader typing
   * a formula passes through every broken prefix of it on the way, and not one
   * of them may throw or hang.
   */
  it('never throws, on anything', () => {
    const nasty = [
      '\\frac',
      '\\frac{',
      '\\frac{a',
      '\\frac{a}',
      '{{{{{',
      '}}}}}',
      '^',
      '_',
      '^^^',
      'x^',
      '\\sqrt[',
      '\\left(',
      '\\right)',
      '\\',
      '\\\\',
      '\\text',
      '\\text{',
      '$',
      ' ￿',
      'a'.repeat(2000),
      '\\frac{'.repeat(200),
    ];
    for (const source of nasty) {
      expect(() => mathToHtml(source), source).not.toThrow();
      expect(() => mathToHtml(source, { display: true }), source).not.toThrow();
      expect(typeof mathToHtml(source)).toBe('string');
    }
  });

  it('is a block and an inline node, and both keep their source verbatim', () => {
    expect(schema.nodes.math?.isBlock).toBe(true);
    expect(schema.nodes.mathInline?.isInline).toBe(true);
    const doc = node({
      type: 'doc',
      content: [
        { type: 'math', attrs: { latex: '\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}' } },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'where ' },
            { type: 'mathInline', attrs: { latex: 'a \\neq 0' } },
          ],
        },
      ],
    });
    doc.check();
    const round = schema.nodeFromJSON(JSON.parse(JSON.stringify(doc.toJSON())));
    expect(round.child(0).attrs.latex).toBe('\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}');
    expect(round.child(1).child(1).attrs.latex).toBe('a \\neq 0');
  });
});

describe('columns nest', () => {
  it('takes a columns block inside a column', () => {
    const nested = node({
      type: 'columns',
      content: [
        {
          type: 'col',
          content: [
            {
              type: 'columns',
              content: [
                { type: 'col', content: [para('inner left')] },
                { type: 'col', content: [para('inner right')] },
              ],
            },
          ],
        },
        { type: 'col', content: [para('outer right')] },
      ],
    });
    nested.check();
    expect(nested.child(0).child(0).type.name).toBe('columns');
  });

  it('holds every other block type a column is offered', () => {
    const mixed = node({
      type: 'columns',
      content: [
        {
          type: 'col',
          content: [
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H' }] },
            { type: 'bulletList', content: [{ type: 'listItem', content: [para('x')] }] },
            { type: 'callout', content: [para('inside')] },
          ],
        },
        { type: 'col', content: [{ type: 'codeBlock' }] },
      ],
    });
    mixed.check();
  });
});
