import { describe, expect, it } from 'vitest';
import {
  buildWelcomePageDocs,
  WELCOME_PAGE_SOURCES,
} from '../src/data/seed';
import {
  parseNotebookScriptPages,
  splitNotebookScriptPages,
} from '../src/editor/script/pageBoundaries';

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

  it('previews protected boundaries without treating them as broken containers', () => {
    const parsed = parseNotebookScriptPages(
      '# One\n\n::page\n\n# Two\n\n::page # keep this aligned\n\n# Three',
    );

    expect(parsed.pages).toHaveLength(3);
    expect(parsed.preview.blocks.map((block) => block.kind)).toEqual([
      'heading',
      'heading',
      'heading',
    ]);
    expect(parsed.preview.diagnostics).toEqual([]);
  });

  it('keeps document-wide styles and frontmatter on later protected pages', () => {
    const parsed = parseNotebookScriptPages([
      '---',
      'paper: grid',
      '---',
      '::style hero {color=amber}',
      '# One',
      '::page',
      '# Two {use=hero}',
    ].join('\n'));

    expect(parsed.pages).toHaveLength(2);
    expect(parsed.pages[1]?.doc.frontmatter).toEqual({ paper: 'grid' });
    expect(parsed.pages[1]?.doc.blocks).toHaveLength(1);
    expect(parsed.pages[1]?.doc.blocks[0]?.attrs).toMatchObject({ color: 'amber' });
    expect(parsed.pages[1]?.doc.diagnostics).toEqual([]);
  });
});
