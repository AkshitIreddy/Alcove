/**
 * Document node extended with page-level attributes.
 *
 * Per docs/design/block-editor.md §4: pageStyle lives as a Document-node
 * attribute so it serializes inside editor.getJSON() — the doc JSON IS the
 * storage format, no parallel model.
 */
import Document from '@tiptap/extension-document';
import { PAGE_STYLES } from '../data/types';
import type { PageDoc, PageStyle } from '../data/types';
import { normalizeStationerySplits } from './nodes/stationerySplit';
import {
  parsePageWritings,
  serializePageWritings,
} from './media/pageWritings';

/*
 * The ruling IDS live in `data/types.ts`, beside the `PageStyle` union the
 * settings blob is validated against; what each one is called and how good it
 * is lives in `./rulings.ts`; the lines themselves are drawn by
 * `styles/rulings.css`. A page's style is persisted in TWO shapes — a document
 * attribute inside the doc JSON, and `pageStyleDefault` in the settings row —
 * and a list of ids typed out on each side is how one of them ends up
 * accepting a ruling the other has never heard of.
 */
export { PAGE_STYLES };
export type EditorPageStyle = PageStyle;

export const DEFAULT_PAGE_STYLE: EditorPageStyle = 'ruled';
export const DEFAULT_LINE_HEIGHT_PX = 32;
export const DEFAULT_RULE_GAP_PX = 0;

/** Reader-controlled baseline offset from the printed rule, in pixels. */
export const RULE_GAP_MIN_PX = -12;
export const RULE_GAP_MAX_PX = 12;

/**
 * The line heights a reader may CHOOSE, in px — the bounds of both sliders
 * that offer them (the book studio's page-defaults row and the rail's page
 * style panel). Each panel used to carry its own pair, so widening the range
 * moved one slider and left the other short.
 *
 * Deliberately NARROWER than what `clampLineHeight` will accept below, and
 * that gap is not drift: the clamp is what a stored or imported document is
 * allowed to say, and it stays generous so a page written before these bounds
 * — or by hand — loads at the height it was authored at instead of being
 * quietly re-ruled. Offered range and accepted range are two facts.
 */
export const LINE_HEIGHT_MIN_PX = 26;
export const LINE_HEIGHT_MAX_PX = 40;

/** The widest a stored `lineHeightPx` may be before it is pulled back. */
const STORED_LINE_HEIGHT_MIN_PX = 24;
const STORED_LINE_HEIGHT_MAX_PX = 64;

export function isPageStyle(value: unknown): value is EditorPageStyle {
  return (
    typeof value === 'string' && (PAGE_STYLES as readonly string[]).includes(value)
  );
}

function clampLineHeight(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LINE_HEIGHT_PX;
  return Math.min(
    STORED_LINE_HEIGHT_MAX_PX,
    Math.max(STORED_LINE_HEIGHT_MIN_PX, Math.round(parsed)),
  );
}

export function clampRuleGapPx(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_RULE_GAP_PX;
  return Math.min(
    RULE_GAP_MAX_PX,
    Math.max(RULE_GAP_MIN_PX, Math.round(parsed)),
  );
}

export const NotebookDocument = Document.extend({
  addAttributes() {
    return {
      pageStyle: {
        default: DEFAULT_PAGE_STYLE,
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute('data-page-style');
          return isPageStyle(raw) ? raw : DEFAULT_PAGE_STYLE;
        },
        renderHTML: () => ({}),
      },
      lineHeightPx: {
        default: DEFAULT_LINE_HEIGHT_PX,
        parseHTML: (element: HTMLElement) =>
          clampLineHeight(element.getAttribute('data-line-height')),
        renderHTML: () => ({}),
      },
      // Undefined keeps old/default pages byte-clean; the live page reads it
      // as zero. A non-zero value is persisted in the document JSON with the
      // ruling it adjusts, rather than in a parallel settings store.
      ruleGapPx: {
        default: undefined,
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute('data-rule-gap');
          if (raw === null || raw === '') return undefined;
          const gap = clampRuleGapPx(raw);
          return gap === DEFAULT_RULE_GAP_PX ? undefined : gap;
        },
        renderHTML: () => ({}),
      },
      // Whole-page mouse writing uses the same normalized vector format as
      // image annotations. Undefined keeps untouched page JSON compact.
      mouseWritings: {
        default: undefined,
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute('data-mouse-writings');
          return serializePageWritings(parsePageWritings(raw)) ?? undefined;
        },
        renderHTML: () => ({}),
      },
    };
  },
});

/**
 * Make a stored PageDoc safe to load: the Document schema requires `block+`,
 * so an empty page (content: []) gets a starter paragraph, and missing attrs
 * fall back to defaults without mutating the input.
 */
export function normalizePageDoc(doc: PageDoc): PageDoc {
  const rawContent =
    Array.isArray(doc.content) && doc.content.length > 0
      ? doc.content
      : [{ type: 'paragraph' }];
  const content = normalizeStationerySplits(rawContent) as unknown[];
  return {
    ...doc,
    attrs: {
      pageStyle: DEFAULT_PAGE_STYLE,
      lineHeightPx: DEFAULT_LINE_HEIGHT_PX,
      ...(doc.attrs ?? {}),
    },
    content,
  };
}
