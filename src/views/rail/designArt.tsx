/**
 * src/views/rail/designArt.tsx — every preview tile in the studio, drawn once
 * and kept.
 *
 * The rule the panels are built on: a picker card is painted by the SAME
 * routine that paints the thing it is picking — `drawCaseCard` for the case,
 * `drawWallpaperCard` for the wall, `drawBookSpine` for a binding. A card that
 * approximates its subject is worse than no card, because it teaches the
 * reader to distrust the panel; the room cards learned that the hard way when
 * the shelf went flat and they kept previewing a watercolour room.
 *
 * Two consequences shape this file.
 *
 * 1. **The scheme swap has to be synchronous.** `setFlatScheme` is module
 *    state in art/flat.ts, so a tile sets the room's palette, draws, and puts
 *    the previous one back with no `await` anywhere in between — otherwise a
 *    second tile baking on the same tick comes out in the wrong colours, and
 *    worse, a tile could repaint the room behind the panel.
 *
 * 2. **The cache key carries every axis.** These are drawn pixels, so the key
 *    has to hold the live scheme's tag AND the design's tag; a build swapped
 *    from plank to gothic under an unchanged room would otherwise serve the
 *    plank forever. Sixty shelf presets, fifty-five papers and sixty-two
 *    bindings is more tiles than a session needs at once, so the store is a
 *    small FIFO rather than an unbounded memo.
 */
import { createEffect, type JSX } from 'solid-js';
import {
  flatScheme,
  flatSchemeTag,
  setFlatScheme,
  type FlatCtx,
  type FlatScheme,
} from '../../art/flat';

/** What a tile paints, in tile-local CSS px. The scheme is already live. */
export type TileDraw = (ctx: FlatCtx, w: number, h: number) => void;

export interface TileSpec {
  /**
   * Everything that varies about this drawing EXCEPT the scheme and the size,
   * which are added here. Include the design tag; a bare preset name is not
   * enough once two panels draw the same preset at different seeds.
   */
  key: string;
  w: number;
  h: number;
  dpr: number;
  scheme: FlatScheme;
  draw: TileDraw;
}

/**
 * Big enough for the LARGEST single picker, plus the strips behind it.
 *
 * This was 150, sized against "sixty shelf presets, fifty-five papers and
 * sixty-two bindings". Those are now 113, 126 and 189, so the biggest sheet on
 * its own overflowed the cache: scrolling a binding picker evicted tiles that
 * were still on screen and redrew them on the way back, which is the worst case
 * for a FIFO — every eviction is a guaranteed future miss.
 *
 * 240 covers the 189 and leaves room for the strips and a second axis opened
 * behind the sheet. A 110x76 tile at dpr 2 is ~270kB of backing store, so the
 * ceiling is about 65MB and the reason for having one at all is unchanged: an
 * unbounded memo over vocabularies this size is hundreds of megabytes of art
 * nobody is looking at.
 *
 * Sized from the tables rather than derived from them on purpose — importing
 * three vocabularies here to add up their lengths would give this module a
 * dependency on all of them to compute a number that only needs to be roughly
 * right.
 */
export const MAX_TILES = 240;

type Tile = OffscreenCanvas | HTMLCanvasElement;

const tiles = new Map<string, Tile | null>();

/** The tag `flatSchemeTag()` would return for a scheme that is not live yet. */
function tagOf(scheme: FlatScheme): string {
  const previous = flatScheme();
  setFlatScheme(scheme);
  const tag = flatSchemeTag();
  setFlatScheme(previous);
  return tag;
}

function makeCanvas(w: number, h: number): Tile | null {
  try {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    if (typeof document === 'undefined') return null;
    const el = document.createElement('canvas');
    el.width = w;
    el.height = h;
    return el;
  } catch {
    return null;
  }
}

