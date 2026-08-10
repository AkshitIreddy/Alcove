import { describe, expect, it } from 'vitest';
import {
  isProtectedFlowStart,
  splitNotebookScriptPages,
} from '../src/editor/script/pageBoundaries';

describe('Notebook Script page boundaries', () => {
  it('splits explicit page directives without leaking the directive', () => {
    expect(
      splitNotebookScriptPages('# One\n\n::page\n\n# Two\n\n::page # fixed\n# Three'),
    ).toEqual(['# One', '# Two', '# Three']);
  });

  it('recognises only durable protected page starts', () => {
    expect(isProtectedFlowStart({ attrs: { flowStart: true } })).toBe(true);
    expect(isProtectedFlowStart({ attrs: { flowStart: false } })).toBe(false);
    expect(isProtectedFlowStart({})).toBe(false);
  });
});
