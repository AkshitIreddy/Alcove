/**
 * src/editor/codeIndent.ts — what the indent keys do, as arithmetic.
 *
 * Every function here takes the code block's text and a caret offset INSIDE
 * that text and returns an edit description. Nothing touches ProseMirror,
 * nothing touches the DOM, so the whole of "what should Tab do here" is
 * unit-testable in Node — which matters, because indentation is a feature
 * made entirely of edge cases (a caret in the middle of the leading
 * whitespace, a selection that starts halfway down a line, a Makefile whose
 * indent is a real tab) and every one of them is a keystroke somebody will
 * press on their first day.
 *
 * Offsets are plain string indices into the block's text content, which is
 * what `node.textContent` gives and what `blockStart + offset` maps back to.
 */

/** A replacement of `[from, to)` with `text`, plus where the caret lands. */
export interface CodeEdit {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  /** Caret offset (absolute, in the NEW text) once the edit is applied. */
  readonly caret: number;
  /** Selection anchor, when the edit should leave a range selected. */
  readonly anchor?: number;
}

/** Start offset of the line containing `offset`. */
export function lineStart(text: string, offset: number): number {
  const at = clamp(offset, 0, text.length);
  const nl = text.lastIndexOf('\n', at - 1);
  return nl === -1 ? 0 : nl + 1;
}

/** End offset (exclusive of the newline) of the line containing `offset`. */
export function lineEnd(text: string, offset: number): number {
  const at = clamp(offset, 0, text.length);
  const nl = text.indexOf('\n', at);
  return nl === -1 ? text.length : nl;
}

