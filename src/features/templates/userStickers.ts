/**
 * src/features/templates/userStickers.ts — roadmap item 27: custom stickers.
 *
 * Imported PNG/SVG files are persisted through the existing asset store
 * (assets table + `save_image_asset` in Tauri, object URLs in browser dev)
 * with `meta.customSticker = <name>`; the session registry in
 * src/editor/nodes/stickers.ts maps `user:<name>` → displayable src for the
 * sticker node, the palette and Notebook Script's `{sticker=user:<name>}`.
 */
import { nanoid } from 'nanoid';
import { getDb, isTauri } from '../../data/db';
import type { AssetRow } from '../../data/types';
import {
  listUserStickers,
  registerUserSticker,
  sanitizeStickerName,
  type UserStickerRecord,
} from '../../editor/nodes/stickers';
import { registerScriptStickerName } from '../../script/vocab';
import {
  recordAssetRow,
  storeImageBytes,
} from '../../editor/media/assets';
import {
  registerDevAssetUrl,
  resolveAssetSrc,
} from '../../editor/media/resolver';
import { notify } from '../../editor/script/exporters/toast';

const STICKER_META_KEY = 'customSticker';

function uniqueName(raw: string): string {
  const base = sanitizeStickerName(raw) || 'sticker';
  const taken = new Set(listUserStickers().map((s) => s.name));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${nanoid(4).toLowerCase()}`;
}

/** Register in the session registry + script vocab in one step. */
function registerEverywhere(name: string, src: string): UserStickerRecord {
  const id = registerUserSticker(name, src);
  registerScriptStickerName(id);
  return { id, name, src };
}

/**
 * Persist raw sticker bytes as an asset and register the sticker. `ext` is
 * 'png' or 'svg'. Returns the registered record.
 */
export async function addUserSticker(
  bytes: Uint8Array,
  ext: 'png' | 'svg',
  rawName: string,
): Promise<UserStickerRecord> {
  const name = uniqueName(rawName);
  const meta = { [STICKER_META_KEY]: name };

  if (isTauri()) {
    const stored = await storeImageBytes(bytes, ext, meta);
    return registerEverywhere(name, stored.src);
  }

  // Browser dev: own object URL so SVG gets its exact MIME type.
  const id = `stk_dev_${nanoid(10)}`;
  const relPath = `dev/${id}.${ext}`;
  const url = URL.createObjectURL(
    new Blob([bytes.slice().buffer], {
      type: ext === 'svg' ? 'image/svg+xml' : 'image/png',
    }),
  );
  registerDevAssetUrl(relPath, url);
  await recordAssetRow(id, relPath, meta);
  return registerEverywhere(name, url);
}

/**
 * Hydrate the session registry from the assets table (Tauri persistence;
 * browser-dev object URLs do not survive reloads and resolve to the
 * missing-sticker placeholder). Safe to call more than once.
 */
export async function loadUserStickers(): Promise<number> {
  try {
    const db = await getDb();
    const rows = await db.select<AssetRow[]>(
      "SELECT * FROM assets WHERE kind = 'image' ORDER BY created_at ASC",
    );
    let count = 0;
    for (const row of rows) {
      if (row.meta === null) continue;
      try {
        const meta: unknown = JSON.parse(row.meta);
        const name =
          meta !== null && typeof meta === 'object'
            ? (meta as Record<string, unknown>)[STICKER_META_KEY]
            : undefined;
        if (typeof name !== 'string' || name === '') continue;
        registerEverywhere(name, await resolveAssetSrc(row.rel_path));
        count += 1;
      } catch {
        // Corrupt meta is cosmetic — skip the row.
      }
    }
    return count;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Import pickers
// ---------------------------------------------------------------------------

function extOf(nameOrPath: string): 'png' | 'svg' | null {
  const lower = nameOrPath.toLowerCase();
  if (lower.endsWith('.png')) return 'png';
  if (lower.endsWith('.svg')) return 'svg';
  return null;
}

async function importTauriStickers(): Promise<UserStickerRecord[]> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({
    multiple: true,
    filters: [{ name: 'Sticker image', extensions: ['png', 'svg'] }],
  });
  if (picked === null) return [];
  const paths = Array.isArray(picked) ? picked : [picked];
  const { readFile } = await import('@tauri-apps/plugin-fs');
  const added: UserStickerRecord[] = [];
  for (const path of paths) {
    const ext = extOf(path);
    if (ext === null) continue;
    try {
      const base = path.replace(/\\/g, '/').split('/').pop() ?? path;
      added.push(await addUserSticker(await readFile(path), ext, base));
    } catch {
      notify('could not read that image');
    }
  }
  return added;
}

function importBrowserStickers(): Promise<UserStickerRecord[]> {
  return new Promise((resolve) => {
    document.querySelector('input[data-nb-sticker-import]')?.remove();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.png,.svg,image/png,image/svg+xml';
    input.multiple = true;
    input.setAttribute('data-nb-sticker-import', 'true');
    input.style.cssText =
      'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
    document.body.appendChild(input);

    let settled = false;
    const finish = async (): Promise<void> => {
      if (settled) return;
      settled = true;
      const added: UserStickerRecord[] = [];
      for (const file of Array.from(input.files ?? [])) {
        const ext =
          extOf(file.name) ??
          (file.type === 'image/svg+xml'
            ? 'svg'
            : file.type === 'image/png'
              ? 'png'
              : null);
        if (ext === null) continue;
        try {
          added.push(
            await addUserSticker(
              new Uint8Array(await file.arrayBuffer()),
              ext,
              file.name,
            ),
          );
        } catch {
          notify(`could not import ${file.name}`);
        }
      }
      input.remove();
      resolve(added);
    };

    input.addEventListener('change', () => void finish());
    window.addEventListener(
      'focus',
      () => setTimeout(() => void finish(), 1200),
      { once: true },
    );
    input.click();
  });
}

/** Full import flow (dialog → asset store → registry). */
export async function importUserStickers(): Promise<UserStickerRecord[]> {
  const added = isTauri()
    ? await importTauriStickers()
    : await importBrowserStickers();
  if (added.length > 0) {
    notify(
      added.length === 1
        ? `sticker “${added[0].name}” added — script: {sticker=${added[0].id}}`
        : `${added.length} stickers added`,
    );
  }
  return added;
}
