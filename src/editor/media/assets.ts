/**
 * Image asset persistence (frontend half of the media pipeline).
 *
 * Tauri: bytes → `save_image_asset` Rust command (writes
 * `app_data_dir/assets/images/<contenthash>.<ext>`) → `assets` DB row
 * recorded here via the sql plugin (Rust stays filesystem-only) → asset
 * protocol src.
 *
 * Browser dev: IndexedDB Blob + object URL + stub-DB row, so paste/drop works
 * without Rust and survives the same reload cycle as the surrounding page.
 */
import { nanoid } from 'nanoid';
import { getDb, isTauri } from '../../data/db';
import { saveDevAssetBlob } from './devAssetStore';
import { registerDevAssetUrl, resolveAssetSrc } from './resolver';

export interface StoredAsset {
  /** `assets` table id (content-derived in Tauri). */
  assetId: string;
  /** Path relative to the assets root (or `dev/…` in the browser). */
  relPath: string;
  /** Displayable src for the current environment. */
  src: string;
}

/** Compatibility name for image-only callers. */
export type StoredImage = StoredAsset;

interface SavedAssetIpc {
  id: string;
  relPath: string;
}

/** Insert (or refresh) the `assets` row for a stored file. */
export async function recordAssetRow(
  id: string,
  relPath: string,
  meta: Record<string, unknown> | null = null,
  kind: 'image' | 'video' = 'image',
): Promise<void> {
  const db = await getDb();
  await db.execute(
    'INSERT OR REPLACE INTO assets (id, rel_path, kind, meta, created_at) VALUES ($1, $2, $3, $4, $5)',
    [id, relPath, kind, meta === null ? null : JSON.stringify(meta), new Date().toISOString()],
  );
}

/**
 * Persist raw image bytes as a local asset and return a displayable src.
 * `meta` lands in the assets row (source URL, attribution…).
 */
export async function storeImageBytes(
  bytes: Uint8Array,
  suggestedExt: string,
  meta: Record<string, unknown> | null = null,
): Promise<StoredAsset> {
  return storeMediaBytes(bytes, suggestedExt, 'image', meta);
}

async function storeMediaBytes(
  bytes: Uint8Array,
  suggestedExt: string,
  kind: 'image' | 'video',
  meta: Record<string, unknown> | null,
): Promise<StoredAsset> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const saved = await invoke<SavedAssetIpc>('save_image_asset', {
      bytes: Array.from(bytes),
      suggestedExt,
    });
    await recordAssetRow(saved.id, saved.relPath, meta, kind);
    return {
      assetId: saved.id,
      relPath: saved.relPath,
      src: await resolveAssetSrc(saved.relPath),
    };
  }

  // Browser dev fallback: object URL, no filesystem.
  const id = `${kind === 'video' ? 'vid' : 'img'}_dev_${nanoid(10)}`;
  const relPath = `dev/${id}`;
  const blob = new Blob([bytes.slice().buffer], {
    type: `${kind}/${suggestedExt || (kind === 'video' ? 'mp4' : 'png')}`,
  });
  await saveDevAssetBlob(relPath, blob);
  const url = URL.createObjectURL(blob);
  registerDevAssetUrl(relPath, url);
  await recordAssetRow(id, relPath, meta, kind);
  return { assetId: id, relPath, src: url };
}

/** Convenience: persist a pasted/dropped File or Blob. */
export async function storeImageFile(file: File | Blob): Promise<StoredAsset> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = file.type.startsWith('image/') ? file.type.slice(6) : 'png';
  const name = file instanceof File ? file.name : null;
  return storeImageBytes(bytes, ext, name === null ? null : { fileName: name });
}

export function videoFileExtension(file: File | Blob): string {
  const mime = file.type.split(';')[0]?.toLowerCase() ?? '';
  const byMime: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/x-msvideo': 'avi',
    'video/x-matroska': 'mkv',
    'video/mpeg': 'mpeg',
    'video/ogg': 'ogv',
  };
  if (byMime[mime]) return byMime[mime]!;
  if (file instanceof File) {
    const candidate = file.name.toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1];
    if (candidate && ['mp4', 'm4v', 'webm', 'mov', 'avi', 'mkv', 'mpeg', 'mpg', 'ogv'].includes(candidate)) {
      return candidate;
    }
  }
  return 'mp4';
}

/** Persist a dropped video through the same content-addressed asset writer. */
export async function storeVideoFile(file: File | Blob): Promise<StoredAsset> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = videoFileExtension(file);
  const name = file instanceof File ? file.name : null;
  return storeMediaBytes(
    bytes,
    ext,
    'video',
    name === null ? null : { fileName: name },
  );
}

// ---------------------------------------------------------------------------
// Image fetch (Openverse via Rust) — used by the script `fetch:` directive
// and the slash menu.
// ---------------------------------------------------------------------------

