/**
 * src/diagrams/measure.ts — text measurement WITHOUT DOM reflow.
 *
 * Uses a single shared off-screen canvas 2D context (`measureText`) when a
 * canvas is available (WebView2 always). In Node (tests) it degrades to a
 * deterministic per-character heuristic so layouts stay pure + testable.
 */

export type TextMeasurer = (text: string, font: string) => number;

let sharedCtx: CanvasRenderingContext2D | null | undefined;

function getCanvasContext(): CanvasRenderingContext2D | null {
  if (sharedCtx !== undefined) return sharedCtx;
  sharedCtx = null;
  if (typeof document !== 'undefined') {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 8;
      canvas.height = 8;
      sharedCtx = canvas.getContext('2d');
    } catch {
      sharedCtx = null;
    }
  }
  return sharedCtx;
}

/** Parse the px size out of a CSS font shorthand (default 14). */
function fontSizePx(font: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  return m ? Number(m[1]) : 14;
}

/**
 * Deterministic fallback: approximate advance widths per character class.
 * Tuned loosely for Architects Daughter / Patrick Hand at 1em.
 */
export function heuristicMeasure(text: string, font: string): number {
  const size = fontSizePx(font);
  let units = 0;
  for (const ch of text) {
    if (ch === ' ') units += 0.34;
    else if ('iIljtf.,:;!|\'"'.includes(ch)) units += 0.32;
    else if ('mwMW@'.includes(ch)) units += 0.92;
    else if (ch >= 'A' && ch <= 'Z') units += 0.72;
    else if (ch >= '0' && ch <= '9') units += 0.58;
    else units += 0.55;
  }
  return units * size;
}

/**
 * The app-wide text measurer: canvas measureText when possible, heuristic
 * otherwise. Same signature either way so layouts can inject their own.
 */
export const measureText: TextMeasurer = (text, font) => {
  const ctx = getCanvasContext();
  if (ctx !== null) {
    ctx.font = font;
    return ctx.measureText(text).width;
  }
  return heuristicMeasure(text, font);
};

/**
 * Greedy word-wrap `text` to `maxWidth` px. Overlong single words are kept
 * whole (SVG text just runs a little wide — never throws, never loops).
 */
export function wrapText(
  text: string,
  maxWidth: number,
  font: string,
  measure: TextMeasurer = measureText,
): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (current !== '' && measure(candidate, font) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}
