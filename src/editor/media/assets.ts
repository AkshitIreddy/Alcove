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

/** Persist a dropped video through the same content-addressed asset writer. */
export async function storeVideoFile(file: File | Blob): Promise<StoredAsset> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = file.type.startsWith('video/') ? file.type.slice(6) : 'mp4';
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
}

export interface FetchedImageResult extends FetchedImageIpc {
  /** Displayable src resolved for the current environment. */
  src: string;
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
  if (!isTauri()) return [];
  const { invoke } = await import('@tauri-apps/api/core');
  const fetched = await invoke<FetchedImageIpc[]>('fetch_images', {
    query,
    count,
    provider,
  });
  const results: FetchedImageResult[] = [];
  for (const item of fetched) {
    await recordAssetRow(item.id, item.relPath, {
      sourceUrl: item.url,
      attribution: item.attribution,
      license: item.license,
      provider,
      query,
    }, 'image');
    results.push({ ...item, src: await resolveAssetSrc(item.relPath) });
  }
  return results;
}
