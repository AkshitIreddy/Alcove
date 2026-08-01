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
const {
  buildBlockContextMenu,
  HIGHLIGHT_WASHES,
  INK_COLOR_TOKENS,
} = await import('../src/editor/menu/registry');
const { editorApi, BLOCK_EFFECT_KEYS } = await import('../src/editor/api');
const {
  activeEditor,
  getLineHeight,
  getPageStyle,
  setLineHeight,
  setPageStyle,
} = await import('../src/editor/insert/activeEditor');

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
 * (id from UniqueID, language: null, the BlockEffects nulls, etc.).
 */
/** Every BlockEffects global attribute at rest (src/editor/effects). */
const FX = {
  rotate: null,
  tape: null,
  washi: null,
  shadow: null,
  frame: null,
  paper: null,
  underline: null,
  font: null,
  ink: null,
  size: null,
  align: null,
};

const fixtureDoc: PageDoc = {
  type: 'doc',
  attrs: { pageStyle: 'grid', lineHeightPx: 32 },
  content: [
    {
      type: 'heading',
      attrs: { id: 'b_head1', level: 2, ...FX },
      content: [
        { type: 'text', text: 'Mitosis ' },
        {
          type: 'text',
          text: 'phases',
          // hlStyle is the wave-2 highlighter-style attr (default 'marker').
          marks: [
            { type: 'highlight', attrs: { color: 'amber', hlStyle: 'marker' } },
          ],
        },
      ],
    },
    {
      type: 'paragraph',
      attrs: { id: 'b_para1', ...FX },
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
      attrs: { id: 'b_call1', icon: 'leaf', tint: 'moss', ...FX },
      content: [
        {
          type: 'paragraph',
          attrs: { id: 'b_call1p', ...FX },
          content: [{ type: 'text', text: 'Remember the spindle fibers!' }],
        },
      ],
    },
    {
      type: 'details',
      attrs: { id: 'b_det1', open: true, ...FX },
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
              attrs: { id: 'b_det1p', ...FX },
              content: [{ type: 'text', text: 'Chromatin condenses.' }],
            },
          ],
        },
      ],
    },
    {
      type: 'taskList',
      attrs: { id: 'b_tasks', ...FX },
      content: [
        {
          type: 'taskItem',
          attrs: { id: 'b_task1', checked: true },
          content: [
            {
              type: 'paragraph',
              attrs: { id: 'b_task1p', ...FX },
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
              attrs: { id: 'b_task2p', ...FX },
              content: [{ type: 'text', text: 'revise telophase' }],
            },
          ],
        },
      ],
    },
    {
      type: 'codeBlock',
      attrs: { id: 'b_code1', language: 'typescript', ...FX },
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

/* --------------------------- context menu registry ------------------------ */

describe('block context menu registry', () => {
  const entries = buildBlockContextMenu();
  const submenus = entries.filter(
    (entry) => entry.kind === 'submenu',
  ) as Array<{ id: string; items: readonly { id: string }[] }>;
  const leafIds = entries.flatMap((entry) => {
    if (entry.kind === 'item') return [entry.id];
    if (entry.kind === 'submenu') return entry.items.map((item) => item.id);
    return [];
  });

  it('exposes the Notion-grade groups', () => {
    expect(submenus.map((submenu) => submenu.id)).toEqual([
      'turn-into',
      'color',
      'highlight',
      'effects',
    ]);
    const rootIds = entries
      .filter((entry) => entry.kind === 'item')
      .map((entry) => (entry as { id: string }).id);
    expect(rootIds).toEqual([
      'insert-above',
      'insert-below',
      'duplicate',
      'copy-script',
      'delete',
    ]);
  });

  it('has globally unique leaf ids', () => {
    expect(new Set(leafIds).size).toBe(leafIds.length);
  });

  it('turn-into covers every block family', () => {
    const turnInto = submenus.find((submenu) => submenu.id === 'turn-into');
    const ids = (turnInto?.items ?? []).map((item) => item.id);
    for (const expected of [
      'turn-text',
      'turn-heading-1',
      'turn-heading-2',
      'turn-heading-3',
      'turn-bullet-list',
      'turn-ordered-list',
      'turn-task-list',
      'turn-toggle',
      'turn-quote',
      'turn-callout',
      'turn-code-block',
      'turn-sticky-note',
      'turn-washi-box',
      'turn-card',
      'turn-quote-card',
      'turn-banner',
      'turn-spoiler',
    ]) {
      expect(ids, `missing ${expected}`).toContain(expected);
    }
  });

  it('offers the 3 vocab inks and the 7 highlight washes (plus resets)', () => {
    expect(Object.keys(INK_COLOR_TOKENS)).toEqual([
      'sepia',
      'graphite',
      'ink-blue',
    ]);
    expect(HIGHLIGHT_WASHES).toEqual([
      'amber',
      'terracotta',
      'moss',
      'lemon',
      'sky',
      'blush',
      'plum',
    ]);
    const color = submenus.find((submenu) => submenu.id === 'color');
    expect(color?.items.map((item) => item.id)).toContain('ink-default');
    const highlight = submenus.find((submenu) => submenu.id === 'highlight');
    expect(highlight?.items.map((item) => item.id)).toContain('highlight-none');
  });

  it('effects submenu quick-applies every BlockEffects attr family', () => {
    const effects = submenus.find((submenu) => submenu.id === 'effects');
    const ids = (effects?.items ?? []).map((item) => item.id);
    for (const key of [
      'effect-rotate',
      'effect-tape',
      'effect-washi',
      'effect-frame',
      'effect-paper',
      'effect-underline',
      'effect-clear',
    ]) {
      expect(ids).toContain(key);
    }
  });
});

/* --------------------------- rail palette API ----------------------------- */

describe('editor rail API (no live editor)', () => {
  it('exposes the typed command surface', () => {
    expect(typeof editorApi.insertSticker).toBe('function');
    expect(typeof editorApi.applyBlockEffect).toBe('function');
    expect(typeof editorApi.setInk).toBe('function');
    expect(typeof editorApi.setHighlight).toBe('function');
    expect(BLOCK_EFFECT_KEYS).toEqual([
      'rotate',
      'tape',
      'washi',
      'shadow',
      'frame',
      'paper',
      'underline',
    ]);
  });

  it('returns false instead of throwing when no editor is active', () => {
    expect(activeEditor()).toBeNull();
    expect(editorApi.insertSticker('star')).toBe(false);
    expect(editorApi.applyBlockEffect('tape', 'top')).toBe(false);
    expect(editorApi.setInk('ink-blue')).toBe(false);
    expect(editorApi.setHighlight('moss')).toBe(false);
  });

  it('page-style helpers fall back to defaults without an editor', () => {
    expect(getPageStyle()).toBe(DEFAULT_PAGE_STYLE);
    expect(getLineHeight()).toBe(DEFAULT_LINE_HEIGHT_PX);
    expect(setPageStyle('grid')).toBe(false);
    expect(setLineHeight(40)).toBe(false);
  });
});

/* ------------------------------- stickers -------------------------------- */

describe('procedural stickers', () => {
  it('renders deterministic markup for every sticker', () => {
    expect(STICKER_IDS).toHaveLength(50);
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
