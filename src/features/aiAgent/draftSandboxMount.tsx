/**
 * Browser-only half of the AI draft sandbox.
 *
 * Each page is mounted as a real PageEditor inside the same `.nb-spread >
 * .nb-sheet-paper` cascade as the open book. `draftSandbox` prevents editor
 * registration and persistence. Overflow is carried into generated spill
 * leaves before the next authored `::page`, then every settled leaf is captured
 * with the same PNG path used by normal page export.
 */
import { render } from 'solid-js/web';
import type { PageDoc } from '../../data/types';
import PageEditor from '../../editor/PageEditor';
import {
  capturePagePng,
  measureMountedSheet,
  type OffscreenPageSize,
} from '../../editor/script/exporters/capture';
import { MISSING_ASSET_SRC } from '../../editor/media/resolver';
import type { NotebookScriptDiagnostic } from './types';
import type {
  DraftPageMountRequest,
  MountedDraftPage,
  PreparedDraftPage,
} from './draftSandbox';
import { buildIntegratedTargetDocument } from './integratedTarget';

const MAX_RENDERED_PAGES = 128;
const PAGE_SETTLE_TIMEOUT_MS = 6_000;
const STABLE_FRAMES = 3;

interface PageQueueEntry {
  readonly doc: PageDoc;
  readonly sourceStart?: number;
  readonly sourceEnd?: number;
  readonly spill: boolean;
}

interface StagedPageResult extends MountedDraftPage {
  readonly overflowBlocks: readonly unknown[];
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw new DOMException('The draft preview was cancelled.', 'AbortError');
}

const nextFrame = (signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('The draft preview was cancelled.', 'AbortError'));
      return;
    }
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      resolve();
    };
    const cancel = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      reject(new DOMException('The draft preview was cancelled.', 'AbortError'));
    };
    const timer = setTimeout(finish, 60);
    signal.addEventListener('abort', cancel, { once: true });
    requestAnimationFrame(finish);
  });

function calculateCapacity(sheet: HTMLElement): number {
  const style = getComputedStyle(sheet);
  return Math.max(
    1,
    Math.floor(
      sheet.clientHeight -
        (Number.parseFloat(style.paddingTop) || 0) -
        (Number.parseFloat(style.paddingBottom) || 0),
    ),
  );
}

function hasPortableImageAsset(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasPortableImageAsset);
  const record = value as Record<string, unknown>;
  if (
    record.attrs !== null &&
    typeof record.attrs === 'object' &&
    typeof (record.attrs as Record<string, unknown>).assetRelPath === 'string'
  ) {
    return true;
  }
  return Object.values(record).some(hasPortableImageAsset);
}

async function settleMedia(
  sheet: HTMLElement,
  doc: PageDoc,
  signal: AbortSignal,
): Promise<void> {
  const hasPortableAssets = hasPortableImageAsset(doc);
  const portableDeadline = performance.now() + 1_500;
  const deadline = performance.now() + PAGE_SETTLE_TIMEOUT_MS;
  while (performance.now() < deadline) {
    throwIfAborted(signal);
    const images = [...sheet.querySelectorAll<HTMLImageElement>('img')];
    const pendingImages = images.filter((image) => !image.complete);
    const pendingPortableAssets = hasPortableAssets && performance.now() < portableDeadline
      ? images.filter((image) => image.getAttribute('src') === MISSING_ASSET_SRC)
      : [];
    for (const image of images) {
      if (!image.complete || image.naturalWidth <= 0) continue;
      await image.decode?.().catch(() => undefined);
    }
    const videos = [...sheet.querySelectorAll<HTMLVideoElement>('video')];
    const pendingVideos = videos.filter(
      (video) => video.currentSrc !== '' && video.readyState < HTMLMediaElement.HAVE_METADATA,
    );
    if (
      pendingImages.length === 0 &&
      pendingPortableAssets.length === 0 &&
      pendingVideos.length === 0
    ) {
      return;
    }
    await nextFrame(signal);
  }
}

