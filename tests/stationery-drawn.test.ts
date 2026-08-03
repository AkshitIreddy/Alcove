// @vitest-environment node
/**
 * tests/stationery-drawn.test.ts — a container that nobody paints.
 *
 * THE REGRESSION THIS EXISTS FOR. A rewrite of the page-vocabulary half of
 * `src/styles/effects.css` replaced the file's first thousand lines and took
 * the container-block section out with them. For four commits every sticky
 * note, polaroid, washi box, card, quote card, banner, index card, envelope,
 * stamp, tag and margin note in the app rendered as a bare unstyled `<div>`.
 *
 * Nothing failed. `tests/effects.test.ts` asserted the NODES exist and the
 * script round-trips through them, and all of that was still true: TipTap
 * wrote `data-type="index-card"` onto the block exactly as designed, the
 * slash menu inserted it, the printer printed it. There was simply no rule
 * anywhere that read the attribute — and an attribute nobody styles is not an
 * error in CSS, it is ordinary markup. The only evidence was looking at a
 * page.
 *
 * `tests/catalogue-reach.test.ts` already runs this argument for the effect
 * AXES ("everything the editor accepts, the stylesheet paints"). This is the
 * same argument for the CONTAINERS, which that file does not cover.
 *
 * Four links, one per direction a container can be lost in:
 *   1. every container name has a registered editor node;
 *   2. every container name is PAINTED by a selector in src/styles;
 *   3. every insertable container can be reached from the slash menu;
 *   4. every container the slash menu offers is on a catalogue shelf.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parse, print } from '../src/script';
import { CONTAINER_NAMES } from '../src/script/vocab';
import { CONTAINER_NODE_NAMES, scriptDocToTiptap } from '../src/editor/script/toTiptap';
import { tiptapToScriptDoc } from '../src/editor/script/fromTiptap';
import { BLOCK_EFFECT_TYPES } from '../src/editor/effects/blockEffects';

const SRC = join(import.meta.dirname, '..', 'src');

/**
 * `BLOCK_ID_TYPES` read out of the source rather than imported.
 *
 * `src/editor/extensions.ts` pulls in the media node views, which are
 * compiled Solid components and register delegated event roots against
 * `window` at import time. Reading the array literal keeps this suite in a
 * plain node environment; the shape it depends on is one `as const` array of
 * string literals, and a change to that shape fails loudly here.
 */
