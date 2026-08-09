/**
 * src/flip/rasterCache.ts — PageRasterCache: pre-rasterized page snapshots.
 *
 * The crux of the hybrid flip (design doc "SNAPSHOT PIPELINE"): pages are
 * captured to ImageBitmaps with html-to-image during idle time so that at
 * pointerdown the texture already exists and the GL overlay can appear the
 * same frame.
 *
 * - `toCanvas` with pixelRatio capped at 2 (1.5 when deviceMemory < 8).
 * - Font-embed CSS cached by the family stacks each page actually uses; this
 *   keeps later diagram/accent faces from inheriting the opening page's bundle.
 * - `includeStyleProperties` narrowed to the properties that can actually
 *   change a pixel — the single biggest cost in a capture (see
 *   snapshotStyleProperties below).
 * - `.snapshotting` class added to the captured root during the clone so CSS
 *   can hide caret/selection UI; a `filter` drops chrome elements (drag
 *   handles, style switcher, anything marked data-snapshot-hide) and images
 *   that cannot inline (still-resolving media) fall back to a transparent
 *   placeholder rather than rejecting the whole capture.
 * - Inline SVG (diagrams) gets its class-based paint inlined for the duration
 *   of the capture — html-to-image does not carry stylesheet rules into an
 *   SVG subtree and unstyled shapes render BLACK (see svgSnapshot.ts).
 * - Mounted leaves are deep-cloned into an inert offscreen stage before any
 *   snapshot-only mutation, so capturing never edits the visible page.
 * - Edit trigger: notifyEdited() debounces 300ms then rasterizes inside
 *   requestIdleCallback. ensureAdjacent() eagerly captures neighbours when
 *   a spread settles so both flip directions are instant.
 * - LRU cap 6 bitmaps; evicted/replaced bitmaps are close()d.
 * - Monotonic version stamps: invalidate()/notifyEdited() bump the page
 *   version; a flip may knowingly use a ≤300ms-stale frame (doc: accept
 *   stale — content is unreadable mid-flip and landings swap to live DOM).
 */

import { getFontEmbedCSS, toCanvas } from 'html-to-image';
import { LruMap, RASTER_CACHE_CAPACITY, snapshotPixelRatio } from './math';
import { paperToneTag, refreshPaperTone, snapshotBackground } from './paperTone';
import { inlineSvgStyles } from './svgSnapshot';
import { prepareSnapshotTableChrome } from './snapshotChrome';
import {
  freezeSnapshotBlockGeometry,
  freezeSnapshotListRows,
  freezeSnapshotNodeViewGeometry,
  measureSnapshotBlockGeometry,
} from './snapshotGeometry';

/** Debounce window between an edit and its idle re-rasterization. */
export const RASTER_DEBOUNCE_MS = 300;

/* -------------------------------------------------------------------------
   The snapshot recipe — what a captured page is allowed to contain
   -------------------------------------------------------------------------

   THE DRIFT THIS SECTION IS EXPORTED FOR. Three modules rasterize a page
   sheet through html-to-image: this cache (mounted leaves), `offscreenPages`
   (the adjacent spread, which is never in the DOM) and the exporter
   (`editor/script/exporters/capture.ts`). All three had typed out the same
   three facts by hand — the marker class, the chrome exclusion, the image
   placeholder — plus a byte-identical copy of the filter built from them.
   Nothing held them together, and they had already come apart:

     - the 1×1 PNG here carried `IEMD` where the other two carry `IEND`, with
       `IEND`'s checksum still attached — a stream no decoder is obliged to
       accept, in the one copy that sits on the flip's own path;
     - the exporter wrote the marker class as a bare `'snapshotting'` string,
       so a rename in `flip.css` would have missed it in silence while both
       named constants moved.

   These are not three policies that happen to agree. They are one policy — a
   snapshot shows paper, never chrome — and it has to hold, because an
   exported PNG and a mid-flip texture of the same page are meant to be the
   same picture. The recipe lives here because this is where it was invented
   and both other modules say so in their own headers.

   What is deliberately NOT shared: the pixel ratio (capped to device memory
   here, fixed at 2× for print there) and the background colour (the live
   theme's paper here, parchment there). Those two genuinely differ per
   caller, and merging them would be the opposite mistake. */