/**
 * Draw one tile in a scheme OTHER than the strip's.
 *
 * Every picker paints its cards in the room the reader is standing in, which
 * is right for a carpentry or a paper — you are judging it against your own
 * timber. The ROOM picker is the one axis where that is backwards: sixty rooms
 * all painted in the current room's colours is sixty identical cards. This lets
 * one option carry its own palette, nested inside the swap `tileFor` already
 * does, so the restore still happens exactly once and in the right order.
 *
 * The caller must put the theme in its `artKey`; the cache key only knows the
 * scheme the STRIP was drawn under.
 */
export function drawInScheme(scheme: FlatScheme, draw: () => void): void {
  const previous = flatScheme();
  setFlatScheme(scheme);
  try {
    draw();
  } finally {
    setFlatScheme(previous);
  }
}

/**
 * The drawn tile, ready to `drawImage` straight into a card's canvas.
 *
 * Synchronous on purpose. An `ImageBitmap` would be a little cheaper to blit
 * but forces every caller into a promise, and a grid of sixty cards each
 * resolving on its own microtask is sixty frames of blank paper — the cards
 * are small and the flat renderer is fast, so the whole strip paints inside
 * one frame this way.
 */
export function tileFor(spec: TileSpec): Tile | null {
  const w = Math.max(1, Math.round(spec.w * spec.dpr));
  const h = Math.max(1, Math.round(spec.h * spec.dpr));
  const key = `${tagOf(spec.scheme)}|${spec.key}|${w}x${h}`;
  const hit = tiles.get(key);
  if (hit !== undefined) return hit;

  let tile: Tile | null = makeCanvas(w, h);
  if (tile !== null) {
    const ctx = (tile as OffscreenCanvas).getContext('2d') as FlatCtx | null;
    if (ctx === null) {
      tile = null;
    } else {
      ctx.scale(spec.dpr, spec.dpr);
      const previous = flatScheme();
      setFlatScheme(spec.scheme);
      try {
        spec.draw(ctx, spec.w, spec.h);
      } catch {
        // A drawing that throws must not take the studio down with it; the
        // card comes out blank and everything else on the sheet still works.
        tile = null;
      } finally {
        setFlatScheme(previous);
      }
    }
  }

  tiles.set(key, tile);
  if (tiles.size > MAX_TILES) {
    const oldest = tiles.keys().next();
    if (oldest.done !== true) tiles.delete(oldest.value);
  }
  return tile;
}

/* ------------------------------ the component ---------------------------- */

export interface DesignCanvasProps {
  key: string;
  w: number;
  h: number;
  scheme: FlatScheme;
  draw: TileDraw;
  class?: string;
  /** Cards are labelled by their own text, so the art is decoration. */
  alt?: string;
}

/**
 * A canvas that shows one cached tile. Every picker card, strip swatch and
 * live preview in the studio is one of these, so there is exactly one place
 * that knows how tiles are keyed and blitted.
 */
export function DesignCanvas(props: DesignCanvasProps): JSX.Element {
  let el: HTMLCanvasElement | undefined;

  createEffect(() => {
    const canvas = el;
    if (!canvas) return;
    const dpr = Math.min(2, (typeof window === 'undefined' ? 1 : window.devicePixelRatio) || 1);
    const tile = tileFor({
      key: props.key,
      w: props.w,
      h: props.h,
      dpr,
      scheme: props.scheme,
      draw: props.draw,
    });
    canvas.width = Math.max(1, Math.round(props.w * dpr));
    canvas.height = Math.max(1, Math.round(props.h * dpr));
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (tile !== null) ctx.drawImage(tile, 0, 0, canvas.width, canvas.height);
  });

  return (
    <canvas
      ref={(node) => (el = node)}
      class={props.class}
      width={props.w}
      height={props.h}
      style={{ 'aspect-ratio': `${props.w} / ${props.h}` }}
      role={props.alt === undefined ? undefined : 'img'}
      aria-label={props.alt}
      aria-hidden={props.alt === undefined ? 'true' : undefined}
    />
  );
}