function pageSignature(sheet: HTMLElement, doc: PageDoc, overflowCount: number): string {
  const prose = sheet.querySelector<HTMLElement>('.nb-prose');
  const blocks = prose === null
    ? []
    : [...prose.children].map((child) => {
        const rect = child.getBoundingClientRect();
        return [
          child.tagName,
          Number(rect.left.toFixed(2)),
          Number(rect.top.toFixed(2)),
          Number(rect.width.toFixed(2)),
          Number(rect.height.toFixed(2)),
        ];
      });
  const media = [...sheet.querySelectorAll<HTMLImageElement>('img')].map((image) => [
    image.complete,
    image.naturalWidth,
    image.naturalHeight,
    image.getAttribute('src') ?? '',
  ]);
  return JSON.stringify({ doc, overflowCount, blocks, media });
}

async function waitForStableLayout(
  sheet: HTMLElement,
  readDoc: () => PageDoc,
  readOverflowCount: () => number,
  signal: AbortSignal,
): Promise<void> {
  await document.fonts?.ready.catch(() => undefined);
  await settleMedia(sheet, readDoc(), signal);
  const deadline = performance.now() + PAGE_SETTLE_TIMEOUT_MS;
  let stable = 0;
  let previous = '';
  while (stable < STABLE_FRAMES && performance.now() < deadline) {
    throwIfAborted(signal);
    await nextFrame(signal);
    const signature = pageSignature(sheet, readDoc(), readOverflowCount());
    if (signature === previous) stable += 1;
    else {
      previous = signature;
      stable = 0;
    }
  }
}

function docIsMeaningful(doc: PageDoc): boolean {
  const visit = (value: unknown): boolean => {
    if (value === null || typeof value !== 'object') return false;
    const node = value as { type?: unknown; text?: unknown; content?: unknown[] };
    if (typeof node.text === 'string' && node.text.trim() !== '') return true;
    if (
      typeof node.type === 'string' &&
      ['image', 'video', 'diagram', 'sticker', 'pageMark', 'math', 'mathInline'].includes(
        node.type,
      )
    ) {
      return true;
    }
    return Array.isArray(node.content) && node.content.some(visit);
  };
  return Array.isArray(doc.content) && doc.content.some(visit);
}

