/**
 * Split an AI-authored Notebook Script into deliberately anchored pages.
 *
 * `::page` is intentionally outside the ordinary parser: it controls the
 * book, not a block within one page. Each later segment is stored with a
 * `flowStart` document attribute so pagination may spill *before* it without
 * ever shifting that authored page forward.
 */
export function splitNotebookScriptPages(source: string): string[] {
  const pages: string[] = [];
  let current: string[] = [];
  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*::page\s*(?:#.*)?$/.test(line)) {
      pages.push(current.join('\n').trim());
      current = [];
    } else {
      current.push(line);
    }
  }
  pages.push(current.join('\n').trim());
  return pages.filter((page, index) => page !== '' || index === 0);
}

export function isProtectedFlowStart(doc: {
  attrs?: Record<string, unknown>;
}): boolean {
  return doc.attrs?.flowStart === true;
}
