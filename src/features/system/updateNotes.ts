/**
 * Turn the Markdown body carried by Tauri's updater feed into a small, safe
 * document for Alcove's update card.
 *
 * GitHub release notes are written for a release page: they open with HTML for
 * a centred logo and end with a download table. Neither belongs in an in-app
 * prompt, and putting that source in a `<p>` exposes every `<div>`, `#` and
 * table pipe. This parser keeps the reader-facing change summary and produces
 * data only. The component creates DOM nodes from that data; remote release
 * text is never handed to `innerHTML`.
 */

export const DEFAULT_UPDATE_NOTES = 'A newer Alcove is ready for your shelf.';

export type UpdateNoteInline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'strong'; readonly text: string }
  | { readonly kind: 'em'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | {
      readonly kind: 'link';
      readonly text: string;
      readonly href: string;
      readonly strong?: boolean;
    };

export type UpdateNoteBlock =
  | {
      readonly kind: 'heading';
      readonly level: 2 | 3;
      readonly content: readonly UpdateNoteInline[];
    }
  | {
      readonly kind: 'paragraph';
      readonly content: readonly UpdateNoteInline[];
    }
  | {
      readonly kind: 'list';
      readonly ordered: boolean;
      readonly items: readonly (readonly UpdateNoteInline[])[];
    };

// Current releases begin directly with "What's new". Keep the former wrapper
// as an accepted start so update feeds from older versions render identically.
const SUMMARY_HEADING = /^##\s+(?:what changed|what['’]s new)\s*$/i;
const DOWNLOAD_HEADING = /^##\s+which file do i want\??\s*$/i;
const HORIZONTAL_RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const HEADING = /^(#{1,6})\s+(.+)$/;
const BULLET = /^\s*[-+*]\s+(.+)$/;
const ORDERED = /^\s*\d+[.)]\s+(.+)$/;

/** Only links the OS can safely hand to a browser survive as links. */
function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** Inline Markdown used by the generated release notes. Deliberately small. */
export function parseUpdateNoteInline(source: string): readonly UpdateNoteInline[] {
  const parts: UpdateNoteInline[] = [];
  const token = /(\*\*\[([^\]\n]+)\]\(([^)\s]+)\)\*\*|\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|_([^_\n]+)_|\*([^*\n]+)\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = token.exec(source)) !== null) {
    if (match.index > cursor) {
      parts.push({ kind: 'text', text: source.slice(cursor, match.index) });
    }
    if (match[2] !== undefined && match[3] !== undefined) {
      const href = safeHref(match[3]);
      parts.push(
        href === null
          ? { kind: 'strong', text: match[2] }
          : { kind: 'link', text: match[2], href, strong: true },
      );
    } else if (match[4] !== undefined) {
      parts.push({ kind: 'strong', text: match[4] });
    } else if (match[5] !== undefined) {
      parts.push({ kind: 'code', text: match[5] });
    } else if (match[6] !== undefined && match[7] !== undefined) {
      const href = safeHref(match[7]);
      parts.push(
        href === null
          ? { kind: 'text', text: match[6] }
          : { kind: 'link', text: match[6], href },
      );
    } else {
      parts.push({ kind: 'em', text: match[8] ?? match[9] ?? '' });
    }
    cursor = token.lastIndex;
  }
  if (cursor < source.length) {
    parts.push({ kind: 'text', text: source.slice(cursor) });
  }
  return parts.length > 0 ? parts : [{ kind: 'text', text: source }];
}

/**
 * Remove HTML presentation that belongs to GitHub, without interpreting it.
 * Script/style bodies are discarded as a unit; remaining tags are removed and
 * their ordinary text is retained.
 */
function withoutReleaseHtml(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<\/?[a-z][^>]*>/gi, '');
}

/** Keep the in-app summary, not GitHub's masthead or download instructions. */
function summaryLines(source: string): string[] {
  const lines = withoutReleaseHtml(source)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd());

  const start = lines.findIndex((line) => SUMMARY_HEADING.test(line.trim()));
  if (start >= 0) {
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i += 1) {
      const line = lines[i]!.trim();
      if (HORIZONTAL_RULE.test(line) || DOWNLOAD_HEADING.test(line)) {
        end = i;
        break;
      }
    }
    return lines.slice(start, end);
  }

  const download = lines.findIndex((line) => DOWNLOAD_HEADING.test(line.trim()));
  const beforeDownload = download >= 0 ? lines.slice(0, download) : lines;
  return beforeDownload.filter((line) => {
    const value = line.trim();
    return !/^#\s+alcove\s+v?\d/i.test(value);
  });
}

function isBlockStart(line: string): boolean {
  const value = line.trim();
  return (
    value === '' ||
    HEADING.test(value) ||
    BULLET.test(line) ||
    ORDERED.test(line) ||
    HORIZONTAL_RULE.test(value)
  );
}

/** Parse one release body into safe blocks suitable for direct Solid rendering. */
export function parseUpdateNotes(source: string | undefined): readonly UpdateNoteBlock[] {
  if (source === undefined || source.trim() === '') {
    return [{ kind: 'paragraph', content: parseUpdateNoteInline(DEFAULT_UPDATE_NOTES) }];
  }

  const lines = summaryLines(source);
  const blocks: UpdateNoteBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!.trim();
    if (line === '' || HORIZONTAL_RULE.test(line)) {
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length <= 2 ? 2 : 3,
        content: parseUpdateNoteInline(heading[2]!.trim()),
      });
      index += 1;
      continue;
    }

    const bullet = BULLET.exec(lines[index]!);
    const ordered = ORDERED.exec(lines[index]!);
    if (bullet !== null || ordered !== null) {
      const orderedList = ordered !== null;
      const matcher = orderedList ? ORDERED : BULLET;
      const items: (readonly UpdateNoteInline[])[] = [];
      while (index < lines.length) {
        const item = matcher.exec(lines[index]!);
        if (item === null) break;
        items.push(parseUpdateNoteInline(item[1]!.trim()));
        index += 1;
      }
      blocks.push({ kind: 'list', ordered: orderedList, items });
      continue;
    }

    const paragraph: string[] = [line.replace(/^>\s?/, '')];
    index += 1;
    while (index < lines.length && !isBlockStart(lines[index]!)) {
      paragraph.push(lines[index]!.trim().replace(/^>\s?/, ''));
      index += 1;
    }
    blocks.push({
      kind: 'paragraph',
      content: parseUpdateNoteInline(paragraph.join(' ')),
    });
  }

  return blocks.length > 0
    ? blocks
    : [{ kind: 'paragraph', content: parseUpdateNoteInline(DEFAULT_UPDATE_NOTES) }];
}
