// @vitest-environment node
/**
 * tests/script/maths-notes-links.test.ts — the four things Notebook Script
 * grew so the welcome book could show them off: maths (inline and block),
 * footnotes, references to other pages, and toggles.
 *
 * Each one owns a character the parser was already using for something else,
 * so most of what is worth testing here is the NEGATIVE side: that a sentence
 * about money is still a sentence, that a bare `[` still opens a link, that an
 * unclosed `$$` does not eat the rest of the note.
 */
import { describe, expect, it } from 'vitest';
import { parse, print } from '../../src/script';
import type { Block, Inline } from '../../src/script';
import { scriptDocToTiptap } from '../../src/editor/script/toTiptap';
import { docToScript } from '../../src/editor/script/fromTiptap';

/** Every inline node in the document, depth-first. */
function inlines(doc: ReturnType<typeof parse>): Inline[] {
  const out: Inline[] = [];
  const walkInline = (nodes: Inline[]): void => {
    for (const n of nodes) {
      out.push(n);
      if ('children' in n) walkInline(n.children);
    }
  };
  const walkBlocks = (blocks: Block[]): void => {
    for (const b of blocks) {
      if ('content' in b) walkInline(b.content);
      if (b.kind === 'container') walkBlocks(b.children);
    }
  };
  walkBlocks(doc.blocks);
  return out;
}

const kinds = (src: string): string[] => inlines(parse(src)).map((n) => n.kind);
const codes = (src: string): string[] =>
  parse(src).diagnostics.map((d) => d.code);

/** Editor JSON with every optional node present. */
const toEditor = (src: string, resolve?: (label: string) => null | {
  pageId: string;
  bookId: string;
}) =>
  scriptDocToTiptap(parse(src), {
    hasNode: () => true,
    ...(resolve !== undefined ? { resolvePageLink: resolve } : {}),
  });

const types = (json: unknown): Set<string> => {
  const out = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const n = node as { type?: unknown; content?: unknown };
    if (typeof n.type === 'string') out.add(n.type);
    if (n.content !== undefined) walk(n.content);
  };
  walk((json as { content?: unknown }).content);
  return out;
};

// ---------------------------------------------------------------------------
// Maths
// ---------------------------------------------------------------------------

describe('maths in a sentence', () => {
  it('reads `$x^2$` as one opaque formula', () => {
    const doc = parse('The area is $\\pi r^2$ exactly.');
    const math = inlines(doc).filter((n) => n.kind === 'math');
    expect(math).toHaveLength(1);
    expect((math[0] as { text: string }).text).toBe('\\pi r^2');
    expect(doc.diagnostics).toEqual([]);
  });

  /**
   * The rule that earns the dollar its place: a formula may not open or close
   * against a space. Without it every price list in every note would turn into
   * maths the moment two dollars happened to line up.
   */
  it('leaves money alone', () => {
    expect(kinds('it costs $5 and $10 today')).toEqual(['text']);
    expect(kinds('between $ 5 $ and nothing')).toEqual(['text']);
    expect(kinds('a lone $ sign')).toEqual(['text']);
  });

  it('never parses markup inside a formula', () => {
    const doc = parse('$a_i * b_i$');
    const math = inlines(doc).filter((n) => n.kind === 'math');
    expect((math[0] as { text: string }).text).toBe('a_i * b_i');
    // No stray emphasis, and no "unclosed marker" complaint about the star.
    expect(kinds('$a_i * b_i$')).toEqual(['math']);
    expect(doc.diagnostics).toEqual([]);
  });

  it('takes a backslash escape for a literal dollar', () => {
    expect(kinds('costs \\$5 and \\$10')).toEqual(['text']);
  });
});

