import { describe, expect, it } from 'vitest';
import {
  buildWelcomePageDocs,
  WELCOME_PAGE_SOURCES,
} from '../src/data/seed';
import { splitNotebookScriptPages } from '../src/editor/script/pageBoundaries';

describe('Notebook Script page boundaries', () => {
  it('splits explicit page directives without leaking the directive', () => {
    expect(
      splitNotebookScriptPages('# One\n\n::page\n\n# Two\n\n::page # fixed\n# Three'),
    ).toEqual(['# One', '# Two', '# Three']);
  });

  it('leaves boundary examples inside code and containers untouched', () => {
    const source = [
      '# One',
      '```notebook',
      '::page',
      '```',
      ':::callout',
      '::page',
      ':::',
      '::page',
      '# Two',
    ].join('\n');
    expect(splitNotebookScriptPages(source)).toEqual([
      '# One\n```notebook\n::page\n```\n:::callout\n::page\n:::',
      '# Two',
    ]);
  });

  it('leaves every authored Welcome page and its formatting envelope intact', () => {
    expect(
      WELCOME_PAGE_SOURCES.every(
        (source) => splitNotebookScriptPages(source).length === 1,
      ),
    ).toBe(true);
    expect(
      buildWelcomePageDocs().every(
        ({ doc }) => doc.attrs?.flowStart === undefined,
      ),
    ).toBe(true);
  });
});
