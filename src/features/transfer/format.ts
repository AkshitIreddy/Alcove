/**
 * src/features/transfer/format.ts — the **Notebook Bundle** (`.nbk`) format.
 *
 * A bundle is a ZIP archive:
 *
 *   manifest.json                       schema + inventory + checksum
 *   pages/<book-slug>/<ord>-<slug>.nbs  page bodies as Notebook Script
 *   docs/<pageId>.json                  lossless TipTap doc JSON (optional)
 *   assets/<relPath>                    referenced media (optional)
 *   theme.json                          library theme snapshot (optional)
 *
 * Everything in this module is pure and DOM-free: manifest building, manifest
 * parsing (total — never throws, returns diagnostics), and the checksum. The
 * archive plumbing lives in ./zip, the data-layer plumbing in ./library.
 */

/*
 * The archive's own name, NOT the app's. It is written into every bundle ever
 * exported, so renaming it would make files this build wrote unreadable by the
 * builds that wrote them. The app is called Bellanote; its bundles are still
 * `notebook-bundle`.
 */
export const BUNDLE_FORMAT = 'notebook-bundle';

/**
 * 2 — books carry the bookcase they stood in.
 *
 * Bumped rather than added silently because the change is legible in the file:
 * a reader (or a future importer) can tell a bundle that omits `bookcaseId`
 * because it predates cases from one that omits it because the book had none.
 */
export const BUNDLE_SCHEMA_VERSION = 2;

/**
 * Oldest schema this build can still read.
 *
 * Stays at 1. A v1 bundle is missing exactly one field, and the importer has a
 * good answer for it (the active case), so refusing to open one would be
 * throwing away someone's library for no reason.
 */
export const BUNDLE_MIN_READABLE_VERSION = 1;
export const BUNDLE_EXTENSION = 'nbk';
export const MANIFEST_PATH = 'manifest.json';
export const THEME_PATH = 'theme.json';

// ---------------------------------------------------------------------------
// Manifest shape
// ---------------------------------------------------------------------------

export type BundleScopeKind = 'selection' | 'book' | 'floor' | 'library';
export type BundleVariant = 'bundle' | 'markdown';
export type BundleLayout = 'per-page' | 'single-file';

export interface ManifestPage {
  /** Source page id (used for conflict detection; never reused on import). */
  id: string;
  ord: number;
  /** Display title derived from the page's first heading. */
  title: string;
  /** Archive path of the Notebook Script (or Markdown) body. */
  file: string;
  /** Archive path of the lossless TipTap JSON, or null. */
  docFile: string | null;
  /** Uncompressed byte length of `file`. */
  bytes: number;
  /** FNV-1a checksum of the body text. */
  checksum: string;
}

export interface ManifestBook {
  id: string;
  title: string;
  /**
   * Which bookcase the book stood in, or null.
   *
   * Null means one of two different things and the importer treats them the
   * same way: a bundle written before bookcases existed (schema < 3), or a
   * book exported from a library that only ever had one case. Either way the
   * importer puts it in the active case, because "the case I am looking at" is
   * the only answer that is never surprising.
   *
   * A non-null id is only honoured when a case with that id actually exists
   * here. Bundles move between machines, and an id from someone else's library
   * would otherwise send books to a case that is not there.
   */
  bookcaseId: string | null;
  floor: number;
  slot: number;
  spineSeed: number;
  /** Cover/spine styling blob, present only when the option is on. */
  coverMeta: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  pages: ManifestPage[];
}

export interface ManifestAsset {
  id: string;
  relPath: string;
  kind: string;
  meta: Record<string, unknown> | null;
  file: string;
  bytes: number;
}

export interface BundleManifest {
  format: typeof BUNDLE_FORMAT;
  schemaVersion: number;
  createdAt: string;
  app: { name: string; version: string };
  scope: BundleScopeKind;
  variant: BundleVariant;
  layout: BundleLayout;
  /** Human label shown in the import tree header ("Study notes — 3 books"). */
  label: string;
  counts: { books: number; pages: number; assets: number };
  books: ManifestBook[];
  assets: ManifestAsset[];
  /** Library theme snapshot, or null when not included. */
  theme: Record<string, unknown> | null;
  /** FNV-1a over the sorted `path:checksum` inventory (see `inventoryChecksum`). */
  checksum: string;
}

// ---------------------------------------------------------------------------
// Checksums — FNV-1a/32, hex, deterministic and dependency-free
// ---------------------------------------------------------------------------

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function checksumBytes(bytes: Uint8Array): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const utf8 = new TextEncoder();

export function checksumText(text: string): string {
  return checksumBytes(utf8.encode(text));
}

