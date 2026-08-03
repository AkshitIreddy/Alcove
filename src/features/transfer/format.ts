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
 * The manifest also lists the BOOKCASES the exported books stood in — their
 * names, heights and rooms — so importing a library rebuilds the furniture it
 * came from rather than tipping every book onto one shelf.
 *
 * Everything in this module is pure and DOM-free: manifest building, manifest
 * parsing (total — never throws, returns diagnostics), and the checksum. The
 * archive plumbing lives in ./zip, the data-layer plumbing in ./library.
 */

/*
 * The archive's own name, NOT the app's. It is written into every bundle ever
 * exported, so renaming it would make files this build wrote unreadable by the
 * builds that wrote them. The app is called Alcove; its bundles are still
 * `notebook-bundle`.
 */
export const BUNDLE_FORMAT = 'notebook-bundle';

/**
 * Schema history — the field list, not the file format (`BUNDLE_FORMAT` above
 * never changes):
 *
 *   1  books, pages, assets, theme.
 *   2  each book records the id of the bookcase it stood in.
 *   3  the bookcases themselves — name, ord, height and room — so an import
 *      can rebuild furniture that does not exist on this machine. v2 recorded
 *      an id and nothing else, which is only useful when the importing library
 *      happens to be the exporting one.
 *
 * Bumped rather than added silently because the change is legible in the file:
 * a reader (or a future importer) can tell a bundle that omits `bookcaseId`
 * because it predates cases from one that omits it because the book had none.
 */
export const BUNDLE_SCHEMA_VERSION = 3;

/**
 * Oldest schema this build can still read.
 *
 * Stays at 1. Every field added since is one the importer has a good answer
 * for without it — the active case for a missing `bookcaseId`, and no
 * furniture at all for a missing `bookcases` list — so refusing to open an old
 * bundle would be throwing away someone's library for no reason.
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

/**
 * A bookcase the exported books stood in — the piece of furniture, not the
 * books on it.
 *
 * This is what makes a bundle a picture of a LIBRARY rather than a pile of
 * books: without it an importing machine knows a book belonged to case
 * `case-7xKq` and has no way to build `case-7xKq`, so every book from every
 * case lands in whichever one happens to be open.
 */
export interface ManifestBookcase {
  /** The case's id in the library that exported it. */
  id: string;
  name: string;
  /** Position in the exporting library's picker (ascending). */
  ord: number;
  /**
   * The case's own room: a `LibraryPrefs` JSON blob, or null to follow the app
   * default. Opaque here exactly as it is in `data/bookcases` — the validator
   * lives in `features/bookshelf/libraryPrefs`, and a bundle must not need a
   * second opinion about what a room is.
   */
  room: string | null;
  /** How many floors the case showed (>= 1). */
  floors: number;
  createdAt: string;
  updatedAt: string;
}

