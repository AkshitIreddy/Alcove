// @vitest-environment node
/**
 * tests/block-effect-coverage.test.ts — every block a reader can make can be
 * dressed.
 *
 * TODO carried "`blockEffects.BLOCK_EFFECT_TYPES` reached 27, not 50 — the
 * page-side agent was stopped mid-run", filed under "still short of fifty"
 * beside the vocabularies. That was a category error, and worth writing down
 * so nobody acts on it: `BLOCK_EFFECT_TYPES` is not a vocabulary. It is the
 * list of NODE TYPES the effect attributes are installed on — paragraph,
 * heading, table, callout, diagram. Growing it to fifty would mean inventing
 * twenty-nine block types nobody asked for. The fifty live on the OTHER axis:
 * the values (`src/editor/effects/vocabulary.ts`, 472 of them across eleven
 * axes), and `tests/catalogue-reach.test.ts` is what guards those.
 *
 * The property that actually matters here is COVERAGE: a block-level node the
 * editor offers but this list forgets accepts no tape, no paper, no frame and
 * no hand, and nothing anywhere says so — the attribute simply never gets
 * installed and the catalogue's chips do nothing on that one block. That is
 * the same silent-nothing failure the effects stack has now shipped three
 * times (the `color` axis, the whole lettering shelf, all fifty underlines).
 *
 * So: every custom node registered under src/editor/nodes must either be in
 * the list or be excluded for a stated structural reason.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BLOCK_EFFECT_TYPES } from '../src/editor/effects/blockEffects';

const NODES_DIR = join(import.meta.dirname, '..', 'src', 'editor', 'nodes');

/**
 * Nodes deliberately outside the effect surface, and why.
 *
 * Both are structural rather than editorial: an effect on either would be an
 * attribute the reader can set and never see.
 */
const NOT_A_DRESSABLE_BLOCK: Readonly<Record<string, string>> = {
  // `inline: true` — it flows inside a paragraph's text, so it has no box of
  // its own to tape, frame or stand on paper.
  sticker: 'inline node, not a block',
  // No `group` on purpose: a col may only live inside a columns node, and the
  // columns node itself is dressable. Dressing both would double every frame.
  col: 'may only live inside `columns`, which is itself dressable',
  // `inline: true` — the marker is one raised number inside a line of prose,
  // and its note is drawn by the page's footnote rail rather than by the node.
  // There is no box on either end to tape, frame or stand on paper.
  footnote: 'inline marker, not a block',
  // `inline: true` — maths inside a sentence, drawn in the run of the text.
  // The equation BLOCK (`math`) is dressable and is in the list.
  mathInline: 'inline maths, not a block',
};

/** Every node name registered under src/editor/nodes. */
function registeredNodes(): string[] {
  const names = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!['.ts', '.tsx'].includes(extname(entry.name))) continue;
      const src = readFileSync(full, 'utf8');
      for (const m of src.matchAll(/^\s{2}name: '([A-Za-z][\w-]*)',$/gm)) {
        if (m[1] !== undefined) names.add(m[1]);
      }
    }
  };
  walk(NODES_DIR);
  return [...names].sort();
}

describe('the effect attributes reach every dressable block', () => {
  const registered = registeredNodes();

  it('finds the nodes it is meant to be watching', () => {
    // A sweep that matches nothing passes forever. These four are the ones a
    // reader most obviously expects to dress; if the scrape stops seeing them,
    // this fails before the coverage check below reports a clean bill.
    expect(registered).toEqual(
      expect.arrayContaining(['callout', 'diagram', 'sticky-note', 'quote-card']),
    );
    expect(registered.length).toBeGreaterThan(10);
  });

  it('installs the attributes on every block-level custom node', () => {
    const listed = new Set<string>(BLOCK_EFFECT_TYPES);
    const missing = registered.filter(
      (name) => !listed.has(name) && NOT_A_DRESSABLE_BLOCK[name] === undefined,
    );
    expect(
      missing,
      'these nodes take no block effects, so the catalogue silently does ' +
        'nothing on them — add them to BLOCK_EFFECT_TYPES, or to ' +
        'NOT_A_DRESSABLE_BLOCK in this file with the structural reason',
    ).toEqual([]);
  });

  it('keeps the exclusions honest', () => {
    // An exclusion for a node that no longer exists is a comment pretending to
    // be a decision.
    for (const name of Object.keys(NOT_A_DRESSABLE_BLOCK)) {
      expect(registered, `${name} is excluded but is not a registered node`).toContain(name);
      expect(BLOCK_EFFECT_TYPES, `${name} is excluded AND listed`).not.toContain(name);
    }
  });
});