export interface FetchedImageIpc {
  id: string;
  relPath: string;
  url: string;
  thumbUrl: string | null;
  attribution: string;
  license: string;
  sha256: string;
  sizeBytes: number;
}

export interface FetchedImageResult extends FetchedImageIpc {
  /** Displayable src resolved for the current environment. */
  src: string;
}

/**
 * Durable provenance retained by an AI reviewed-generation receipt.
 *
 * `src` is deliberately absent: it is a WebView display URL, not identity.
 * `relPath` names the content-addressed bytes Rust already downloaded. During
 * an AI preview this receipt is staged without an `assets` row; explicit
 * approval promotes the same bytes instead of searching or downloading again.
 */
export interface FetchedImageAssetReceipt extends FetchedImageIpc {
  readonly provider: string;
  readonly query: string;
}

export function fetchedImageAssetReceipt(
  image: FetchedImageResult,
  query: string,
  provider = 'openverse',
): FetchedImageAssetReceipt {
  return {
    id: image.id,
    relPath: image.relPath,
    url: image.url,
    thumbUrl: image.thumbUrl,
    attribution: image.attribution,
    license: image.license,
    sha256: image.sha256,
    sizeBytes: image.sizeBytes,
    provider,
    query,
  };
}

/**
 * Search/download through Rust without making the bytes part of the notebook.
 *
 * The Rust command currently writes a content-addressed file beneath the
 * library asset root, which is the only safe SSRF-guarded download seam. This
 * function intentionally creates no database row. Rejected previews therefore
 * cannot appear in the normal asset catalogue, while approved previews can
 * promote this exact `relPath` without refetching mutable remote content.
 */
export async function stageFetchedImages(
  query: string,
  count = 3,
  provider = 'openverse',
): Promise<FetchedImageResult[]> {
  if (!isTauri()) return [];
  const { invoke } = await import('@tauri-apps/api/core');
  const fetched = await invoke<FetchedImageIpc[]>('fetch_images', {
    query,
    count,
    provider,
  });
  return Promise.all(
    fetched.map(async (item) => ({ ...item, src: await resolveAssetSrc(item.relPath) })),
  );
}

/** Promote already-downloaded immutable bytes into the notebook asset index. */
export async function promoteFetchedImageAssets(
  receipts: readonly FetchedImageAssetReceipt[],
): Promise<void> {
  const unique = new Map(receipts.map((receipt) => [receipt.id, receipt]));
  for (const item of unique.values()) {
    if (isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      const verified = await invoke<{
        relPath: string;
        sha256: string;
        sizeBytes: number;
      }>('verify_image_asset', { relPath: item.relPath });
      if (
        verified.relPath !== item.relPath ||
        verified.sha256 !== item.sha256 ||
        verified.sizeBytes !== item.sizeBytes
      ) {
        throw new Error(
          'A searched image changed after the reviewed preview. Refresh the preview before inserting.',
        );
      }
    }
    await recordAssetRow(item.id, item.relPath, {
      sourceUrl: item.url,
      attribution: item.attribution,
      license: item.license,
      provider: item.provider,
      query: item.query,
    }, 'image');
  }
}

/**
 * Remove only catalogue rows created by an abandoned AI apply. Content bytes
 * remain content-addressed and may still be shared by another asset/preview.
 */
export async function rollbackFetchedImageAssetPromotions(
  receipts: readonly FetchedImageAssetReceipt[],
  createdIds: readonly string[] = receipts.map((receipt) => receipt.id),
): Promise<void> {
  if (createdIds.length === 0) return;
  const db = await getDb();
  for (const id of new Set(createdIds)) {
    await db.execute('DELETE FROM assets WHERE id = $1', [id]);
  }
}

/** Snapshot which staged assets lack a catalogue row before promotion. */
export async function missingFetchedImageAssetIds(
  receipts: readonly FetchedImageAssetReceipt[],
): Promise<readonly string[]> {
  if (receipts.length === 0) return [];
  const db = await getDb();
  const missing: string[] = [];
  for (const id of new Set(receipts.map((receipt) => receipt.id))) {
    const rows = await db.select<Array<{ id: string }>>(
      'SELECT id FROM assets WHERE id = $1 LIMIT 1',
      [id],
    );
    if (rows.length === 0) missing.push(id);
  }
  return missing;
}

/**
 * Search openly-licensed images, cache them as local assets (Rust side),
 * record their asset rows, and return displayable srcs. Tauri-only —
 * resolves to `[]` in the browser dev shell.
 */
export async function fetchImages(
  query: string,
  count = 3,
  provider = 'openverse',
): Promise<FetchedImageResult[]> {
  const results = await stageFetchedImages(query, count, provider);
  await promoteFetchedImageAssets(
    results.map((result) => fetchedImageAssetReceipt(result, query, provider)),
  );
  return results;
}
