/**
 * Notebook Script — inline parser.
 *
 * Single forward pass with an explicit delimiter stack (simplified
 * CommonMark/Djot flanking). Unclosed delimiters degrade to literal text —
 * never an error. Any closed span may take a trailing `{attrs}` with no space
 * before the brace (`==term=={color=moss}`).
 *
 * Markers: `**`/`__` strong, `*`/`_` em, `~~` strike, `==` highlight,
 * `^` sup, `~` sub, `` ` `` code, `[text](url)` link. Backslash escapes any
 * ASCII punctuation character.
 */

import type { Attrs, Diag, Inline, TextNode } from "./types";
import { parseAttrBlock } from "./attrParser";

interface Frame {
  type: "root" | "strong" | "em" | "strike" | "highlight" | "sup" | "sub" | "link";
  marker: string;
  /** Absolute offset of the opening marker. */
  start: number;
  children: Inline[];
}

const ASCII_PUNCT = /[!-/:-@[-`{-~]/;
const WORD = /[A-Za-z0-9]/;

/** Merge adjacent text nodes and drop empty ones (canonical shape). */
function mergeText(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes) {
    if (n.kind === "text" && n.text === "" && n.attrs === undefined) continue;
    const last = out[out.length - 1];
    if (
      n.kind === "text" &&
      last !== undefined &&
      last.kind === "text" &&
      last.attrs === undefined &&
      n.attrs === undefined
    ) {
      last.text += n.text;
      last.srcEnd = n.srcEnd;
    } else {
      out.push(n);
    }
  }
  return out;
}

export interface InlineParseResult {
  nodes: Inline[];
  diags: Diag[];
}

export function parseInline(text: string, base: number): InlineParseResult {
  const diags: Diag[] = [];
  const root: Frame = { type: "root", marker: "", start: base, children: [] };
  const stack: Frame[] = [root];
  let buf = "";
  let bufStart = 0; // relative
  let i = 0;

  const top = (): Frame => stack[stack.length - 1];

  const appendText = (s: string, from: number): void => {
    if (buf === "") bufStart = from;
    buf += s;
  };

  const flush = (endRel: number): void => {
    if (buf === "") return;
    const node: TextNode = {
      kind: "text",
      text: buf,
      srcStart: base + bufStart,
      srcEnd: base + endRel,
    };
    top().children.push(node);
    buf = "";
  };

  /** Pop `frame` treating its opener as literal text (degradation path). */
  const literalize = (frame: Frame): void => {
    stack.pop();
    const parent = top();
    const literal: TextNode = {
      kind: "text",
      text: frame.marker,
      srcStart: frame.start,
      srcEnd: frame.start + frame.marker.length,
    };
    parent.children.push(literal, ...frame.children);
  };

  /** Consume a trailing `{attrs}` if one immediately follows position `at`. */
  const maybeAttrs = (at: number): { attrs: Attrs | undefined; end: number } => {
    if (text[at] !== "{") return { attrs: undefined, end: at };
    const res = parseAttrBlock(text.slice(at), base + at);
    diags.push(...res.diags);
    const has = Object.keys(res.attrs).length > 0;
    return { attrs: has ? res.attrs : undefined, end: at + res.end };
  };

  const closeFrame = (idx: number, markerLen: number): void => {
    // literalize any unclosed frames sitting above the one we're closing
    while (stack.length - 1 > idx) literalize(top());
    const frame = stack.pop() as Frame;
    const after = i + markerLen;
    const { attrs, end } = maybeAttrs(after);
    const node: Inline = {
      kind: frame.type as Exclude<Frame["type"], "root" | "link">,
      children: mergeText(frame.children),
      srcStart: frame.start,
      srcEnd: base + end,
      ...(attrs !== undefined ? { attrs } : {}),
    } as Inline;
    top().children.push(node);
    i = end;
  };

  while (i < text.length) {
    const ch = text[i];

    // backslash escape of ASCII punctuation
    if (ch === "\\" && i + 1 < text.length && ASCII_PUNCT.test(text[i + 1])) {
      appendText(text[i + 1], i);
      i += 2;
      continue;
    }

    // code span: scan ahead for a matching backtick run
    if (ch === "`") {
      let n = 1;
      while (text[i + n] === "`") n++;
      const open = "`".repeat(n);
      const close = text.indexOf(open, i + n);
      if (close === -1) {
        appendText(open, i);
        i += n;
        continue;
      }
      flush(i);
      const content = text.slice(i + n, close);
      const after = close + n;
      const { attrs, end } = maybeAttrs(after);
      top().children.push({
        kind: "code",
        text: content,
        srcStart: base + i,
        srcEnd: base + end,
        ...(attrs !== undefined ? { attrs } : {}),
      });
      i = end;
      continue;
    }

    if (ch === "[") {
      flush(i);
      stack.push({ type: "link", marker: "[", start: base + i, children: [] });
      i++;
      continue;
    }

    if (ch === "]") {
      let linkIdx = -1;
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].type === "link") {
          linkIdx = k;
          break;
        }
      }
      if (linkIdx === -1) {
        appendText("]", i);
        i++;
        continue;
      }
      flush(i);
      if (text[i + 1] === "(") {
        const closeParen = text.indexOf(")", i + 2);
        if (closeParen !== -1) {
          while (stack.length - 1 > linkIdx) literalize(top());
          const frame = stack.pop() as Frame;
          const href = text.slice(i + 2, closeParen).trim();
          const { attrs, end } = maybeAttrs(closeParen + 1);
          top().children.push({
            kind: "link",
            href,
            children: mergeText(frame.children),
            srcStart: frame.start,
            srcEnd: base + end,
            ...(attrs !== undefined ? { attrs } : {}),
          });
          i = end;
          continue;
        }
      }
      // no (url) → the bracket was literal
      while (stack.length - 1 >= linkIdx) literalize(top());
      appendText("]", i);
      i++;
      continue;
    }

    // emphasis-family markers
    const two = text.slice(i, i + 2);
    let marker = "";
    let type: Frame["type"] | "" = "";
    if (two === "**" || two === "__") {
      marker = two;
      type = "strong";
    } else if (two === "~~") {
      marker = two;
      type = "strike";
    } else if (two === "==") {
      marker = two;
      type = "highlight";
    } else if (ch === "*") {
      marker = "*";
      type = "em";
    } else if (ch === "_") {
      marker = "_";
      type = "em";
    } else if (ch === "^") {
      marker = "^";
      type = "sup";
    } else if (ch === "~") {
      marker = "~";
      type = "sub";
    }

    if (marker !== "") {
      const prev = i > 0 ? text[i - 1] : "";
      const next = text[i + marker.length] ?? "";
      // no intra-word emphasis for underscore markers (snake_case safety)
      if (
        (marker === "_" || marker === "__") &&
        WORD.test(prev) &&
        WORD.test(next)
      ) {
        appendText(marker, i);
        i += marker.length;
        continue;
      }
      // close the top frame first so `***x***` nests correctly
      const t = top();
      if (t.type !== "root" && t.marker === marker && prev !== "" && !/\s/.test(prev)) {
        flush(i);
        closeFrame(stack.length - 1, marker.length);
        continue;
      }
      let openIdx = -1;
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].marker === marker) {
          openIdx = k;
          break;
        }
      }
      const canClose = openIdx !== -1 && prev !== "" && !/\s/.test(prev);
      const canOpen = next !== "" && !/\s/.test(next);
      if (canClose) {
        flush(i);
        closeFrame(openIdx, marker.length);
      } else if (canOpen) {
        flush(i);
        stack.push({ type: type as Frame["type"], marker, start: base + i, children: [] });
        i += marker.length;
      } else {
        appendText(marker, i);
        i += marker.length;
      }
      continue;
    }

    appendText(ch, i);
    i++;
  }

  flush(text.length);
  while (stack.length > 1) {
    const frame = top();
    diags.push({
      severity: "warn",
      message: `unclosed '${frame.marker}' — rendered as plain text`,
      span: { srcStart: frame.start, srcEnd: frame.start + frame.marker.length },
    });
    literalize(frame);
  }
  return { nodes: mergeText(root.children), diags };
}
