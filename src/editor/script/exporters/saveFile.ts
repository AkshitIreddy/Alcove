/**
 * src/editor/script/exporters/saveFile.ts — environment-aware "save bytes".
 *
 * - Tauri: plugin-dialog save picker → plugin-fs writeFile.
 * - Browser dev: object-URL anchor download (Playwright asserts on the
 *   download event in tests/e2e/import-export.spec.ts).
 */
import { isTauri } from '../../../data/db';

export interface SaveFilter {
  name: string;
  extensions: string[];
}

export type SaveOutcome = 'saved' | 'cancelled' | 'failed';

export async function saveBytes(
  bytes: Uint8Array,
  suggestedName: string,
  mime: string,
  filters: SaveFilter[],
): Promise<SaveOutcome> {
  if (isTauri()) {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const path = await save({ defaultPath: suggestedName, filters });
      if (path === null) return 'cancelled';
      const { writeFile } = await import('@tauri-apps/plugin-fs');
      await writeFile(path, bytes);
      return 'saved';
    } catch {
      return 'failed';
    }
  }
  try {
    const blob = new Blob([bytes.slice().buffer], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = suggestedName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 4000);
    return 'saved';
  } catch {
    return 'failed';
  }
}

/** `my title` → `my-title` filename stem (never empty). */
export function fileStem(title: string, fallback = 'notebook'): string {
  const stem = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return stem === '' ? fallback : stem;
}
