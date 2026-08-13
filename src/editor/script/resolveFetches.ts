/**
 * Resolve Notebook Script `fetch:` blocks before they enter TipTap.
 *
 * The parser must stay synchronous and total, while Openverse search is an
 * asynchronous Tauri command. Keeping this bridge in the insertion layer
 * gives both sides the contract they need: parser/preview can describe the
 * request immediately, and the stored page receives real durable image nodes.
 * Browser development and offline failures degrade to an upload card instead
 * of leaking the words `fetch: ...` into the reader.
 */
import type {
  Attrs,
  Block,
  ContainerBlock,
  FetchDirectiveBlock,
  ImageBlock,
  ScriptDoc,
} from '../../script';
import {
  fetchImages,
  fetchedImageAssetReceipt,
  type FetchedImageAssetReceipt,
  type FetchedImageResult,
} from '../media/assets';

export type ScriptImageFetcher = (
  query: string,
  count: number,
) => Promise<readonly FetchedImageResult[]>;

export interface ResolvedScriptFetches {
  readonly doc: ScriptDoc;
  /** Exact content-addressed downloads used while resolving this document. */
  readonly fetchedAssets: readonly FetchedImageAssetReceipt[];
}

interface ResolvedBlocks {
  readonly blocks: readonly Block[];
  readonly fetchedAssets: readonly FetchedImageAssetReceipt[];
}

function requestedCount(block: FetchDirectiveBlock, inImageRow: boolean): number {
  if (inImageRow) return 1;
  const raw = block.attrs.count;
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) ? Math.max(1, Math.min(4, Math.round(value))) : 1;
}

function imageAttrs(
  attrs: Attrs,
  additions: Attrs,
): Attrs {
  const { query: _query, count: _count, ...portable } = attrs;
  return { ...portable, ...additions };
}

function fetchedImage(
  request: FetchDirectiveBlock,
  result: FetchedImageResult,
): ImageBlock {
  const caption =
    typeof request.attrs.caption === 'string' && request.attrs.caption.trim() !== ''
      ? request.attrs.caption
      : request.query;
  return {
    kind: 'image',
    src: result.src,
    alt: request.query,
    attrs: imageAttrs(request.attrs, {
      asset: result.relPath,
      caption,
      style: request.attrs.style ?? 'polaroid',
    }),
    srcStart: request.srcStart,
    srcEnd: request.srcEnd,
  };
}

function uploadFallback(request: FetchDirectiveBlock): ImageBlock {
  const caption =
    typeof request.attrs.caption === 'string' && request.attrs.caption.trim() !== ''
      ? request.attrs.caption
      : request.query;
  return {
    kind: 'image',
    src: '',
    alt: request.query,
    attrs: imageAttrs(request.attrs, {
      placeholder: `add an image for ${request.query}`,
      caption,
      style: request.attrs.style ?? 'polaroid',
    }),
    srcStart: request.srcStart,
    srcEnd: request.srcEnd,
  };
}

async function resolveFetch(
  block: FetchDirectiveBlock,
  inImageRow: boolean,
  fetcher: ScriptImageFetcher,
): Promise<ResolvedBlocks> {
  const count = requestedCount(block, inImageRow);
  let results: readonly FetchedImageResult[] = [];
  try {
    results = await fetcher(block.query, count);
  } catch {
    // Network, provider and permissions failures are recoverable. The reader
    // can fill the card with the exact image they intended.
  }
  const usable = results.slice(0, count).filter((result) => result.relPath !== '');
  return usable.length > 0
    ? {
        blocks: usable.map((result) => fetchedImage(block, result)),
        fetchedAssets: usable.map((result) =>
          fetchedImageAssetReceipt(result, block.query),
        ),
      }
    : { blocks: [uploadFallback(block)], fetchedAssets: [] };
}

async function resolveBlock(
  block: Block,
  fetcher: ScriptImageFetcher,
  inImageRow: boolean,
): Promise<ResolvedBlocks> {
  if (block.kind === 'fetchDirective') {
    return resolveFetch(block, inImageRow, fetcher);
  }
  if (block.kind !== 'container') return { blocks: [block], fetchedAssets: [] };
  const container = block as ContainerBlock;
  const resolved = await Promise.all(
    container.children.map((child) =>
      resolveBlock(child, fetcher, container.name === 'image-row'),
    ),
  );
  return {
    blocks: [{ ...container, children: resolved.flatMap((entry) => entry.blocks) }],
    fetchedAssets: resolved.flatMap((entry) => entry.fetchedAssets),
  };
}

/** Resolve with an immutable asset manifest for preview/apply handoff. */
export async function resolveScriptFetchesWithManifest(
  doc: ScriptDoc,
  fetcher: ScriptImageFetcher = fetchImages,
): Promise<ResolvedScriptFetches> {
  const resolved = await Promise.all(
    doc.blocks.map((block) => resolveBlock(block, fetcher, false)),
  );
  return {
    doc: { ...doc, blocks: resolved.flatMap((entry) => entry.blocks) },
    fetchedAssets: resolved.flatMap((entry) => entry.fetchedAssets),
  };
}

export async function resolveScriptFetches(
  doc: ScriptDoc,
  fetcher: ScriptImageFetcher = fetchImages,
): Promise<ScriptDoc> {
  return (await resolveScriptFetchesWithManifest(doc, fetcher)).doc;
}
