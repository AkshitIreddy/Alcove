/**
 * Highlighter styles (roadmap #15) — the Highlight mark extended with a
 * `hlStyle` attribute so a highlight can render as:
 *   - 'marker'   the classic translucent watercolor sweep (default),
 *   - 'squiggle' a colored squiggle underline, no fill,
 *   - 'circle'   a hand-drawn circle scribble around the words.
 *
 * The attribute serializes as `data-style` on the <mark>; editor.css owns
 * the look per style (using the wash tint the data-color rules define).
 */
import Highlight from '@tiptap/extension-highlight';

export const HIGHLIGHT_STYLES = ['marker', 'squiggle', 'circle'] as const;
export type HighlightStyle = (typeof HIGHLIGHT_STYLES)[number];

export function isHighlightStyle(value: unknown): value is HighlightStyle {
  return (
    typeof value === 'string' &&
    (HIGHLIGHT_STYLES as readonly string[]).includes(value)
  );
}

export const NotebookHighlight = Highlight.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      hlStyle: {
        default: 'marker',
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute('data-style');
          return isHighlightStyle(raw) ? raw : 'marker';
        },
        renderHTML: (attributes: Record<string, unknown>) =>
          isHighlightStyle(attributes.hlStyle) && attributes.hlStyle !== 'marker'
            ? { 'data-style': attributes.hlStyle }
            : {},
      },
    };
  },
});

/**
 * Attribute payload for setHighlight() carrying a style. TipTap's typed
 * signature only knows `color`, but setMark passes arbitrary attributes
 * through — the cast is contained here.
 */
export function highlightAttrs(
  color: string,
  style: HighlightStyle,
): { color: string } {
  return { color, hlStyle: style } as unknown as { color: string };
}
