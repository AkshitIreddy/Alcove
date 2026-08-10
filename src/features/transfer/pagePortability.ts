/**
 * The page/document seam shared by the database-backed transfer runner and
 * pure bundle regressions. Kept separate from `library.ts` so it does not pull
 * the entire bookshelf/runtime graph into a no-DOM test.
 */
import type { Page, PageDoc } from '../../data/types';
import {
  collectPageAssetReferences,
  portablePageDocForExport,
  rebasePageAssetSources,
  type AssetSourceResolver,
} from '../../editor/media/portableAssets';
import { docToScript } from '../../editor/script/fromTiptap';
import type { PageSnapshot } from './scope';

interface DocNode {
  type?: unknown;
  text?: unknown;
  content?: unknown;
}

function nodeText(node: unknown): string {
  if (node === null || typeof node !== 'object') return '';
  const record = node as DocNode;
  if (typeof record.text === 'string') return record.text;
  if (!Array.isArray(record.content)) return '';
  return record.content.map(nodeText).join('');
}

/** First heading's text, else the first paragraph's, else "page N". */
export function pageTitleFromDoc(doc: PageDoc, index: number): string {
  const blocks = Array.isArray(doc.content) ? doc.content : [];
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue;
    if ((block as DocNode).type !== 'heading') continue;
    const text = nodeText(block).trim();
    if (text !== '') return text.slice(0, 80);
  }
  for (const block of blocks) {
    const text = nodeText(block).trim();
    if (text !== '') return text.slice(0, 60);
  }
  return `page ${index + 1}`;
}

/** Plain-text length of a document -- the "how full" hint in the tree. */
export function docCharCount(doc: PageDoc): number {
  return nodeText({ content: doc.content ?? [] }).length;
}

/**
 * Build one bundle page from its real stored model.
 *
 * Local image URLs are presentation state tied to this library root. Both
 * archive representations therefore use the portable document: lossless JSON
 * carries `assetRelPath` with an empty `src`, and Notebook Script carries the
 * same value as `{asset=...}`. A clean verbatim script is retained only when
 * the page has no library-owned image reference to canonicalize.
 */
export function pageSnapshotForTransfer(page: Page, index: number): PageSnapshot {
  const portable = portablePageDocForExport(page.doc);
  const references = collectPageAssetReferences(page.doc);
  const hasLocalAssets = portable.assetRelPaths.length > 0;
  return {
    id: page.id,
    bookId: page.bookId,
    ord: page.ord,
    title: pageTitleFromDoc(page.doc, index),
    script:
      page.scriptSource !== null && !page.sourceDirty && !hasLocalAssets
        ? page.scriptSource
        : docToScript(portable.doc),
    docJson: JSON.stringify(portable.doc),
    assetRelPaths: references.relPaths,
    customStickerNames: references.customStickerNames,
    chars: docCharCount(page.doc),
  };
}

/** Shared lossless/script import seam, exported for deterministic regression. */
export async function prepareImportedPageDoc(
  doc: PageDoc,
  resolve?: AssetSourceResolver,
): Promise<PageDoc> {
  return (await rebasePageAssetSources(doc, resolve)).doc;
}
