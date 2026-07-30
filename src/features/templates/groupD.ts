/**
 * src/features/templates/groupD.ts — group D's public wiring surface.
 *
 * One import gives the rail (BookRail/BookView, owned by group B this wave)
 * everything it needs:
 *
 *   import {
 *     openTemplatesGallery,   // roadmap 26 — "+ from template"
 *     importMarkdownBooks,    // roadmap 25 — "Import Markdown"
 *     openExportPdfDialog,    // roadmap 23 — "Export PDF" (page / whole book)
 *     exportActivePagePng,    // roadmap 24 — "Export page PNG"
 *   } from '../features/templates/groupD';
 *
 * Importing this module also hydrates the user-sticker registry from the
 * assets table (roadmap 27) and, in dev builds, exposes the flows on
 * `window.__nbGroupD` so the Playwright suite can drive them before the
 * rail buttons are wired.
 */
import {
  exportActivePagePdf,
  exportActivePagePng,
  exportOpenBookPdf,
} from '../../editor/script/exporters/exportPage';
import { insertSticker } from '../../editor/api';
import {
  listUserStickers,
  registerUserSticker,
} from '../../editor/nodes/stickers';
import { registerScriptStickerName } from '../../script/vocab';
import { openTemplatesGallery } from './TemplatesGallery';
import { openExportPdfDialog } from './ExportPdfDialog';
import { importMarkdownBooks } from './importMarkdown';
import { importUserStickers, loadUserStickers } from './userStickers';

export { openTemplatesGallery } from './TemplatesGallery';
export { openExportPdfDialog } from './ExportPdfDialog';
export { importMarkdownBooks } from './importMarkdown';
export {
  exportActivePagePdf,
  exportActivePagePng,
  exportOpenBookPdf,
} from '../../editor/script/exporters/exportPage';
export { importUserStickers, loadUserStickers } from './userStickers';
export {
  ExportPdfIcon,
  ExportPngIcon,
  ImportMdIcon,
  TemplatesIcon,
} from './icons';
export { default as UserStickersSection } from './UserStickersSection';

// Hydrate persisted custom stickers once per app boot.
void loadUserStickers();

// Dev-only E2E hooks (the Playwright suite runs against `vite dev`).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__nbGroupD = {
    openTemplatesGallery,
    openExportPdfDialog,
    importMarkdownBooks,
    exportActivePagePng,
    exportActivePagePdf,
    exportOpenBookPdf,
    importUserStickers,
    listUserStickers,
    insertSticker,
    registerUserSticker: (name: string, src: string) => {
      const id = registerUserSticker(name, src);
      registerScriptStickerName(id);
      return id;
    },
  };
}
