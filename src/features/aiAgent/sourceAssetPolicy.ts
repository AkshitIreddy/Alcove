import { parseNotebookScriptPages } from '../../editor/script/pageBoundaries';
import { print, type Block } from '../../script';
import { explicitImageRequest } from './imageIntent';
import {
  latestReaderText,
  readerRequestsConciseAttachedImage,
  readerRequestsDominantAttachedImage,
  readerUsesImplicitAttachmentDefault,
} from './intent';
import type { AgentState } from './types';

export interface ObservedManagedImageAsset {
  readonly path: string;
  readonly label: string;
  readonly width?: number;
  readonly height?: number;
}

function currentReaderTurns(state: AgentState): AgentState['modelHistory'] {
  if (
    state.objective?.reason === 'reader_preview_feedback' &&
    state.draft?.sourceManifestDigest !== undefined &&
    state.draft.sourceManifestDigest === state.sourceManifest?.digest
  ) {
    // Explicit revision retains the exact reviewed draft/source authority but
    // starts a new reader-turn anchor. Reuse only immutable successful reads
    // from that same manifest; ordinary later chat remains turn-scoped.
    return state.modelHistory;
  }
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
  const readerText = latestReaderText(state);
  const refusesManagedImage =
    /\b(?:do\s+not|don['’]?t|dont|without|exclude|omit|leave\s+out|remove)\b[\s\S]{0,32}\b(?:attached\s+)?(?:image|picture|photo|infographic|diagram)\b/iu.test(
      readerText,
    );
  if (refusesManagedImage) return [];
  // The concise-image contract is itself an explicit reader decision: one
  // observed attached image is the primary page payload. Do not make that
  // authority depend on whether a later model draft or feedback turn happens
  // to repeat the word “image”.
  if (
    readerRequestsConciseAttachedImage(state) ||
    readerRequestsDominantAttachedImage(state) ||
    readerUsesImplicitAttachmentDefault(state) ||
    /\b(?:add|include|use|put|place)\b[\s\S]{0,48}\b(?:attached\s+)?(?:image|picture|photo|infographic|diagram)\b|\b(?:image|picture|photo|infographic|diagram)\b[\s\S]{0,48}\b(?:add|include|use|put|place)\b/iu.test(
      readerText,
    )
  ) {
    return observedManagedImageAssetPaths(state);
  }
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

function managedAttachmentAlias(path: string): string | undefined {
  const parts = path.split('/');
  const leaf = parts[parts.length - 1] ?? '';
  return /^(att_[0-9a-f]{64})(?:\.[a-z0-9]+)?$/iu.exec(leaf)?.[1]?.toLowerCase();
}

function widthFor(asset: ObservedManagedImageAsset, state?: AgentState): number {
  const width = asset.width ?? 0;
  const height = asset.height ?? 0;
  if (state !== undefined && readerRequestsDominantAttachedImage(state)) {
    if (width > 0 && height > width * 1.18) return 72;
    if (height > 0 && width > height * 1.18) return 92;
    return 82;
  }
  if (state !== undefined && readerRequestsConciseAttachedImage(state)) {
    // A portrait infographic needs room for its heading, frame and caption.
    // 72% looks large but spills a 3:2 portrait past the native sheet; 58%
    // is the largest fit-safe teaching size measured on the real renderer.
    if (width > 0 && height > width * 1.18) return 58;
    if (height > 0 && width > height * 1.18) return 90;
    return 74;
  }
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
  let normalizedScript = script.replace(
    /!\[([^\]]*)\]\((ai\/attachments\/[^)\s]+)\)(?:\{[^{}]*\})?/giu,
    (whole, rawAlt: string, rawPath: string) => {
      const asset = assetsByPath.get(rawPath.trim());
      if (asset === undefined) return whole;
      canonicalizedPaths.push(asset.path);
      const alt = safeInlineText(rawAlt || asset.label);
      return `![${alt}](){asset="${asset.path}", width=${widthFor(asset, state)}, align=center, style=polaroid, caption="${alt}"}`;
    },
  );
  // Command A+ sometimes returns the attachment resource id as a raw Markdown
  // URL (`/att_<digest>`) even though the source receipt exposed the complete
  // managed path. Resolve only an exact 64-hex attachment alias we already
  // observed; arbitrary paths never gain managed-asset authority here.
  normalizedScript = normalizedScript.replace(
    /!\[([^\]]*)\]\(\/?(att_[0-9a-f]{64})(?:\.[a-z0-9]+)?\)(?:\{[^{}]*\})?/giu,
    (whole, rawAlt: string, rawAlias: string) => {
      const asset = [...assetsByPath.values()].find(
        (candidate) => managedAttachmentAlias(candidate.path) === rawAlias.toLowerCase(),
      );
      if (asset === undefined) return whole;
      canonicalizedPaths.push(asset.path);
      const alt = safeInlineText(rawAlt || asset.label);
      return `![${alt}](){asset="${asset.path}", width=${widthFor(asset, state)}, align=center, style=polaroid, caption="${alt}"}`;
    },
  );
  // A second common envelope mistake puts the image attributes themselves in
  // Markdown's URL parentheses: `](asset="ai/attachments/...", width=...)`.
  // The browser interprets that whole string as a URL. Recover it only when it
  // contains an exact managed path or digest alias already observed this turn.
  normalizedScript = normalizedScript.replace(
    /!\[([^\]]*)\]\(([^)\r\n]*)\)(?:\{[^{}]*\})?/giu,
    (whole, rawAlt: string, rawDestination: string) => {
      const asset = [...assetsByPath.values()].find((candidate) => {
        const alias = managedAttachmentAlias(candidate.path);
        return rawDestination.includes(candidate.path) ||
          (alias !== undefined && rawDestination.toLowerCase().includes(alias));
      });
      if (asset === undefined) return whole;
      canonicalizedPaths.push(asset.path);
      const alt = safeInlineText(rawAlt || asset.label);
      return `![${alt}](){asset="${asset.path}", width=${widthFor(asset, state)}, align=center, style=polaroid, caption="${alt}"}`;
    },
  );
  if (
    readerRequestsDominantAttachedImage(state) ||
    readerRequestsConciseAttachedImage(state)
  ) {
    normalizedScript = normalizedScript.replace(
      /!\[([^\]]*)\]\(\)\{([^{}]*\basset="([^"]+)"[^{}]*)\}/giu,
      (whole, rawAlt: string, rawAttrs: string, rawPath: string) => {
        const asset = assetsByPath.get(rawPath.trim());
        if (asset === undefined) return whole;
        const width = widthFor(asset, state);
        const attrs = /\bwidth\s*=\s*(?:\d+(?:\.\d+)?|"[^"]*")/iu.test(rawAttrs)
          ? rawAttrs.replace(
              /\bwidth\s*=\s*(?:\d+(?:\.\d+)?|"[^"]*")/iu,
              `width=${width}`,
            )
          : `${rawAttrs.trimEnd()}, width=${width}`;
        return `![${rawAlt}](){${attrs}}`;
      },
    );
  }
  const seenManagedPaths = new Set<string>();
  normalizedScript = normalizedScript.replace(
    /!\[[^\]]*\]\(\)\{[^{}]*\basset="([^"]+)"[^{}]*\}\s*/giu,
    (whole, rawPath: string) => {
      const path = rawPath.trim();
      if (!assetsByPath.has(path)) return whole;
      if (seenManagedPaths.has(path)) return '';
      seenManagedPaths.add(path);
      return whole;
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
    return `![${label}](){asset="${asset.path}", width=${widthFor(asset, state)}, align=center, style=polaroid, caption="${label}"}`;
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

function imagePageTitle(script: string, asset: ObservedManagedImageAsset): string {
  const parsed = parseNotebookScriptPages(script).preview;
  const heading = firstHeading(script);
  if (
    heading !== undefined &&
    !/^(?:image|picture|photo|infographic|diagram|attached image)$/iu.test(heading)
  ) return heading;
  const frontmatterTitle = parsed.frontmatter.title?.trim();
  if (frontmatterTitle) return safeInlineText(frontmatterTitle);
  const plainTitle = /^\s*title\s*:\s*(.+?)\s*$/imu.exec(script)?.[1]?.trim();
  if (plainTitle) return safeInlineText(plainTitle.replace(/[.]+$/u, ''));
  return heading ?? safeInlineText(asset.label);
}

function rawFrontmatter(script: string): { readonly value: string; readonly rest: string } {
  const match = /^\s*(---\r?\n[\s\S]*?\r?\n---)(?:\r?\n)*/u.exec(script);
  return match === null
    ? { value: '', rest: script }
    : { value: match[1]!, rest: script.slice(match[0].length) };
}

function blockContainsMedia(block: Block): boolean {
  if (block.kind === 'image' || block.kind === 'fetchDirective') return true;
  return block.kind === 'container' && block.children.some(blockContainsMedia);
}

function blockContainsManagedAsset(block: Block, path: string): boolean {
  if (block.kind === 'image') return block.attrs.asset === path;
  return block.kind === 'container' &&
    block.children.some((child) => blockContainsManagedAsset(child, path));
}

function findManagedImageBlock(
  blocks: readonly Block[],
  path: string,
): Extract<Block, { readonly kind: 'image' }> | undefined {
  for (const block of blocks) {
    if (block.kind === 'image' && block.attrs.asset === path) return block;
    if (block.kind === 'container') {
      const nested = findManagedImageBlock(block.children, path);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function compactNotesBlockAllowed(block: Block): boolean {
  if (blockContainsMedia(block) || block.kind === 'divider') return false;
  if (
    !['heading', 'paragraph', 'quote', 'list', 'taskList', 'table', 'container'].includes(
      block.kind,
    )
  ) return false;
  if ('attrs' in block && block.attrs.size !== undefined) return false;
  if (block.kind !== 'container') return true;
  if (block.name === 'columns' || block.name === 'image-row') return false;
  return block.children.every(compactNotesBlockAllowed);
}

function printStandaloneBlock(block: Block): string {
  return print({ frontmatter: {}, blocks: [block], diagnostics: [] }).trim();
}

function blockHasPromisedPayload(block: Block): boolean {
  if (block.kind === 'list' || block.kind === 'taskList' || block.kind === 'table') {
    return true;
  }
  return block.kind === 'container' && block.children.some(blockHasPromisedPayload);
}

function blockContainsMetadataParagraph(block: Block): boolean {
  if (block.kind === 'container') {
    return block.children.some(blockContainsMetadataParagraph);
  }
  if (block.kind !== 'paragraph') return false;
  return /^\s*(?:title|paper|wash|ink|image)\s*:/iu.test(
    printStandaloneBlock(block),
  );
}

function terminalSemanticText(block: Block): string {
  if (block.kind === 'container') {
    const last = block.children[block.children.length - 1];
    return last === undefined ? '' : terminalSemanticText(last);
  }
  return printStandaloneBlock(block).trim();
}

function coherentNotesGroup(blocks: readonly Block[], text: string): boolean {
  if (!blocks.some((block) => block.kind !== 'heading')) return false;
  if (blocks.some(blockContainsMetadataParagraph)) return false;
  const terminal = terminalSemanticText(blocks[blocks.length - 1]!);
  if (/[:\u2013\u2014-]\s*$/u.test(terminal)) return false;
  const promisesPayload =
    /\b(?:the\s+following|shown\s+below|listed\s+below|as\s+follows|these\s+(?:are|include)|(?:one|two|three|four|five|six|\d+)\s+(?:key\s+)?(?:ways?|steps?|measurements?|dimensions?|parts?|points?|rules?))\b/iu.test(
      text,
    );
  return !promisesPayload || blocks.some(blockHasPromisedPayload);
}

function compactNotesBlocks(blocks: readonly Block[], managedPath: string): string {
  const groups: Block[][] = [];
  let current: Block[] = [];
  let skippedOpeningHeading = false;
  for (const block of blocks) {
    if (blockContainsManagedAsset(block, managedPath)) {
      if (current.length > 0) groups.push(current);
      current = [];
      continue;
    }
    if (!compactNotesBlockAllowed(block)) continue;
    if (block.kind === 'heading' && !skippedOpeningHeading) {
      skippedOpeningHeading = true;
      continue;
    }
    if (block.kind === 'heading' && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(block);
  }
  if (current.length > 0) groups.push(current);

  for (const group of groups) {
    if (group.length > 5) continue;
    const text = group.map(printStandaloneBlock).filter(Boolean).join('\n\n').trim();
    if (text === '' || text.length > 700 || text.split('\n').length > 12) continue;
    if (!coherentNotesGroup(group, text)) continue;
    return text;
  }
  return '';
}

/**
 * The reader says the supplied image already carries the substance and asks
 * for only a small supporting write-up. Preserve Cohere's grounded title and
 * earliest bounded native blocks, but enforce the editorial contract locally:
 * one large uncropped managed-image page and at most one non-empty notes page.
 */
export function applyConciseManagedImageLayout(
  state: AgentState,
  script: string,
): { readonly script: string; readonly compacted: boolean } {
  if (!readerRequestsConciseAttachedImage(state)) {
    return { script, compacted: false };
  }
  const assets = observedManagedImageAssets(state);
  if (assets.length !== 1) return { script, compacted: false };
  const asset = assets[0]!;
  const parsed = parseNotebookScriptPages(script).preview;
  const parsedImage = findManagedImageBlock(parsed.blocks, asset.path);
  if (parsedImage === undefined) return { script, compacted: false };
  const imageBlock = printStandaloneBlock({
    ...parsedImage,
    attrs: {
      ...parsedImage.attrs,
      width: widthFor(asset, state),
      align: parsedImage.attrs.align ?? 'center',
      style: parsedImage.attrs.style ?? 'polaroid',
    },
  });

  const { value: frontmatter } = rawFrontmatter(script);
  const title = imagePageTitle(script, asset);
  const notes = compactNotesBlocks(
    parsed.blocks,
    asset.path,
  );
  const normalized = [
    frontmatter,
    `# ${title}`,
    imageBlock,
    ...(notes === '' ? [] : ['::page', notes]),
  ].filter((part) => part !== '').join('\n\n');
  return { script: normalized, compacted: normalized !== script };
}

/**
 * A reader asking for one supplied picture to occupy its own page has already
 * chosen the page hierarchy. Keep Cohere's title and write-up, but normalize
 * the structural part locally: one dedicated image page, one natural-flow
 * notes section, and no model-authored trailing `::page` that can become an
 * empty leaf. This is idempotent and changes no source facts.
 */
export function applyDominantManagedImageLayout(
  state: AgentState,
  script: string,
): { readonly script: string; readonly relaidOut: boolean } {
  if (!readerRequestsDominantAttachedImage(state)) {
    return { script, relaidOut: false };
  }
  const required = new Set(requiredManagedImageAssetPaths(state));
  const assets = observedManagedImageAssets(state).filter((asset) => required.has(asset.path));
  if (assets.length !== 1) return { script, relaidOut: false };
  const asset = assets[0]!;
  let imageBlock = '';
  let remainder = script.replace(
    /!\[[^\]]*\]\(\)\{[^{}]*\basset="([^"]+)"[^{}]*\}\s*/giu,
    (whole, rawPath: string) => {
      if (rawPath.trim() !== asset.path) return whole;
      imageBlock ||= whole.trim();
      return '';
    },
  );
  if (imageBlock === '') return { script, relaidOut: false };

  let frontmatter = '';
  const frontmatterMatch = /^\s*(---\r?\n[\s\S]*?\r?\n---)(?:\r?\n)*/u.exec(remainder);
  if (frontmatterMatch !== null) {
    frontmatter = frontmatterMatch[1]!;
    remainder = remainder.slice(frontmatterMatch[0].length);
  }
  const headingLine = /^#{1,3}\s+.+$/mu.exec(remainder)?.[0];
  if (headingLine !== undefined) remainder = remainder.replace(headingLine, '');
  remainder = remainder
    .replace(/^\s*::page\s*$/gmu, '')
    .replace(/^:::\s+[^\n]+\n\s*:::\s*$/gmu, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const title = firstHeading(script) ?? safeInlineText(asset.label);
  const normalized = [
    frontmatter,
    `# ${title}`,
    imageBlock,
    ...(remainder === '' ? [] : ['::page', remainder]),
  ].filter((part) => part !== '').join('\n\n');
  return { script: normalized, relaidOut: normalized !== script };
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
      `![${label}](){asset="${asset.path}", width=${widthFor(asset, state)}, align=center, style=polaroid, caption="${title}"}`,
    ].join('\n'),
    compacted: true,
  };
}
