/** JSON/SQLite representation shared by every Agent page authority digest. */
import type { PageDoc } from '../../data/types';

/**
 * TipTap exposes optional document attributes as `undefined`, while JSON and
 * SQLite omit those object keys. Hashing the live object directly therefore
 * invents a revision change that persistence cannot observe. This is the exact
 * storage boundary used by `pages.doc_json`.
 */
export function jsonStorageCanonicalPageDoc(doc: PageDoc): PageDoc {
  return JSON.parse(JSON.stringify(doc)) as PageDoc;
}
