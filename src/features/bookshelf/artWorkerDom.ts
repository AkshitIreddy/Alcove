/**
 * features/bookshelf/artWorkerDom.ts — the two lines of DOM the art code needs.
 *
 * Imported for its side effect, FIRST, by `artWorker.ts`.
 *
 * Almost all of `src/art` is already worker-clean: every canvas factory in
 * there checks `typeof OffscreenCanvas !== 'undefined'` before reaching for the
 * document. One does not — `brush.drawSurface` allocates its scratch canvas
 * with a bare `document.createElement('canvas')` — and because that function is
 * how every painted surface reaches a 2D context, a worker without a
 * `document` cannot paint a single spine, plank or leaf. The failure is total
 * and silent: the job throws, the host falls back, and the main thread quietly
 * does all the work it was supposed to have been spared.
 *
 * Rather than reach into `src/art` (owned elsewhere) this installs the
 * smallest possible stand-in: a `document` whose only trick is handing back an
 * `OffscreenCanvas` when asked for a `<canvas>`. An OffscreenCanvas already
 * satisfies everything `drawSurface` does with the element — settable
 * `width`/`height`, `getContext('2d')`, and being a valid `drawImage` source —
 * so the art code cannot tell the difference.
 *
 * Deliberately NOT a general DOM shim. Anything else the art code might one
 * day ask the document for should fail loudly here rather than silently
 * returning a stub that paints nothing.
 */

interface MinimalDocument {
  createElement(tag: string): OffscreenCanvas;
  readonly fonts?: FontFaceSet;
}

const g = globalThis as unknown as { document?: MinimalDocument; OffscreenCanvas?: unknown };

/** True when the shim was needed and installed (surfaced in the ready message). */
export const domShimInstalled = ((): boolean => {
  if (g.document !== undefined) return false;
  if (typeof OffscreenCanvas === 'undefined') return false;
  g.document = {
    createElement(tag: string): OffscreenCanvas {
      if (tag.toLowerCase() !== 'canvas') {
        throw new Error(`artWorkerDom: no <${tag}> in a worker — only <canvas> is shimmed`);
      }
      // 1×1 because every caller sets width/height immediately; allocating the
      // real size here would double the allocation for no benefit.
      return new OffscreenCanvas(1, 1);
    },
    get fonts(): FontFaceSet | undefined {
      return (globalThis as unknown as { fonts?: FontFaceSet }).fonts;
    },
  };
  return true;
})();
