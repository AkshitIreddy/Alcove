// @vitest-environment node
/**
 * tests/editor.test.ts — pure-logic tests for the block editor:
 *   1. slash-menu registry filtering (fuzzy ranking),
 *   2. doc ↔ storage round-trip of fixtures validated through
 *      schema.nodeFromJSON (the doc JSON IS the storage format),
 *   3. procedural sticker determinism.
 *
 * Runs in plain Node — extensions are built without the interactive chrome
 * (drag handle / slash / placeholder), so no DOM is touched.
 */
import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';

import {
  DEFAULT_LINE_HEIGHT_PX,
  DEFAULT_PAGE_STYLE,
  normalizePageDoc,
} from '../src/editor/document';
import {
  SLASH_COMMANDS,
  filterSlashCommands,
  fuzzyScore,
} from '../src/editor/slash/registry';
import { STICKER_IDS, stickerSvg } from '../src/editor/nodes/stickers';
import { emptyPageDoc } from '../src/data/pages';
import type { PageDoc } from '../src/data/types';

/**
 * Minimal DOM shim: compiled Solid node-view components register delegated
 * event roots (window.document.addEventListener) at import time. Nothing
 * else in these tests touches the DOM — rendering never happens — so a stub
 * document is enough. The extension module is imported after the shim.
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

/* ------------------------------ slash menu ------------------------------- */

describe('slash command registry', () => {
  it('has unique ids and every section populated', () => {
    const ids = SLASH_COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
    const sections = new Set(SLASH_COMMANDS.map((command) => command.section));
    expect(sections).toContain('blocks');
    expect(sections).toContain('stickers');
    expect(sections).toContain('turn-into');
  });

  it('returns all commands in registry order for an empty query', () => {
    expect(filterSlashCommands('')).toEqual([...SLASH_COMMANDS]);
    expect(filterSlashCommands('   ')).toEqual([...SLASH_COMMANDS]);
  });

  it('ranks title prefixes first', () => {
    const results = filterSlashCommands('head');
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(results[0].id).toBe('heading-1');
    expect(results[1].id).toBe('heading-2');
  });

  it('matches via keywords (todo → task list)', () => {
    const results = filterSlashCommands('todo');
    expect(results[0].id).toBe('task-list');
  });

  it('matches h1/h2/h3 shorthands', () => {
    expect(filterSlashCommands('h2')[0].id).toBe('heading-2');
    expect(filterSlashCommands('h3')[0].id).toBe('heading-3');
  });

  it('finds commands by fuzzy subsequence', () => {
    const results = filterSlashCommands('clout');
    expect(results.some((command) => command.id === 'callout')).toBe(true);
  });

  it('finds every sticker by its name', () => {
    for (const stickerId of STICKER_IDS) {
      const results = filterSlashCommands(stickerId);
      expect(
        results.some((command) => command.id === `sticker-${stickerId}`),
        `sticker "${stickerId}" should be findable`,
      ).toBe(true);
    }
  });

  it('returns nothing for gibberish', () => {
    expect(filterSlashCommands('qxzqxzqxz')).toEqual([]);
  });

  it('fuzzyScore orders prefix > word-start > substring > subsequence', () => {
    const prefix = fuzzyScore('head', 'heading 1');
    const wordStart = fuzzyScore('list', 'bullet list');
    const substring = fuzzyScore('ullet', 'bullet list');
    const subsequence = fuzzyScore('blist', 'bullet list');
    expect(prefix).not.toBeNull();
    expect(wordStart).not.toBeNull();
    expect(substring).not.toBeNull();
    expect(subsequence).not.toBeNull();
    expect(prefix as number).toBeGreaterThan(wordStart as number);
    expect(wordStart as number).toBeGreaterThan(substring as number);
    expect(substring as number).toBeGreaterThan(subsequence as number);
    expect(fuzzyScore('xyz', 'heading')).toBeNull();
  });
});

/* -------------------------- doc ↔ storage round-trip ---------------------- */

/**
 * Fixture note: ProseMirror's toJSON always emits the full attrs object for
 * node types that declare attributes, so fixtures spell out defaults too
 * (id from UniqueID, language: null, etc.).
 */