/** Stable checksum over a set of archive entries (order-independent). */
export function inventoryChecksum(
  entries: ReadonlyArray<{ path: string; checksum: string }>,
): string {
  const lines = entries
    .map((entry) => `${entry.path}:${entry.checksum}`)
    .sort()
    .join('\n');
  return checksumText(lines);
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** `My Book!` → `my-book`; never empty, never path-traversing. */
export function slugify(text: string, fallback = 'untitled'): string {
  const slug = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug === '' ? fallback : slug;
}

/** Archive path for a page body. Deterministic; collisions get an index. */
export function pageFilePath(
  bookSlug: string,
  index: number,
  pageTitle: string,
  variant: BundleVariant,
): string {
  const ext = variant === 'markdown' ? 'md' : 'nbs';
  const ord = String(index + 1).padStart(3, '0');
  return `pages/${bookSlug}/${ord}-${slugify(pageTitle, 'page')}.${ext}`;
}

/**
 * Reject archive paths that escape the bundle root. Import must never write
 * outside the app's own data, and a hand-edited zip is untrusted input.
 */
export function isSafeArchivePath(path: string): boolean {
  if (path === '' || path.length > 400) return false;
  if (path.startsWith('/') || path.startsWith('\\')) return false;
  if (/^[a-zA-Z]:/.test(path)) return false;
  if (path.includes('\\')) return false;
  return !path.split('/').some((part) => part === '..' || part === '.');
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

export interface BuildManifestInput {
  createdAt: string;
  appVersion: string;
  scope: BundleScopeKind;
  variant: BundleVariant;
  layout: BundleLayout;
  label: string;
  books: ManifestBook[];
  assets: ManifestAsset[];
  theme: Record<string, unknown> | null;
}

export function buildManifest(input: BuildManifestInput): BundleManifest {
  const pageCount = input.books.reduce((sum, book) => sum + book.pages.length, 0);
  const inventory: Array<{ path: string; checksum: string }> = [];
  for (const book of input.books) {
    for (const page of book.pages) {
      inventory.push({ path: page.file, checksum: page.checksum });
    }
  }
  for (const asset of input.assets) {
    inventory.push({ path: asset.file, checksum: String(asset.bytes) });
  }
  return {
    format: BUNDLE_FORMAT,
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    createdAt: input.createdAt,
    app: { name: 'Notebook', version: input.appVersion },
    scope: input.scope,
    variant: input.variant,
    layout: input.layout,
    label: input.label,
    counts: {
      books: input.books.length,
      pages: pageCount,
      assets: input.assets.length,
    },
    books: input.books,
    assets: input.assets,
    theme: input.theme,
    checksum: inventoryChecksum(inventory),
  };
}

// ---------------------------------------------------------------------------
// Parsing — total. Unknown/garbled fields degrade; nothing throws.
// ---------------------------------------------------------------------------

export interface ManifestParseResult {
  manifest: BundleManifest | null;
  /** Fatal problems — `manifest` is null whenever this is non-empty. */
  errors: string[];
  /** Recovered problems — the bundle is importable but imperfect. */
  warnings: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asInt(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : fallback;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parsePage(
  raw: unknown,
  index: number,
  bookSlug: string,
  warnings: string[],
): ManifestPage | null {
  const record = asRecord(raw);
  if (record === null) {
    warnings.push(`page ${index + 1} of “${bookSlug}” is malformed — skipped`);
    return null;
  }
  const title = asString(record.title, `page ${index + 1}`);
  const file = asString(record.file);
  if (file === '' || !isSafeArchivePath(file)) {
    warnings.push(`page “${title}” has an unusable file path — skipped`);
    return null;
  }
  const docFile = asString(record.docFile, '');
  return {
    id: asString(record.id, `${bookSlug}-p${index}`),
    ord: asInt(record.ord, index),
    title,
    file,
    docFile: docFile !== '' && isSafeArchivePath(docFile) ? docFile : null,
    bytes: Math.max(0, asInt(record.bytes, 0)),
    checksum: asString(record.checksum),
  };
}

function parseBook(
  raw: unknown,
  index: number,
  warnings: string[],
): ManifestBook | null {
  const record = asRecord(raw);
  if (record === null) {
    warnings.push(`book ${index + 1} is malformed — skipped`);
    return null;
  }
  const title = asString(record.title, `Untitled book ${index + 1}`);
  const pages: ManifestPage[] = [];
  asArray(record.pages).forEach((page, i) => {
    const parsed = parsePage(page, i, slugify(title), warnings);
    if (parsed !== null) pages.push(parsed);
  });
  const bookcaseId = typeof record.bookcaseId === 'string' && record.bookcaseId !== ''
    ? record.bookcaseId
    : null;
  return {
    id: asString(record.id, `book-${index}`),
    title,
    // Absent in every bundle written before schema 3. Null rather than a
    // guessed id, so the importer can tell "no case recorded" from "this case".
    bookcaseId,
    floor: Math.max(0, asInt(record.floor, 0)),
    slot: Math.max(0, asInt(record.slot, index)),
    spineSeed: asInt(record.spineSeed, 0) >>> 0,
    coverMeta: asRecord(record.coverMeta),
    createdAt: asString(record.createdAt),
    updatedAt: asString(record.updatedAt),
    pages,
  };
}

function parseAsset(raw: unknown, warnings: string[]): ManifestAsset | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const file = asString(record.file);
  const relPath = asString(record.relPath);
  if (file === '' || !isSafeArchivePath(file) || !isSafeArchivePath(relPath)) {
    warnings.push('an asset has an unusable path — skipped');
    return null;
  }
  return {
    id: asString(record.id, relPath),
    relPath,
    kind: asString(record.kind, 'other'),
    meta: asRecord(record.meta),
    file,
    bytes: Math.max(0, asInt(record.bytes, 0)),
  };
}

/**
 * Parse manifest JSON text (or an already-parsed value). Total: any input
 * yields a result object; fatal cases carry `errors` and a null manifest.
 */
export function parseManifest(source: string | unknown): ManifestParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let raw: unknown = source;
  if (typeof source === 'string') {
    try {
      raw = JSON.parse(source);
    } catch {
      return { manifest: null, errors: ['manifest.json is not valid JSON'], warnings };
    }
  }
  const record = asRecord(raw);
  if (record === null) {
    return { manifest: null, errors: ['manifest.json is not an object'], warnings };
  }
  if (asString(record.format) !== BUNDLE_FORMAT) {
    errors.push('this file is not a Notebook bundle');
  }
  const schemaVersion = asInt(record.schemaVersion, 0);
  if (schemaVersion > BUNDLE_SCHEMA_VERSION) {
    errors.push(
      `bundle was written by a newer Notebook (schema v${schemaVersion}) — update to open it`,
    );
  } else if (schemaVersion < BUNDLE_MIN_READABLE_VERSION) {
    errors.push(`bundle schema v${schemaVersion} is too old to read`);
  }
  if (errors.length > 0) return { manifest: null, errors, warnings };

  const variant: BundleVariant =
    asString(record.variant) === 'markdown' ? 'markdown' : 'bundle';
  const layout: BundleLayout =
    asString(record.layout) === 'single-file' ? 'single-file' : 'per-page';
  const scopeRaw = asString(record.scope);
  const scope: BundleScopeKind = (
    ['selection', 'book', 'floor', 'library'] as const
  ).includes(scopeRaw as BundleScopeKind)
    ? (scopeRaw as BundleScopeKind)
    : 'selection';

  const books: ManifestBook[] = [];
  asArray(record.books).forEach((book, i) => {
    const parsed = parseBook(book, i, warnings);
    if (parsed !== null) books.push(parsed);
  });
  const assets: ManifestAsset[] = [];
  for (const asset of asArray(record.assets)) {
    const parsed = parseAsset(asset, warnings);
    if (parsed !== null) assets.push(parsed);
  }

  if (books.length === 0) {
    return {
      manifest: null,
      errors: ['this bundle contains no readable books'],
      warnings,
    };
  }

  const pageCount = books.reduce((sum, book) => sum + book.pages.length, 0);
  const countsRecord = asRecord(record.counts);
  if (countsRecord !== null && asInt(countsRecord.pages, pageCount) !== pageCount) {
    warnings.push(
      `manifest claims ${asInt(countsRecord.pages)} pages but lists ${pageCount}`,
    );
  }

  return {
    manifest: {
      format: BUNDLE_FORMAT,
      schemaVersion,
      createdAt: asString(record.createdAt),
      app: {
        name: asString(asRecord(record.app)?.name, 'Notebook'),
        version: asString(asRecord(record.app)?.version, '?'),
      },
      scope,
      variant,
      layout,
      label: asString(record.label, 'Notebook bundle'),
      counts: { books: books.length, pages: pageCount, assets: assets.length },
      books,
      assets,
      theme: asRecord(record.theme),
      checksum: asString(record.checksum),
    },
    errors,
    warnings,
  };
}

/**
 * Re-derive the inventory checksum from the archive's real contents and
 * compare it with the manifest. A mismatch is a warning, never a hard stop —
 * a hand-edited bundle should still be importable, just flagged.
 */
export function verifyBundleChecksum(
  manifest: BundleManifest,
  actual: ReadonlyArray<{ path: string; checksum: string }>,
): { ok: boolean; expected: string; actual: string } {
  const recomputed = inventoryChecksum(actual);
  return {
    ok: manifest.checksum === '' || recomputed === manifest.checksum,
    expected: manifest.checksum,
    actual: recomputed,
  };
}

// ---------------------------------------------------------------------------
// Presentation helpers (pure)
// ---------------------------------------------------------------------------

/** 1536 → "1.5 KB". Deterministic, no locale dependence. */
export function formatBytes(bytes: number): string {
  const n = Math.max(0, Math.round(bytes));
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) {
    const kb = n / 1024;
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  const mb = n / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** "3 books · 41 pages" — the count line under every tree header. */
export function describeCounts(counts: {
  books: number;
  pages: number;
  assets?: number;
}): string {
  const parts = [
    `${counts.books} book${counts.books === 1 ? '' : 's'}`,
    `${counts.pages} page${counts.pages === 1 ? '' : 's'}`,
  ];
  if (counts.assets !== undefined && counts.assets > 0) {
    parts.push(`${counts.assets} asset${counts.assets === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}
