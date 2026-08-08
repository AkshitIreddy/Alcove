/** Shared media insertion for paste, OS drop, and the context menu. */
import type { Editor } from '@tiptap/core';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { storeImageFile, storeVideoFile } from './assets';
import { groupImageSources } from './classify';

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

function imageBlocks(view: EditorView, sources: readonly string[]): PMNode[] {
  const imageType = view.state.schema.nodes.image;
  const rowType = view.state.schema.nodes.imageRow;
  if (imageType === undefined) return [];
  if (sources.length === 1 || rowType === undefined) {
    return sources.map((src) => imageType.create({ src }));
  }
  return groupImageSources(sources).map((group) =>
    group.length === 1
      ? imageType.create({ src: group[0] })
      : rowType.create(null, group.map((src) => imageType.create({ src }))),
  );
}

function videoBlock(view: EditorView, src: string): PMNode | null {
  return view.state.schema.nodes.video?.create({ src }) ?? null;
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
        const asset = kind === 'image'
          ? await storeImageFile(file)
          : await storeVideoFile(file);
        return { kind, src: asset.src };
      } catch {
        return null;
      }
    }),
  );
  if (view.isDestroyed) return 0;

  // Preserve drop order. Adjacent images still share an imageRow; a video
  // between them remains between them rather than being shuffled to the end.
  const blocks: PMNode[] = [];
  let pendingImages: string[] = [];
  const flushImages = (): void => {
    blocks.push(...imageBlocks(view, pendingImages));
    pendingImages = [];
  };
  for (const item of stored) {
    if (item === null) continue;
    if (item.kind === 'image') {
      pendingImages.push(item.src);
      continue;
    }
    flushImages();
    const video = videoBlock(view, item.src);
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
