// @vitest-environment node
/**
 * tests/reader-controls.test.ts — the three things the reader asked to be in
 * charge of, pinned where they are decidable without a browser.
 *
 *   A. FOCUS AS A RANGE   (src/views/rail/focusLevels.ts)
 *   B. STICKERS ANYWHERE  (src/editor/effects/freePlacement.ts)
 *   C. ONE RIBBON CONTROL (src/views/rail/BookRail.tsx)
 *
 * A and B are pure modules and are tested as such. C is a wiring fact — one
 * rail button, not two — and the only honest mechanical form of that is a
 * source sweep, in the shape this tree already uses for `styles.test.ts` and
 * `top-left-exits.test.ts`: point at one line rather than at "somewhere in the
 * rail". The behaviour of all three was driven in the running app; this file
 * is what stops them drifting back.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FOCUS_LEVELS,
  FOCUS_RUNGS,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_REST,
  clampPan,
  clampZoom,
  focusRank,
  isFocusLevel,
  panRange,
  stepFocusLevel,
  stepZoom,
  zoomLabel,
} from '../src/views/rail/focusLevels';
import {
  FREE_EDGE_MARGIN_PCT,
  armEffect,
  armSticker,
  armedMark,
  armedStickerId,
  clampPlacePct,
  disarmMark,
  freeStickerNode,
  isArmedEffect,
  isFreeMarkJson,
  isFreeStickerJson,
  isStickerPlacement,
  pageMarkNode,
  pointToPagePct,
  splitFreeMarks,
} from '../src/editor/effects/freePlacement';
import {
  BLOCK_ONLY_REASONS,
  MARK_MAX_PCT,
  MARK_MIN_PCT,
  PLACEABLE_AXES,
  PLACEABLE_KEYS,
  clampMarkSize,
  isPlaceableKey,
  placeableAxis,
  resolveMark,
} from '../src/editor/effects/placeableEffects';
import { EFFECT_AXES } from '../src/editor/effects/vocabulary';

const SRC = join(import.meta.dirname, '..', 'src');
const read = (...parts: string[]): string =>
  readFileSync(join(SRC, ...parts), 'utf8');

/* ==========================================================================
   A. Focus is a range
   ========================================================================== */

describe('focus mode is a ladder the reader steps, not a switch', () => {
  it('has the four rungs, off first and one page last', () => {
    expect([...FOCUS_LEVELS]).toEqual(['off', 'spread', 'page', 'leaf']);
    expect(focusRank('off')).toBe(0);
    expect(focusRank('leaf')).toBe(FOCUS_LEVELS.length - 1);
    // Anything else reads as off, so a stale value can never wedge the view.
    expect(focusRank('nonsense' as never)).toBe(0);
    expect(isFocusLevel('page')).toBe(true);
    expect(isFocusLevel('PAGE')).toBe(false);
  });

  it('offers every rung above off on the dial, each with its own words', () => {
    expect(FOCUS_RUNGS.map((rung) => rung.id)).toEqual(
      FOCUS_LEVELS.filter((level) => level !== 'off'),
    );
    for (const rung of FOCUS_RUNGS) {
      expect(rung.name.length, rung.id).toBeGreaterThan(2);
      expect(rung.blurb.length, rung.id).toBeGreaterThan(8);
    }
    // Three different pictures, not one word three times.
    expect(new Set(FOCUS_RUNGS.map((r) => r.blurb)).size).toBe(FOCUS_RUNGS.length);
  });

  it('steps up and down and stops at both ends', () => {
    expect(stepFocusLevel('off', 1)).toBe('spread');
    expect(stepFocusLevel('spread', 1)).toBe('page');
    expect(stepFocusLevel('page', 1)).toBe('leaf');
    expect(stepFocusLevel('leaf', 1)).toBe('leaf');
  });

  it('never falls out of focus mode by stepping down', () => {
    // Leaving is the exit chip's job and Escape's. One keystroke too many on
    // `[` must not throw the reader all the way back to the desk.
    expect(stepFocusLevel('leaf', -1)).toBe('page');
    expect(stepFocusLevel('page', -1)).toBe('spread');
    expect(stepFocusLevel('spread', -1)).toBe('spread');
  });

  it('clamps the zoom to its range and snaps it so 100% is reachable', () => {
    expect(clampZoom(99)).toBe(ZOOM_MAX);
    expect(clampZoom(-4)).toBe(ZOOM_MIN);
    expect(clampZoom(Number.NaN)).toBe(ZOOM_REST);
    expect(clampZoom(1.0000001)).toBe(1);
    expect(zoomLabel(1.4)).toBe('140%');
    expect(zoomLabel(ZOOM_REST)).toBe('100%');
  });

  it('walks the zoom in even steps and lands exactly back on 100%', () => {
    let z = ZOOM_REST;
    for (let i = 0; i < 5; i += 1) z = stepZoom(z, 1);
    for (let i = 0; i < 5; i += 1) z = stepZoom(z, -1);
    expect(z).toBe(ZOOM_REST);
    // and it cannot be walked past either end
    let up = ZOOM_REST;
    for (let i = 0; i < 60; i += 1) up = stepZoom(up, 1);
    expect(up).toBe(ZOOM_MAX);
  });

  it('allows no pan at all until the book is bigger than the window', () => {
    // At 100% the book already fits; a pan there is only a way to lose it off
    // the edge of the screen.
    expect(panRange(ZOOM_REST, 1600)).toBe(0);
    expect(panRange(0.8, 1600)).toBe(0);
    expect(panRange(1.5, 1600)).toBe(400);
    expect(clampPan({ x: 999, y: -999 }, ZOOM_REST, { width: 1600, height: 900 })).toEqual({
      x: 0,
      y: 0,
    });
    expect(clampPan({ x: 999, y: -999 }, 1.5, { width: 1600, height: 900 })).toEqual({
      x: 400,
      y: -225,
    });
  });
});