/** Marker class while capturing; flip.css hides caret/selection under it. */
export const SNAPSHOTTING_CLASS = 'snapshotting';

/** Elements never included in snapshots (interactive chrome, not paper). */
export const SNAPSHOT_EXCLUDE_SELECTOR =
  '.nb-style-switcher, .nb-page-full-hint, [data-snapshot-hide]';

/**
 * 1×1 transparent PNG — stand-in for images that fail to inline.
 *
 * `backgroundColor` fills the canvas with the paper tone before the clone is
 * drawn, so a placeholder normally lands on paper. It is still the one
 * deliberate source of alpha in a snapshot, and the curl shader treats any
 * transparent texel as cream (see samplePage in flip/curl.ts) — never as
 * black, which is what sampling premultiplied .rgb alone used to give.
 */
export const TRANSPARENT_PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABijPjAAAAAABJRU5ErkJggg==';

/**
 * Skip chrome and un-embeddable images. An `<img>` with an empty src (a
 * media node still resolving its asset) makes html-to-image's inline step
 * reject with a bare error Event. On the export path that loses the page; on
 * the flip path a rejected capture leaves NO cache entry, so beginFlip's
 * synchronous get() finds nothing and that face renders blank cream for the
 * whole gesture. Filtering it keeps every capture total.
 */
export function snapshotFilter(node: HTMLElement): boolean {
  if (
    node instanceof HTMLImageElement &&
    (node.getAttribute('src') ?? '') === ''
  ) {
    return false;
  }
  return (
    typeof node.matches !== 'function' ||
    !node.matches(SNAPSHOT_EXCLUDE_SELECTOR)
  );
}

/* -------------------------------------------------------------------------
   Font embedding — cache by the faces THIS page actually uses
   ------------------------------------------------------------------------- */

/**
 * `getFontEmbedCSS(root)` filters the document's @font-face rules down to the
 * families used under `root`. That makes caching its first answer forever
 * incorrect: the opening pages use Caveat + Patrick Hand, while a later
 * diagram, ledger or styled block can introduce Architects Daughter, Kalam,
 * Gochi Hand, Shadows Into Light, Lora, Crimson Pro or Nunito Sans. The old
 * one-promise caches in all three capture paths therefore photographed those
 * later faces with a system fallback. At the flat landing the real DOM put the
 * bundled face back, changing word widths and making ribbons/cards re-wrap.
 *
 * Cache by the computed family stacks present on this capture root instead —
 * including SVG labels and text emitted by `::before` / `::after` (which
 * html-to-image's own HTMLElement-only font walk cannot discover). Pages with
 * the same typography reuse the expensive embedded data URLs; pages that
 * introduce a face get the CSS for that face rather than inheriting whichever
 * page happened to rasterize first.
 */
const fontEmbedCssByUsage = new Map<string, Promise<string>>();

function fontUsageStacks(root: HTMLElement): string[] {
  if (typeof getComputedStyle !== 'function') return [];
  const stacks = new Set<string>();
  const elements: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const element of elements) {
    try {
      // Computed first: an inline `var(--font-label)` is not a usable @font-face
      // name, while the computed stack has already resolved that variable.
      const stack = getComputedStyle(element).fontFamily;
      if (stack.trim() !== '') stacks.add(stack.trim());
    } catch {
      // A detached/custom test double can have no computed style. The fallback
      // key still lets getFontEmbedCSS decide what it can inspect.
    }

    if (!(element instanceof HTMLElement)) continue;
    for (const pseudo of ['::before', '::after'] as const) {
      try {
        const style = getComputedStyle(element, pseudo);
        const content = style.content?.trim() ?? '';
        if (content === '' || content === 'none' || content === 'normal') continue;
        const stack = style.fontFamily;
        if (stack.trim() !== '') stacks.add(stack.trim());
      } catch {
        // Browsers without pseudo-style inspection simply fall back to the
        // regular element stacks. The capture remains usable, just less exact.
      }
    }
  }
  return [...stacks].sort();
}