export interface ManifestBook {
  id: string;
  title: string;
  /**
   * Which bookcase the book stood in, or null.
   *
   * Null means one of two different things and the importer treats them the
   * same way: a bundle written before bookcases existed (schema 1), or a
   * book exported from a library that only ever had one case. Either way the
   * importer puts it in the active case, because "the case I am looking at" is
   * the only answer that is never surprising.
   *
   * A non-null id is honoured when a case with that id exists here, when
   * `manifest.bookcases` describes it well enough to rebuild (schema 3+), or
   * when a case here already carries the same name. Bundles move between
   * machines, and an id from someone else's library must never send books to a
   * case that is not there.
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
  /**
   * The cases the listed books stood in. Empty for a bundle written before
   * schema 3 — and empty is a fine answer, not a broken one: the importer then
   * falls back to matching by id and finally to the active case.
   */
  bookcases: ManifestBookcase[];
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
  /** Cases the books stood in; omit for a bundle that carries none. */
  bookcases?: ManifestBookcase[];
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
    app: { name: 'Alcove', version: input.appVersion },
    scope: input.scope,
    variant: input.variant,
    layout: input.layout,
    label: input.label,
    counts: {
      books: input.books.length,
      pages: pageCount,
      assets: input.assets.length,
    },
    bookcases: input.bookcases ?? [],
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

/**
 * Sanity bounds for a hand-edited bundle. Not the app's real limits — the
 * bookcase store clamps floors again on the way in (`clampFloorCount`) and is
 * the authority; this only stops a manifest from carrying nonsense.
 */
const MAX_MANIFEST_FLOORS = 999;
const MAX_ROOM_BLOB = 20_000;

function parseBookcase(
  raw: unknown,
  index: number,
  warnings: string[],
): ManifestBookcase | null {
  const record = asRecord(raw);
  if (record === null) {
    warnings.push(`bookcase ${index + 1} is malformed — skipped`);
    return null;
  }
  // An unidentifiable case is worse than no case: books reference it by id, so
  // one without an id can never receive them. Drop it and let those books fall
  // back to the active case.
  const id = asString(record.id);
  if (id === '') {
    warnings.push(`bookcase ${index + 1} has no id — skipped`);
    return null;
  }
  const room = asString(record.room, '');
  return {
    id,
    name: asString(record.name, `Bookcase ${index + 1}`).slice(0, 60),
    ord: asInt(record.ord, index),
    // An oversized blob is dropped rather than truncated: half a JSON room is
    // not a room, and `roomToPrefs` would only degrade it to the default
    // anyway — with the truncation blamed on the reader's colours.
    room: room !== '' && room.length <= MAX_ROOM_BLOB ? room : null,
    floors: Math.min(MAX_MANIFEST_FLOORS, Math.max(1, asInt(record.floors, 10))),
    createdAt: asString(record.createdAt),
    updatedAt: asString(record.updatedAt),
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
    // Absent in every bundle written before schema 2. Null rather than a
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

  const bookcases: ManifestBookcase[] = [];
  const seenBookcaseIds = new Set<string>();
  asArray(record.bookcases).forEach((bookcase, i) => {
    const parsed = parseBookcase(bookcase, i, warnings);
    if (parsed === null) return;
    // Two entries for one id would make "which case is this" ambiguous at the
    // exact moment the importer has to pick one. First listing wins.
    if (seenBookcaseIds.has(parsed.id)) {
      warnings.push(`bookcase “${parsed.name}” is listed twice — the second was ignored`);
      return;
    }
    seenBookcaseIds.add(parsed.id);
    bookcases.push(parsed);
  });
  bookcases.sort((a, b) => a.ord - b.ord);

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
        // Defaults to the OLD name on purpose: a bundle without an app name is
        // one written before the rename, and saying "Alcove" about it would
        // be inventing provenance.
        name: asString(asRecord(record.app)?.name, 'Notebook'),
        version: asString(asRecord(record.app)?.version, '?'),
      },
      scope,
      variant,
      layout,
      label: asString(record.label, 'Notebook bundle'),
      counts: { books: books.length, pages: pageCount, assets: assets.length },
      bookcases,
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

/** "2 bookcases · 3 books · 41 pages" — the count line under every tree header. */
export function describeCounts(counts: {
  books: number;
  pages: number;
  assets?: number;
  bookcases?: number;
}): string {
  const parts: string[] = [];
  // Furniture first, because it is what the books stand in. Only when there is
  // more than one: "1 bookcase" in front of every count is noise, since a
  // library that has never been split has exactly one and always did.
  if (counts.bookcases !== undefined && counts.bookcases > 1) {
    parts.push(`${counts.bookcases} bookcases`);
  }
  parts.push(
    `${counts.books} book${counts.books === 1 ? '' : 's'}`,
    `${counts.pages} page${counts.pages === 1 ? '' : 's'}`,
  );
  if (counts.assets !== undefined && counts.assets > 0) {
    parts.push(`${counts.assets} asset${counts.assets === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}