function blockIdTypes(): string[] {
  const source = readFileSync(join(SRC, 'editor', 'extensions.ts'), 'utf8');
  const body = /export const BLOCK_ID_TYPES = \[([\s\S]*?)\] as const;/.exec(source);
  if (body === null) throw new Error('BLOCK_ID_TYPES is no longer an `as const` array');
  return [...body[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

function stylesheets(): string {
  const dir = join(SRC, 'styles');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.css'))
    .map((name) => readFileSync(join(dir, name), 'utf8'))
    .join('\n');
}

/** Comments stripped, so the file header listing the names cannot vouch. */
function paintedCss(): string {
  return stylesheets().replace(/\/\*[\s\S]*?\*\//g, '\n');
}

/**
 * The containers that are NOT painted by a `[data-type=…]` rule, and why.
 *
 * `spoiler` is the one node in the set with a Solid node view, so it renders
 * `class="nb-spoiler"` and is styled by class. `col` has no rule of its own
 * beyond the one its parent gives it, and `columns`/`col` live in editor.css
 * beside the divider-drag geometry rather than here — both are checked by
 * name below instead of by attribute selector.
 */
const PAINTED_BY_ANOTHER_SELECTOR: Record<string, string> = {
  spoiler: '.nb-spoiler',
  columns: "[data-type='columns']",
  col: "[data-type='col']",
};

/** `image-row` and `callout` are node views with their own class names. */
const NODE_VIEW_CLASSES: Record<string, string> = {
  'image-row': '.nb-image-row',
  callout: '.nb-callout',
};

describe('every script container is a real, drawn, reachable block', () => {
  const css = paintedCss();

  it.each(CONTAINER_NAMES.map((name) => [name] as const))(
    '%s is painted by a selector in src/styles',
    (name) => {
      const selector =
        NODE_VIEW_CLASSES[name] ??
        PAINTED_BY_ANOTHER_SELECTOR[name] ??
        `[data-type='${name}']`;
      expect(
        css.includes(selector),
        `no rule anywhere in src/styles matches ${selector} — ` +
          `\`::: ${name}\` renders as an unstyled div`,
      ).toBe(true);
    },
  );

  it('has an editor node for every container name', () => {
    const nodes = new Set(Object.values(CONTAINER_NODE_NAMES));
    const missing = CONTAINER_NAMES.filter((name) => !nodes.has(name));
    // `image-row` alone: the bridge sorts its children into `image` nodes
    // before it builds the row, so it has an arm of its own rather than a
    // name in the straight-through table.
    expect(missing.slice().sort()).toEqual(['image-row']);
  });

  /**
   * The effects are the reason a container is worth having as a node rather
   * than as a class: `{rotate=-2}` and `{tape=corner}` must work on a
   * postcard exactly as they work on a paragraph. A node missing from
   * BLOCK_EFFECT_TYPES silently drops every one of them.
   */
  it('carries the block effects on every container that takes children', () => {
    // `col` is exempt on purpose: it is a slot inside `columns`, not a block
    // a reader decorates. Tilting one column of two is not a feature.
    const notEffected = Object.values(CONTAINER_NODE_NAMES)
      .filter((node) => node !== 'col')
      .filter((node) => !(BLOCK_EFFECT_TYPES as readonly string[]).includes(node));
    expect(notEffected).toEqual([]);
  });

  /**
   * Several containers seed their tilt from `node.attrs.id`. With no
   * UniqueID that attr is undefined, every block on the page hashes the same
   * string, and a column of pressed flowers all lie at the same angle.
   */
  it('gives every container a stable id to seed its tilt from', () => {
    const withId = blockIdTypes();
    const noId = Object.values(CONTAINER_NODE_NAMES).filter(
      (node) => !withId.includes(node),
    );
    expect(noId).toEqual([]);
  });
});

/**
 * The writing language, end to end and per container.
 *
 * `tests/effects.test.ts` round-trips two fixtures by hand, which proves the
 * bridge works and says nothing about the container added this morning. The
 * five keepsakes went in with a `title` attr that `fromTiptap` returned for
 * `card` only, so an index card's label — the whole point of a card you file —
 * was dropped on export and nothing failed. Every name, every time, is the
 * only version of this test that keeps up.
 */
describe('every container survives a round trip through the script', () => {
  /** `col` is only legal inside `columns`, so it is exercised through it. */
  const ROUNDTRIP = CONTAINER_NAMES.filter((name) => name !== 'col');

  it.each(ROUNDTRIP.map((name) => [name] as const))(
    '::: %s comes back as itself, with its attrs',
    (name) => {
      // Two containers do not hold prose: `columns` holds `col`, and
      // `image-row` holds images — a row with a paragraph in it is not a row,
      // and the bridge is right to let the paragraph through instead.
      const source =
        name === 'columns'
          ? '::: columns\n::: col\nleft\n:::\n::: col\nright\n:::\n:::\n'
          : name === 'image-row'
            ? '::: image-row {cols=2}\n![a](a.png)\n![b](b.png)\n:::\n'
            : `::: ${name} {color=moss, title=Kept, rotate=-2}\nWhat it held.\n:::\n`;

      const doc = parse(source);
      expect(doc.diagnostics.filter((d) => d.severity !== 'warn')).toEqual([]);

      const json = scriptDocToTiptap(doc);
      const restored = tiptapToScriptDoc(json);
      // The printer is canonical, so equal output IS a round trip — and it
      // catches a lost attr, which comparing node types alone would not.
      expect(print(restored)).toBe(print(doc));
    },
  );

  it('never throws on a container name that is only half written', () => {
    for (const name of CONTAINER_NAMES) {
      for (const junk of [`::: ${name}`, `::: ${name} {color=`, `::: ${name} {`]) {
        expect(() => print(parse(junk))).not.toThrow();
      }
    }
  });
});

/**
 * Reachability, the same argument catalogue-reach.test.ts makes for effects:
 * a block that exists, round-trips and draws beautifully is still not a
 * feature if the only way to insert it is to write the script by hand.
 *
 * Both files are read as TEXT rather than imported: `registry.ts` pulls in the
 * slash extension and `CataloguePanel.tsx` is a Solid component that reaches
 * for `window` at import time, and neither can load in a node environment.
 */
describe('a reader can reach the stationery without writing script', () => {
  const slash = readFileSync(join(SRC, 'editor', 'slash', 'registry.ts'), 'utf8');
  const catalogue = readFileSync(
    join(SRC, 'views', 'rail', 'CataloguePanel.tsx'),
    'utf8',
  );

  /**
   * The three that are reached some other way, on purpose:
   *   `col`       — never inserted alone; `columns` builds it and the
   *                 right-click menu changes how many there are;
   *   `callout`   — the catalogue offers the four variants as four tiles
   *                 (`callout-info`, …) rather than one "callout" you then
   *                 have to configure, so it has no SLASH_SHELF row;
   *   `image-row` — built by the image flow, from images the reader picked.
   */
  const INSERTABLE = CONTAINER_NAMES.filter(
    (name) => name !== 'col' && name !== 'callout' && name !== 'image-row',
  );

  it.each(INSERTABLE.map((name) => [name] as const))(
    '/%s is in the slash menu',
    (name) => {
      expect(
        slash.includes(`wrapIn('${name}')`) ||
          slash.includes(`setNode('${name}')`) ||
          slash.includes(`insertContainer('${name}')`) ||
          slash.includes(`'${name}'`),
        `no slash command inserts ${name}`,
      ).toBe(true);
    },
  );

  it.each(INSERTABLE.map((name) => [name] as const))(
    '%s is on a catalogue shelf',
    (name) => {
      const key = /^[a-z]+$/.test(name) ? name : `'${name}'`;
      expect(
        new RegExp(`^\\s*${key}:\\s*'`, 'm').test(catalogue),
        `${name} has no entry in CataloguePanel's SLASH_SHELF — it can be ` +
          'inserted by typing / but not found by browsing',
      ).toBe(true);
    },
  );
});
