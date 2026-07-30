// @vitest-environment node
/**
 * tests/editor-script.test.ts — script ↔ editor bridge:
 *   1. round-trip (script → tiptap JSON → script) is stable for the
 *      supported subset,
 *   2. unknown containers degrade to a callout fallback and come back,
 *   3. sticker / callout-variant mapping,
 *   4. script block ids are preserved,
 *   5. diagram placeholder vs registered diagram node,
 *   6. the emitted JSON satisfies the real editor schema.
 */
import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';

import { parse, print } from '../src/script';
import type { ScriptDoc } from '../src/script';
import {
  scriptDocToTiptap,
  type TiptapNode,
} from '../src/editor/script/toTiptap';
import {
  docToScript,
  tiptapToScriptDoc,
} from '../src/editor/script/fromTiptap';
import { NOTEBOOK_SCRIPT_SPEC } from '../src/editor/script/spec';
import { stripSpans } from './script/fixtures';

/**
 * Minimal DOM shim (same as tests/editor.test.ts): compiled Solid node-view
 * components register delegated event roots at import time. Rendering never
 * happens here, so a stub document suffices. Imported after the shim.
 */
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

/** Compare two script docs modulo spans and diagnostics. */
function essence(doc: ScriptDoc): unknown {
  return stripSpans({ frontmatter: doc.frontmatter, blocks: doc.blocks });
}

function content(json: { content?: unknown[] }): TiptapNode[] {
  return (json.content ?? []) as TiptapNode[];
}

/* ------------------------------- round trip ------------------------------- */

const FIXTURE = [
  '---',
  'title: Round Trip',
  'paper: grid',
  '---',
  '',
  '# The Cell {id=b_head1, sticker=bee}',
  '',
  'Cells are the ==basic unit=={color=amber} of *life*. Key: **organelle**, ~~old~~, `code`.',
  '',
  '## Links {rotate=-2}',
  '',
  'See [the notes](https://example.com) for more.',
  '',
  '- first',
  '- second',
  '  - nested',
  '',
  '1. one',
  '2. two',
  '',
  '- [ ] open task',
  '- [x] done task',
  '',
  '> A quote to remember {washi=top}',
  '',
  '---',
  '',
  '| Col A | Col B |',
  '| --- | --- |',
  '| a | b |',
  '',
  '![a cell](assets/cell.png)',
  '',
  '::: callout {variant=tip}',
  'Watch the mitochondria.',
  ':::',
  '',
  '::: sticky-note {color=lemon, rotate=-2}',
  'Exam on **Friday!**',
  ':::',
  '',
  '::: image-row {cols=2, style=polaroid}',
  '![kitten](assets/kitten.png)',
  '![another](assets/two.png)',
  ':::',
  '',
  '```tree',
  'Cell',
  '  Nucleus',
  '  Membrane | thin',
  '```',
  '',
  '```graph',
  'Sun -> Photosynthesis: light',
  'Photosynthesis -> Glucose',
  '```',
  '',
  '```timeline',
  '1665: Hooke names the cell',
  '1838: Schleiden | color=terracotta',
  '```',
].join('\n');

describe('script → tiptap → script round trip', () => {
  const original = parse(FIXTURE);
  const json = scriptDocToTiptap(original);
  const restored = tiptapToScriptDoc(json);

  it('parses the fixture without dropping blocks', () => {
    expect(original.blocks.length).toBeGreaterThanOrEqual(15);
    expect(content(json).length).toBe(original.blocks.length);
  });

  it('restores the same frontmatter and blocks (modulo spans)', () => {
    expect(essence(restored)).toEqual(essence(original));
  });

  it('prints identically after the round trip', () => {
    expect(print(restored)).toBe(print(original));
  });

  it('docToScript is print ∘ tiptapToScriptDoc', () => {
    expect(docToScript(json)).toBe(print(restored));
  });

  it('maps frontmatter paper onto the document pageStyle attr', () => {
    expect((json.attrs as Record<string, unknown>).pageStyle).toBe('grid');
  });
});

/* ------------------------- degradation behaviors -------------------------- */

