/**
 * Portable references for library-owned image and video assets.
 *
 * `src` is presentation state: Tauri's converted URL contains the currently
 * active library root and browser development uses a session-only blob URL.
 * Neither value is safe to put in a Notebook bundle. `assetRelPath` is the
 * durable identity, relative to the library's assets root, and is the value
 * that crosses export/import boundaries.
 *
 * The helpers in this file deliberately operate on loose PageDoc JSON rather
 * than ProseMirror nodes. That gives every path which handles a document --
 * reader hydration, lossless bundle import, and script-only import -- one
 * compatibility/migration contract before a schema sees the content.
 */
import type { PageDoc } from '../../data/types';
import {
  MISSING_ASSET_SRC,
  normalizeRelPath,
  resolveAssetSrc,
} from './resolver';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate and canonicalize a path relative to `<library>/assets`.
 *
 * This mirrors the archive writer's important safety rules instead of using
 * `normalizeRelPath` alone: that older helper intentionally drops `..`, which
 * is useful when joining trusted database rows but must not turn an authored
 * `../../outside.png` into an apparently safe bundle reference.
 */
export function normalizeAssetRelPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let raw = value.trim().replace(/\\/g, '/');
  if (raw === '') return null;

  // Be forgiving when a person writes the archive-shaped `assets/images/x`
  // form. The persisted contract is still relative to the assets root.
  raw = raw.replace(/^\.\//, '');
  if (raw.toLowerCase().startsWith('assets/')) raw = raw.slice('assets/'.length);

  if (
    raw === '' ||
    raw.startsWith('/') ||
    /^[a-zA-Z]:/.test(raw) ||
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(raw) ||
    raw.includes('\0')
  ) {
    return null;
  }
  const parts = raw.split('/');
  if (
    parts.some(
      (part) =>
        part === '' || part === '.' || part === '..' || part.includes(':'),
    )
  ) {
    return null;
  }
  const normalized = normalizeRelPath(raw);
  return normalized === '' ? null : normalized;
}

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function relPathAfterAssetsMarker(value: string): string | null {
  const normalized = decodePath(value).replace(/\\/g, '/');
  const lower = normalized.toLowerCase();
  const marker = '/assets/';
  const at = lower.lastIndexOf(marker);
  if (at < 0) return null;
  return normalizeAssetRelPath(normalized.slice(at + marker.length));
}

/**
 * Recover the durable path from pre-`assetRelPath` documents.
 *
 * Only URL families that can name a local file are considered. In
 * particular, `https://example.com/assets/photo.png` is intentionally NOT
 * claimed by the library merely because its pathname contains `/assets/`.
 */
export function inferAssetRelPathFromSrc(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const src = value.trim();
  if (src === '' || src.startsWith('data:') || src.startsWith('blob:')) {
    return null;
  }

  /*
   * Check Windows paths before `new URL`: the URL parser accepts `C:\\...`
   * and `D:/...` as custom `c:` / `d:` schemes. Returning from the URL branch
   * first made the raw-path compatibility arm below unreachable for the very
   * documents it was meant to migrate.
   */
  if (/^[a-zA-Z]:[\\/]/.test(src) || src.startsWith('\\\\')) {
    return relPathAfterAssetsMarker(src);
  }

  let url: URL | null = null;
  try {
    url = new URL(src);
  } catch {
    url = null;
  }

  if (url !== null) {
    const protocol = url.protocol.toLowerCase();
    const host = url.hostname.toLowerCase();
    const isTauriAssetHost =
      (protocol === 'http:' || protocol === 'https:') &&
      (host === 'asset.localhost' || host.endsWith('.asset.localhost'));
    const isLocalProtocol = protocol === 'asset:' || protocol === 'file:';
    if (!isTauriAssetHost && !isLocalProtocol) return null;

    const marked = relPathAfterAssetsMarker(`${url.hostname}${url.pathname}`);
    if (marked !== null) return marked;

    // Some early documents used the compact `asset://images/hash.png` form
    // rather than convertFileSrc's full absolute path.
    if (protocol === 'asset:' && host !== '' && host !== 'localhost') {
      return normalizeAssetRelPath(`${url.hostname}${url.pathname}`);
    }
    return null;
  }

  // Public relative URLs such as `/kittens/cat.svg` and normal web URLs must
  // remain ordinary media.
  return null;
}

/** The durable local reference carried by one media node, if it has one. */
export function assetRelPathForImageAttrs(
  attrs: Readonly<Record<string, unknown>>,
): string | null {
  return (
    normalizeAssetRelPath(attrs.assetRelPath) ??
    // `asset` is Notebook Script's friendly spelling. It can occur in loose
    // JSON produced before the TipTap schema has normalized the node.
    normalizeAssetRelPath(attrs.asset) ??
    inferAssetRelPathFromSrc(attrs.src)
  );
}