describe('the focus range reaches the view', () => {
  const bookView = read('views', 'BookView.tsx');
  const reader = read('styles', 'reader.css');

  it('keeps `is-focus-mode` on the view, whatever the rung', () => {
    // The e2e suite and the tour both find focus mode by that class; the rung
    // is an extra fact, never a replacement.
    expect(bookView).toContain("'is-focus-mode': focusMode()");
    expect(bookView).toContain('data-focus-level={focusLevel()}');
  });

  it('zooms with a transform, never with the leaf box', () => {
    // focusLevels.ts explains why at length: growing the leaf's layout box
    // changes pageCapacityPx, which repaginates the reader's whole book.
    const rule = reader.slice(
      reader.indexOf('.nb-book-view.is-focus-mode .nb-spread-stage'),
    );
    const block = rule.slice(0, rule.indexOf('}'));
    expect(block).toContain('scale(var(--nb-focus-zoom, 1))');
    expect(block).not.toMatch(/\bheight:/);
    expect(block).not.toMatch(/\bwidth:/);
  });

  it('paints each rung from the level attribute, not from a second flag', () => {
    for (const rung of ['page', 'leaf']) {
      expect(reader, rung).toContain(`.nb-book-view[data-focus-level='${rung}']`);
    }
    expect(reader).toContain("[data-solo-leaf='left']");
    expect(reader).toContain("[data-solo-leaf='right']");
  });
});

/* ==========================================================================
   B. Stickers placed anywhere
   ========================================================================== */

describe('a free-placed sticker', () => {
  it('is clamped onto the page, never half over its edge', () => {
    expect(clampPlacePct(-40)).toBe(FREE_EDGE_MARGIN_PCT);
    expect(clampPlacePct(140)).toBe(100 - FREE_EDGE_MARGIN_PCT);
    expect(clampPlacePct('nope')).toBe(50);
    expect(clampPlacePct(33.333333)).toBe(33.3);
  });

  it('turns a pointer into a percentage of the leaf it landed on', () => {
    const rect = { left: 100, top: 50, width: 400, height: 800 };
    expect(pointToPagePct(rect, 300, 450)).toEqual({ x: 50, y: 50 });
    expect(pointToPagePct(rect, 100, 50)).toEqual({
      x: FREE_EDGE_MARGIN_PCT,
      y: FREE_EDGE_MARGIN_PCT,
    });
    // A degenerate rect must not produce NaN attributes in the stored doc.
    const flat = pointToPagePct({ left: 0, top: 0, width: 0, height: 0 }, 5, 5);
    expect(Number.isFinite(flat.x) && Number.isFinite(flat.y)).toBe(true);
  });

  it('builds a node the schema will take', () => {
    const node = freeStickerNode({ stickerId: 'bee', x: 61.27, y: -3 });
    expect(node.type).toBe('sticker');
    expect(node.attrs).toEqual({
      stickerId: 'bee',
      placement: 'free',
      x: 61.3,
      y: FREE_EDGE_MARGIN_PCT,
    });
    expect(isFreeStickerJson(node)).toBe(true);
    expect(isStickerPlacement('free')).toBe(true);
    expect(isStickerPlacement('somewhere')).toBe(false);
  });

  it('is not mistaken for an inline one', () => {
    expect(
      isFreeStickerJson({ type: 'sticker', attrs: { placement: 'inline' } }),
    ).toBe(false);
    // A sticker stored before free placement existed has no placement at all.
    expect(isFreeStickerJson({ type: 'sticker', attrs: { stickerId: 'star' } })).toBe(
      false,
    );
    expect(isFreeStickerJson({ type: 'paragraph' })).toBe(false);
    expect(isFreeStickerJson(null)).toBe(false);
  });
});