/** The run of spaces and tabs the line at `offset` opens with. */
export function leadingWhitespace(text: string, offset: number): string {
  const start = lineStart(text, offset);
  const end = lineEnd(text, offset);
  const line = text.slice(start, end);
  return /^[ \t]*/.exec(line)?.[0] ?? '';
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Indent every line the range touches by one `unit`.
 *
 * "Touches" is the important word: a selection from the middle of line 3 to
 * the middle of line 5 indents all three lines, not the characters between
 * the two carets. Prefixing the selected TEXT is what an editor does when it
 * has not thought about it, and the visible result is a first line that jumps
 * three characters in from where the reader put their cursor.
 *
 * With an empty selection the unit goes in at the CARET rather than at the
 * start of the line, because that is what Tab means when you are typing: you
 * are asking for a gap here, not for the line to move.
 */
export function indentRange(
  text: string,
  from: number,
  to: number,
  unit: string,
): CodeEdit {
  if (from === to) {
    return { from, to, text: unit, caret: from + unit.length };
  }
  const start = lineStart(text, from);
  const end = lineEnd(text, to);
  const lines = text.slice(start, end).split('\n');
  const next = lines.map((line) => unit + line).join('\n');
  return {
    from: start,
    to: end,
    text: next,
    anchor: start,
    caret: start + next.length,
  };
}

/**
 * Remove up to one `unit` of leading whitespace from every line the range
 * touches. Lines with nothing to give are left exactly as they are.
 *
 * A tab counts as one unit however wide the unit is, and a partial run of
 * spaces is taken in full rather than left at an odd number — outdent should
 * always reach a column the reader could have typed.
 */
export function outdentRange(
  text: string,
  from: number,
  to: number,
  unit: string,
): CodeEdit | null {
  const start = lineStart(text, from);
  const end = lineEnd(text, to);
  const lines = text.slice(start, end).split('\n');
  let removedFirst = 0;
  let changed = false;
  const next = lines
    .map((line, index) => {
      const strip = outdentPrefix(line, unit);
      if (strip > 0) changed = true;
      if (index === 0) removedFirst = strip;
      return line.slice(strip);
    })
    .join('\n');
  if (!changed) return null;
  const caret =
    from === to
      ? clamp(from - removedFirst, start, start + next.length)
      : start + next.length;
  return {
    from: start,
    to: end,
    text: next,
    ...(from === to ? {} : { anchor: start }),
    caret,
  };
}

/** How many leading characters one outdent step should take off `line`. */
function outdentPrefix(line: string, unit: string): number {
  if (line.startsWith('\t')) return 1;
  const width = unit === '\t' ? 4 : unit.length;
  let n = 0;
  while (n < width && line[n] === ' ') n += 1;
  return n;
}

/**
 * Should Backspace at `offset` eat a whole indent step?
 *
 * Only when everything before the caret on this line is whitespace — inside
 * code, that is the one place a run of spaces is structure rather than
 * typing, and having to press Backspace four times to leave a block is the
 * single most-complained-about thing about editors that skip this.
 *
 * Returns how many characters to delete, or 0 to let the normal Backspace
 * through.
 */
export function backspaceIndent(
  text: string,
  offset: number,
  unit: string,
): number {
  if (unit === '\t') return 0;
  const start = lineStart(text, offset);
  if (offset <= start) return 0;
  const before = text.slice(start, offset);
  if (!/^ +$/.test(before)) return 0;
  const width = unit.length;
  const over = before.length % width;
  return over === 0 ? width : over;
}

/* ============================== auto-indent =============================== */

export interface AutoIndentOptions {
  /** Spaces per step, or `\t` for a real tab. */
  readonly unit: string;
  /** A line ending in `:` opens a block (Python, YAML, Haskell…). */
  readonly offside?: boolean;
  /** `do` / `then` / `begin` open a block (Ruby, Lua, shell, Elixir…). */
  readonly wordBlocks?: boolean;
}

/** Openers and their closers, for the "caret between a pair" case. */
const PAIRS: Readonly<Record<string, string>> = {
  '{': '}',
  '[': ']',
  '(': ')',
};

const WORD_OPENERS = /(?:^|\s)(?:do|then|begin)$/;

/**
 * What Enter should insert at `offset`, and where the caret ends up.
 *
 * Three behaviours, in order of how surprising they would be to leave out:
 *
 *   1. carry the current line's indentation onto the new line — without this
 *      every second line of a nested block has to be re-indented by hand;
 *   2. add a step when the line opens a block, by bracket, by `:` in an
 *      offside language, or by `do`/`then`/`begin` in a word-block one;
 *   3. when the caret sits BETWEEN a pair — `{|}` — put the closer on its own
 *      line at the original indent and leave the caret on the blank line
 *      between them, which is the shape everybody actually wants and nobody
 *      wants to type.
 *
 * Returns null when there is nothing clever to do, so the caller can let a
 * plain newline through rather than re-implementing one.
 */
export function autoIndent(
  text: string,
  offset: number,
  options: AutoIndentOptions,
): CodeEdit | null {
  const at = clamp(offset, 0, text.length);
  const start = lineStart(text, at);
  const base = leadingWhitespace(text, at);
  const before = text.slice(start, at);
  const after = text.slice(at, lineEnd(text, at));

  // Only the whitespace that is actually BEHIND the caret can be carried: a
  // caret parked in the middle of a line's indent must not deal itself the
  // whole run, or splitting a line duplicates its indentation.
  const carried = base.slice(0, Math.min(base.length, before.length));

  const trimmedBefore = before.trimEnd();
  const opener = trimmedBefore.slice(-1);
  const closer = PAIRS[opener];
  const opensBracket = closer !== undefined;
  const opensOffside = options.offside === true && trimmedBefore.endsWith(':');
  const opensWord =
    options.wordBlocks === true && WORD_OPENERS.test(trimmedBefore);
  const opens = opensBracket || opensOffside || opensWord;

  if (!opens && carried === '') return null;

  const inner = opens ? carried + options.unit : carried;

  // `{|}` — the closer goes to its own line and the caret sits between.
  if (opensBracket && after.trimStart().startsWith(closer as string)) {
    const insert = `\n${inner}\n${carried}`;
    return { from: at, to: at, text: insert, caret: at + 1 + inner.length };
  }

  const insert = `\n${inner}`;
  return { from: at, to: at, text: insert, caret: at + insert.length };
}

/* ============================ comment toggling =========================== */

/**
 * Toggle a line comment on every line the range touches.
 *
 * Uncommenting wins when EVERY non-blank line already carries the marker —
 * the alternative (toggling per line) turns a half-commented block into the
 * other half-commented block, which is never what the keystroke meant.
 *
 * The marker goes in at the shallowest indentation in the range rather than
 * at column zero, so a commented block keeps the shape of the code under it.
 */
export function toggleComment(
  text: string,
  from: number,
  to: number,
  marker: string,
): CodeEdit | null {
  if (marker === '') return null;
  const start = lineStart(text, from);
  const end = lineEnd(text, to);
  const lines = text.slice(start, end).split('\n');
  const meaningful = lines.filter((line) => line.trim() !== '');
  if (meaningful.length === 0) return null;

  const commented = meaningful.every((line) =>
    line.trimStart().startsWith(marker),
  );
  let next: string;
  if (commented) {
    next = lines
      .map((line) => {
        const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
        const rest = line.slice(indent.length);
        if (!rest.startsWith(marker)) return line;
        const body = rest.slice(marker.length);
        return indent + (body.startsWith(' ') ? body.slice(1) : body);
      })
      .join('\n');
  } else {
    const column = meaningful.reduce(
      (min, line) => Math.min(min, (/^[ \t]*/.exec(line)?.[0] ?? '').length),
      Number.POSITIVE_INFINITY,
    );
    next = lines
      .map((line) =>
        line.trim() === ''
          ? line
          : line.slice(0, column) + marker + ' ' + line.slice(column),
      )
      .join('\n');
  }
  return {
    from: start,
    to: end,
    text: next,
    anchor: start,
    caret: start + next.length,
  };
}