function fontProbe(root: HTMLElement, stacks: readonly string[]): HTMLElement {
  const doc = root.ownerDocument;
  if (doc === null || doc === undefined || stacks.length === 0) return root;
  const probe = doc.createElement('div');
  for (const stack of stacks) {
    const sample = doc.createElement('span');
    sample.style.fontFamily = stack;
    sample.textContent = 'Aa';
    probe.appendChild(sample);
  }
  return probe;
}

export function pageFontEmbedCSS(root: HTMLElement): Promise<string> {
  const stacks = fontUsageStacks(root);
  const key = stacks.join('|') || '__default__';
  const cached = fontEmbedCssByUsage.get(key);
  if (cached !== undefined) return cached;
  const pending = getFontEmbedCSS(fontProbe(root, stacks)).catch((error) => {
    // Do not poison this typography for the rest of the session. A transient
    // asset failure may be gone by the next idle capture.
    fontEmbedCssByUsage.delete(key);
    console.warn('[rasterCache] font embedding failed', error);
    return '';
  });
  fontEmbedCssByUsage.set(key, pending);
  return pending;
}

/* -------------------------------------------------------------------------
   Which computed properties are worth copying onto the clone
   ------------------------------------------------------------------------- */

/**
 * Every property CSS inherits, plus the two html-to-image cannot work without.
 *
 * The derived list below is built by reading the app's own stylesheets, and a
 * scan of stylesheets is blind to exactly one thing: a value that reaches the
 * captured subtree by INHERITANCE from an inline style on an ancestor above
 * the snapshot root (`document.body.style.fontFamily = …`). Inherited
 * properties are a closed, specified set, so they are simply always kept
 * rather than guessed at. SVG's inherited paint is in here too — the `<svg>`
 * root element is cloned by html-to-image like any other element (only its
 * descendants are stranded, which is svgSnapshot.ts's problem).
 *
 * `content` is not inherited but must be present: html-to-image rebuilds
 * ::before/::after as a real stylesheet from this same list (its
 * clone-pseudos.ts), and without `content` every pseudo element in the
 * snapshot loses its glyph. `unicode-bidi` likewise pairs with `direction`.
 */
const ALWAYS_KEEP_PROPERTIES: readonly string[] = [
  'border-collapse',
  'border-spacing',
  'caption-side',
  'color',
  // Inherited, and it decides the UA's own default colours — a snapshot taken
  // under a dark scheme must not paint UA-default text on a light one.
  'color-scheme',
  'content',
  'cursor',
  'direction',
  'dominant-baseline',
  'empty-cells',
  'fill',
  'fill-opacity',
  'fill-rule',
  'font-family',
  'font-feature-settings',
  'font-kerning',
  'font-language-override',
  'font-optical-sizing',
  'font-palette',
  'font-size',
  'font-size-adjust',
  'font-stretch',
  'font-style',
  'font-synthesis-small-caps',
  'font-synthesis-style',
  'font-synthesis-weight',
  'font-variant',
  'font-variant-alternates',
  'font-variant-caps',
  'font-variant-east-asian',
  'font-variant-emoji',
  'font-variant-ligatures',
  'font-variant-numeric',
  'font-variant-position',
  'font-variation-settings',
  'font-weight',
  'hyphenate-character',
  'hyphenate-limit-chars',
  'hyphens',
  'image-orientation',
  'image-rendering',
  'letter-spacing',
  'line-break',
  'line-height',
  'list-style-image',
  'list-style-position',
  'list-style-type',
  'marker-end',
  'marker-mid',
  'marker-start',
  'orphans',
  'overflow-wrap',
  'paint-order',
  'print-color-adjust',
  'quotes',
  'shape-rendering',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'tab-size',
  'text-align',
  'text-align-last',
  'text-anchor',
  'text-combine-upright',
  'text-decoration-skip-ink',
  'text-emphasis-color',
  'text-emphasis-position',
  'text-emphasis-style',
  'text-indent',
  'text-justify',
  'text-orientation',
  'text-rendering',
  'text-shadow',
  'text-size-adjust',
  'text-transform',
  'text-underline-offset',
  'text-underline-position',
  'text-wrap-mode',
  'text-wrap-style',
  'unicode-bidi',
  'vector-effect',
  'visibility',
  'white-space-collapse',
  'widows',
  'word-break',
  'word-spacing',
  'writing-mode',
  // Chromium exposes inherited `border-spacing` under these two names only.
  '-webkit-border-horizontal-spacing',
  '-webkit-border-vertical-spacing',
  '-webkit-font-smoothing',
  '-webkit-line-break',
  '-webkit-rtl-ordering',
  '-webkit-text-fill-color',
  '-webkit-text-security',
  '-webkit-text-stroke-color',
  '-webkit-text-stroke-width',
];