/** TipTap/HTML attribute contract for the durable local image identity. */
export const IMAGE_ASSET_REL_PATH_ATTRIBUTE = {
  default: null,
  parseHTML: (element: HTMLElement): string | null =>
    normalizeAssetRelPath(element.getAttribute('data-asset-rel-path')),
  renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
    const relPath = normalizeAssetRelPath(attributes.assetRelPath);
    return relPath === null ? {} : { 'data-asset-rel-path': relPath };
  },
};

export interface PortablePageAssets {
  readonly doc: PageDoc;
  readonly changed: boolean;
  /** Stable, first-seen order; useful to audit/export only referenced files. */
  readonly assetRelPaths: readonly string[];
}

export interface PageAssetReferences {
  /** Local media files named directly by image/video nodes. */
  readonly relPaths: readonly string[];
  /** Bare names of `user:<name>` sticker assets used by the page. */
  readonly customStickerNames: readonly string[];
}

/**
 * Inventory every library asset a page actually uses without rewriting it.
 *
 * Images have the durable attribute introduced by the placeholder pipeline;
 * older images and current videos can still carry only a converted local URL.
 * Custom stickers are indirect: the document stores `user:<name>` while the
 * assets row stores that bare name in `meta.customSticker`.
 */
export function collectPageAssetReferences(doc: PageDoc): PageAssetReferences {
  const relPaths: string[] = [];
  const customStickerNames: string[] = [];
  const seenPaths = new Set<string>();
  const seenStickers = new Set<string>();
  const rememberSticker = (value: unknown): void => {
    if (typeof value !== 'string' || !value.startsWith('user:')) return;
    const name = value.slice('user:'.length).trim();
    if (name === '' || seenStickers.has(name)) return;
    seenStickers.add(name);
    customStickerNames.push(name);
  };
  const visit = (value: unknown): void => {
    if (!isObject(value)) return;
    const attrs = isObject(value.attrs) ? value.attrs : {};
    if (value.type === 'image' || value.type === 'video') {
      const relPath = assetRelPathForImageAttrs(attrs);
      if (relPath !== null && !seenPaths.has(relPath)) {
        seenPaths.add(relPath);
        relPaths.push(relPath);
      }
    }
    rememberSticker(attrs.stickerId);
    rememberSticker(attrs.sticker);
    rememberSticker(attrs.icon);
    if (Array.isArray(value.content)) value.content.forEach(visit);
  };
  if (Array.isArray(doc.content)) doc.content.forEach(visit);
  return { relPaths, customStickerNames };
}

type MediaAttrsMapper = (
  attrs: Readonly<JsonObject>,
) => JsonObject | Promise<JsonObject>;

function sameShallowRecord(a: Readonly<JsonObject>, b: Readonly<JsonObject>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && a[key] === b[key])
  );
}

function mapNodeSync(value: unknown, mapMediaAttrs: MediaAttrsMapper): unknown {
  if (!isObject(value)) return value;
  let changed = false;
  let attrs = value.attrs;
  if (value.type === 'image' || value.type === 'video') {
    const original = isObject(value.attrs) ? value.attrs : {};
    const mapped = mapMediaAttrs(original);
    if (mapped instanceof Promise) {
      throw new Error('an asynchronous image mapper was used in a synchronous pass');
    }
    if (!sameShallowRecord(original, mapped)) {
      attrs = mapped;
      changed = true;
    }
  }
  let content = value.content;
  const originalContent = Array.isArray(value.content) ? value.content : null;
  if (originalContent !== null) {
    const mapped = originalContent.map((child) =>
      mapNodeSync(child, mapMediaAttrs),
    );
    if (mapped.some((child, index) => child !== originalContent[index])) {
      content = mapped;
      changed = true;
    }
  }
  if (!changed) return value;
  return {
    ...value,
    ...(attrs === undefined ? {} : { attrs }),
    ...(content === undefined ? {} : { content }),
  };
}

async function mapNodeAsync(
  value: unknown,
  mapMediaAttrs: MediaAttrsMapper,
): Promise<unknown> {
  if (!isObject(value)) return value;
  let changed = false;
  let attrs = value.attrs;
  if (value.type === 'image' || value.type === 'video') {
    const original = isObject(value.attrs) ? value.attrs : {};
    const mapped = await mapMediaAttrs(original);
    if (!sameShallowRecord(original, mapped)) {
      attrs = mapped;
      changed = true;
    }
  }
  let content = value.content;
  const originalContent = Array.isArray(value.content) ? value.content : null;
  if (originalContent !== null) {
    const mapped = await Promise.all(
      originalContent.map((child) => mapNodeAsync(child, mapMediaAttrs)),
    );
    if (mapped.some((child, index) => child !== originalContent[index])) {
      content = mapped;
      changed = true;
    }
  }
  if (!changed) return value;
  return {
    ...value,
    ...(attrs === undefined ? {} : { attrs }),
    ...(content === undefined ? {} : { content }),
  };
}