describe('an equation on its own line', () => {
  it('reads the fenced form verbatim, newlines and all', () => {
    const doc = parse('$$\n\\frac{a}{b}\n= c\n$$\n');
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]).toMatchObject({
      kind: 'mathBlock',
      latex: '\\frac{a}{b}\n= c',
    });
    expect(doc.diagnostics).toEqual([]);
  });

  it('reads the one-line form too', () => {
    const doc = parse('$$ e^{i\\pi} + 1 = 0 $$');
    expect(doc.blocks[0]).toMatchObject({
      kind: 'mathBlock',
      latex: 'e^{i\\pi} + 1 = 0',
    });
    expect(doc.diagnostics).toEqual([]);
  });

  it('takes block attrs on the opening line', () => {
    const doc = parse('$$ {color=amber}\nx = 1\n$$');
    expect(doc.blocks[0]).toMatchObject({
      kind: 'mathBlock',
      latex: 'x = 1',
      attrs: { color: 'amber' },
    });
  });

  it('warns rather than swallows when the closing `$$` is missing', () => {
    const doc = parse('$$\nx = 1\n\nand more prose\n');
    expect(codes('$$\nx = 1\n\nand more prose\n')).toContain('math-unclosed');
    // Total, as always: the note still parsed.
    expect(doc.blocks.length).toBeGreaterThan(0);
  });

  it('warns about an empty equation', () => {
    expect(codes('$$\n\n$$')).toContain('math-empty');
  });
});

// ---------------------------------------------------------------------------
// Footnotes
// ---------------------------------------------------------------------------

describe('footnotes', () => {
  it('carries the note inside the marker', () => {
    const doc = parse('A claim[^ and the note about it ] follows.');
    const notes = inlines(doc).filter((n) => n.kind === 'footnote');
    expect(notes).toHaveLength(1);
    expect((notes[0] as { text: string }).text).toBe('and the note about it');
    expect(doc.diagnostics).toEqual([]);
  });

  /** The spelling every chatbot writes, folded into the same node. */
  it('understands the Markdown two-part form', () => {
    const doc = parse('A claim[^why].\n\n[^why]: because of the thing.\n');
    const notes = inlines(doc).filter((n) => n.kind === 'footnote');
    expect(notes).toHaveLength(1);
    expect((notes[0] as { text: string }).text).toBe('because of the thing.');
    // The definition line is lifted out of the page, not printed as prose.
    expect(JSON.stringify(doc.blocks)).not.toContain('[^why]:');
    expect(doc.diagnostics).toEqual([]);
  });

  it('says so when a label has no definition', () => {
    expect(codes('A claim[^1].\n\n[^2]: the other one.\n')).toContain(
      'footnote-undefined',
    );
  });

  it('says so when a definition is never referenced', () => {
    expect(codes('A claim[^1].\n\n[^1]: used.\n\n[^2]: never.\n')).toContain(
      'footnote-unused',
    );
  });

  it('leaves a bracket that is not a footnote alone', () => {
    expect(kinds('an array[0] and a [link](x)')).toContain('link');
    expect(kinds('an array[0] and a [link](x)')).not.toContain('footnote');
  });

  it('lets a note contain the bracket that ends it', () => {
    const src = 'x[^ see figure 2\\] overleaf ]';
    const notes = inlines(parse(src)).filter((n) => n.kind === 'footnote');
    expect((notes[0] as { text: string }).text).toBe('see figure 2] overleaf');
    // …and the escape survives the canonical printer, which is what makes the
    // scan-to-closer honest rather than a trick that only works on the way in.
    const again = inlines(parse(print(parse(src)))).filter(
      (n) => n.kind === 'footnote',
    );
    expect((again[0] as { text: string }).text).toBe('see figure 2] overleaf');
  });
});

// ---------------------------------------------------------------------------
// Page references
// ---------------------------------------------------------------------------