/**
 * Below this many properties the derivation has clearly gone wrong (an empty
 * document, a stylesheet that parsed to nothing) and the full list is used.
 * A page's own CSS reaches well past 150 longhands.
 */
const MIN_PLAUSIBLE_PROPERTIES = 80;

let derivedStyleProperties: string[] | null | undefined;

/**
 * Every longhand any rule in any of the document's own stylesheets sets.
 *
 * Read out of the CSSOM rather than off the source text, so the ENGINE
 * expands the shorthands: `margin: 0` enumerates as margin-top/right/bottom/
 * left, `font:` as its fourteen longhands. A regex here would have to know
 * every shorthand in CSS and would be wrong the week a new one shipped.
 *
 * Returns null if any sheet refuses to be read (a cross-origin stylesheet
 * throws on `.cssRules`) — a partial scan is worse than no scan, because the
 * properties it missed are exactly the ones that would go unpainted.
 */
function collectAuthoredProperties(): Set<string> | null {
  const sheets: CSSStyleSheet[] = [
    ...Array.from(document.styleSheets),
    ...Array.from(document.adoptedStyleSheets ?? []),
  ];
  if (sheets.length === 0) return null;

  const authored = new Set<string>();
  const visit = (rules: CSSRuleList): void => {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i] as CSSRule & {
        style?: CSSStyleDeclaration;
        cssRules?: CSSRuleList;
      };
      const style = rule.style;
      if (style !== undefined) {
        for (let p = 0; p < style.length; p++) authored.add(style[p]);
      }
      // @media / @supports / @layer / @container / @keyframes all nest.
      if (rule.cssRules !== undefined) visit(rule.cssRules);
    }
  };

  for (const sheet of sheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      return null;
    }
    visit(rules);
  }
  return authored;
}

/**
 * The `includeStyleProperties` html-to-image should use, or undefined to let
 * it keep its own (full) list.
 *
 * WHY THIS EXISTS — measured with shots-now/flip-raster-perf.mjs on a
 * 58-element page: a capture cost ~205ms, and 120ms of that (63%) was
 * html-to-image's cloneCSSStyle. It has no property list of its own: it
 * enumerates `getComputedStyle(document.documentElement)` and copies EVERY
 * entry onto EVERY cloned element. On this engine that is 620 names, ~160 of
 * them our own `--token` custom properties, at three CSSOM calls each — 31k
 * setProperty + 31k getPropertyValue + 31k getPropertyPriority for one page.
 *
 * Nearly all of it cannot change a pixel. The clone is rasterized inside an
 * `<svg><foreignObject>` data URL — an isolated document where NONE of the
 * app's stylesheets apply — so a property the app's CSS never sets computes to
 * the same UA-initial value on both sides and copying it is pure cost. Custom
 * properties are pure cost too: cloneCSSStyle copies COMPUTED values, and by
 * then every `var()` has already been substituted.
 *
 * Two things need no entry here. Properties set INLINE on a captured element
 * survive on their own — html-to-image clones with `cloneNode()`, which copies
 * the style attribute verbatim (that is also why svgSnapshot.ts's inlining
 * works). And properties only ever set inside `<svg>` descendants are handled
 * by svgSnapshot.ts for the same reason.
 *
 * Fail-safe: an unreadable stylesheet or an implausibly short result returns
 * undefined and html-to-image keeps the full list. Slow beats wrong.
 *
 * ONE-SHOT AND GLOBAL — html-to-image caches the first list it is handed for
 * the lifetime of the page (`styleProps` in its util.ts), so whichever capture
 * site runs first decides for every other one. That is why this is exported:
 * offscreenPages.ts and editor/script/exporters/capture.ts should pass the
 * same array, or the winner of that race decides whether anyone is quick.
 */
