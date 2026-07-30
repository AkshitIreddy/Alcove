/**
 * Notebook Script — `tree` / `mindmap` fence mini-parser.
 *
 * Indentation-stack grammar: 2 spaces per level (tabs count as 2 spaces,
 * ragged indents tolerated — any deeper line is a child of the nearest
 * shallower one). `label | note` adds an annotation; a trailing `{attrs}`
 * decorates the node. Blank lines and `//`/`#` comment lines are skipped.
 */

import type { Diag, SrcLine, TreeNode } from "../types";
import { parseAttrBlock } from "../attrParser";

const COMMENT_RE = /^\s*(\/\/|#)/;

export function parseTree(lines: SrcLine[], diags: Diag[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const stack: { indent: number; node: TreeNode }[] = [];

  for (const line of lines) {
    if (line.text.trim() === "" || COMMENT_RE.test(line.text)) continue;

    // tabs = 2 spaces (leading whitespace only)
    const expanded = line.text.replace(/^[\t ]*/, (ws) =>
      ws.replace(/\t/g, "  "),
    );
    const indent = expanded.length - expanded.trimStart().length;
    let content = expanded.trim();

    // trailing {attrs}
    let attrs: TreeNode["attrs"];
    const braceAt = content.indexOf("{");
    if (braceAt !== -1) {
      const res = parseAttrBlock(
        content.slice(braceAt),
        line.start + (line.text.length - content.length) + braceAt,
      );
      diags.push(...res.diags);
      if (Object.keys(res.attrs).length > 0) attrs = res.attrs;
      content = content.slice(0, braceAt).trim();
    }

    // `label | note`
    let label = content;
    let note: string | undefined;
    const pipeAt = content.indexOf("|");
    if (pipeAt !== -1) {
      label = content.slice(0, pipeAt).trim();
      note = content.slice(pipeAt + 1).trim();
      if (note === "") note = undefined;
    }

    const node: TreeNode = {
      label,
      children: [],
      srcStart: line.start,
      srcEnd: line.end,
      ...(note !== undefined ? { note } : {}),
      ...(attrs !== undefined ? { attrs } : {}),
    };

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1].node.children.push(node);
    stack.push({ indent, node });
  }

  return roots;
}