describe('references to another page', () => {
  it('names a page between double brackets', () => {
    const doc = parse('See [[Cell Biology]] for the numbers.');
    const refs = inlines(doc).filter((n) => n.kind === 'pageref');
    expect(refs).toHaveLength(1);
    expect((refs[0] as { label: string }).label).toBe('Cell Biology');
    expect(doc.diagnostics).toEqual([]);
  });

  it('becomes a real reference when the label resolves', () => {
    const json = toEditor('See [[Cell Biology]].', (label) =>
      label === 'Cell Biology' ? { pageId: 'p1', bookId: 'b1' } : null,
    );
    expect(types(json).has('pageLink')).toBe(true);
    expect(JSON.stringify(json)).toContain('"pageId":"p1"');
  });

  /** A chip pointing at nothing would be a dead end; the words are not. */
  it('degrades to its own words when nothing resolves', () => {
    const json = toEditor('See [[Cell Biology]].');
    expect(types(json).has('pageLink')).toBe(false);
    expect(JSON.stringify(json)).toContain('Cell Biology');
  });

  it('warns about an empty reference', () => {
    expect(codes('See [[]].')).toContain('pageref-empty');
  });

  it('leaves a single bracket link alone', () => {
    expect(kinds('a [link](https://example.com)')).toContain('link');
  });
});

// ---------------------------------------------------------------------------
// Toggles
// ---------------------------------------------------------------------------

describe('toggles', () => {
  it('maps to the editor’s details triple, with the title as its summary', () => {
    const json = toEditor('::: toggle {title="Open me"}\ninside\n:::\n');
    expect(types(json).has('details')).toBe(true);
    expect(types(json).has('detailsSummary')).toBe(true);
    expect(types(json).has('detailsContent')).toBe(true);
    expect(JSON.stringify(json)).toContain('Open me');
  });

  it('nests', () => {
    const json = toEditor(
      '::: toggle {title=Outer}\n::: toggle {title=Inner}\ndeep\n:::\n:::\n',
    );
    const count = (JSON.stringify(json).match(/"details"/g) ?? []).length;
    expect(count).toBe(2);
  });

  /**
   * A `details` node used to come back as a `spoiler` with its summary
   * flattened into a bold paragraph — the fold was lost, so exporting and
   * re-importing built a different block from the one that was exported.
   */
  it('survives the round trip through the editor and back', () => {
    const src = '::: toggle {title="Open me"}\ninside\n:::\n';
    const back = docToScript(toEditor(src));
    expect(back).toContain('::: toggle');
    expect(back).toContain('title="Open me"');
    expect(back).toContain('inside');
  });

  it('is still a different thing from a spoiler', () => {
    expect(types(toEditor('::: spoiler\nhidden\n:::\n')).has('spoiler')).toBe(true);
    expect(types(toEditor('::: spoiler\nhidden\n:::\n')).has('details')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The whole way round
// ---------------------------------------------------------------------------

describe('script → editor → script', () => {
  it('brings maths, notes and references home unchanged', () => {
    const src = [
      'The area is $\\pi r^2$, noted[^ Archimedes, roughly. ].',
      '',
      '$$',
      'e^{i\\pi} + 1 = 0',
      '$$',
      '',
      'See [[Another page]].',
      '',
    ].join('\n');
    // Resolved, because a reference only survives an export as a reference:
    // an unresolved one is deliberately degraded to its own words on the way
    // IN, so there is nothing left for the way out to recognise.
    const back = docToScript(
      toEditor(src, () => ({ pageId: 'p1', bookId: 'b1' })),
    );
    expect(back).toContain('$\\pi r^2$');
    expect(back).toContain('[^ Archimedes, roughly. ]');
    expect(back).toContain('e^{i\\pi} + 1 = 0');
    expect(back).toContain('[[Another page]]');
    // And it parses back to the same shapes.
    const again = parse(back);
    expect(again.diagnostics).toEqual([]);
    expect(again.blocks.map((b) => b.kind)).toEqual([
      'paragraph',
      'mathBlock',
      'paragraph',
    ]);
  });

  it('keeps a formula out of the schema without losing it', () => {
    const json = scriptDocToTiptap(parse('$$\nx = 1\n$$\n'), {
      hasNode: (name) => name !== 'math',
    });
    expect(types(json).has('math')).toBe(false);
    expect(JSON.stringify(json)).toContain('x = 1');
  });
});