function withoutScriptAssetAlias(attrs: Readonly<JsonObject>): JsonObject {
  if (!Object.prototype.hasOwnProperty.call(attrs, 'asset')) return { ...attrs };
  const next = { ...attrs };
  delete next.asset;
  return next;
}

/**
 * Produce lossless bundle JSON: durable rel paths stay, root-specific display
 * URLs do not. The input object is never mutated.
 */
export function portablePageDocForExport(doc: PageDoc): PortablePageAssets {
  const paths: string[] = [];
  const seen = new Set<string>();
  const content = Array.isArray(doc.content)
    ? doc.content.map((child) =>
        mapNodeSync(child, (attrs) => {
          const relPath = assetRelPathForImageAttrs(attrs);
          if (relPath === null) return attrs as JsonObject;
          if (!seen.has(relPath)) {
            seen.add(relPath);
            paths.push(relPath);
          }
          const next = withoutScriptAssetAlias(attrs);
          next.assetRelPath = relPath;
          next.src = '';
          return next;
        }),
      )
    : doc.content;
  const changed =
    Array.isArray(doc.content) &&
    Array.isArray(content) &&
    content.some((child, index) => child !== doc.content![index]);
  return {
    doc: changed ? { ...doc, content } : doc,
    changed,
    assetRelPaths: paths,
  };
}

export type AssetSourceResolver = (relPath: string) => Promise<string>;

/**
 * Rebind every durable/legacy local image or video to the active library root.
 *
 * Resolver failures deliberately become the normal missing-image art rather
 * than retaining a URL into a previous library. Keeping the old root as a
 * fallback is precisely the portability bug this migration exists to remove.
 */
export async function rebasePageAssetSources(
  doc: PageDoc,
  resolve: AssetSourceResolver = resolveAssetSrc,
): Promise<PortablePageAssets> {
  const paths: string[] = [];
  const seen = new Set<string>();
  const resolved = new Map<string, Promise<string>>();
  const sourceFor = (relPath: string): Promise<string> => {
    let pending = resolved.get(relPath);
    if (pending === undefined) {
      pending = resolve(relPath)
        .then((src) => (src.trim() === '' ? MISSING_ASSET_SRC : src))
        .catch(() => MISSING_ASSET_SRC);
      resolved.set(relPath, pending);
    }
    return pending;
  };

  const content = Array.isArray(doc.content)
    ? await Promise.all(
        doc.content.map((child) =>
          mapNodeAsync(child, async (attrs) => {
            const relPath = assetRelPathForImageAttrs(attrs);
            if (relPath === null) return attrs as JsonObject;
            if (!seen.has(relPath)) {
              seen.add(relPath);
              paths.push(relPath);
            }
            const next = withoutScriptAssetAlias(attrs);
            next.assetRelPath = relPath;
            next.src = await sourceFor(relPath);
            return next;
          }),
        ),
      )
    : doc.content;
  const changed =
    Array.isArray(doc.content) &&
    Array.isArray(content) &&
    content.some((child, index) => child !== doc.content![index]);
  return {
    doc: changed ? { ...doc, content } : doc,
    changed,
    assetRelPaths: paths,
  };
}

export type PersistRebasedPage = (
  pageId: string,
  doc: PageDoc,
) => Promise<unknown>;

/**
 * Hydrate a set of database page models before either live DOM or the page
 * curl's offscreen renderer can observe them. Compatibility writes use the
 * same non-authoring persistence lane as stable block-id materialization, so
 * merely opening a legacy page does not dirty its clean Notebook Script.
 */
export async function preparePageAssetsForDisplay<
  TPage extends { readonly id: string; readonly doc: PageDoc },
>(
  pages: readonly TPage[],
  persist?: PersistRebasedPage,
  resolve: AssetSourceResolver = resolveAssetSrc,
): Promise<TPage[]> {
  const prepared = await Promise.all(
    pages.map(async (page) => {
      const rebased = await rebasePageAssetSources(page.doc, resolve);
      return rebased.changed ? { ...page, doc: rebased.doc } : page;
    }),
  );
  if (persist !== undefined) {
    await Promise.allSettled(
      prepared.map((page, index) =>
        page === pages[index] ? Promise.resolve() : persist(page.id, page.doc),
      ),
    );
  }
  return prepared;
}