describe('the pagination contract: the blocks travel, the stickers stay', () => {
  const blocks = [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'one' },
        { type: 'sticker', attrs: { stickerId: 'cat', placement: 'free', x: 10, y: 20 } },
        { type: 'sticker', attrs: { stickerId: 'bee', placement: 'inline' } },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'sticker',
                  attrs: { stickerId: 'moon', placement: 'free', x: 80, y: 5 },
                },
              ],
            },
          ],
        },
      ],
    },
  ];

  it('lifts every free sticker out, at any depth, in document order', () => {
    const { freed } = splitFreeMarks(blocks);
    expect(freed.map((node) => (node.attrs as { stickerId: string }).stickerId)).toEqual(
      ['cat', 'moon'],
    );
  });

  it('leaves the inline ones exactly where they are', () => {
    const { kept } = splitFreeMarks(blocks);
    const first = kept[0] as { content: { type: string; attrs?: { stickerId?: string } }[] };
    expect(first.content.map((n) => n.type)).toEqual(['text', 'sticker']);
    expect(first.content[1]?.attrs?.stickerId).toBe('bee');
  });

  it('keeps a block that held nothing but a free sticker', () => {
    // Silently deleting a block the reader typed, during a page break, is
    // exactly the kind of thing nobody would ever find.
    const { kept } = splitFreeMarks(blocks);
    expect(kept).toHaveLength(2);
    expect((kept[1] as { type: string }).type).toBe('bulletList');
  });

  it('does not touch the callers JSON', () => {
    const snapshot = JSON.stringify(blocks);
    splitFreeMarks(blocks);
    expect(JSON.stringify(blocks)).toBe(snapshot);
  });

  it('is a no-op on blocks with nothing free in them', () => {
    const plain = [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }];
    const { kept, freed } = splitFreeMarks(plain);
    expect(freed).toEqual([]);
    expect(kept).toEqual(plain);
  });
});

describe('the armed mark', () => {
  it('holds one at a time and lets go', () => {
    expect(armedMark()).toBeNull();
    armSticker('star');
    expect(armedStickerId()).toBe('star');
    armSticker('bee');
    expect(armedStickerId()).toBe('bee');
    disarmMark();
    expect(armedMark()).toBeNull();
  });

  it('is ONE slot, so arming trim puts a half-armed sticker down', () => {
    armSticker('star');
    armEffect('tape', 'gaffer');
    // Two signals here would mean two things landing on one click.
    expect(armedStickerId()).toBeNull();
    expect(isArmedEffect('tape', 'gaffer')).toBe(true);
    expect(isArmedEffect('tape', 'masking')).toBe(false);
    armSticker('bee');
    expect(isArmedEffect('tape', 'gaffer')).toBe(false);
    disarmMark();
  });
});

