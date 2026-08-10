/**
 * Pure image-placeholder contract shared by the script-facing tests and the
 * Solid image node view. Kept out of imageView.tsx so persistence and schema
 * behavior remain testable in Vitest's deliberate no-DOM environment.
 */
import { storeImageFile, type StoredAsset } from './assets';

/** The prompt only owns an empty-src image; filled images are ordinary media. */
export function imagePlaceholderPrompt(
  attrs: Readonly<Record<string, unknown>>,
): string | null {
  const src = typeof attrs.src === 'string' ? attrs.src.trim() : '';
  const assetRelPath =
    typeof attrs.assetRelPath === 'string'
      ? attrs.assetRelPath.trim()
      : typeof attrs.asset === 'string'
        ? attrs.asset.trim()
        : '';
  const prompt =
    typeof attrs.placeholder === 'string' ? attrs.placeholder.trim() : '';
  return src === '' && assetRelPath === '' && prompt !== '' ? prompt : null;
}

export type StorePlaceholderImage = (
  file: File | Blob,
) => Promise<Pick<StoredAsset, 'src' | 'relPath'>>;

/**
 * Persist one replacement through the same content-addressed media pipeline
 * used by paste/drop, then return the deliberately tiny node patch. Caption,
 * alt, frame, width and effects are absent from the patch, so replacing a
 * picture can never erase the AI-authored presentation around it.
 */
export async function persistPlaceholderImage(
  file: File | Blob,
  store: StorePlaceholderImage = storeImageFile,
): Promise<{ src: string; assetRelPath: string; placeholder: null }> {
  if (!file.type.startsWith('image/')) {
    throw new Error('the placeholder accepts one image file');
  }
  const stored = await store(file);
  if (stored.src.trim() === '') throw new Error('the saved image has no source');
  if (stored.relPath.trim() === '') {
    throw new Error('the saved image has no portable asset path');
  }
  return {
    src: stored.src,
    assetRelPath: stored.relPath,
    placeholder: null,
  };
}

/** TipTap attribute spec: the prompt survives editor JSON and HTML round-trips. */
export const IMAGE_PLACEHOLDER_ATTRIBUTE = {
  default: null,
  parseHTML: (element: HTMLElement): string | null =>
    element.getAttribute('data-image-placeholder'),
  renderHTML: (attributes: Record<string, unknown>): Record<string, string> =>
    typeof attributes.placeholder === 'string' &&
    attributes.placeholder.trim() !== ''
      ? { 'data-image-placeholder': attributes.placeholder }
      : {},
};
