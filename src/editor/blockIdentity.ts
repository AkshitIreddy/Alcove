/**
 * Stable block identity before a page reaches either renderer.
 *
 * TipTap's UniqueID extension is still responsible for blocks a reader creates
 * while editing. Stored and seeded documents are different: an adjacent page
 * can be mounted in the offscreen snapshot editor before its live PageEditor
 * ever exists. Letting those two editors independently mint random ids makes
 * id-seeded stationery (tags, stamps, pressed flowers, …) change its tilt at
 * the raster-to-DOM handoff.
 *
 * A book session therefore materializes every missing id once, from the page
 * id and the node's path, before either renderer can see the document. Existing
 * ids are preserved. The deterministic fallback also means a failed identity
 * persistence write cannot bring the mismatch back on the next open.
 */
import type { Page, PageDoc } from '../data/types';

/** Block-level types configured on TipTap's UniqueID extension. */
export const BLOCK_ID_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'codeBlock',
  'horizontalRule',
  'table',
  'details',
  'callout',
  'imageRow',
  'video',
  'sticky-note',
  'polaroid',
  'washi-box',
  'card',
  'quote-card',
  'banner',
  'spoiler',
  'columns',
  'col',
  // The rest of the stationery drawer and all of the keepsake drawer.
  // Several seed their tilt from `node.attrs.id`; omitting one here makes all
  // instances without an id hash the same empty seed.
  'index-card',
  'envelope',
  'stamp',
  'tag',
  'marginalia',
  'pressed-flower',
  'ticket-stub',
  'postcard',
  'ledger',
  'photo-corner',
  'wax-seal',
  'map-pin',
  // A tall graph may become several page viewports. Its first stable block id
  // is the continuation group's identity; every carried viewport derives its
  // own deterministic id from it.
  'diagram',
] as const;

const BLOCK_ID_TYPE_SET: ReadonlySet<string> = new Set(BLOCK_ID_TYPES);

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Small deterministic hash; collisions are resolved against the page set. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function generatedId(
  pageId: string,
  type: string,
  path: readonly number[],
  used: ReadonlySet<string>,
): string {
  const stem = `b_${fnv1a(`${pageId}\u0000${type}\u0000${path.join('.')}`)
    .toString(36)
    .padStart(7, '0')}`;
  if (!used.has(stem)) return stem;
  let suffix = 2;
  while (used.has(`${stem}_${suffix}`)) suffix += 1;
  return `${stem}_${suffix}`;
}

export interface MaterializedBlockIds {
  readonly doc: PageDoc;
  readonly changed: boolean;
}

/**
 * Fill missing/duplicate block ids without mutating the stored JSON.
 *
 * The path is deliberately positional only for the first materialization.
 * Once written, an id travels with its node through edits and pagination; a
 * later reorder never recomputes an existing id.
 */
export function materializeStableBlockIds(
  pageId: string,
  doc: PageDoc,
): MaterializedBlockIds {
  // Reserve every authored id before generating anything. Otherwise the
  // vanishingly rare case where an early path hash equals a later stored id
  // would make us rewrite the authored id instead of choosing another suffix
  // for the generated one.
  const unavailable = new Set<string>();
  const reserve = (value: unknown): void => {
    if (!isObject(value)) return;
    if (BLOCK_ID_TYPE_SET.has(typeof value.type === 'string' ? value.type : '')) {
      const attrs = isObject(value.attrs) ? value.attrs : null;
      if (typeof attrs?.id === 'string' && attrs.id.trim().length > 0) {
        unavailable.add(attrs.id);
      }
    }
    if (Array.isArray(value.content)) {
      for (const child of value.content) reserve(child);
    }
  };
  if (Array.isArray(doc.content)) {
    for (const node of doc.content) reserve(node);
  }

  const used = new Set<string>();

  const visit = (value: unknown, path: readonly number[]): unknown => {
    if (!isObject(value)) return value;

    const type = typeof value.type === 'string' ? value.type : '';
    const originalAttrs = isObject(value.attrs) ? value.attrs : null;
    let attrs = originalAttrs;
    let changed = false;

    if (BLOCK_ID_TYPE_SET.has(type)) {
      const current = originalAttrs?.id;
      const valid = typeof current === 'string' && current.trim().length > 0;
      if (valid && !used.has(current)) {
        used.add(current);
      } else {
        const id = generatedId(pageId, type, path, unavailable);
        unavailable.add(id);
        used.add(id);
        attrs = { ...(originalAttrs ?? {}), id };
        changed = true;
      }
    }

    const originalContent = Array.isArray(value.content) ? value.content : null;
    let content = value.content;
    if (originalContent !== null) {
      const next = originalContent.map((child, index) =>
        visit(child, [...path, index]),
      );
      if (next.some((child, index) => child !== originalContent[index])) {
        content = next;
        changed = true;
      }
    }

    if (!changed) return value;
    return {
      ...value,
      ...(attrs === null ? {} : { attrs }),
      ...(originalContent === null ? {} : { content }),
    };
  };

  const originalContent = Array.isArray(doc.content) ? doc.content : null;
  const content = originalContent?.map((node, index) => visit(node, [index]));
  const changed =
    originalContent !== null &&
    content!.some((node, index) => node !== originalContent[index]);
  return {
    doc: changed ? { ...doc, content: content as unknown[] } : doc,
    changed,
  };
}

export type PersistPageIdentity = (
  pageId: string,
  doc: PageDoc,
) => Promise<unknown>;

/**
 * Prepare a complete session and finish its identity writes before resolving.
 * A rejected write does not stop the book opening: deterministic ids produce
 * the same result next time, and the normal editor save will persist them once
 * that page is changed.
 */
export async function preparePageRenderDocs(
  pages: readonly Page[],
  persist: PersistPageIdentity,
): Promise<Page[]> {
  const writes: Promise<unknown>[] = [];
  const prepared = pages.map((page) => {
    const materialized = materializeStableBlockIds(page.id, page.doc);
    if (!materialized.changed) return page;
    writes.push(persist(page.id, materialized.doc));
    return { ...page, doc: materialized.doc };
  });
  await Promise.allSettled(writes);
  return prepared;
}

/** The offscreen renderer reads the same object the live leaf receives. */
export function pageDocForRendering(
  pages: readonly Page[],
  pageId: string,
): PageDoc | null {
  return pages.find((page) => page.id === pageId)?.doc ?? null;
}
