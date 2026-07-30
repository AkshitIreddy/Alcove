/**
 * src/features/transfer/io.ts — everything that touches a real file.
 *
 * Tauri path: the `bundle_write` / `bundle_read` Rust commands
 * (src-tauri/src/transfer.rs) do the archive work — deflate-compressed, so a
 * shipped bundle is a third the size of the pure-TS STORE writer. Both
 * commands degrade: if they are not registered yet, the TypeScript codec in
 * ./zip runs instead and the file is written through plugin-fs.
 *
 * Browser dev path: object-URL download for export, a hidden
 * `input[data-nb-bundle]` for import (which is also the Playwright hook in
 * tests/e2e/transfer.spec.ts).
 */

import { isTauri } from '../../data/db';
import { saveBytes } from '../../editor/script/exporters/saveFile';
import {
  BUNDLE_EXTENSION,
  MANIFEST_PATH,
  checksumBytes,
  parseManifest,
  verifyBundleChecksum,
} from './format';
import { buildBundleFiles, buildMarkdownDocument, type BuildBundleInput } from './bundle';
import type { BundleContents } from './library';
import { bytesToText, textToBytes, unzip, zipStore, type ZipEntry } from './zip';

const BINARY_PREFIX = 'assets/';

async function tauriInvoke<T>(command: string, args: unknown): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type ExportOutcome = 'saved' | 'cancelled' | 'failed';

export interface ExportFileResult {
  outcome: ExportOutcome;
  /** Bytes actually produced (0 when cancelled). */
  bytes: number;
  fileName: string;
}

interface IpcEntry {
  path: string;
  bytes: number[];
}

/**
 * Build and save a bundle. When `asSingleMarkdown` is set, the built entries
 * are folded into one `.md` document instead of an archive.
 */
export async function writeBundle(
  input: BuildBundleInput,
  fileName: string,
  asSingleMarkdown: boolean,
): Promise<ExportFileResult> {
  const built = buildBundleFiles({
    ...input,
    assetBytes: input.assetBytes ?? (await readAssetBytes(input)),
  });

  if (asSingleMarkdown) {
    const bytes = textToBytes(buildMarkdownDocument(built));
    const outcome = await saveBytes(bytes, fileName, 'text/markdown', [
      { name: 'Markdown', extensions: ['md'] },
    ]);
    return { outcome, bytes: bytes.length, fileName };
  }

  if (isTauri()) {
    const saved = await saveBundleTauri(built.entries, fileName);
    if (saved !== null) return saved;
  }
  const bytes = zipStore(built.entries, new Date(input.createdAt));
  const outcome = await saveBytes(bytes, fileName, 'application/zip', [
    { name: 'Notebook bundle', extensions: [BUNDLE_EXTENSION] },
  ]);
  return { outcome, bytes: bytes.length, fileName };
}

/**
 * Read the bytes of every asset the plan references, so "bring the pictures"
 * actually ships files and not just rows. Tauri only — the browser dev build
 * has no asset files on disk, and a missing file simply degrades to a
 * reference-only entry the importer warns about.
 */
async function readAssetBytes(
  input: BuildBundleInput,
): Promise<Map<string, Uint8Array> | undefined> {
  if (!input.options.includeAssets || input.plan.assets.length === 0) return undefined;
  if (!isTauri()) return undefined;
  try {
    const { BaseDirectory, readFile } = await import('@tauri-apps/plugin-fs');
    const bytes = new Map<string, Uint8Array>();
    for (const asset of input.plan.assets) {
      try {
        bytes.set(
          asset.relPath,
          await readFile(`assets/${asset.relPath}`, { baseDir: BaseDirectory.AppData }),
        );
      } catch {
        // Missing file: keep the manifest entry, ship no bytes.
      }
    }
    return bytes;
  } catch {
    return undefined;
  }
}

/** Returns null when the Rust command is unavailable (caller falls back). */
async function saveBundleTauri(
  entries: readonly ZipEntry[],
  fileName: string,
): Promise<ExportFileResult | null> {
  try {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      defaultPath: fileName,
      filters: [{ name: 'Notebook bundle', extensions: [BUNDLE_EXTENSION] }],
    });
    if (path === null) return { outcome: 'cancelled', bytes: 0, fileName };
    const ipc: IpcEntry[] = entries.map((entry) => ({
      path: entry.path,
      bytes: Array.from(entry.bytes),
    }));
    const written = await tauriInvoke<number>('bundle_write', { path, entries: ipc });
    return { outcome: 'saved', bytes: written, fileName };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ReadBundleResult {
  contents: BundleContents | null;
  fileName: string;
  errors: string[];
  warnings: string[];
}

