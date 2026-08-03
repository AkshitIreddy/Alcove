/**
 * Table sorting — the part that is decidable without a document.
 *
 * Pure and DOM-free so tests/table-sort.test.ts can pin the ordering rules in
 * a Node environment; the transaction that actually reorders rows lives in
 * ./sortable.ts.
 *
 * THREE RULES, AND WHY EACH ONE IS A RULE
 *
 * 1. A COLUMN HAS A KIND, PER CELL. "12" and "twelve" in the same column is a
 *    real thing readers write, and a comparator that reads the column's kind
 *    once and forces every cell through it either loses the numbers or loses
 *    the words. So each cell is read on its own and kinds are ranked:
 *    numbers, then dates, then words, then blanks. A column of numbers sorts
 *    numerically; a column of numbers with one "n/a" in it sorts numerically
 *    with the "n/a" after them, which is what a hand would do.
 *
 * 2. BLANKS SINK, IN BOTH DIRECTIONS. A blank is not the smallest value, it is
 *    the absence of one, and flipping to descending should not float every
 *    empty cell to the top of the table. Spreadsheets have done this for forty
 *    years and readers expect it.
 *
 * 3. DATES ARE ISO ONLY. `03/08/2026` is the third of August in one country
 *    and the eighth of March in another, and a notebook cannot ask. ISO dates
 *    (and ISO timestamps) sort as dates; every other date-ish string sorts as
 *    text, which for `2026-08-03`-shaped input happens to be the same order
 *    anyway and for `03/08/2026` is at least an order the reader can predict.
 */

export type SortDirection = 'asc' | 'desc';

/** What one cell's text turned out to be. Rank order = the kind order. */
export type CellValue =
  | { readonly kind: 'number'; readonly rank: 0; readonly n: number }
  | { readonly kind: 'date'; readonly rank: 1; readonly t: number }
  | { readonly kind: 'text'; readonly rank: 2; readonly s: string }
  | { readonly kind: 'blank'; readonly rank: 3 };

const BLANK: CellValue = { kind: 'blank', rank: 3 };

/** Currency marks and separators a written number carries. */
const MONEY = /[$£€¥₹¢₽₺₩]/g;

/**
 * A number, if the text is one.
 *
 * Accepts what people write in tables: thousands separators, a leading or
 * trailing currency mark, a trailing percent, and accountants' parentheses for
 * negatives. Rejects anything with a letter left in it after that, so "3 cats"
 * stays text rather than sorting as 3.
 */
function readNumber(raw: string): number | null {
  let text = raw.replace(MONEY, '').trim();
  if (text === '') return null;

  let sign = 1;
  if (/^\(.*\)$/.test(text)) {
    sign = -1;
    text = text.slice(1, -1).trim();
  }
  const percent = text.endsWith('%');
  if (percent) text = text.slice(0, -1).trim();

  // Thousands separators, but only in the grouping positions — "1,5" is not a
  // number here, and neither is "1,23,456" outside the lakh convention we are
  // deliberately not guessing at.
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) text = text.replace(/,/g, '');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) return null;

  const value = Number(text);
  return Number.isFinite(value) ? sign * value : null;
}

/** An ISO date (or timestamp) as epoch ms, if the text is one. */
function readIsoDate(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/.test(text)) return null;
  const time = Date.parse(text.includes('T') ? text : text.replace(' ', 'T'));
  return Number.isFinite(time) ? time : null;
}

/** Read one cell's text into the value it sorts by. Total — never throws. */
export function readCell(raw: string): CellValue {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text === '') return BLANK;
  const n = readNumber(text);
  if (n !== null) return { kind: 'number', rank: 0, n };
  const t = readIsoDate(text);
  if (t !== null) return { kind: 'date', rank: 1, t };
  return { kind: 'text', rank: 2, s: text };
}

/**
 * Words compared the way a reader would file them: case-insensitive, accents
 * folded, and embedded numbers compared as numbers so "page 2" precedes
 * "page 10".
 */
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

/**
 * Ascending order between two cells, IGNORING the blank rule (which is applied
 * by `sortedRowOrder`, because it must survive the descending flip).
 */
export function compareCells(a: CellValue, b: CellValue): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.kind === 'number' && b.kind === 'number') return a.n - b.n;
  if (a.kind === 'date' && b.kind === 'date') return a.t - b.t;
  if (a.kind === 'text' && b.kind === 'text') return collator.compare(a.s, b.s);
  return 0;
}

/**
 * The order `rows` should be drawn in when sorted by `col`.
 *
 * Returns row INDICES rather than rows, so the caller reorders the real
 * ProseMirror nodes and nothing is rebuilt from text (which would throw away
 * every mark, cell attribute and nested block in the table).
 *
 * Ties keep their document order: Array#sort is stable, and the explicit index
 * tie-break makes that a promise of this function rather than of the engine.
 */
export function sortedRowOrder(
  rows: readonly (readonly string[])[],
  col: number,
  dir: SortDirection,
): number[] {
  const values = rows.map((row) => readCell(row[col] ?? ''));
  const flip = dir === 'desc' ? -1 : 1;
  return rows
    .map((_, index) => index)
    .sort((left, right) => {
      const a = values[left]!;
      const b = values[right]!;
      // Rule 2: blanks sink whichever way the arrow points.
      if (a.kind === 'blank' && b.kind !== 'blank') return 1;
      if (b.kind === 'blank' && a.kind !== 'blank') return -1;
      const cmp = compareCells(a, b) * flip;
      return cmp !== 0 ? cmp : left - right;
    });
}

/**
 * The cycle a header click walks: unsorted → ascending → descending → back to
 * the order the rows were written in.
 *
 * Clicking a DIFFERENT column always starts that column at ascending — the
 * alternative (inheriting the last column's direction) means the same gesture
 * gives a different answer depending on history.
 */
export function nextSortState(
  current: { col: number | null; dir: SortDirection | null },
  col: number,
): { col: number | null; dir: SortDirection | null } {
  if (current.col !== col || current.dir === null) return { col, dir: 'asc' };
  if (current.dir === 'asc') return { col, dir: 'desc' };
  return { col: null, dir: null };
}