export function snapshotStyleProperties(): string[] | undefined {
  if (derivedStyleProperties !== undefined) return derivedStyleProperties ?? undefined;
  derivedStyleProperties = null;
  try {
    const authored = collectAuthoredProperties();
    if (authored === null) return undefined;
    for (const name of ALWAYS_KEEP_PROPERTIES) authored.add(name);
    const wanted = [...authored].filter((name) => !name.startsWith('--'));

    // Keep an engine property when the app touches it, its family, or one of
    // its sub-longhands: the two vocabularies do not line up name for name
    // (a rule enumerates `background-position-x`, a computed style exposes
    // `background-position`), and a near miss there would drop paint.
    const keep = Array.from(getComputedStyle(document.documentElement)).filter(
      (name) =>
        !name.startsWith('--') &&
        wanted.some(
          (want) =>
            want === name || name.startsWith(`${want}-`) || want.startsWith(`${name}-`),
        ),
    );
    if (keep.length >= MIN_PLAUSIBLE_PROPERTIES) derivedStyleProperties = keep;
  } catch {
    derivedStyleProperties = null;
  }
  return derivedStyleProperties ?? undefined;
}

export interface RasterEntry {
  readonly bitmap: ImageBitmap;
  /** Page version at capture time (compare with `version()` for staleness). */
  readonly version: number;
  /**
   * `paperTone.paperToneTag()` at capture time.
   *
   * The theme is an axis of variation in these baked pixels — every colour on
   * the page comes from a token settings.css remaps — and a theme is applied
   * by writing `data-theme` on `<html>`, which is nowhere near the leaf the
   * host's MutationObserver watches. Without this in the entry, a reader who
   * changed theme kept turning pages of the old one until they happened to
   * edit something. CLAUDE.md's rule about cache keys, applied to the one
   * cache in this folder.
   */
  readonly tone: string;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

export interface PageRasterCacheOptions {
  /**
   * Resolve a pageId to its live snapshot root (the `.nb-sheet-paper` of a
   * mounted leaf). Return null for pages not currently in the DOM — those
   * go through `captureOffscreen` when provided, otherwise ensure()
   * resolves null and the flip falls back to plain paper (or an older
   * cached bitmap captured while the page was visible).
   */
  getElement(pageId: string): HTMLElement | null;
  /**
   * Rasterize a page that has no mounted leaf (the adjacent spread, which
   * is never in the DOM at rest). The flip's back and revealed faces come
   * from this path — without it they fall back to blank cream. The returned
   * bitmap enters the same LRU/version bookkeeping as a live capture;
   * ownership passes to the cache (it will be close()d on eviction).
   */
  captureOffscreen?(pageId: string): Promise<ImageBitmap | null>;
  /** LRU capacity override (default 6). */
  capacity?: number;
  /** pixelRatio override (default: device ratio capped per doc). */
  pixelRatio?: number;
}

function defaultPixelRatio(): number {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return snapshotPixelRatio(window.devicePixelRatio || 1, memory);
}

type IdleHandle = { cancel(): void };

/** requestIdleCallback with a setTimeout fallback (and cancellation). */
function whenIdle(fn: () => void): IdleHandle {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(() => fn(), { timeout: 1000 });
    return { cancel: () => cancelIdleCallback(id) };
  }
  const id = window.setTimeout(fn, 50);
  return { cancel: () => window.clearTimeout(id) };
}

export class PageRasterCache {
  private readonly entries: LruMap<string, RasterEntry>;
  private readonly versions = new Map<string, number>();
  private readonly inflight = new Map<string, Promise<RasterEntry | null>>();
  private readonly debounceTimers = new Map<string, number>();
  private readonly idleHandles = new Set<IdleHandle>();
  private readonly pixelRatio: number;
  private disposed = false;

  /** Idle captures deferred by suspend(), replayed on resume(). */
  private readonly deferred = new Set<string>();
  private suspended = false;

