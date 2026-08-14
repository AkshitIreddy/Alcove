import { describe, expect, it } from 'vitest';
import type { Page, PageDoc } from '../src/data/types';
import {
  buildTocRows,
  filterTocRows,
  normalizeTocSearch,
  pageHasVisibleContent,
} from '../src/views/toc';

const doc = (...content: unknown[]): PageDoc => ({ type: 'doc', content });
const text = (value: string) => ({ type: 'text', text: value });
const paragraph = (value = '') => ({
  type: 'paragraph',
  ...(value === '' ? {} : { content: [text(value)] }),
});
const heading = (value: string, level = 2) => ({
  type: 'heading',
  attrs: { level },
  content: [text(value)],
});
const page = (slot: number, pageDoc: PageDoc): Page => ({
  id: `page-${slot}`,
  bookId: 'book',
  ord: slot,
  doc: pageDoc,
  scriptSource: null,
  sourceDirty: false,
  updatedAt: '2026-08-11T00:00:00.000Z',
});

describe('table-of-contents presentation rows', () => {
  it('names heading-less content as a continuation and omits stocked trailing blanks', () => {
    const rows = buildTocRows([
      page(0, doc(heading('The Final Tree'), paragraph('Branch convention.'))),
      page(1, doc({ type: 'diagram', attrs: { kind: 'tree' } })),
      page(2, doc(heading('Final Codes'))),
      page(3, doc(paragraph())),
      page(4, doc(paragraph())),
    ]);

    expect(rows).toEqual([
      { slot: 0, level: 2, text: 'The Final Tree', isPageRow: false },
      {
        slot: 1,
        level: 0,
        text: 'continued — The Final Tree',
        isPageRow: true,
      },
      { slot: 2, level: 2, text: 'Final Codes', isPageRow: false },
    ]);
  });

  it('keeps an intentional blank inside the authored range reachable', () => {
    const rows = buildTocRows([
      page(0, doc(heading('Opening'))),
      page(1, doc(paragraph())),
      page(2, doc(paragraph('Later prose.'))),
    ]);
    expect(rows[1]).toEqual({
      slot: 1,
      level: 0,
      text: 'blank page',
      isPageRow: true,
    });
    expect(rows[2]?.text).toBe('continued — Opening');
  });

  it('recognises text and atomic visuals but not an empty TipTap paragraph', () => {
    expect(pageHasVisibleContent(doc(paragraph()))).toBe(false);
    expect(pageHasVisibleContent(doc(paragraph('Hello')))).toBe(true);
    expect(
      pageHasVisibleContent(doc({ type: 'image', attrs: { src: 'x.png' } })),
    ).toBe(true);
  });

  it('searches headings without case or accent sensitivity and keeps book order', () => {
    const rows = buildTocRows([
      page(0, doc(heading('Résumé of naïve Bayes'), paragraph('Opening.'))),
      page(1, doc(heading('Probability Review'))),
      page(2, doc(heading('Bayesian Résumé'))),
    ]);

    expect(normalizeTocSearch('  RÉSUMÉ—Naïve  ')).toBe('resume naive');
    expect(filterTocRows(rows, 'resume')).toEqual([rows[0], rows[2]]);
    expect(filterTocRows(rows, 'NAIVE bayes')).toEqual([rows[0]]);
  });

  it('finds page aliases and requires every query word to match one row', () => {
    const rows = buildTocRows([
      page(0, doc(heading('Opening'))),
      page(1, doc(heading('Worked example'))),
      page(2, doc(heading('Closing notes'))),
    ]);

    expect(filterTocRows(rows, 'page 2')).toEqual([rows[1]]);
    expect(filterTocRows(rows, 'p.3')).toEqual([rows[2]]);
    expect(filterTocRows(rows, 'worked 2')).toEqual([rows[1]]);
    expect(filterTocRows(rows, 'worked 3')).toEqual([]);
    expect(filterTocRows(rows, '   ')).toEqual(rows);
  });

  it('matches numeric page aliases exactly in books with double-digit pages', () => {
    const rows = buildTocRows(Array.from({ length: 22 }, (_, slot) =>
      page(slot, doc(heading(
        slot === 21 ? 'Appendix 2' : `Section ${String.fromCharCode(65 + slot)}`,
      ))),
    ));

    expect(filterTocRows(rows, 'page 2')).toEqual([rows[1]]);
    expect(filterTocRows(rows, 'p.2')).toEqual([rows[1]]);
    // The exact alias reaches page 2; a numeral genuinely present in a title
    // remains an ordinary text match rather than being hidden by alias logic.
    expect(filterTocRows(rows, '2')).toEqual([rows[1], rows[21]]);
    expect(filterTocRows(rows, 'section b 2')).toEqual([rows[1]]);
    expect(filterTocRows(rows, 'section l 2')).toEqual([]);
  });
});