function layoutDiagnostics(
  sheet: HTMLElement,
  doc: PageDoc,
  capacity: number,
  pageNumber: number,
  producedOverflow: boolean,
): NotebookScriptDiagnostic[] {
  const out: NotebookScriptDiagnostic[] = [];
  const prose = sheet.querySelector<HTMLElement>('.nb-prose');
  const clip = sheet.querySelector<HTMLElement>('.nb-page-editor');
  if (!docIsMeaningful(doc)) {
    out.push({
      severity: 'error',
      code: 'layout.empty-page',
      message: 'Pagination produced a blank rendered page.',
      pageNumber,
    });
  }
  if (producedOverflow) {
    out.push({
      severity: 'warning',
      code: 'layout.spill-page-created',
      message: 'Content exceeded this leaf and continued onto a generated spill page.',
      pageNumber,
    });
  }
  if (prose !== null) {
    const rootRect = prose.getBoundingClientRect();
    const paddingBottom = Number.parseFloat(getComputedStyle(prose).paddingBottom) || 0;
    const bottoms = [...prose.children].map(
      (child) => child.getBoundingClientRect().bottom - rootRect.top,
    );
    const lastBottom = bottoms.length === 0 ? 0 : bottoms[bottoms.length - 1]!;
    if (lastBottom + paddingBottom > capacity + 1) {
      out.push({
        severity: 'error',
        code: 'layout.residual-overflow',
        message: 'Content still extends past the fixed page after pagination settled.',
        pageNumber,
      });
    }
  }
  if (prose !== null && clip !== null) {
    const clipRect = clip.getBoundingClientRect();
    const clipped = [...prose.children].some((child) => {
      const rect = child.getBoundingClientRect();
      return (
        rect.left < clipRect.left - 8 ||
        rect.right > clipRect.right + 8 ||
        rect.top < clipRect.top - 8 ||
        rect.bottom > clipRect.bottom + 8
      );
    });
    if (clipped) {
      out.push({
        severity: 'error',
        code: 'layout.clipping',
        message: 'One or more rendered blocks are clipped by the fixed page boundary.',
        pageNumber,
      });
    }
  }
  const placeholders = sheet.querySelectorAll('[data-image-placeholder]').length;
  if (placeholders > 0) {
    out.push({
      severity: 'warning',
      code: 'layout.missing-media-placeholder',
      message: `${placeholders} image ${placeholders === 1 ? 'slot is' : 'slots are'} still waiting for media.`,
      pageNumber,
    });
  }
  const missingSrc = MISSING_ASSET_SRC;
  const brokenImages = [...sheet.querySelectorAll<HTMLImageElement>('img')].filter((image) => {
    // ProseMirror inserts a source-less separator image between adjacent
    // uneditable node views. It is editing chrome, not notebook media.
    if (image.classList.contains('ProseMirror-separator')) return false;
    const source = image.getAttribute('src') ?? '';
    return (
      source === '' ||
      source === missingSrc ||
      (image.complete && image.naturalWidth <= 0)
    );
  }).length;
  if (brokenImages > 0) {
    out.push({
      severity: 'error',
      code: 'layout.missing-media',
      message: `${brokenImages} image ${brokenImages === 1 ? 'could' : 'could'} not be loaded for the preview.`,
      pageNumber,
    });
  }
  const skeletons = sheet.querySelectorAll('.nb-diagram-skeleton').length;
  if (skeletons > 0) {
    out.push({
      severity: 'error',
      code: 'layout.unrendered-diagram',
      message: `${skeletons} diagram ${skeletons === 1 ? 'has' : 'have'} not finished rendering.`,
      pageNumber,
    });
  }
  return out;
}

function stageParent(): HTMLElement {
  return document.querySelector<HTMLElement>('.nb-spread:not(.nb-export-offscreen)') ?? document.body;
}

async function renderOnePage(
  entry: PageQueueEntry,
  pageNumber: number,
  side: 'left' | 'right',
  size: OffscreenPageSize,
  signal: AbortSignal,
): Promise<StagedPageResult> {
  throwIfAborted(signal);
  const host = document.createElement('div');
  host.className = 'nb-export-offscreen nb-ai-draft-offscreen';
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'position:fixed;left:-12000px;top:0;pointer-events:none;user-select:none;' +
    `width:${size.width}px;height:${size.height}px;overflow:hidden;`;
  if (stageParent() === document.body) host.classList.add('nb-spread');

  const sheet = document.createElement('div');
  sheet.className = 'nb-sheet-paper nb-leaf-paper nb-export-sheet nb-ai-draft-sheet';
  sheet.dataset.side = side;
  sheet.dataset.pageId = `ai-draft-page-${pageNumber}`;
  sheet.style.width = `${size.width}px`;
  sheet.style.height = `${size.height}px`;
  const freeLayer = document.createElement('div');
  freeLayer.className = 'nb-free-layer';
  freeLayer.setAttribute('aria-hidden', 'true');
  sheet.appendChild(freeLayer);
  host.appendChild(sheet);
  stageParent().appendChild(host);
  const capacity = calculateCapacity(sheet);
  let currentDoc = entry.doc;
  let overflowBlocks: unknown[] = [];
  let disposeSolid: (() => void) | undefined;
  try {
    disposeSolid = render(
      () => (
        <PageEditor
          pageId={`ai-draft-${pageNumber}`}
          initialDoc={entry.doc}
          draftSandbox
          paginated
          pageCapacityPx={capacity}
          onDocChange={(doc) => {
            currentDoc = doc;
          }}
          onOverflow={(blocks) => {
            // A later font/media pass removes content that precedes the tail
            // removed by an earlier pass, so it is prepended, never appended.
            overflowBlocks = [...blocks, ...overflowBlocks];
          }}
        />
      ),
      sheet,
    );
    await waitForStableLayout(
      sheet,
      () => currentDoc,
      () => overflowBlocks.length,
      signal,
    );
    throwIfAborted(signal);
    const diagnostics = layoutDiagnostics(
      sheet,
      currentDoc,
      capacity,
      pageNumber,
      overflowBlocks.length > 0,
    );
    // Unlike a file export, the approval preview is a promise about what the
    // reader will receive inside THIS book. `capturePagePng` keeps a house-
    // parchment default for exported files; explicitly hand it the mounted
    // leaf's resolved stock here so a pink, olive, night or custom sheet does
    // not turn cream while the reader is deciding whether to insert it.
    const captured = await capturePagePng(sheet, {
      backgroundColor: getComputedStyle(sheet).backgroundColor,
    });
    throwIfAborted(signal);
    return {
      doc: currentDoc,
      pngBytes: captured.bytes,
      width: captured.width,
      height: captured.height,
      sourceStart: entry.sourceStart,
      sourceEnd: entry.sourceEnd,
      producedOverflow: overflowBlocks.length > 0,
      diagnostics,
      overflowBlocks,
    };
  } finally {
    disposeSolid?.();
    host.remove();
  }
}

