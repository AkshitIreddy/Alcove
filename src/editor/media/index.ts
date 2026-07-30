/**
 * Media pipeline — public surface.
 *
 * Wiring (done by the orchestrator, not here):
 * 1. src/editor/nodes/index.ts — register the linkCard node:
 *      registerCustomNode({ name: LinkCard.name, extension: LinkCard });
 * 2. src/editor/extensions.ts — replace the local `NotebookImage` with
 *      MediaImage.configure({ allowBase64: true })
 *    (same node name/`widthPct` contract, adds align/caption/frame + view).
 * 3. src/editor/PageEditor.tsx — install the paste/drop plugin, e.g. via a
 *    tiny extension:  addProseMirrorPlugins: () => [createMediaPastePlugin()]
 *    (or push it into the view with `registerPlugin`).
 */
import '../../styles/media.css';

export {
  checkFetchableUrl,
  isBareUrl,
  isBlockedHost,
  hostOf,
  type UrlCheck,
} from './urlGuard';

export {
  assetSrcFromRoot,
  normalizeRelPath,
  registerDevAssetUrl,
  resolveAssetSrc,
  MISSING_ASSET_SRC,
} from './resolver';

export {
  fetchImages,
  recordAssetRow,
  storeImageBytes,
  storeImageFile,
  type FetchedImageResult,
  type StoredImage,
} from './assets';

export {
  classifyPaste,
  groupImageSources,
  type PasteAction,
  type PasteContext,
} from './classify';

export {
  createMediaPastePlugin,
  mediaPastePluginKey,
} from './pastePlugin';

export {
  LinkCard,
  LINK_CARD_STATUSES,
  openExternal,
  type LinkCardAttributes,
  type LinkCardStatus,
} from './linkCard';

export {
  MediaImage,
  IMAGE_ALIGNMENTS,
  IMAGE_FRAMES,
  clampWidthPct,
  type ImageAlign,
  type ImageFrame,
} from './imageView';