const EMPTY_RESULT: ReadBundleResult = {
  contents: null,
  fileName: '',
  errors: [],
  warnings: [],
};

/** Turn raw archive bytes into a validated, checksum-verified bundle. */
export async function readBundleBytes(
  bytes: Uint8Array,
  fileName: string,
): Promise<ReadBundleResult> {
  const archive = await unzip(bytes);
  const warnings = [...archive.warnings];
  const manifestBytes = archive.files.get(MANIFEST_PATH);
  if (manifestBytes === undefined) {
    return {
      contents: null,
      fileName,
      errors: ['this file has no manifest.json — it is not a Notebook bundle'],
      warnings,
    };
  }
  const parsed = parseManifest(bytesToText(manifestBytes));
  warnings.push(...parsed.warnings);
  if (parsed.manifest === null) {
    return { contents: null, fileName, errors: parsed.errors, warnings };
  }

  const texts = new Map<string, string>();
  const binaries = new Map<string, Uint8Array>();
  for (const [path, data] of archive.files) {
    if (path === MANIFEST_PATH) continue;
    if (path.startsWith(BINARY_PREFIX)) binaries.set(path, data);
    else texts.set(path, bytesToText(data));
  }

  // Re-derive the inventory checksum from what is actually in the archive.
  const inventory: Array<{ path: string; checksum: string }> = [];
  for (const book of parsed.manifest.books) {
    for (const page of book.pages) {
      const text = texts.get(page.file);
      inventory.push({
        path: page.file,
        checksum: text === undefined ? '' : checksumTextLocal(text),
      });
    }
  }
  for (const asset of parsed.manifest.assets) {
    inventory.push({ path: asset.file, checksum: String(asset.bytes) });
  }
  const verdict = verifyBundleChecksum(parsed.manifest, inventory);
  if (!verdict.ok) {
    warnings.push(
      'checksum mismatch — this bundle was edited after it was exported; import is still additive and undoable',
    );
  }

  return {
    contents: { manifest: parsed.manifest, texts, binaries },
    fileName,
    errors: [],
    warnings,
  };
}

/** Local re-export so this module needs only one import from ./format. */
function checksumTextLocal(text: string): string {
  return checksumBytes(textToBytes(text));
}

/** Full picker → bytes → parsed bundle. Resolves with nulls when cancelled. */
export async function pickAndReadBundle(): Promise<ReadBundleResult> {
  const picked = isTauri() ? await pickTauriBundle() : await pickBrowserBundle();
  if (picked === null) return EMPTY_RESULT;
  return readBundleBytes(picked.bytes, picked.fileName);
}

interface PickedFile {
  fileName: string;
  bytes: Uint8Array;
}

async function pickTauriBundle(): Promise<PickedFile | null> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const path = await open({
      multiple: false,
      filters: [
        { name: 'Notebook bundle', extensions: [BUNDLE_EXTENSION, 'zip'] },
      ],
    });
    if (path === null || Array.isArray(path)) return null;
    const fileName = path.split(/[\\/]/).pop() ?? 'bundle.nbk';
    try {
      const entries = await tauriInvoke<IpcEntry[]>('bundle_read', { path });
      // Re-zip locally so the rest of the pipeline sees one uniform shape.
      return {
        fileName,
        bytes: zipStore(
          entries.map((entry) => ({
            path: entry.path,
            bytes: Uint8Array.from(entry.bytes),
          })),
        ),
      };
    } catch {
      const { readFile } = await import('@tauri-apps/plugin-fs');
      return { fileName, bytes: await readFile(path) };
    }
  } catch {
    return null;
  }
}

/** Browser dev: hidden file input — also the Playwright `setInputFiles` hook. */
function pickBrowserBundle(): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    document.querySelector('input[data-nb-bundle]')?.remove();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `.${BUNDLE_EXTENSION},.zip,application/zip`;
    input.setAttribute('data-nb-bundle', 'true');
    input.style.cssText =
      'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
    document.body.appendChild(input);

    let settled = false;
    const finish = async (): Promise<void> => {
      if (settled) return;
      settled = true;
      const file = input.files?.[0] ?? null;
      input.remove();
      if (file === null) {
        resolve(null);
        return;
      }
      resolve({
        fileName: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
    };
    input.addEventListener('change', () => void finish());
    window.addEventListener('focus', () => setTimeout(() => void finish(), 1500), {
      once: true,
    });
    input.click();
  });
}