function preparedQueue(pages: readonly PreparedDraftPage[]): PageQueueEntry[] {
  return pages.map((page) => ({
    doc: page.doc,
    sourceStart: page.sourceStart,
    sourceEnd: page.sourceEnd,
    spill: false,
  }));
}

async function integratedQueue(request: DraftPageMountRequest): Promise<PageQueueEntry[]> {
  const target = request.insertionTarget;
  if (target.kind !== 'caret' && target.kind !== 'replace_selection') {
    if (request.targetPage !== undefined) {
      throw new Error('A structural draft render cannot include a target-page document.');
    }
    return preparedQueue(request.pages);
  }
  const targetPage = request.targetPage;
  const first = request.pages[0];
  if (targetPage === undefined || targetPage.pageId !== target.pageId || first === undefined) {
    throw new Error('The exact target page and first draft page are required for this preview.');
  }

  return [
      {
        doc: await buildIntegratedTargetDocument({
          targetDoc: targetPage.doc,
          draftDoc: first.doc,
          target,
        }),
        sourceStart: first.sourceStart,
        sourceEnd: first.sourceEnd,
        spill: false,
      },
      ...preparedQueue(request.pages.slice(1)),
    ];
}

/** Mount, paginate and capture every final page without touching a user page. */
export async function renderDraftPagesInSandbox(
  request: DraftPageMountRequest,
): Promise<readonly MountedDraftPage[]> {
  if (typeof document === 'undefined') {
    throw new Error('Draft preview rendering requires the Alcove WebView.');
  }
  throwIfAborted(request.signal);
  const size = measureMountedSheet();
  const queue = await integratedQueue(request);
  const output: MountedDraftPage[] = [];
  for (let index = 0; index < queue.length; index += 1) {
    throwIfAborted(request.signal);
    if (output.length >= MAX_RENDERED_PAGES) {
      throw new Error(
        `Draft pagination exceeded ${MAX_RENDERED_PAGES} pages. Shorten oversized blocks or add deliberate page boundaries.`,
      );
    }
    const entry = queue[index]!;
    const side = (request.insertionSlot + output.length) % 2 === 0 ? 'left' : 'right';
    const rendered = await renderOnePage(
      entry,
      output.length + 1,
      side,
      size,
      request.signal,
    );
    const { overflowBlocks, ...page } = rendered;
    output.push(page);
    if (overflowBlocks.length > 0) {
      queue.splice(index + 1, 0, {
        doc: {
          type: 'doc',
          attrs: { ...(rendered.doc.attrs ?? entry.doc.attrs ?? {}) },
          content: [...overflowBlocks],
        },
        sourceStart: entry.sourceStart,
        sourceEnd: entry.sourceEnd,
        spill: true,
      });
    }
  }
  return output;
}
