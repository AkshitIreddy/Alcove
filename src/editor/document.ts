/**
 * Document node extended with page-level attributes.
 *
 * Per docs/design/block-editor.md §4: pageStyle lives as a Document-node
 * attribute so it serializes inside editor.getJSON() — the doc JSON IS the
 * storage format, no parallel model.
 */
import Document from '@tiptap/extension-document';
import type { PageDoc } from '../data/types';

export const PAGE_STYLES = ['ruled', 'grid', 'blank', 'dotted'] as const;
export type EditorPageStyle = (typeof PAGE_STYLES)[number];

export const DEFAULT_PAGE_STYLE: EditorPageStyle = 'ruled';
export const DEFAULT_LINE_HEIGHT_PX = 32;

export function isPageStyle(value: unknown): value is EditorPageStyle {
  return (
    typeof value === 'string' && (PAGE_STYLES as readonly string[]).includes(value)
  );
}

function clampLineHeight(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LINE_HEIGHT_PX;
  return Math.min(64, Math.max(24, Math.round(parsed)));
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
    };
  },
});

/**
 * Make a stored PageDoc safe to load: the Document schema requires `block+`,
 * so an empty page (content: []) gets a starter paragraph, and missing attrs
 * fall back to defaults without mutating the input.
 */
export function normalizePageDoc(doc: PageDoc): PageDoc {
  const content =
    Array.isArray(doc.content) && doc.content.length > 0
      ? doc.content
      : [{ type: 'paragraph' }];
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