describe('free placement is wired from the catalogue to the leaf', () => {
  it('anchors at the head of the page, which the drain cannot reach', () => {
    const bookView = read('views', 'BookView.tsx');
    // The whole contract rests on this: trailingOverflowCount removes trailing
    // blocks and always leaves one, so the first block is the safe berth.
    expect(bookView).toContain('freeAnchorPos');
    expect(bookView).toContain('node.isTextblock');
    // …and on the carry rescuing any that an earlier prepend pushed into the
    // tail. Both halves, or the rule is only true on a quiet page.
    expect(bookView).toContain('splitFreeMarks(blocks)');
    expect(bookView).toContain('anchorFreeMarks(pageId, freed)');
    expect(bookView).toContain("tr.setMeta('addToHistory', false)");
  });

  it('gives every leaf a layer for them and takes the press in capture', () => {
    const bookView = read('views', 'BookView.tsx');
    expect(bookView).toContain('nb-free-layer');
    expect(bookView).toContain("el.addEventListener('pointerdown', onDown, true)");
  });

  it('offers the choice on the sticker shelf and disarms when it closes', () => {
    const panel = read('views', 'rail', 'CataloguePanel.tsx');
    expect(panel).toContain('anywhere on the page');
    expect(panel).toContain('at the cursor');
    expect(panel).toContain('onCleanup(() => disarmMark())');
  });

  /**
   * The gap this half closes: the mode chips lived on the sticker shelf alone,
   * so tape, washi, frames and paper could only ever be an attribute on
   * whichever block the caret happened to be in.
   */
  it('offers the same choice on the trim shelf', () => {
    const panel = read('views', 'rail', 'CataloguePanel.tsx');
    expect(panel).toContain('hasPlacementModes');
    expect(panel).toContain("shelfId === 'stickers' || shelfId === 'trim'");
    // …and a trim tile has to ROUTE through the mode rather than going straight
    // to the block. `run: () => toggleEffect(spec)` is the old behaviour.
    expect(panel).toContain('run: () => runEffect(spec)');
    expect(panel).toContain('armEffect(spec.key, String(spec.value))');
  });

  it('places a trim mark from the same click the sticker uses', () => {
    const bookView = read('views', 'BookView.tsx');
    expect(bookView).toContain('placeArmedMark');
    expect(bookView).toContain('pageMarkNode({ fx: mark.fx, value: mark.value');
  });
});

/* ==========================================================================
   B2. Any effects, not just stickers
   ========================================================================== */

