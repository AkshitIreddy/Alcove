/** Shared media insertion for paste, OS drop, and the context menu. */
import type { Editor } from '@tiptap/core';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { storeImageFile, storeVideoFile } from './assets';
import { groupImageSources } from './classify';
import {
  imageFileDimensions,
  safeStandaloneUploadWidth,
} from './initialImageFit';

export type MediaFileKind = 'image' | 'video';

export function mediaKindForFile(file: Pick<File, 'type'>): MediaFileKind | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return null;
}

export function mediaFilesFrom(transfer: DataTransfer | null): File[] {
  if (transfer === null) return [];
  return Array.from(transfer.files).filter(
    (file) => mediaKindForFile(file) !== null,
  );
}

interface StoredImageSource {
  src: string;
  assetRelPath: string;
  intrinsicWidth?: number;
  intrinsicHeight?: number;
}

function imageBlocks(
  view: EditorView,
  sources: readonly StoredImageSource[],
): PMNode[] {
  const imageType = view.state.schema.nodes.image;
  const rowType = view.state.schema.nodes.imageRow;
  if (imageType === undefined) return [];
  const safeAttrs = (source: StoredImageSource): Record<string, unknown> => {
    const widthPct =
      source.intrinsicWidth !== undefined && source.intrinsicHeight !== undefined
        ? safeStandaloneUploadWidth({
            intrinsicWidth: source.intrinsicWidth,
            intrinsicHeight: source.intrinsicHeight,
            pageWidthPx: view.dom.clientWidth,
            pageCapacityPx: Number(view.dom.dataset.pageCapacityPx),
          })
        : 100;
    return {
      src: source.src,
      assetRelPath: source.assetRelPath,
      widthPct: widthPct < 100 ? widthPct : null,
      initialFitPending: false,
    };
  };
  if (sources.length === 1 || rowType === undefined) {
    return sources.map((source) => imageType.create(safeAttrs(source)));
  }
  return groupImageSources(sources).map((group) =>
    group.length === 1
      ? imageType.create(safeAttrs(group[0]))
      : rowType.create(
          null,
          // A row already divides the page width between its children; a
          // standalone safety percentage would incorrectly be applied again.
          group.map((source) =>
            imageType.create({
              src: source.src,
              assetRelPath: source.assetRelPath,
              initialFitPending: false,
            }),
          ),
        ),
  );
}

function videoBlock(
  view: EditorView,
  source: StoredImageSource,
): PMNode | null {
  return view.state.schema.nodes.video?.create(source) ?? null;
}

/** Persist and insert supported files. Returns the number successfully added. */
export async function insertMediaFiles(
  view: EditorView,
  files: readonly File[],
  pos: number | null,
): Promise<number> {
  if (files.length === 0 || view.isDestroyed) return 0;

  const stored = await Promise.all(
    files.map(async (file) => {
      const kind = mediaKindForFile(file);
      if (kind === null) return null;
      try {
        const [asset, dimensions] = await Promise.all([
          kind === 'image' ? storeImageFile(file) : storeVideoFile(file),
          kind === 'image' ? imageFileDimensions(file) : Promise.resolve(null),
        ]);
        return {
          kind,
          src: asset.src,
          assetRelPath: asset.relPath,
          intrinsicWidth: dimensions?.width,
          intrinsicHeight: dimensions?.height,
        };
      } catch {
        return null;
      }
    }),
  );
  if (view.isDestroyed) return 0;

  // Preserve drop order. Adjacent images still share an imageRow; a video
  // between them remains between them rather than being shuffled to the end.
  const blocks: PMNode[] = [];
  let pendingImages: StoredImageSource[] = [];
  const flushImages = (): void => {
    blocks.push(...imageBlocks(view, pendingImages));
    pendingImages = [];
  };
  for (const item of stored) {
    if (item === null) continue;
    if (item.kind === 'image') {
      pendingImages.push({
        src: item.src,
        assetRelPath: item.assetRelPath,
        intrinsicWidth: item.intrinsicWidth,
        intrinsicHeight: item.intrinsicHeight,
      });
      continue;
    }
    flushImages();
    const video = videoBlock(view, {
      src: item.src,
      assetRelPath: item.assetRelPath,
    });
    if (video !== null) blocks.push(video);
  }
  flushImages();
  if (blocks.length === 0) return 0;

  const tr = view.state.tr;
  if (pos === null) {
    tr.replaceSelection(new Slice(Fragment.from(blocks), 0, 0));
  } else {
    const at = Math.max(0, Math.min(pos, view.state.doc.content.size));
    // `posAtCoords` can sit inside a paragraph. replaceRange finds the nearest
    // valid block boundary (and splits text when needed); `tr.insert` would
    // try to put a block inside inline content and can reject the whole drop.
    tr.replaceRange(at, at, new Slice(Fragment.from(blocks), 0, 0));
  }
  view.dispatch(tr.scrollIntoView());
  return stored.filter((item) => item !== null).length;
}

export async function insertMediaFilesInEditor(
  editor: Editor,
  files: readonly File[],
  pos: number | null,
): Promise<number> {
  if (editor.isDestroyed) return 0;
  return insertMediaFiles(editor.view, files, pos);
}

export function pickMediaFiles(
  accept: string,
  multiple = true,
): Promise<readonly File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.hidden = true;
    document.body.appendChild(input);
    let finished = false;
    const finish = (files: readonly File[]): void => {
      if (finished) return;
      finished = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])), {
      once: true,
    });
    input.addEventListener('cancel', () => finish([]), { once: true });
    input.click();
  });
}

export async function readClipboardImageFile(): Promise<File | null> {
  if (navigator.clipboard?.read === undefined) return null;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((candidate) => candidate.startsWith('image/'));
      if (type === undefined) continue;
      const blob = await item.getType(type);
      return new File([blob], `clipboard.${type.slice(6) || 'png'}`, { type });
    }
  } catch {
    // Clipboard denial is a normal outcome; the caller reports it.
  }
  return null;
}
