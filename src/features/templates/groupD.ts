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
 * assets table (roadmap 27).
 *
 * ## The dev bridge is not a home, and it hid that these had none
 *
 * `window.__nbGroupD` below was written so the Playwright suite could drive
 * these four "before the rail buttons are wired". The rail buttons were then
 * never wired, and for the whole of that time every one of the four passed its
 * own e2e spec — because the spec drove the bridge. Four finished features,
 * reachable only by typing a global into a console.
 *
 * They have real homes now, and each home is listed here so the next reader can
 * check the claim rather than trust it:
 *
 *   openTemplatesGallery   the shelf dock's "template" button, the bare-plank
 *                          right-click card, the book rail's template icon,
 *                          and `templates` (Ctrl+Alt+G).
 *   openExportPdfDialog    the book rail's "Take it out" sheet, and
 *                          `export-pdf` (Ctrl+Alt+P).
 *   exportActivePagePng    the same sheet, and `export-png`
 *                          (Ctrl+Shift+Alt+P).
 *   importMarkdownBooks    the same sheet, the settings sheet's "Library
 *                          files" section, and `import-markdown`
 *                          (Ctrl+Shift+Alt+M).
 *
 * The bridge stays — a probe that wants to run an export without hunting for a
 * button is a fair thing to want — but `tests/plugged-in.test.ts` no longer
 * counts it as a reader, so removing a button breaks the suite even while the
 * bridge still works. See that file's "part three".
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
  OutTrayIcon,
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
