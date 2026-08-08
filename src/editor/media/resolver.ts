/**
 * Asset src resolution — maps a stored `rel_path` (relative to
 * `app_data_dir/assets/`, e.g. `images/9f2a….png`) to a displayable
 * `<img src>` in both environments:
 *
 * - Tauri: `convertFileSrc(appDataDir + '/assets/' + relPath)` → asset
 *   protocol URL (assetProtocol scope `$APPDATA/assets/**` is enabled in
 *   tauri.conf.json).
 * - Browser dev (plain vite): object URLs registered by the paste pipeline,
 *   falling back to an inline placeholder so nothing 404s.
 *
 * `assetSrcFromRoot` is the pure joining logic (unit-tested in
 * tests/media.test.ts); `resolveAssetSrc` is the environment-aware wrapper.
 */
import { getLibraryInfo, isTauri } from '../../data/db';

/** Normalize a rel_path: forward slashes, no leading slash, no `..`. */
export function normalizeRelPath(relPath: string): string {
  const parts = relPath
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p.length > 0 && p !== '.' && p !== '..');
  return parts.join('/');
}

/**
 * Pure join of an assets-root path/URL and a rel_path. The root may or may
 * not end with a slash; the result always uses forward slashes.
 */
export function assetSrcFromRoot(root: string, relPath: string): string {
  const cleanRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  return `${cleanRoot}/${normalizeRelPath(relPath)}`;
}

// ---------------------------------------------------------------------------
// Browser-dev object URL registry
// ---------------------------------------------------------------------------

const devObjectUrls = new Map<string, string>();

/** Register a dev-only object URL for a rel_path (browser paste fallback). */
export function registerDevAssetUrl(relPath: string, objectUrl: string): void {
  devObjectUrls.set(normalizeRelPath(relPath), objectUrl);
}

/** Tiny hand-drawn "missing image" placeholder (inline SVG data URI). */
export const MISSING_ASSET_SRC =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120">' +
      '<rect x="6" y="6" width="148" height="108" fill="#f7f1e3" ' +
      'stroke="#8a7a63" stroke-width="2" stroke-dasharray="7 4" rx="6"/>' +
      '<circle cx="52" cy="48" r="11" fill="none" stroke="#8a7a63" stroke-width="2"/>' +
      '<path d="M20 96 L62 62 L88 84 L112 58 L140 96" fill="none" ' +
      'stroke="#8a7a63" stroke-width="2" stroke-linejoin="round"/></svg>',
  );

// ---------------------------------------------------------------------------
// Environment-aware resolution
// ---------------------------------------------------------------------------

let assetsRootPromise: Promise<string> | null = null;

async function tauriAssetsRoot(): Promise<string> {
  assetsRootPromise ??= getLibraryInfo().then((info) => info.assetsRoot);
  return assetsRootPromise;
}

/**
 * Resolve a stored rel_path to a displayable src for the current
 * environment. Never throws — unresolvable paths get the placeholder.
 */
export async function resolveAssetSrc(relPath: string): Promise<string> {
  const clean = normalizeRelPath(relPath);
  if (clean.length === 0) return MISSING_ASSET_SRC;
  if (isTauri()) {
    try {
      const [{ convertFileSrc }, root] = await Promise.all([
        import('@tauri-apps/api/core'),
        tauriAssetsRoot(),
      ]);
      return convertFileSrc(assetSrcFromRoot(root, clean));
    } catch {
      return MISSING_ASSET_SRC;
    }
  }
  return devObjectUrls.get(clean) ?? MISSING_ASSET_SRC;
}