describe('which effects are marks, and which are things you do to a block', () => {
  it('classifies every axis exactly once, so a twelfth cannot slip through', () => {
    for (const axis of EFFECT_AXES) {
      const placeable = isPlaceableKey(axis.key);
      const blockOnly = BLOCK_ONLY_REASONS[axis.key] !== undefined;
      expect(
        placeable !== blockOnly,
        `axis ${axis.key} is in ${placeable && blockOnly ? 'both lists' : 'neither list'} — ` +
          'decide whether it has an extent of its own on bare paper',
      ).toBe(true);
    }
  });

  it('keeps the tint a property, because it paints nothing on its own', () => {
    // [data-color] sets --fx-light/--fx-base/--fx-deep and no pixels of its
    // own. Free-placing it would put an invisible box on the page.
    expect(isPlaceableKey('color')).toBe(false);
    expect(BLOCK_ONLY_REASONS.color).toContain('--fx-light');
    // The other three that describe something already there.
    expect(isPlaceableKey('shadow')).toBe(false);
    expect(isPlaceableKey('underline')).toBe(false);
    expect(isPlaceableKey('align')).toBe(false);
  });

  it('takes the four trim axes whole, rather than restating their values', () => {
    const byKey = new Map(EFFECT_AXES.map((axis) => [axis.key, axis]));
    for (const axis of PLACEABLE_AXES) {
      const source = byKey.get(axis.key);
      if (source === undefined) continue; // doodles, which have no block form
      expect(axis.label).toBe(source.label);
      expect(axis.values).toEqual(source.values.map((entry) => entry.value));
    }
    // …and the doodles, which exist ONLY as marks.
    expect([...PLACEABLE_KEYS]).toContain('doodle');
    expect(byKey.has('doodle')).toBe(false);
  });

  it('is total on the way in from SQLite', () => {
    expect(resolveMark('nonsense', 'nonsense').fx).toBe(PLACEABLE_AXES[0].key);
    expect(resolveMark('tape', 'nonsense').value).toBe(placeableAxis('tape')?.values[0]);
    expect(resolveMark('tape', 'gaffer')).toEqual({ fx: 'tape', value: 'gaffer' });
  });

  it('never sizes a mark to nothing or to more than the leaf', () => {
    expect(clampMarkSize(-40, 10)).toBe(MARK_MIN_PCT);
    expect(clampMarkSize(4000, 10)).toBe(MARK_MAX_PCT);
    expect(clampMarkSize('nope', 12)).toBe(12);
    expect(clampMarkSize(33.333333, 10)).toBe(33.3);
  });

  it('builds a mark node the schema will take, sized off its own axis', () => {
    const node = pageMarkNode({ fx: 'tape', value: 'gaffer', x: 61.27, y: -3 });
    expect(node.type).toBe('page-mark');
    const attrs = node.attrs as Record<string, number | string>;
    expect(attrs.fx).toBe('tape');
    expect(attrs.value).toBe('gaffer');
    expect(attrs.x).toBe(61.3);
    expect(attrs.y).toBe(FREE_EDGE_MARGIN_PCT);
    // A strip and a scrap are not the same size; handing both one number would
    // make one of them wrong on the very click that places it.
    expect(attrs.w).toBe(placeableAxis('tape')?.w);
    expect(attrs.h).toBe(placeableAxis('tape')?.h);
    expect(attrs.w).not.toBe(placeableAxis('paper')?.w);
    // The doodle's wobble is fixed HERE so a drag cannot re-roll the drawing.
    expect(typeof attrs.seed).toBe('number');
  });

  it('is carried off a reflowing page exactly like a sticker', () => {
    const mark = pageMarkNode({ fx: 'washi', value: 'top', x: 30, y: 40 });
    const blocks = [
      { type: 'paragraph', content: [{ type: 'text', text: 'one' }, mark] },
    ];
    expect(isFreeMarkJson(mark)).toBe(true);
    const { kept, freed } = splitFreeMarks(blocks);
    expect(freed).toHaveLength(1);
    expect((freed[0] as { type: string }).type).toBe('page-mark');
    const first = kept[0] as { content: { type: string }[] };
    expect(first.content.map((n) => n.type)).toEqual(['text']);
  });

  it('needs no `placement: free`, because there is no inline page mark', () => {
    // A sticker has to say so — the same node is also the inline one. A page
    // mark is free by construction, and demanding the flag would have made
    // every stored mark invisible to the carry.
    expect(isFreeMarkJson({ type: 'page-mark', attrs: { fx: 'tape' } })).toBe(true);
    expect(isFreeStickerJson({ type: 'page-mark', attrs: { fx: 'tape' } })).toBe(false);
    expect(isFreeMarkJson({ type: 'paragraph' })).toBe(false);
  });
});

/* ==========================================================================
   C. One ribbon control
   ========================================================================== */

describe('the bookmark button and the ribbons are one control', () => {
  const rail = read('views', 'rail', 'BookRail.tsx');

  it('has no separate ribbon tool left in the rail', () => {
    expect(rail).not.toContain("id: 'ribbon-style'");
    const tools = [...rail.matchAll(/^\s*id: '([a-z-]+)',$/gm)].map((m) => m[1]);
    expect(tools).toContain('bookmark');
    expect(tools.filter((id) => id === 'bookmark')).toHaveLength(1);
  });

  it('still marks the page in ONE press', () => {
    // The whole risk in merging was turning a one-press action into a menu.
    // The press toggles first and opens the plate second.
    const press = rail.slice(rail.indexOf('const pressBookmark'));
    const body = press.slice(0, press.indexOf('\n  };'));
    expect(body).toContain('props.onToggleBookmark()');
    expect(body).toContain('openPlateFrom(button)');
    expect(body).toContain('if (wasMarked) closePlate()');
  });

  it('offers the whole set of ribbons, and the way into the drawer', () => {
    expect(rail).toContain('RIBBON_COLORS');
    expect(rail).toContain('onPickBookmarkSlot');
    expect(rail).toContain('onOpenDrawer');
    // A right-click reaches the ribbons of a page that is already marked
    // without un-marking it on the way in.
    expect(rail).toContain('onContextMenu');
  });

  it('hands the pick up to the view rather than guessing a slot', () => {
    const bookView = read('views', 'BookView.tsx');
    expect(bookView).toContain('onPickBookmarkSlot');
    expect(bookView).toContain('bookmarkSlot={activeMark()?.color ?? null}');
  });
});