  constructor(private readonly options: PageRasterCacheOptions) {
    this.pixelRatio = options.pixelRatio ?? defaultPixelRatio();
    this.entries = new LruMap(options.capacity ?? RASTER_CACHE_CAPACITY, (_id, entry) =>
      entry.bitmap.close(),
    );
  }

  /** Current edit version of a page (0 until first invalidation). */
  version(pageId: string): number {
    return this.versions.get(pageId) ?? 0;
  }

  /** Cached bitmap, if any (marks it most-recently-used). May be stale. */
  get(pageId: string): RasterEntry | undefined {
    return this.entries.get(pageId);
  }

  /**
   * Cached bitmap WITHOUT touching LRU order — consumers that merely
   * observe (the thumbnails strip) must not evict flip-critical neighbours.
   */
  peek(pageId: string): RasterEntry | undefined {
    return this.entries.peek(pageId);
  }

  /**
   * Whether the cached bitmap matches the page's current version AND was taken
   * under the paper tone in force now (see RasterEntry.tone).
   */
  isFresh(pageId: string): boolean {
    const entry = this.entries.peek(pageId);
    return (
      entry !== undefined &&
      entry.version === this.version(pageId) &&
      entry.tone === paperToneTag()
    );
  }

  /**
   * Read-only scheduling state for the `?fx=force` flip bridge.
   *
   * Presence is not readiness: `get()` deliberately serves a stale bitmap
   * while an edited page is debouncing or being recaptured. Visual probes
   * need to know when a named set of faces is both fresh AND no cache job can
   * replace it on the next tick. Keeping this query on the owning instance
   * also avoids the dev-server duplicate-module trap described in
   * FlipSurface's QA bridge.
   */
  qaState(pageIds: ReadonlyArray<string | null>): {
    fresh: boolean;
    quiet: boolean;
    token: string;
  } {
    const ids = [...new Set(pageIds.filter((id): id is string => id !== null))];
    const busy = (set: ReadonlySet<string> | ReadonlyMap<string, unknown>): boolean =>
      ids.some((id) => set.has(id));
    const quiet =
      !this.disposed &&
      !busy(this.inflight) &&
      !busy(this.debounceTimers) &&
      !busy(this.deferred) &&
      this.idleHandles.size === 0;
    const token = ids
      .map((id) => {
        const entry = this.entries.peek(id);
        return `${id}:${this.version(id)}:${entry?.version ?? -1}:${entry?.tone ?? '-'}`;
      })
      .join('|');
    return {
      fresh: ids.every((id) => this.isFresh(id)),
      quiet,
      token,
    };
  }

  /**
   * Mark a page dirty without scheduling a capture (e.g. page deleted or
   * about to remount). The stale bitmap stays usable until re-captured.
   */
  invalidate(pageId: string): void {
    this.versions.set(pageId, this.version(pageId) + 1);
  }

  /** Drop a page's bitmap entirely (closes it). */
  drop(pageId: string): void {
    this.entries.delete(pageId);
  }