describe('unknown-container degradation', () => {
  const doc = parse('::: mystery-box {color=sky}\nHello inside.\n:::');
  const json = scriptDocToTiptap(doc);
  const fallback = content(json)[0];

  it('falls back to a callout node carrying the container marker', () => {
    expect(fallback.type).toBe('callout');
    expect(fallback.attrs?.containerName).toBe('mystery-box');
    expect(fallback.attrs?.containerAttrs).toEqual({ color: 'sky' });
    expect(fallback.content?.[0]?.type).toBe('paragraph');
  });

  it('round-trips back to the generic container', () => {
    const restored = tiptapToScriptDoc(json);
    expect(essence(restored)).toEqual(essence(doc));
    expect(print(restored)).toContain('::: mystery-box');
  });

  it('columns map to a real columns node with col children', () => {
    const cols = parse(
      '::: columns\n::: col\nleft\n:::\n::: col\nright\n:::\n:::',
    );
    const mapped = content(scriptDocToTiptap(cols));
    expect(mapped.map((n) => n.type)).toEqual(['columns']);
    expect(mapped[0].content?.map((n) => n.type)).toEqual(['col', 'col']);
  });

  it('columns still flatten when a hasNode() denies the nodes', () => {
    const cols = parse(
      '::: columns\n::: col\nleft\n:::\n::: col\nright\n:::\n:::',
    );
    const flat = content(scriptDocToTiptap(cols, { hasNode: () => false }));
    expect(flat.map((n) => n.type)).toEqual(['paragraph', 'paragraph']);
  });

  it('never throws on hostile block shapes', () => {
    const evil = parse('```wat\n<<<>>>\n```\n\n::fetch{count=3}');
    expect(() => scriptDocToTiptap(evil)).not.toThrow();
    expect(() => tiptapToScriptDoc(scriptDocToTiptap(evil))).not.toThrow();
  });
});

/* --------------------------- sticker & callout ---------------------------- */

describe('sticker and callout mapping', () => {
  it('turns a {sticker=…} attr into a trailing inline sticker node', () => {
    const doc = parse('# Hi there {sticker=bee}');
    const heading = content(scriptDocToTiptap(doc))[0];
    const last = heading.content?.[heading.content.length - 1];
    expect(last?.type).toBe('sticker');
    expect(last?.attrs?.stickerId).toBe('bee');
  });

  it('maps script-only sticker names onto the editor sticker set', () => {
    const doc = parse('# Lab notes {sticker=microscope}');
    const heading = content(scriptDocToTiptap(doc))[0];
    const last = heading.content?.[heading.content.length - 1];
    expect(last?.type).toBe('sticker');
    expect(last?.attrs?.stickerId).toBe('sparkle');
  });

  it('maps callout variants to icon + tint', () => {
    const info = content(scriptDocToTiptap(parse('::: callout {variant=info}\nx\n:::')))[0];
    expect(info.type).toBe('callout');
    expect(info.attrs?.icon).toBe('sparkle');
    expect(info.attrs?.tint).toBe('sky');

    const warn = content(scriptDocToTiptap(parse('::: warn\nx\n:::')))[0];
    expect(warn.attrs?.icon).toBe('bee');
    expect(warn.attrs?.tint).toBe('terracotta');
  });

  it('lets an explicit color override the variant tint', () => {
    const doc = parse('::: callout {variant=tip, color=blush}\nx\n:::');
    const callout = content(scriptDocToTiptap(doc))[0];
    expect(callout.attrs?.tint).toBe('blush');
  });

  it('derives a variant from the tint for live-editor callouts', () => {
    const restored = tiptapToScriptDoc({
      type: 'doc',
      content: [
        {
          type: 'callout',
          attrs: { id: 'b_c1', icon: 'leaf', tint: 'moss' },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] },
          ],
        },
      ],
    });
    const block = restored.blocks[0];
    expect(block.kind).toBe('container');
    if (block.kind === 'container') {
      expect(block.name).toBe('callout');
      expect(block.attrs).toEqual({ id: 'b_c1', variant: 'tip' });
    }
  });
});

