/**
 * src/flip/paperTone.ts — what colour the paper is RIGHT NOW.
 *
 * THE BUG THIS EXISTS FOR (reader: "when turning the page the colour of page
 * changes before going back to original colour").
 *
 * Three places in this folder wrote the parchment cream `#f7f1e3` as a
 * literal: the snapshot canvas's background fill (rasterCache, offscreenPages)
 * and the shader constant a transparent texel — or a missing snapshot —
 * composites over (curl). But `--paper-cream` is a THEME TOKEN and
 * `settings.css` remaps it in three of the app's four themes:
 *
 *     parchment  #f7f1e3   (tokens.css, the default — the literal was right)
 *     pastel     #f9eff2
 *     botanical  #f0f2e0
 *     night      #2b211a   (a dark brown; the literal is 200 levels out)
 *
 * So on any theme but the default, the moment the GL overlay went up the page
 * turned parchment and the landing put it back. Measured, not guessed:
 * `shots-now/flip-paper-tone.mjs` freezes the curl and reads the leaf's modal
 * colour — pastel reported #f9eff2 at rest and #f7f1e3 mid-turn.
 *
 * Everything in the flip that needs to know what colour blank paper is asks
 * here instead, and here reads the live token.
 *
 * ## Why it is cached, and when the cache is dropped
 *
 * `getComputedStyle` can force a style recalculation, and the curl renders
 * every frame of a turn — so the value is read once and held. `refresh()` is
 * the ONLY thing that re-reads, and the flip calls it at the two moments the
 * tone can have changed without anyone drawing: when a flip begins, and when a
 * capture starts. A theme swap between those is picked up by the next one.
 *
 * ## Why the default is still a literal
 *
 * `paperCreamRgb()` has to answer during module init, in a node test with no
 * `document`, and on the frame a context is restored. Every one of those wants
 * a number rather than a throw, and the honest number is the token's own
 * default. It is the FALLBACK, not the value.
 */

/** tokens.css `--paper-cream` — the parchment theme's paper, and the fallback. */
export const DEFAULT_PAPER_CREAM_CSS = '#f7f1e3';

/** The same colour as 0-255 RGB. */
export const DEFAULT_PAPER_CREAM_RGB: readonly [number, number, number] = [247, 241, 227];

/** The CSS custom property every theme in settings.css remaps. */
const PAPER_CREAM_PROPERTY = '--paper-cream';

type Rgb = readonly [number, number, number];

interface Tone {
  readonly css: string;
  readonly rgb: Rgb;
  /** Cache-key fragment — see paperToneTag(). */
  readonly tag: string;
}

const DEFAULT_TONE: Tone = {
  css: DEFAULT_PAPER_CREAM_CSS,
  rgb: DEFAULT_PAPER_CREAM_RGB,
  tag: 'none|none|f7f1e3',
};

let cached: Tone | null = null;

/** A parsed colour: 0-255 channels plus 0-1 alpha (1 when none was given). */
export interface ParsedColour {
  readonly rgb: Rgb;
  readonly alpha: number;
}

/**
 * Parse the handful of forms a resolved colour can arrive in.
 *
 * A custom property comes back as AUTHORED (`#f9eff2`), while a computed
 * `background-color` comes back as `rgb(249, 239, 242)` or, once alpha is
 * involved, `rgba(249, 239, 242, 0.5)` / the modern `rgb(249 239 242 / 50%)`.
 * All of them are read here because all of them are asked for. Anything else
 * (a colour function, a keyword, an empty string) returns null and the caller
 * falls back rather than guessing.
 */
