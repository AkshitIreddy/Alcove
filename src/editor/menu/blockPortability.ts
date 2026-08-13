/** Copy/download one editor block in the format people expect outside Alcove. */
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { saveBytes, fileStem, type SaveFilter } from '../script/exporters/saveFile';
import { assetRelPathForImageAttrs } from '../media/portableAssets';
import { resolveAssetSrc } from '../media/resolver';
import { blockToScript, topLevelBlockAt } from './blockOps';

interface MatrixPayload {
  readonly rows: readonly (readonly string[])[];
  readonly tsv: string;
  readonly csv: string;
  readonly html: string;
}

export interface PortableBlockPayload {
  readonly kind: 'image' | 'video' | 'table' | 'code' | 'text';
  readonly title: string;
  readonly text: string;
  readonly mediaSrc?: string;
  readonly mediaRelPath?: string;
  readonly matrix?: MatrixPayload;
  readonly language?: string;
}

type MediaAttrs = Readonly<Record<string, unknown>>;

function textOf(node: ProseMirrorNode): string {
  return node.textContent.replace(/\u00a0/g, ' ').trim();
}

function tableMatrix(node: ProseMirrorNode): string[][] {
  const rows: string[][] = [];
  node.forEach((row) => {
    if (row.type.name !== 'tableRow') return;
    const cells: string[] = [];
    row.forEach((cell) => cells.push(textOf(cell)));
    if (cells.length > 0) rows.push(cells);
  });
  return rows;
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function htmlCell(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function matrixPayload(rows: readonly (readonly string[])[]): MatrixPayload {
  const tsv = rows.map((row) => row.join('\t')).join('\r\n');
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const html = `<table>${rows.map((row, index) =>
    `<tr>${row.map((cell) => `<${index === 0 ? 'th' : 'td'}>${htmlCell(cell)}</${index === 0 ? 'th' : 'td'}>`).join('')}</tr>`
  ).join('')}</table>`;
  return { rows, tsv, csv, html };
}

export function portableBlockPayload(node: ProseMirrorNode, script: string): PortableBlockPayload {
  const name = node.type.name;
  const label = textOf(node) || String(node.attrs.caption ?? node.attrs.alt ?? name);
  if (name === 'image' || name === 'video') {
    const source = typeof node.attrs.src === 'string' ? node.attrs.src : '';
    const relPath = assetRelPathForImageAttrs(node.attrs);
    return {
      kind: name,
      title: label || name,
      text: script,
      mediaSrc: source,
      mediaRelPath: relPath ?? undefined,
    };
  }
  if (name === 'table') {
    const matrix = matrixPayload(tableMatrix(node));
    return { kind: 'table', title: 'table', text: matrix.tsv, matrix };
  }
  if (name === 'codeBlock') {
    const language = typeof node.attrs.language === 'string' && node.attrs.language !== ''
      ? node.attrs.language
      : 'txt';
    return { kind: 'code', title: `code-${language}`, text: node.textContent, language };
  }
  return { kind: 'text', title: label || 'alcove-block', text: script };
}

function blockPayload(editor: Editor, pos: number): PortableBlockPayload | null {
  const block = topLevelBlockAt(editor, pos + 1) ?? topLevelBlockAt(editor, pos);
  const script = blockToScript(editor, pos);
  return block === null || script === null ? null : portableBlockPayload(block.node, script);
}

async function mediaBlob(payload: PortableBlockPayload): Promise<Blob> {
  const source = payload.mediaRelPath === undefined
    ? payload.mediaSrc
    : await resolveAssetSrc(payload.mediaRelPath);
  if (source === undefined || source === '') throw new Error('missing media source');
  const response = await fetch(source);
  if (!response.ok) throw new Error('media read failed');
  return response.blob();
}

async function imagePng(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('canvas unavailable');
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => value === null ? reject(new Error('PNG encode failed')) : resolve(value), 'image/png'),
    );
  } finally {
    bitmap.close();
  }
}

async function writeClipboard(items: Record<string, Blob>, fallback: string): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write !== undefined) {
    await navigator.clipboard.write([new ClipboardItem(items)]);
    return;
  }
  await navigator.clipboard.writeText(fallback);
}

function portableImagePayload(attrs: MediaAttrs): PortableBlockPayload {
  const source = typeof attrs.src === 'string' ? attrs.src : '';
  const relPath = assetRelPathForImageAttrs(attrs);
  const caption = typeof attrs.caption === 'string' ? attrs.caption.trim() : '';
  const alt = typeof attrs.alt === 'string' ? attrs.alt.trim() : '';
  return {
    kind: 'image',
    title: caption || alt || 'image',
    text: alt === '' ? '![Image]' : `![${alt.replace(/]/g, '\\]')}]`,
    mediaSrc: source,
    mediaRelPath: relPath ?? undefined,
  };
}

/** Copy one picture even when it is nested inside an image-row block. */
export async function copyPortableImage(attrs: MediaAttrs): Promise<string> {
  const payload = portableImagePayload(attrs);
  const png = await imagePng(await mediaBlob(payload));
  await writeClipboard({ 'image/png': png }, payload.text);
  return 'image copied';
}

