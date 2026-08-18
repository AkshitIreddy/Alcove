import { parseNotebookScriptPages } from '../../editor/script/pageBoundaries';
import type { Block } from '../../script';
import { explicitImageRequest } from './imageIntent';
import { readerUsesImplicitAttachmentDefault } from './intent';
import type { AgentState } from './types';

export interface ObservedManagedImageAsset {
  readonly path: string;
  readonly label: string;
  readonly width?: number;
  readonly height?: number;
}

function currentReaderTurns(state: AgentState): AgentState['modelHistory'] {
  const anchorId = state.budgetWindow?.readerMessageId;
  const anchorIndex = anchorId === undefined
    ? 0
    : state.modelHistory.findIndex(
        (turn) => turn.role === 'user' && turn.id === anchorId,
      );
  return state.modelHistory.slice(anchorIndex >= 0 ? anchorIndex : state.modelHistory.length);
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

/**
 * Exact managed image paths actually exposed by a source-read tool in this
 * reader turn. These are local authority receipts, not model claims.
 */
export function observedManagedImageAssets(
  state: AgentState,
): readonly ObservedManagedImageAsset[] {
  const imageSourceIds = new Set(
    state.sourceManifest?.sources
      .filter((source) => source.kind === 'image')
      .map((source) => source.id) ?? [],
  );
  if (imageSourceIds.size === 0) return [];
  const assets: ObservedManagedImageAsset[] = [];
  for (const turn of currentReaderTurns(state)) {
    if (
      turn.role !== 'tool' || turn.isError ||
      (turn.toolName !== 'read_full_source' && turn.toolName !== 'read_source_range')
    ) continue;
    const content = record(turn.content);
    const visualRefs = Array.isArray(content?.visualRefs) ? content.visualRefs : [];
    for (const value of visualRefs) {
      const visual = record(value);
      const anchor = record(visual?.anchor);
      const image = record(visual?.image);
      const path = visual?.portableAssetPath;
      const label = visual?.label;
      if (
        typeof path === 'string' && path.trim() !== '' &&
        typeof anchor?.sourceId === 'string' &&
        imageSourceIds.has(anchor.sourceId)
      ) {
        assets.push({
          path: path.trim(),
          label:
            typeof label === 'string' && label.trim() !== ''
              ? label.trim()
              : 'Attached image',
          ...(typeof image?.width === 'number' ? { width: image.width } : {}),
          ...(typeof image?.height === 'number' ? { height: image.height } : {}),
        });
      }
    }
  }
  return [...new Map(assets.map((asset) => [asset.path, asset])).values()]
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function observedManagedImageAssetPaths(state: AgentState): readonly string[] {
  return observedManagedImageAssets(state).map((asset) => asset.path);
}

/**
 * A newly attached image is the content of “add this to my book” unless the
 * reader explicitly says not to include images. Repairs may change layout and
 * prose, but they may not silently delete this exact managed asset.
 */
export function requiredManagedImageAssetPaths(state: AgentState): readonly string[] {
  const directive = explicitImageRequest(state);
  if (!directive.requested && directive.evidence !== undefined) return [];
  return observedManagedImageAssetPaths(state);
}

function collectBlockAssets(blocks: readonly Block[], paths: string[]): void {
  for (const block of blocks) {
    if (block.kind === 'image') {
      const value = block.attrs.asset;
      if (typeof value === 'string' && value.trim() !== '') paths.push(value.trim());
    } else if (block.kind === 'container') {
      collectBlockAssets(block.children, paths);
    }
  }
}

/** Asset paths on real parsed image blocks; code fences/comments do not count. */
export function notebookScriptManagedImageAssetPaths(script: string): readonly string[] {
  const paths: string[] = [];
  for (const page of parseNotebookScriptPages(script).pages) {
    collectBlockAssets(page.doc.blocks, paths);
  }
  return [...new Set(paths)].sort();
}

export function missingRequiredManagedImageAssetPaths(
  state: AgentState,
  script = state.draft?.script ?? '',
): readonly string[] {
  const present = new Set(notebookScriptManagedImageAssetPaths(script));
  return requiredManagedImageAssetPaths(state).filter((path) => !present.has(path));
}

function safeInlineText(value: string): string {
  return value
    .replace(/[\[\]{}<>]/g, ' ')
    .replace(/["'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Attached image';
}

function widthFor(asset: ObservedManagedImageAsset): number {
  const width = asset.width ?? 0;
  const height = asset.height ?? 0;
  if (width > 0 && height > width * 1.18) return 48;
  if (height > 0 && width > height * 1.18) return 82;
  return 64;
}

function insertionOffsetAfterOpening(script: string): number {
  const rows = [...script.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)]
    .filter((match) => match[0] !== '');
  let frontmatterClosed = script.trimStart().startsWith('---') ? false : true;
  let offset = 0;
  for (const [index, row] of rows.entries()) {
    offset += row[0].length;
    const text = row[0].replace(/[\r\n]+$/g, '').trim();
    if (!frontmatterClosed) {
      if (index > 0 && text === '---') frontmatterClosed = true;
      continue;
    }
    if (/^#{1,3}\s+\S/u.test(text)) return offset;
  }
  return frontmatterClosed ? 0 : offset;
}

/**
 * Canonical local repair for a model that understood the picture but omitted
 * or mis-syntaxed its managed image block. The reader already authorized this
 * exact payload; inserting the local receipt does not invent content or grant
 * write authority, and the resulting pixels still face normal review.
 */
export function ensureRequiredManagedImagesInNotebookScript(
  state: AgentState,
  script: string,
): { readonly script: string; readonly insertedPaths: readonly string[] } {
  const assetsByPath = new Map(
    observedManagedImageAssets(state).map((asset) => [asset.path, asset]),
  );
  const canonicalizedPaths: string[] = [];
  const normalizedScript = script.replace(
    /!\[([^\]]*)\]\((ai\/attachments\/[^)\s]+)\)(?:\{[^{}]*\})?/giu,
    (whole, rawAlt: string, rawPath: string) => {
      const asset = assetsByPath.get(rawPath.trim());
      if (asset === undefined) return whole;
      canonicalizedPaths.push(asset.path);
      const alt = safeInlineText(rawAlt || asset.label);
      return `![${alt}](){asset="${asset.path}", width=${widthFor(asset)}, align=center, style=polaroid, caption="${alt}"}`;
    },
  );
  const required = new Set(requiredManagedImageAssetPaths(state));
  const present = new Set(notebookScriptManagedImageAssetPaths(normalizedScript));
  const missing = observedManagedImageAssets(state).filter(
    (asset) => required.has(asset.path) && !present.has(asset.path),
  );
  if (missing.length === 0) {
    return {
      script: normalizedScript,
      insertedPaths: [...new Set(canonicalizedPaths)],
    };
  }
  const blocks = missing.map((asset) => {
    const label = safeInlineText(asset.label);
    return `![${label}](){asset="${asset.path}", width=${widthFor(asset)}, align=center, style=polaroid, caption="${label}"}`;
  }).join('\n\n');
  const offset = insertionOffsetAfterOpening(normalizedScript);
  const before = normalizedScript.slice(0, offset).trimEnd();
  const after = normalizedScript.slice(offset).trimStart();
  return {
    script: [before, blocks, after].filter((part) => part !== '').join('\n\n'),
    insertedPaths: [...new Set([
      ...canonicalizedPaths,
      ...missing.map((asset) => asset.path),
    ])],
  };
}

function firstHeading(script: string): string | undefined {
  const match = /^#{1,3}\s+(.+)$/mu.exec(script);
  if (match === null) return undefined;
  return safeInlineText(
    match[1]
      .replace(/\s+\{[^{}]*\}\s*$/u, '')
      .replace(/[*_~=`]/g, ''),
  );
}

/**
 * “Add to my book” with one dense picture means preserve the picture, not
 * silently transcribe it into a chapter. Keep a model-authored concise draft
 * untouched; compact only obviously expanded outputs.
 */
export function applyVagueManagedImageDefault(
  state: AgentState,
  script: string,
): { readonly script: string; readonly compacted: boolean } {
  if (!readerUsesImplicitAttachmentDefault(state)) return { script, compacted: false };
  const assets = observedManagedImageAssets(state).filter((asset) =>
    requiredManagedImageAssetPaths(state).includes(asset.path));
  if (assets.length !== 1) return { script, compacted: false };
  const asset = assets[0]!;
  const title = firstHeading(script) ?? safeInlineText(asset.label);
  const label = safeInlineText(asset.label);
  return {
    script: [
      '---',
      'paper: grid',
      'wash: sky',
      '---',
      '',
      `# ${title}`,
      '',
      `![${label}](){asset="${asset.path}", width=${widthFor(asset)}, align=center, style=polaroid, caption="${title}"}`,
    ].join('\n'),
    compacted: true,
  };
}
