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
  // `toggle` is the script's name for TipTap's disclosure element, which is
  // called `details` everywhere else — the node, the CSS and the slash
  // command all predate the container name. Same block, one spelling.
  toggle: "[data-type='details']",
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
    // Two, and both are named rather than being an escape hatch:
    //   `image-row` — the bridge sorts its children into `image` nodes before
    //                 it builds the row, so it has an arm of its own rather
    //                 than a name in the straight-through table;
    //   `toggle`    — maps to TipTap's `details`, and to its `detailsSummary`
    //                 and `detailsContent` as well. One container name, three
    //                 nodes, so it cannot be a one-to-one entry either.
    expect(missing.slice().sort()).toEqual(['image-row', 'toggle']);
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
  /**
   * Comments stripped, because the registry explains itself at length and a
   * name in prose must not vouch for a command that inserts it.
   */
  const slash = readFileSync(join(SRC, 'editor', 'slash', 'registry.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/[^\n]*$/gm, ' ');
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

  /**
   * The call in `registry.ts` that actually inserts a container, for the two
   * that do not go through `wrapIn`.
   *
   * Both are commands of their own for a reason written down beside them:
   *   `columns` — `setColumns(n)` carries the block the caret was on into the
   *               first column and nests when the caret is already inside one,
   *               which is also the path the right-click menu takes, so three
   *               columns from the menu and three from `/` cannot drift;
   *   `toggle`  — TipTap's disclosure element, inserted by `setDetails()`. Same
   *               one spelling / one block note as `PAINTED_BY_ANOTHER_SELECTOR`
   *               above: the node is `details` everywhere but the script.
   * Everything else is `wrapIn('<name>')`, and naming these two here is the
   * point — an exception you can read beats a clause loose enough to swallow
   * the whole list.
   */
  const INSERTED_BY: Readonly<Record<string, RegExp>> = {
    columns: /\.setColumns\(\s*\d+\s*\)/,
    toggle: /\.setDetails\(\s*\)/,
  };

  /**
   * WHY THIS IS NOT A `.includes` CHAIN ANY MORE.
   *
   * It used to end in `slash.includes(`'${name}'`)` — the name in quotes,
   * anywhere in the file. Every entry in the registry carries `id: 'postcard'`
   * and `keywords: ['postcard', …]`, so that last clause matched every
   * container unconditionally and the three meaningful clauses above it were
   * unreachable. Change `wrapIn('postcard')` to `wrapIn('paragraph')` — `/postcard`
   * then inserts a bare paragraph, the keepsake is gone from the app — and all
   * 93 specs in this file stayed green, plus 84 others.
   *
   * So the assertion is now the INSERTING CALL, named per container. A command
   * that still lists postcard in its keywords while wrapping something else is
   * exactly the defect, and it now reads as one.
   */
  it.each(INSERTABLE.map((name) => [name] as const))(
    '/%s is in the slash menu',
    (name) => {
      const call =
        INSERTED_BY[name] ??
        new RegExp(`\\.(?:wrapIn|setNode|insertContainer)\\('${name}'\\)`);
      expect(
        call.test(slash),
        `no slash command inserts ${name} — nothing in registry.ts matches ` +
          `${String(call)}. A title, an id and a keyword list mentioning ` +
          `${name} are what the reader SEARCHES; the call is what they get.`,
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
