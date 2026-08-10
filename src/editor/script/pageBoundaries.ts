/**
 * Split an AI-authored Notebook Script into deliberately anchored pages.
 *
 * `::page` is intentionally outside the ordinary parser: it controls the
 * book, not a block within one page. Only a top-level directive is structural;
 * examples inside fenced code or directive containers remain ordinary text.
 */
export function splitNotebookScriptPages(source: string): string[] {
  const pages: string[] = [];
  let current: string[] = [];
  let fence: { marker: '`' | '~'; length: number } | null = null;
  let containerDepth = 0;
  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    const fenceRun = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== null) {
      current.push(line);
      if (
        fenceRun?.[0] === fence.marker &&
        fenceRun.length >= fence.length
      ) {
        fence = null;
      }
      continue;
    }
    if (fenceRun !== undefined) {
      fence = {
        marker: fenceRun[0] as '`' | '~',
        length: fenceRun.length,
      };
      current.push(line);
      continue;
    }

    if (/^\s*:::\s*$/.test(line)) {
      containerDepth = Math.max(0, containerDepth - 1);
      current.push(line);
      continue;
    }
    if (/^\s*:::\s*[a-z][\w-]*(?:\s|$)/i.test(line)) {
      containerDepth += 1;
      current.push(line);
      continue;
    }

    if (containerDepth === 0 && /^\s*::page\s*(?:#.*)?$/.test(line)) {
      pages.push(current.join('\n').trim());
      current = [];
    } else {
      current.push(line);
    }
  }
  pages.push(current.join('\n').trim());
  return pages.filter((page, index) => page !== '' || index === 0);
}
