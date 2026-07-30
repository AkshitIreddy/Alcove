/**
 * Media paste/drop plugin (ProseMirror):
 *
 * - image files/blobs from clipboard or drag-drop → stored via
 *   `save_image_asset` (Tauri) or object URLs (browser dev), inserted as an
 *   `image` block (one file) or `imageRow` blocks (2+ files, ≤4 per row);
 * - a bare URL pasted at an empty selection → `linkCard` in loading state,
 *   patched asynchronously by the Rust `fetch_link_preview` command,
 *   degrading to a plain link chip on failure;
 * - everything else falls through to ProseMirror's default handling.
 *
 * The decision logic lives in classify.ts (pure, unit-tested); the orchestrator
 * wires this plugin into the editor via `editorProps`/`addProseMirrorPlugins`.
 */
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { isTauri } from '../../data/db';
import { storeImageFile } from './assets';
import { classifyPaste, groupImageSources } from './classify';
import type { LinkCardStatus } from './linkCard';
import { checkFetchableUrl } from './urlGuard';

export const mediaPastePluginKey = new PluginKey('nb-media-paste');

interface LinkPreviewIpc {
  url: string;
  title: string | null;
  description: string | null;
  imageDataUri: string | null;
  faviconDataUri: string | null;
  siteName: string | null;
  error: string | null;
}

function imageFilesFrom(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];
  return Array.from(transfer.files).filter((file) =>
    file.type.startsWith('image/'),
  );
}

function inCodeBlock(view: EditorView): boolean {
  const { $from } = view.state.selection;
  return $from.parent.type.spec.code === true;
}

/** Clamp a captured position into the current doc (content may have moved). */
function clampPos(view: EditorView, pos: number): number {
  return Math.max(0, Math.min(pos, view.state.doc.content.size));
}

// ---------------------------------------------------------------------------
// Image insertion
// ---------------------------------------------------------------------------

function buildImageBlocks(view: EditorView, sources: readonly string[]): PMNode[] {
  const { schema } = view.state;
  const imageType = schema.nodes.image;
  const rowType = schema.nodes.imageRow;
  if (!imageType) return [];
  if (sources.length === 1 || !rowType) {
    return sources.map((src) => imageType.create({ src }));
  }
  return groupImageSources(sources).map((group) =>
    group.length === 1
      ? imageType.create({ src: group[0] })
      : rowType.create(null, group.map((src) => imageType.create({ src }))),
  );
}

async function insertImageFiles(
  view: EditorView,
  files: readonly File[],
  dropPos: number | null,
): Promise<void> {
  const stored = await Promise.all(
    files.map(async (file) => {
      try {
        return await storeImageFile(file);
      } catch {
        return null; // one unreadable file must not sink the batch
      }
    }),
  );
  const sources = stored
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .map((s) => s.src);
  if (sources.length === 0 || view.isDestroyed) return;

  const blocks = buildImageBlocks(view, sources);
  if (blocks.length === 0) return;

  const tr = view.state.tr;
  if (dropPos === null) {
    tr.replaceSelection(new Slice(Fragment.from(blocks), 0, 0));
  } else {
    tr.insert(clampPos(view, dropPos), blocks);
  }
  view.dispatch(tr.scrollIntoView());
}

// ---------------------------------------------------------------------------
// Link card insertion + async preview fill
// ---------------------------------------------------------------------------

function patchLoadingCard(
  view: EditorView,
  url: string,
  patch: Record<string, unknown> & { status: LinkCardStatus },
): void {
  if (view.isDestroyed) return;
  let foundPos = -1;
  let foundNode: PMNode | null = null;
  view.state.doc.descendants((node, pos) => {
    if (foundPos >= 0) return false;
    if (
      node.type.name === 'linkCard' &&
      node.attrs.url === url &&
      node.attrs.status === 'loading'
    ) {
      foundPos = pos;
      foundNode = node;
      return false;
    }
    return true;
  });
  if (foundPos < 0 || foundNode === null) return;
  view.dispatch(
    view.state.tr.setNodeMarkup(foundPos, undefined, {
      ...(foundNode as PMNode).attrs,
      ...patch,
    }),
  );
}

async function fillLinkPreview(view: EditorView, url: string): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const preview = await invoke<LinkPreviewIpc>('fetch_link_preview', { url });
    if (preview.error !== null && preview.error !== undefined) {
      patchLoadingCard(view, url, { status: 'plain' });
      return;
    }
    patchLoadingCard(view, url, {
      status: 'ready',
      title: preview.title,
      description: preview.description,
      imageDataUri: preview.imageDataUri,
      favicon: preview.faviconDataUri,
      siteName: preview.siteName,
    });
  } catch {
    patchLoadingCard(view, url, { status: 'plain' });
  }
}

function insertLinkCard(view: EditorView, url: string): boolean {
  const type = view.state.schema.nodes.linkCard;
  if (!type) return false;
  // Previews need the Rust side and a public https URL; otherwise the card
  // starts (and stays) as a plain link chip.
  const canPreview = isTauri() && checkFetchableUrl(url).ok;
  const node = type.create({ url, status: canPreview ? 'loading' : 'plain' });
  view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
  if (canPreview) void fillLinkPreview(view, url);
  return true;
}

// ---------------------------------------------------------------------------
// The plugin
// ---------------------------------------------------------------------------

/**
 * Create the media paste/drop plugin. Wire into the editor with
 * `editorProps: { plugins: [...] }` equivalent — see media/index.ts.
 */
export function createMediaPastePlugin(): Plugin {
  return new Plugin({
    key: mediaPastePluginKey,

    props: {
      handlePaste(view, event) {
        const files = imageFilesFrom(event.clipboardData);
        const text = event.clipboardData?.getData('text/plain') ?? '';
        const action = classifyPaste({
          imageFileCount: files.length,
          text,
          selectionEmpty: view.state.selection.empty,
          inCodeBlock: inCodeBlock(view),
        });
        switch (action.kind) {
          case 'insert-images':
            event.preventDefault();
            void insertImageFiles(view, files, null);
            return true;
          case 'insert-link-card':
            event.preventDefault();
            return insertLinkCard(view, action.url);
          default:
            return false;
        }
      },

      handleDrop(view, event, _slice, moved) {
        if (moved) return false; // internal block drag, not a file drop
        const files = imageFilesFrom(event.dataTransfer);
        if (files.length === 0) return false;
        event.preventDefault();
        const coords = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        void insertImageFiles(view, files, coords?.pos ?? null);
        return true;
      },
    },
  });
}