const fixtureDoc: PageDoc = {
  type: 'doc',
  attrs: { pageStyle: 'grid', lineHeightPx: 32 },
  content: [
    {
      type: 'heading',
      attrs: { id: 'b_head1', level: 2 },
      content: [
        { type: 'text', text: 'Mitosis ' },
        {
          type: 'text',
          text: 'phases',
          marks: [{ type: 'highlight', attrs: { color: 'amber' } }],
        },
      ],
    },
    {
      type: 'paragraph',
      attrs: { id: 'b_para1' },
      content: [
        { type: 'text', text: 'A cell divides ' },
        {
          type: 'sticker',
          attrs: { stickerId: 'bee', scale: 1.5, rotate: -8 },
        },
        { type: 'text', text: ' carefully.' },
      ],
    },
    {
      type: 'callout',
      attrs: { id: 'b_call1', icon: 'leaf', tint: 'moss' },
      content: [
        {
          type: 'paragraph',
          attrs: { id: 'b_call1p' },
          content: [{ type: 'text', text: 'Remember the spindle fibers!' }],
        },
      ],
    },
    {
      type: 'details',
      attrs: { id: 'b_det1', open: true },
      content: [
        {
          type: 'detailsSummary',
          content: [{ type: 'text', text: 'Prophase' }],
        },
        {
          type: 'detailsContent',
          content: [
            {
              type: 'paragraph',
              attrs: { id: 'b_det1p' },
              content: [{ type: 'text', text: 'Chromatin condenses.' }],
            },
          ],
        },
      ],
    },
    {
      type: 'taskList',
      attrs: { id: 'b_tasks' },
      content: [
        {
          type: 'taskItem',
          attrs: { id: 'b_task1', checked: true },
          content: [
            {
              type: 'paragraph',
              attrs: { id: 'b_task1p' },
              content: [{ type: 'text', text: 'draw the diagram' }],
            },
          ],
        },
        {
          type: 'taskItem',
          attrs: { id: 'b_task2', checked: false },
          content: [
            {
              type: 'paragraph',
              attrs: { id: 'b_task2p' },
              content: [{ type: 'text', text: 'revise telophase' }],
            },
          ],
        },
      ],
    },
    {
      type: 'codeBlock',
      attrs: { id: 'b_code1', language: 'typescript' },
      content: [{ type: 'text', text: 'const phases = 4;' }],
    },
  ],
};

describe('document round-trip through the schema', () => {
  it('nodeFromJSON validates and re-serializes the fixture byte-identically', () => {
    const node = schema.nodeFromJSON(fixtureDoc);
    expect(() => node.check()).not.toThrow();
    expect(node.toJSON()).toEqual(fixtureDoc);
  });

  it('reaches a stable fixpoint for imageRow + blockquote + table content', () => {
    const richer: PageDoc = {
      type: 'doc',
      attrs: { pageStyle: 'ruled', lineHeightPx: 32 },
      content: [
        {
          type: 'imageRow',
          attrs: { id: 'b_row1' },
          content: [
            { type: 'image', attrs: { src: 'asset://a.png', widthPct: 40 } },
            { type: 'image', attrs: { src: 'asset://b.png' } },
          ],
        },
        {
          type: 'blockquote',
          attrs: { id: 'b_quote1' },
          content: [
            {
              type: 'paragraph',
              attrs: { id: 'b_quote1p' },
              content: [{ type: 'text', text: 'Nature does nothing in vain.' }],
            },
          ],
        },
        {
          type: 'table',
          attrs: { id: 'b_table1' },
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  content: [
                    {
                      type: 'paragraph',
                      attrs: { id: 'b_th1p' },
                      content: [{ type: 'text', text: 'Phase' }],
                    },
                  ],
                },
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'paragraph',
                      attrs: { id: 'b_td1p' },
                      content: [{ type: 'text', text: 'Prophase' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const once = schema.nodeFromJSON(richer);
    expect(() => once.check()).not.toThrow();
    const serialized = once.toJSON() as PageDoc;
    const twice = schema.nodeFromJSON(serialized).toJSON();
    expect(twice).toEqual(serialized);
  });

  it('page style + line height live on the doc node and survive', () => {
    const node = schema.nodeFromJSON(fixtureDoc);
    expect(node.attrs.pageStyle).toBe('grid');
    expect(node.attrs.lineHeightPx).toBe(32);
  });

  it('doc defaults come from the extended Document node', () => {
    const bare = schema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { id: 'b_p' } }],
    });
    expect(bare.attrs.pageStyle).toBe(DEFAULT_PAGE_STYLE);
    expect(bare.attrs.lineHeightPx).toBe(DEFAULT_LINE_HEIGHT_PX);
  });

  it('normalizePageDoc makes an empty stored page schema-valid', () => {
    const normalized = normalizePageDoc(emptyPageDoc());
    const node = schema.nodeFromJSON(normalized);
    expect(() => node.check()).not.toThrow();
    expect(node.childCount).toBe(1);
    expect(node.child(0).type.name).toBe('paragraph');
    // and it does not mutate the input
    expect(emptyPageDoc().content).toEqual([]);
  });

  it('rejects invalid content (schema is the gatekeeper)', () => {
    const invalid = {
      type: 'doc',
      content: [{ type: 'no-such-block' }],
    };
    expect(() => schema.nodeFromJSON(invalid)).toThrow();
  });
});

/* ------------------------------- stickers -------------------------------- */

describe('procedural stickers', () => {
  it('renders deterministic markup for all 8 stickers', () => {
    expect(STICKER_IDS).toHaveLength(8);
    for (const id of STICKER_IDS) {
      const first = stickerSvg(id);
      expect(first.startsWith('<svg')).toBe(true);
      expect(first).toContain('viewBox="0 0 32 32"');
      // No runtime SVG filters allowed outside the bake pipeline.
      expect(first).not.toContain('<filter');
      expect(first).not.toContain('feTurbulence');
      expect(stickerSvg(id)).toBe(first);
    }
  });

  it('uses only token-based colors', () => {
    for (const id of STICKER_IDS) {
      const svg = stickerSvg(id);
      const fills = svg.match(/(?:fill|stroke)="([^"]+)"/g) ?? [];
      for (const declaration of fills) {
        expect(declaration).toMatch(/"(none|var\(--[a-z-]+\))"/);
      }
    }
  });
});
