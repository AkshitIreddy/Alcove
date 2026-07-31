/**
 * Notebook Script — `timeline` fence mini-parser.
 *
 * One entry per line: `label: text | attrs`
 *   1839: Schwann — animal cells | color=terracotta
 *
 * The label is everything before the first `:`; a missing colon degrades to
 * an entry with an empty label (warned). Blank lines and `//`/`#` comment
 * lines are skipped.
 */

import type { Diag, SrcLine, TimelineEntry } from "../types";
import { parseBareAttrs } from "../attrParser";
import { pushDiag } from "../diagnostics";

const COMMENT_RE = /^\s*(\/\/|#)/;

export function parseTimeline(lines: SrcLine[], diags: Diag[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const line of lines) {
    const raw = line.text.trim();
    if (raw === "" || COMMENT_RE.test(raw)) continue;

    // split off `| attrs` tail (first pipe wins; parseBareAttrs handles more)
    let main = raw;
    let attrs: TimelineEntry["attrs"];
    const pipeAt = raw.indexOf("|");
    if (pipeAt !== -1) {
      const tail = raw.slice(pipeAt + 1);
      const res = parseBareAttrs(tail, line.start + (line.text.length - raw.length) + pipeAt + 1);
      diags.push(...res.diags);
      if (Object.keys(res.attrs).length > 0) attrs = res.attrs;
      main = raw.slice(0, pipeAt).trim();
    }

    let label = "";
    let text = main;
    const colonAt = main.indexOf(":");
    if (colonAt !== -1) {
      label = main.slice(0, colonAt).trim();
      text = main.slice(colonAt + 1).trim();
    } else {
      pushDiag(
        diags,
        "timeline-missing-label",
        `timeline entry has no 'label:' separator — using the whole line as text`,
        { srcStart: line.start, srcEnd: line.end },
        "label: text",
      );
    }

    entries.push({
      label,
      text,
      srcStart: line.start,
      srcEnd: line.end,
      ...(attrs !== undefined ? { attrs } : {}),
    });
  }

  return entries;
}