async function savePortableMedia(payload: PortableBlockPayload): Promise<string> {
  const blob = await mediaBlob(payload);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mime = blob.type || (payload.kind === 'image' ? 'image/png' : 'video/mp4');
  const extension = extensionForMedia(
    mime,
    payload.mediaRelPath,
    payload.kind === 'image' ? 'png' : 'mp4',
  );
  const outcome = await saveBytes(
    bytes,
    `${fileStem(payload.title, 'alcove-media')}.${extension}`,
    mime,
    [{ name: payload.kind === 'image' ? 'Image' : 'Video', extensions: [extension] }],
  );
  if (outcome === 'failed') throw new Error('save failed');
  return outcome === 'cancelled' ? 'download cancelled' : `${payload.kind} saved`;
}

/** Save the original picture bytes with their truthful durable extension. */
export function downloadPortableImage(attrs: MediaAttrs): Promise<string> {
  return savePortableMedia(portableImagePayload(attrs));
}

export async function copyUsefulBlock(editor: Editor, pos: number): Promise<string> {
  const payload = blockPayload(editor, pos);
  if (payload === null) throw new Error('block unavailable');
  if (payload.kind === 'image') {
    const png = await imagePng(await mediaBlob(payload));
    await writeClipboard({ 'image/png': png }, payload.text);
    return 'image copied';
  }
  if (payload.kind === 'video') {
    const blob = await mediaBlob(payload);
    if (
      typeof ClipboardItem !== 'undefined' &&
      typeof ClipboardItem.supports === 'function' &&
      ClipboardItem.supports(blob.type)
    ) {
      await writeClipboard({ [blob.type]: blob }, payload.text);
      return 'video copied';
    }
    await navigator.clipboard.writeText(payload.text);
    return 'video block copied as portable script — use Download for the original file';
  }
  if (payload.matrix !== undefined) {
    await writeClipboard({
      'text/plain': new Blob([payload.matrix.tsv], { type: 'text/plain' }),
      'text/html': new Blob([payload.matrix.html], { type: 'text/html' }),
    }, payload.matrix.tsv);
    return 'table copied for spreadsheets and documents';
  }
  await navigator.clipboard.writeText(payload.text);
  return payload.kind === 'code' ? 'code copied' : 'block copied';
}

/** Copy the reader's exact multi-block text range instead of pretending the
 * right-clicked block was the whole selection. */
export async function copyUsefulSelection(
  editor: Editor,
  range: { readonly from: number; readonly to: number },
): Promise<string> {
  const text = editor.state.doc.textBetween(range.from, range.to, '\n\n', '\n');
  await navigator.clipboard.writeText(text);
  return 'selection copied';
}

export function extensionForMedia(
  mime: string,
  relPath: string | undefined,
  fallback: 'png' | 'mp4',
): string {
  const pathExtension = relPath?.toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1];
  if (pathExtension) return pathExtension === 'jpeg' ? 'jpg' : pathExtension;
  const clean = mime.split(';')[0]?.toLowerCase() ?? '';
  return ({
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/x-ms-bmp': 'bmp',
    'image/avif': 'avif',
    'image/svg+xml': 'svg',
    'image/tiff': 'tiff',
    'image/x-icon': 'ico',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/x-msvideo': 'avi',
    'video/x-matroska': 'mkv',
    'video/mpeg': 'mpeg',
    'video/ogg': 'ogv',
  } as Record<string, string>)[clean] ?? fallback;
}

function extensionForLanguage(language: string | undefined): string {
  const clean = (language ?? 'txt').toLowerCase();
  return ({
    javascript: 'js', typescript: 'ts', python: 'py', plaintext: 'txt',
    markdown: 'md', powershell: 'ps1', bash: 'sh', shell: 'sh',
    csharp: 'cs', cpp: 'cpp', objectivec: 'm', ruby: 'rb',
    kotlin: 'kt', swift: 'swift', rust: 'rs', java: 'java',
    html: 'html', css: 'css', scss: 'scss', json: 'json', yaml: 'yaml',
    sql: 'sql', xml: 'xml', toml: 'toml',
  } as Record<string, string>)[clean] ?? (clean.replace(/[^a-z0-9]+/g, '') || 'txt');
}

export async function downloadUsefulBlock(editor: Editor, pos: number): Promise<string> {
  const payload = blockPayload(editor, pos);
  if (payload === null) throw new Error('block unavailable');
  let bytes: Uint8Array;
  let mime: string;
  let extension: string;
  let filters: SaveFilter[];
  if (payload.kind === 'image' || payload.kind === 'video') {
    return savePortableMedia(payload);
  } else if (payload.matrix !== undefined) {
    bytes = new TextEncoder().encode(payload.matrix.csv);
    mime = 'text/csv;charset=utf-8';
    extension = 'csv';
    filters = [{ name: 'CSV table', extensions: ['csv'] }];
  } else if (payload.kind === 'code') {
    bytes = new TextEncoder().encode(payload.text);
    mime = 'text/plain;charset=utf-8';
    extension = extensionForLanguage(payload.language);
    filters = [{ name: 'Source code', extensions: [extension] }];
  } else {
    bytes = new TextEncoder().encode(payload.text);
    mime = 'text/markdown;charset=utf-8';
    extension = 'md';
    filters = [{ name: 'Notebook Script', extensions: ['md'] }];
  }
  const outcome = await saveBytes(
    bytes,
    `${fileStem(payload.title, 'alcove-block')}.${extension}`,
    mime,
    filters,
  );
  if (outcome === 'failed') throw new Error('save failed');
  return outcome === 'cancelled' ? 'download cancelled' : `${payload.kind} saved`;
}
