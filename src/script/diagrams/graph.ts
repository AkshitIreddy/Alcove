/**
 * Notebook Script — `graph` / `flowchart` fence mini-parser.
 *
 * Grammar: `A -> B: label`, fan-out `A -> B, C`, chains `A -> B -> C`,
 * node decoration `A {shape=cloud, color=amber}` on its own line.
 *
 * Mermaid-compat ramp (models emit it out of habit): `-->`/`==>` arrows,
 * a `graph TD` / `flowchart LR` header line (ignored with a warning),
 * `A[Label]`/`A(Label)` node labels, `-->|label|` edge labels, `%%` comments
 * and trailing semicolons.
 */

import type { Diag, Graph, GraphNode, Span, SrcLine } from "../types";
import { parseAttrBlock } from "../attrParser";

const COMMENT_RE = /^\s*(\/\/|#|%%)/;
const HEADER_RE = /^\s*(graph|flowchart|digraph)\b\s*(TD|TB|LR|RL|BT)?\s*\{?\s*;?\s*$/i;
const ARROW_RE = /\s*(?:-+>|=+>|→)\s*/;

function warn(diags: Diag[], message: string, span: Span): void {
  diags.push({ severity: "warn", message, span });
}

export function parseGraph(lines: SrcLine[], diags: Diag[]): Graph {
  const nodes = new Map<string, GraphNode>();
  const graph: Graph = { nodes: [], edges: [] };

  const ensureNode = (id: string, span: Span): GraphNode => {
    let node = nodes.get(id);
    if (node === undefined) {
      node = { id, srcStart: span.srcStart, srcEnd: span.srcEnd };
      nodes.set(id, node);
      graph.nodes.push(node);
    }
    return node;
  };

  /**
   * Parse one node reference: bare id, Mermaid `id[Label]`/`id(Label)`/
   * `id{Label}` (label variant warned), or `id {attrs}`.
   */
  const parseRef = (raw: string, span: Span): GraphNode | null => {
    let s = raw.trim();
    if (s === "") return null;
    let label: string | undefined;
    let attrs: GraphNode["attrs"];

    const braceAt = s.indexOf("{");
    if (braceAt !== -1) {
      const inner = s.slice(braceAt + 1, s.includes("}") ? s.lastIndexOf("}") : s.length);
      if (/[=:]/.test(inner)) {
        const res = parseAttrBlock(s.slice(braceAt), span.srcStart + braceAt);
        diags.push(...res.diags);
        if (Object.keys(res.attrs).length > 0) attrs = res.attrs;
      } else if (inner.trim() !== "") {
        label = inner.trim();
        warn(diags, `Mermaid-style '{...}' node label accepted — prefer 'id {shape=...}' attrs`, span);
      }
      s = s.slice(0, braceAt).trim();
    }

    const m = /^([^[(]+)\s*(?:\[([^\]]*)\]|\(([^)]*)\))\s*$/.exec(s);
    if (m) {
      s = m[1].trim();
      const bracketLabel = (m[2] ?? m[3] ?? "").trim();
      if (bracketLabel !== "") {
        label = bracketLabel;
        warn(diags, `Mermaid-style node label '[...]' accepted — prefer plain names`, span);
      }
    }

    if (s === "") return null;
    const node = ensureNode(s, span);
    if (label !== undefined && node.label === undefined) node.label = label;
    if (attrs !== undefined) node.attrs = { ...(node.attrs ?? {}), ...attrs };
    return node;
  };

  for (const line of lines) {
    let text = line.text.trim();
    if (text === "" || COMMENT_RE.test(text)) continue;
    const span: Span = { srcStart: line.start, srcEnd: line.end };

    if (HEADER_RE.test(text)) {
      warn(diags, `Mermaid-style header '${text}' ignored — Notebook Script graphs need no header`, span);
      continue;
    }
    text = text.replace(/;+\s*$/, "");
    if (text === "") continue;

    const segments = text.split(ARROW_RE);
    if (segments.length === 1) {
      // node decoration / definition line (possibly `id: label`)
      let seg = segments[0];
      let label: string | undefined;
      if (!seg.includes("{")) {
        const colonAt = seg.indexOf(":");
        if (colonAt !== -1) {
          label = seg.slice(colonAt + 1).trim();
          seg = seg.slice(0, colonAt);
        }
      }
      const node = parseRef(seg, span);
      if (node !== null && label !== undefined && label !== "" && node.label === undefined) {
        node.label = label;
      }
      continue;
    }

    // edge chain: consecutive segment groups become edges (with fan-out)
    let prevGroup: GraphNode[] = [];
    for (let s = 0; s < segments.length; s++) {
      let seg = segments[s];
      let edgeLabel: string | undefined;

      // Mermaid `-->|label| B`
      const pipe = /^\|([^|]*)\|\s*(.*)$/.exec(seg.trim());
      if (pipe && s > 0) {
        edgeLabel = pipe[1].trim();
        seg = pipe[2];
      }
      // `A -> B: label` (label after colon on a target segment)
      if (edgeLabel === undefined && s > 0 && !seg.includes("{")) {
        const colonAt = seg.indexOf(":");
        if (colonAt !== -1) {
          edgeLabel = seg.slice(colonAt + 1).trim();
          seg = seg.slice(0, colonAt);
        }
      }

      const group: GraphNode[] = [];
      for (const part of seg.split(",")) {
        const node = parseRef(part, span);
        if (node !== null) group.push(node);
      }

      if (s > 0) {
        if (prevGroup.length === 0) {
          warn(diags, "edge is missing its source — skipped", span);
        } else if (group.length === 0) {
          warn(diags, "dangling arrow — edge target missing", span);
        } else {
          for (const from of prevGroup) {
            for (const to of group) {
              graph.edges.push({
                from: from.id,
                to: to.id,
                srcStart: span.srcStart,
                srcEnd: span.srcEnd,
                ...(edgeLabel !== undefined && edgeLabel !== ""
                  ? { label: edgeLabel }
                  : {}),
              });
            }
          }
        }
      }
      prevGroup = group;
    }
  }

  return graph;
}