/* --------------------------------- ids ------------------------------------ */

describe('id preservation', () => {
  it('keeps script {id=…} attrs as node ids and round-trips them', () => {
    const doc = parse('# Title {id=b_h}\n\nBody text. {id=b_p}');
    const json = scriptDocToTiptap(doc);
    expect(content(json)[0].attrs?.id).toBe('b_h');
    expect(content(json)[1].attrs?.id).toBe('b_p');
    const restored = tiptapToScriptDoc(json);
    expect(restored.blocks[0].attrs.id).toBe('b_h');
    expect(restored.blocks[1].attrs.id).toBe('b_p');
  });
});

/* -------------------------------- diagrams -------------------------------- */

describe('diagram bridging', () => {
  const doc = parse('```timeline\n1900: start\n1910: end\n```');

  it('emits a placeholder paragraph when no diagram node is registered', () => {
    const json = scriptDocToTiptap(doc);
    const block = content(json)[0];
    expect(block.type).toBe('paragraph');
    expect(typeof block.attrs?.['data-diagram']).toBe('string');
    expect(block.content?.[0]?.text).toContain('timeline');
    // …and the payload restores the diagram block exactly.
    expect(essence(tiptapToScriptDoc(json))).toEqual(essence(doc));
  });

  it('emits a diagram node when the runtime registry has one', () => {
    const json = scriptDocToTiptap(doc, {
      hasNode: (name) => name === 'diagram',
    });
    const block = content(json)[0];
    expect(block.type).toBe('diagram');
    expect(block.attrs?.kind).toBe('timeline');
    expect(essence(tiptapToScriptDoc(json))).toEqual(essence(doc));
  });
});

/* --------------------------- schema validation ---------------------------- */

describe('editor schema compatibility', () => {
  it('the round-trip fixture JSON satisfies the real schema', () => {
    const json = scriptDocToTiptap(parse(FIXTURE));
    expect(() =>
      schema.nodeFromJSON(json as unknown as Record<string, unknown>).check(),
    ).not.toThrow();
  });

  it('an image-row of only fetch: lines emits no empty imageRow node', () => {
    const doc = parse('::: image-row\nfetch: kitten\nfetch: puppy\n:::');
    const json = scriptDocToTiptap(doc);
    expect(content(json).some((n) => n.type === 'imageRow')).toBe(false);
    expect(() =>
      schema.nodeFromJSON(json as unknown as Record<string, unknown>).check(),
    ).not.toThrow();
  });

  it('callout children degrade to paragraphs (schema: paragraph+)', () => {
    const doc = parse('::: callout\n## A heading inside\n- a list item\n:::');
    const json = scriptDocToTiptap(doc);
    const callout = content(json)[0];
    expect(callout.type).toBe('callout');
    expect(callout.content?.every((n) => n.type === 'paragraph')).toBe(true);
    expect(() =>
      schema.nodeFromJSON(json as unknown as Record<string, unknown>).check(),
    ).not.toThrow();
  });

  it('card is a real node now and keeps rich children (schema: block+)', () => {
    const doc = parse(
      '::: card {title=Definitions}\n## A heading inside\n- a list item\n:::',
    );
    const json = scriptDocToTiptap(doc);
    const card = content(json)[0];
    expect(card.type).toBe('card');
    expect(card.attrs?.title).toBe('Definitions');
    expect(card.content?.map((n) => n.type)).toEqual(['heading', 'bulletList']);
    expect(() =>
      schema.nodeFromJSON(json as unknown as Record<string, unknown>).check(),
    ).not.toThrow();
  });
});

/* ---------------------------------- spec ---------------------------------- */

describe('inlined spec', () => {
  it('matches the shape of the canonical resource', () => {
    expect(NOTEBOOK_SCRIPT_SPEC).toContain('# Notebook Script');
    expect(NOTEBOOK_SCRIPT_SPEC).toContain('## 11. Final checklist');
    expect(NOTEBOOK_SCRIPT_SPEC.length).toBeGreaterThan(10_000);
  });
});
