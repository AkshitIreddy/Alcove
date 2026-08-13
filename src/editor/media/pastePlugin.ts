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
import { Slice, type Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { isTauri } from '../../data/db';
import { classifyPaste } from './classify';
import { insertMediaFiles, mediaFilesFrom } from './insert';
import type { LinkCardStatus } from './linkCard';
import { checkFetchableUrl } from './urlGuard';
import { notify } from '../script/exporters/toast';
import { structuredPasteContent } from '../smartPaste';

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

function videoFilesFrom(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];
  return Array.from(transfer.files).filter((file) =>
    file.type.startsWith('video/'),
  );
}

function inCodeBlock(view: EditorView): boolean {
  const { $from } = view.state.selection;
  return $from.parent.type.spec.code === true;
}

/**
 * Store a clipboard payload after the synchronous paste handler has claimed
 * it. Claiming the event suppresses ProseMirror's default paste, so a failed
 * store must be visible rather than leaving the reader with no block and no
 * explanation. Partial batches are reported too: silently dropping one file
 * out of several is the same bug in a less obvious shape.
 */
function insertPastedMedia(view: EditorView, files: readonly File[]): void {
  const failedMessage =
    files.length === 1 && files[0]?.type.startsWith('image/')
      ? 'image could not be added'
      : files.length === 1 && files[0]?.type.startsWith('video/')
        ? 'video could not be added'
        : 'pasted media could not be added';

  void insertMediaFiles(view, files, null)
    .then((inserted) => {
      if (inserted === 0) notify(failedMessage);
      else if (inserted < files.length) notify('some pasted media could not be added');
    })
    .catch(() => notify(failedMessage));
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
        const images = imageFilesFrom(event.clipboardData);
        const videos = videoFilesFrom(event.clipboardData);
        const text = event.clipboardData?.getData('text/plain') ?? '';
        const action = classifyPaste({
          imageFileCount: images.length,
          videoFileCount: videos.length,
          text,
          selectionEmpty: view.state.selection.empty,
          inCodeBlock: inCodeBlock(view),
        });
        switch (action.kind) {
          case 'insert-media':
            event.preventDefault();
            insertPastedMedia(view, [...images, ...videos]);
            return true;
          case 'insert-link-card':
            event.preventDefault();
            return insertLinkCard(view, action.url);
          default:
            break;
        }
        // Inside source code, paste bytes literally into the existing block.
        // Structural upgrades would split/lift the selection into new blocks.
        if (inCodeBlock(view)) return false;
        // Rich clipboard HTML already carries its table/list semantics and is
        // better handled by ProseMirror's DOM parser.  Upgrade only a
        // plain-text payload whose structure would otherwise be flattened.
        const html = event.clipboardData?.getData('text/html') ?? '';
        const semanticHtml = /<(?:table|thead|tbody|tr|ul|ol|li|blockquote|h[1-6])\b/i.test(html);
        if (semanticHtml) return false;
        const structured = structuredPasteContent(
          text,
          (name) => view.state.schema.nodes[name] !== undefined,
        );
        if (structured === null || structured.content.length === 0) return false;
        try {
          const documentNode = view.state.schema.nodeFromJSON({
            type: 'doc',
            content: structured.content,
          });
          event.preventDefault();
          view.dispatch(
            view.state.tr
              .replaceSelection(new Slice(documentNode.content, 0, 0))
              .scrollIntoView(),
          );
          notify(
            structured.kind === 'table' || structured.kind === 'json-table'
              ? 'Pasted data shaped into a table'
              : structured.kind === 'code'
                ? 'Pasted code kept as a code block'
                : 'Pasted structure kept as Alcove blocks',
          );
          return true;
        } catch {
          return false;
        }
      },

      handleDrop(view, event, _slice, moved) {
        if (moved) return false; // internal block drag, not a file drop
        const files = mediaFilesFrom(event.dataTransfer);
        if (files.length === 0) return false;
        event.preventDefault();
        const coords = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        void insertMediaFiles(view, files, coords?.pos ?? null);
        return true;
      },
    },
  });
}