export function parseColour(raw: string): ParsedColour | null {
  const value = raw.trim().toLowerCase();
  if (value === '') return null;

  if (value.startsWith('#')) {
    const digits = value.slice(1);
    if (/^[0-9a-f]{3,4}$/.test(digits)) {
      const pair = (index: number): number => parseInt(digits[index] + digits[index], 16);
      return {
        rgb: [pair(0), pair(1), pair(2)],
        alpha: digits.length === 4 ? pair(3) / 255 : 1,
      };
    }
    if (/^[0-9a-f]{6}$/.test(digits) || /^[0-9a-f]{8}$/.test(digits)) {
      const pair = (index: number): number => parseInt(digits.slice(index, index + 2), 16);
      return {
        rgb: [pair(0), pair(2), pair(4)],
        alpha: digits.length === 8 ? pair(6) / 255 : 1,
      };
    }
    return null;
  }

  const fn = /^rgba?\(([^)]+)\)$/.exec(value);
  if (fn === null) return null;
  const parts = fn[1]
    .replace(/\//g, ' ')
    .split(/[\s,]+/)
    .filter((part) => part !== '');
  if (parts.length < 3) return null;
  const channel = (part: string): number => {
    const asNumber = part.endsWith('%')
      ? (Number.parseFloat(part) / 100) * 255
      : Number.parseFloat(part);
    return Number.isFinite(asNumber) ? Math.max(0, Math.min(255, Math.round(asNumber))) : NaN;
  };
  const rgb: [number, number, number] = [channel(parts[0]), channel(parts[1]), channel(parts[2])];
  if (rgb.some(Number.isNaN)) return null;
  let alpha = 1;
  if (parts.length > 3) {
    const raw4 = parts[3];
    const parsed = raw4.endsWith('%')
      ? Number.parseFloat(raw4) / 100
      : Number.parseFloat(raw4);
    alpha = Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 1;
  }
  return { rgb, alpha };
}

/**
 * Read the paper off `<html>`; null when there is no document to read.
 *
 * The TAG carries more than the colour. A theme moves `--paper-cream`, so the
 * cream alone separates parchment from night — but `data-ink` repaints every
 * word on the page without touching the paper at all, and a snapshot taken in
 * sepia is just as stale under graphite. Both attributes go in, so the cache's
 * freshness check cannot be fooled by a look that kept the same ground.
 */
function readToken(): Tone | null {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return null;
  const root = document.documentElement;
  if (root === null) return null;
  let raw: string;
  try {
    raw = getComputedStyle(root).getPropertyValue(PAPER_CREAM_PROPERTY);
  } catch {
    return null;
  }
  const parsed = parseColour(raw);
  if (parsed === null) return null;
  const css = raw.trim();
  const theme = root.getAttribute('data-theme') ?? 'none';
  const ink = root.getAttribute('data-ink') ?? 'none';
  return { css, rgb: parsed.rgb, tag: `${theme}|${ink}|${css}` };
}

/** Re-read the token. Call when the tone may have moved and nothing is drawing. */
export function refreshPaperTone(): void {
  cached = readToken();
}

function tone(): Tone {
  cached ??= readToken();
  return cached ?? DEFAULT_TONE;
}

/** The live paper colour as a CSS string (what html-to-image is handed). */
export function paperCreamCss(): string {
  return tone().css;
}

/** The live paper colour as 0-255 RGB (what the shader is compiled with). */
export function paperCreamRgb(): Rgb {
  return tone().rgb;
}

/**
 * A cache-key fragment for the current look: `theme|ink|paper`.
 *
 * CLAUDE.md's rule about baked pixels applies to page snapshots exactly as it
 * does to shelf art: the theme is an axis of variation in what a capture
 * contains, so a cached bitmap taken under one theme must not be served under
 * another. `PageRasterCache` stamps every entry with this and refuses a hit
 * that does not match — otherwise a reader who changes theme keeps turning
 * pages of the old one until they happen to edit something.
 *
 * `CurlRenderer` uses it for a different question — "do my shaders still have
 * the right cream baked in" — which is why it is a string rather than a colour.
 */
export function paperToneTag(): string {
  return tone().tag;
}

/**
 * The colour a snapshot of `element` should be backed with: the element's own
 * resolved background when it has an opaque one (the truest answer — it is
 * literally the paper being photographed), otherwise the live token.
 *
 * Only the parts of the canvas the clone does not cover ever show this, which
 * is the deckled top edge, the rounded corners and any pixel a failed image
 * placeholder leaves behind. Getting it wrong there is a rim of the wrong
 * colour round a turning page.
 */
export function snapshotBackground(element: Element | null): string {
  if (element !== null && typeof getComputedStyle === 'function') {
    try {
      const own = parseColour(getComputedStyle(element).backgroundColor);
      // Only an OPAQUE background is the paper. A transparent or partly
      // transparent one means the colour is coming from somewhere else, and
      // the token is a better answer than compositing something that is not
      // paper (a `rgba(0,0,0,0)` read straight would fill the canvas black).
      if (own !== null && own.alpha >= 0.999) {
        const [r, g, b] = own.rgb;
        return `rgb(${r}, ${g}, ${b})`;
      }
    } catch {
      // fall through to the token
    }
  }
  return paperCreamCss();
}
