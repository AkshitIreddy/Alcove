/**
 * src/features/transfer/bundle.ts — turning a plan into archive bytes.
 *
 * Pure: `buildBundleFiles` maps (snapshot, plan, options) to the exact list
 * of archive entries plus the manifest, and `buildMarkdownDocument` folds the
 * same entries into a single plain-Markdown file for the "one .md" variant.
 * Neither touches the DOM, the database, or the filesystem — the runner in
 * ./runExport does the saving.
 */

import {
  MANIFEST_PATH,
  THEME_PATH,
  buildManifest,
  checksumText,
  type BundleManifest,
  type ManifestAsset,
  type ManifestBook,
  type ManifestPage,
} from './format';
import type { ExportOptions, ExportPlan, LibrarySnapshot } from './scope';
import { textToBytes, type ZipEntry } from './zip';

/** Page break used when several pages share one file. */
export const PAGE_BREAK = '\n\n<!-- notebook:page -->\n\n';

// ---------------------------------------------------------------------------
// Plain-Markdown degradation
// ---------------------------------------------------------------------------

/**
 * Notebook Script → plain Markdown: drop the frontmatter block, unwrap
 * `:::container` directives (keeping their content), and relabel fenced
 * mini-languages (```tree, ```graph, ```timeline) as plain fences so other
 * editors render them as code instead of choking. Total — never throws.
 */
export function toPlainMarkdown(script: string): string {
  const lines = script.split('\n');
  const out: string[] = [];
  let index = 0;

  // Frontmatter: a leading --- … --- block.
  if (lines[0]?.trim() === '---') {
    index = 1;
    while (index < lines.length && lines[index].trim() !== '---') index += 1;
    index += 1;
  }

  let inFence = false;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = /^(\s*)```(\s*[\w-]*)\s*$/.exec(line);
    if (fence !== null) {
      const lang = fence[2].trim();
      if (!inFence && ['tree', 'graph', 'timeline'].includes(lang)) {
        out.push(`${fence[1]}\`\`\``);
      } else {
        out.push(line);
      }
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    // ":::name {attrs}" open and ":::" close both vanish.
    if (/^\s*:::/.test(line)) continue;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export interface BuiltBundle {
  manifest: BundleManifest;
  entries: ZipEntry[];
  /** Every page body keyed by archive path — reused by the .md variant. */
  bodies: Map<string, string>;
}

export interface BuildBundleInput {
  snapshot: LibrarySnapshot;
  plan: ExportPlan;
  options: ExportOptions;
  label: string;
  createdAt: string;
  appVersion: string;
  /** Asset bytes by relPath; missing entries are simply omitted. */
  assetBytes?: ReadonlyMap<string, Uint8Array>;
}

export function buildBundleFiles(input: BuildBundleInput): BuiltBundle {
  const { snapshot, plan, options } = input;
  const pagesById = new Map<string, (typeof snapshot.books)[number]['pages'][number]>();
  const booksById = new Map<string, (typeof snapshot.books)[number]>();
  for (const book of snapshot.books) {
    booksById.set(book.id, book);
    for (const page of book.pages) pagesById.set(page.id, page);
  }

  const bodies = new Map<string, string>();
  const docEntries: ZipEntry[] = [];
  const manifestBooks: ManifestBook[] = [];

  for (const planBook of plan.books) {
    const source = booksById.get(planBook.id);
    if (source === undefined) continue;
    const manifestPages: ManifestPage[] = [];

    for (const planPage of planBook.pages) {
      const page = pagesById.get(planPage.id);
      if (page === undefined) continue;
      const body =
        options.variant === 'markdown' ? toPlainMarkdown(page.script) : page.script;

      if (options.layout === 'single-file') {
        const existing = bodies.get(planPage.file);
        bodies.set(
          planPage.file,
          existing === undefined ? body : existing + PAGE_BREAK + body,
        );
      } else {
        bodies.set(planPage.file, body);
      }

      let docFile: string | null = null;
      if (options.losslessDocs && options.variant === 'bundle') {
        docFile = `docs/${page.id}.json`;
        docEntries.push({ path: docFile, bytes: textToBytes(page.docJson) });
      }
      manifestPages.push({
        id: page.id,
        ord: page.ord,
        title: page.title,
        file: planPage.file,
        docFile,
        bytes: textToBytes(body).length,
        checksum: checksumText(body),
      });
    }

    manifestBooks.push({
      id: source.id,
      title: source.title,
      // Which case it stood in. Without this a round trip through a bundle
      // flattened a multi-case library into whichever case happened to be open
      // on import.
      bookcaseId: source.bookcaseId ?? null,
      floor: source.floor,
      slot: source.slot,
      spineSeed: source.spineSeed,
      coverMeta: options.includeCoverStyling ? source.coverMeta : null,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
      pages: manifestPages,
    });
  }

  const assetEntries: ZipEntry[] = [];
  const manifestAssets: ManifestAsset[] = [];
  if (options.includeAssets) {
    for (const asset of plan.assets) {
      const file = `assets/${asset.relPath}`;
      const bytes = input.assetBytes?.get(asset.relPath);
      manifestAssets.push({
        id: asset.id,
        relPath: asset.relPath,
        kind: asset.kind,
        meta: asset.meta,
        file,
        bytes: bytes?.length ?? asset.bytes,
      });
      if (bytes !== undefined) assetEntries.push({ path: file, bytes });
    }
  }

  const theme =
    options.includeLibraryTheme && snapshot.theme !== null ? snapshot.theme : null;

  const manifest = buildManifest({
    createdAt: input.createdAt,
    appVersion: input.appVersion,
    scope: 'selection',
    variant: options.variant,
    layout: options.layout,
    label: input.label,
    books: manifestBooks,
    assets: manifestAssets,
    theme,
  });

  const entries: ZipEntry[] = [
    { path: MANIFEST_PATH, bytes: textToBytes(JSON.stringify(manifest, null, 2)) },
  ];
  // Deterministic order: bodies (insertion order), docs, assets, theme.
  for (const [path, body] of bodies) {
    entries.push({ path, bytes: textToBytes(body) });
  }
  entries.push(...docEntries, ...assetEntries);
  if (theme !== null) {
    entries.push({ path: THEME_PATH, bytes: textToBytes(JSON.stringify(theme, null, 2)) });
  }

  return { manifest, entries, bodies };
}

/**
 * Fold a built bundle into one plain-Markdown document — the "single .md"
 * export. Each book gets an H1 banner comment so the file stays readable.
 */
export function buildMarkdownDocument(built: BuiltBundle): string {
  const chunks: string[] = [];
  for (const book of built.manifest.books) {
    const seen = new Set<string>();
    const parts: string[] = [];
    for (const page of book.pages) {
      if (seen.has(page.file)) continue;
      seen.add(page.file);
      const body = built.bodies.get(page.file);
      if (body !== undefined) parts.push(body.trim());
    }
    chunks.push(`# ${book.title}\n\n${parts.join(PAGE_BREAK)}`.trim());
  }
  return `${chunks.join('\n\n---\n\n')}\n`;
}