  /**
   * Edit trigger (doc policy): bump version, debounce 300ms, then rasterize
   * during idle time. Coalesces bursts of edits into one capture.
   */
  notifyEdited(pageId: string): void {
    if (this.disposed) return;
    this.invalidate(pageId);
    const existing = this.debounceTimers.get(pageId);
    if (existing !== undefined) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      this.debounceTimers.delete(pageId);
      this.captureWhenIdle(pageId);
    }, RASTER_DEBOUNCE_MS);
    this.debounceTimers.set(pageId, timer);
  }

  /**
   * Guarantee a bitmap exists (and is fresh) for `pageId`. Resolves the
   * cached entry when fresh, otherwise captures. Resolves null when the
   * page has no mounted element. Concurrent calls share one capture.
   */
  ensure(pageId: string): Promise<RasterEntry | null> {
    if (this.disposed) return Promise.resolve(null);
    if (this.isFresh(pageId)) return Promise.resolve(this.entries.get(pageId) ?? null);
    const pending = this.inflight.get(pageId);
    if (pending) return pending;
    const capture = this.capture(pageId).finally(() => this.inflight.delete(pageId));
    this.inflight.set(pageId, capture);
    return capture;
  }

  /**
   * Eagerly snapshot a settled spread and its neighbours (doc: the two pages
   * behind the right leaf and the two before the left leaf) so both flip
   * directions start instantly. Runs at idle; null/undefined ids are skipped.
   */
  ensureAdjacent(pageIds: ReadonlyArray<string | null | undefined>): void {
    if (this.disposed) return;
    for (const pageId of pageIds) {
      if (!pageId) continue;
      this.captureWhenIdle(pageId);
    }
  }

  /**
   * Hold every idle capture until resume(). A capture is 200ms+ of synchronous
   * main-thread work (clone the sheet, embed fonts, rasterize an SVG the size
   * of a page); one landing in the middle of a turn stalls the tween and
   * stretches the landing's rAFs, which is what made a click-turn stutter and
   * made the post-landing frame hang around long enough to read as a flicker.
   * Requested pages are remembered and captured once the overlay is down.
   */
  suspend(): void {
    this.suspended = true;
  }

  resume(): void {
    if (!this.suspended) return;
    this.suspended = false;
    if (this.disposed) return;
    const pending = [...this.deferred];
    this.deferred.clear();
    for (const pageId of pending) this.captureWhenIdle(pageId);
  }

  /** Cancel pending work and close every bitmap (call on book close). */
  dispose(): void {
    this.disposed = true;
    for (const timer of this.debounceTimers.values()) window.clearTimeout(timer);
    this.debounceTimers.clear();
    for (const handle of this.idleHandles) handle.cancel();
    this.idleHandles.clear();
    this.deferred.clear();
    this.entries.clear();
    this.versions.clear();
  }

  /* ------------------------------ internals ------------------------------ */

  /** Queue one idle capture, or park it until resume() when suspended. */
  private captureWhenIdle(pageId: string): void {
    if (this.disposed) return;
    if (this.suspended) {
      this.deferred.add(pageId);
      return;
    }
    const handle = whenIdle(() => {
      this.idleHandles.delete(handle);
      if (this.suspended) {
        this.deferred.add(pageId);
        return;
      }
      void this.ensure(pageId);
    });
    this.idleHandles.add(handle);
  }

  private async capture(pageId: string): Promise<RasterEntry | null> {
    /*
     * A MOUNTED PAGE IS ITS PRESENTATION, NOT MERELY ITS SAVED DOCUMENT.
     *
     * The old path rebuilt EVERY page in a second offscreen TipTap editor,
     * including the two leaves already mounted in front of the reader. That
     * loses transient node-view state and gives Chromium a second chance to
     * resolve margins, custom-block heights and font wrapping. At pointerdown
     * both live leaves were hidden and those reconstructed pixels took over,
     * which is why text on the stationary page visibly jumped in response to
     * turning the other page.
     *
     * Capture a DEEP CLONE of the exact rendered leaf instead. Snapshot chrome,
     * SVG paint and block geometry are changed only on that inert copy, so the
     * live editor is never touched and its current special-block state is what
     * the texture receives. Unmounted neighbour pages still use the staged
     * document path below because no presentation exists for them yet.
     *
     * This ordering is the prepare phase of the render transaction: a visible
     * source owns its pixels; reconstruction is only a declared fallback when
     * there is no visible source.
     */
    const element = this.options.getElement(pageId);
    if (
      element === null ||
      !element.isConnected ||
      element.clientWidth < 1 ||
      element.clientHeight < 1
    ) {
      return this.captureUnmounted(pageId);
    }
    const versionAtStart = this.version(pageId);
    // The theme can have changed since the last capture; re-read it now so the
    // canvas is backed with TODAY's paper and the entry is stamped with it.
    refreshPaperTone();
    const toneAtStart = paperToneTag();
    const background = snapshotBackground(element);
    const fontEmbedCSS = await pageFontEmbedCSS(element);

    const sourceStyle = getComputedStyle(element);
    const sourceRect = element.getBoundingClientRect();
    const width = Number.parseFloat(sourceStyle.width);
    const height = Number.parseFloat(sourceStyle.height);
    const cssWidth = Number.isFinite(width) && width > 1 ? width : element.clientWidth;
    const cssHeight = Number.isFinite(height) && height > 1 ? height : element.clientHeight;
    const clone = element.cloneNode(true) as HTMLElement;
    clone.style.setProperty('width', `${cssWidth}px`, 'important');
    clone.style.setProperty('height', `${cssHeight}px`, 'important');

    const stage = document.createElement('div');
    stage.setAttribute('aria-hidden', 'true');
    stage.dataset.nbSnapshotStage = 'mounted';
    stage.style.cssText =
      'position:fixed;left:-12000px;top:0;overflow:hidden;pointer-events:none;' +
      `width:${cssWidth}px;height:${cssHeight}px;`;
    stage.append(clone);
    (element.closest<HTMLElement>('.nb-spread') ?? document.body).append(stage);

    // Confirm the clone acquired real layout before committing its measured
    // block boxes. If an ancestor is tearing down, use the reconstructed path
    // rather than caching a zero-sized presentation.
    if (
      sourceRect.width < 1 ||
      sourceRect.height < 1 ||
      clone.getBoundingClientRect().width < 1 ||
      clone.getBoundingClientRect().height < 1
    ) {
      stage.remove();
      return this.captureUnmounted(pageId);
    }
    const blockGeometry = measureSnapshotBlockGeometry(clone);
    freezeSnapshotListRows(clone);
    freezeSnapshotNodeViewGeometry(clone);
    freezeSnapshotBlockGeometry(clone, blockGeometry);
    clone.classList.add(SNAPSHOTTING_CLASS);
    // Inline SVG loses class-based styling in html-to-image's clone and
    // renders BLACK; see svgSnapshot.ts.
    const restoreSvg = inlineSvgStyles(clone);
    const restoreTableChrome = prepareSnapshotTableChrome(clone);
    let canvas: HTMLCanvasElement | null = null;
    try {
      canvas = await toCanvas(clone, {
        pixelRatio: this.pixelRatio,
        backgroundColor: background,
        fontEmbedCSS,
        imagePlaceholder: TRANSPARENT_PX,
        filter: snapshotFilter,
        includeStyleProperties: snapshotStyleProperties(),
      });
    } catch (err) {
      // Snapshot failure → caller falls back (doc: CSS path). Warn rather
      // than swallow: a capture that keeps failing silently leaves the flip
      // with a blank face and no trace of why.
      console.warn('[rasterCache] snapshot capture failed for', pageId, err);
    } finally {
      restoreTableChrome();
      restoreSvg();
      stage.remove();
    }
    if (canvas === null) return this.captureUnmounted(pageId);
    if (this.disposed) return null;

    const bitmap = await createImageBitmap(canvas);
    if (this.disposed) {
      bitmap.close();
      return null;
    }
    const entry: RasterEntry = {
      bitmap,
      version: versionAtStart,
      tone: toneAtStart,
      width: canvas.width,
      height: canvas.height,
      pixelRatio: this.pixelRatio,
    };
    this.entries.set(pageId, entry);
    return entry;
  }

  /** Offscreen path for pages with no mounted leaf (see capture()). */
  private async captureUnmounted(pageId: string): Promise<RasterEntry | null> {
    const captureOffscreen = this.options.captureOffscreen;
    if (captureOffscreen === undefined) return null;
    const versionAtStart = this.version(pageId);
    refreshPaperTone();
    const toneAtStart = paperToneTag();
    let bitmap: ImageBitmap | null;
    try {
      bitmap = await captureOffscreen(pageId);
    } catch (err) {
      // Same reasoning as the mounted path: a silently failing neighbour
      // capture leaves the turning sheet's back face blank cream, which the
      // landing then replaces with real content — a visible flash with no
      // trace of why.
      console.warn('[rasterCache] offscreen staging failed for', pageId, err);
      return null;
    }
    if (bitmap === null) return null;
    if (this.disposed) {
      bitmap.close();
      return null;
    }
    const entry: RasterEntry = {
      bitmap,
      version: versionAtStart,
      tone: toneAtStart,
      width: bitmap.width,
      height: bitmap.height,
      pixelRatio: this.pixelRatio,
    };
    this.entries.set(pageId, entry);
    return entry;
  }
}
