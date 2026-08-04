/**
 * tests/code-block.test.ts — the code block, as arithmetic.
 *
 * Indentation is a feature made entirely of edge cases, and every one of them
 * is a keystroke somebody will press on their first day: a caret halfway
 * through a line's leading whitespace, a selection that starts mid-line and
 * ends mid-line three lines later, a Makefile whose indent is a real tab, a
 * half-commented block. `src/editor/codeIndent.ts` is DOM-free precisely so
 * every one of them can be pinned here rather than discovered by a reader.
 *
 * The second half covers the two questions the block has to answer about text
 * arriving from elsewhere: "is this code, and if so which" — the part where
 * being wrong confidently is worse than saying nothing.
 */

import { describe, expect, it } from 'vitest';

import {
  autoIndent,
  backspaceIndent,
  indentRange,
  leadingWhitespace,
  lineEnd,
  lineStart,
  outdentRange,
  toggleComment,
  type CodeEdit,
} from '../src/editor/codeIndent';
import {
  CODE_LANGUAGE_SHELVES,
  CODE_LANGUAGE_SHORTLIST,
  indentUnit,
  languageLabel,
  resolveLanguage,
} from '../src/editor/codeLanguages';
import {
  clipboardLanguage,
  canHighlight,
  detectLanguage,
  fencedPaste,
  lowlight,
} from '../src/editor/codeHighlight';
import { CODE_LANGS } from '../src/script/vocab';
import { resolveCodeLang, resolveDiagramLang } from '../src/script/normalize';

/** Apply an edit to the text it was computed from, and mark the caret with |. */
function applied(text: string, edit: CodeEdit | null): string {
  if (edit === null) return text;
  const next = text.slice(0, edit.from) + edit.text + text.slice(edit.to);
  return next.slice(0, edit.caret) + '|' + next.slice(edit.caret);
}

/** Offset of the `|` marker in a fixture, and the fixture without it. */
function at(fixture: string): [text: string, offset: number] {
  const offset = fixture.indexOf('|');
  return [fixture.replace('|', ''), offset];
}

/* ============================== line geometry ============================= */

describe('finding the line the caret is on', () => {
  const text = 'one\n  two\n\nfour';

  it('locates the start and end of every line', () => {
    expect(lineStart(text, 0)).toBe(0);
    expect(lineEnd(text, 0)).toBe(3);
    expect(lineStart(text, 6)).toBe(4);
    expect(lineEnd(text, 6)).toBe(9);
    // The blank line: start and end are the same offset.
    expect(lineStart(text, 10)).toBe(10);
    expect(lineEnd(text, 10)).toBe(10);
  });

  it('clamps rather than throwing on an offset off either end', () => {
    expect(lineStart(text, -5)).toBe(0);
    expect(lineEnd(text, 9999)).toBe(text.length);
  });

  it('reads the leading whitespace, tabs included', () => {
    expect(leadingWhitespace('    x', 4)).toBe('    ');
    expect(leadingWhitespace('\t\tx', 1)).toBe('\t\t');
    expect(leadingWhitespace('x', 1)).toBe('');
  });
});

/* ================================== Tab ================================== */

describe('Tab', () => {
  it('inserts one step at the caret when nothing is selected', () => {
    const [text, offset] = at('const x =| 1');
    expect(applied(text, indentRange(text, offset, offset, '  '))).toBe(
      'const x =  | 1',
    );
  });

  it('indents every line a selection TOUCHES, not the selected characters', () => {
    // The failure this pins: prefixing the selected text moves the first line
    // in from wherever the cursor happened to be, three characters short of
    // the column every other line lands on.
    const text = 'a = 1\nb = 2\nc = 3';
    const edit = indentRange(text, 2, 14, '  ');
    expect(applied(text, edit).replace('|', '')).toBe('  a = 1\n  b = 2\n  c = 3');
  });

  it('uses the language its own indent step, real tabs included', () => {
    expect(indentUnit('python')).toBe('    ');
    expect(indentUnit('javascript')).toBe('  ');
    // A Makefile with spaces in front of a recipe does not run, and Go is
    // gofmt's business, not ours.
    expect(indentUnit('makefile')).toBe('\t');
    expect(indentUnit('go')).toBe('\t');
    expect(indentUnit(null)).toBe('  ');
    expect(indentUnit('a language nobody has')).toBe('  ');
  });
});

describe('Shift-Tab', () => {
  it('takes one step off every line it touches, and skips the ones with none', () => {
    const text = '    a\n  b\nc';
    const edit = outdentRange(text, 0, text.length, '  ');
    expect(applied(text, edit as CodeEdit).replace('|', '')).toBe('  a\nb\nc');
  });

  it('takes a partial run in full — outdent always reaches a real column', () => {
    const text = '   x'; // three spaces, in a four-space language
    const edit = outdentRange(text, 4, 4, '    ');
    // All three go, not two: an outdent that leaves you at column one has put
    // the caret somewhere no keystroke could have typed it.
    expect(applied(text, edit as CodeEdit)).toBe('x|');
  });

  it('counts a tab as one step however wide the step is', () => {
    const text = '\t\tx';
    const edit = outdentRange(text, 3, 3, '    ');
    expect(applied(text, edit as CodeEdit).replace('|', '')).toBe('\tx');
  });

  it('reports null when there is nothing left to give', () => {
    expect(outdentRange('x', 1, 1, '  ')).toBeNull();
    expect(outdentRange('a\nb', 0, 3, '  ')).toBeNull();
  });
});

/* ================================ Backspace ============================== */

describe('Backspace inside the indent', () => {
  it('eats a whole step when everything before the caret is whitespace', () => {
    const [text, offset] = at('    |x');
    expect(backspaceIndent(text, offset, '    ')).toBe(4);
  });

  it('eats only back to the previous stop when the run is ragged', () => {
    const [text, offset] = at('      |x'); // six spaces, four-wide steps
    expect(backspaceIndent(text, offset, '    ')).toBe(2);
  });

  it('leaves a normal Backspace alone once there is code behind the caret', () => {
    const [text, offset] = at('    x|');
    expect(backspaceIndent(text, offset, '    ')).toBe(0);
  });

  it('does nothing in a tab language — one press already deletes one tab', () => {
    expect(backspaceIndent('\t\t', 2, '\t')).toBe(0);
  });
});

/* =============================== auto-indent ============================= */

describe('Enter', () => {
  it('carries the current line indentation onto the new line', () => {
    const [text, offset] = at('    return x|');
    expect(applied(text, autoIndent(text, offset, { unit: '    ' }))).toBe(
      '    return x\n    |',
    );
  });

  it('adds a step after an opening bracket', () => {
    const [text, offset] = at('  const o = {|');
    expect(applied(text, autoIndent(text, offset, { unit: '  ' }))).toBe(
      '  const o = {\n    |',
    );
  });

  it('puts the closer on its own line when the caret sits between a pair', () => {
    const [text, offset] = at('function f() {|}');
    expect(applied(text, autoIndent(text, offset, { unit: '  ' }))).toBe(
      'function f() {\n  |\n}',
    );
  });

  it('indents after a colon, but only in an offside language', () => {
    const [text, offset] = at('def f():|');
    expect(applied(text, autoIndent(text, offset, { unit: '    ', offside: true }))).toBe(
      'def f():\n    |',
    );
    // The same line in C is a label, and indenting after it would be wrong.
    expect(autoIndent(text, offset, { unit: '    ' })).toBeNull();
  });

  it('indents after do / then / begin, but only where those open a block', () => {
    const [text, offset] = at('items.each do|');
    expect(
      applied(text, autoIndent(text, offset, { unit: '  ', wordBlocks: true })),
    ).toBe('items.each do\n  |');
    expect(autoIndent(text, offset, { unit: '  ' })).toBeNull();
    // A word ENDING in "do" is not `do`.
    const [tricky, where] = at('const shadow = window|');
    expect(autoIndent(tricky, where, { unit: '  ', wordBlocks: true })).toBeNull();
  });

  it('never deals the caret indentation that is in front of it', () => {
    // Splitting a line from inside its own indent used to duplicate the run:
    // the caret is two spaces in, and it may only carry those two.
    const [text, offset] = at('  |  deep()');
    expect(applied(text, autoIndent(text, offset, { unit: '  ' }))).toBe(
      '  \n  |  deep()',
    );
  });

  it('stays out of the way when there is nothing to carry or open', () => {
    expect(autoIndent('plain', 5, { unit: '  ' })).toBeNull();
    expect(autoIndent('', 0, { unit: '  ' })).toBeNull();
  });
});

/* ============================ comment toggling =========================== */

describe('Mod-/', () => {
  it('comments every line at ONE column, so the shape survives', () => {
    // The marker goes in at the shallowest indentation in the range, not at
    // each line's own — that is what keeps the nesting visible while the block
    // is commented, and it is what makes uncommenting exact rather than
    // approximate.
    const text = '  a()\n    b()';
    const edit = toggleComment(text, 0, text.length, '//');
    const commented = applied(text, edit as CodeEdit).replace('|', '');
    expect(commented).toBe('  // a()\n  //   b()');
    const back = toggleComment(commented, 0, commented.length, '//');
    expect(applied(commented, back as CodeEdit).replace('|', '')).toBe(text);
  });

  it('uncomments only when every meaningful line is already commented', () => {
    const both = '// a\n// b';
    expect(
      applied(both, toggleComment(both, 0, both.length, '//') as CodeEdit).replace('|', ''),
    ).toBe('a\nb');
    // Half-commented goes fully commented rather than swapping which half is.
    const half = '// a\nb';
    expect(
      applied(half, toggleComment(half, 0, half.length, '//') as CodeEdit).replace('|', ''),
    ).toBe('// // a\n// b');
  });

  it('leaves blank lines blank', () => {
    const text = 'a\n\nb';
    expect(
      applied(text, toggleComment(text, 0, text.length, '#') as CodeEdit).replace('|', ''),
    ).toBe('# a\n\n# b');
  });

  it('uses the language own marker', () => {
    expect(resolveLanguage('sql').comment).toBe('--');
    expect(resolveLanguage('python').comment).toBe('#');
    expect(resolveLanguage('clojure').comment).toBe(';');
    expect(resolveLanguage('rust').comment).toBe('//');
  });
});

/* ============================= the vocabulary ============================ */

describe('the language vocabulary', () => {
  it('every id in the script vocabulary has a grammar that can colour it', () => {
    // A language in the picker that colours nothing is a name that lies. This
    // is the whole reason `zig` is not in the list.
    const uncolourable = CODE_LANGS.filter((id) => !canHighlight(id));
    expect(uncolourable).toEqual([]);
  });

  it('every id is described, and the shelves hold all of them', () => {
    const shelved = CODE_LANGUAGE_SHELVES.flatMap((shelf) =>
      shelf.languages.map((spec) => spec.id),
    );
    expect(shelved.sort()).toEqual([...CODE_LANGS].sort());
    for (const shelf of CODE_LANGUAGE_SHELVES) {
      expect(shelf.title.length).toBeGreaterThan(3);
      for (const spec of shelf.languages) {
        expect(spec.label).toBe(spec.label.toLowerCase());
      }
    }
  });

  it('resolves aliases people actually type', () => {
    expect(resolveCodeLang('js')).toBe('javascript');
    expect(resolveCodeLang('TSX')).toBe('typescript');
    expect(resolveCodeLang('Objective-C')).toBe('objectivec');
    expect(resolveCodeLang('c++')).toBe('cpp');
    expect(resolveCodeLang('yml')).toBe('yaml');
    expect(resolveCodeLang('toml')).toBe('ini');
    expect(resolveCodeLang('sh')).toBe('bash');
    expect(resolveCodeLang('')).toBeNull();
    expect(resolveCodeLang('wobblescript')).toBeNull();
  });

  it('an exact code language is never fuzzed into a diagram', () => {
    // `graphql` is two edits from `graph`, inside the Levenshtein cap, so
    // every GraphQL fence in the app was being handed to the flowchart
    // grammar and warned about as a near-miss the reader never made.
    expect(resolveDiagramLang('graphql').lang).toBeNull();
    expect(resolveCodeLang('graphql')).toBe('graphql');
    // The diagram languages themselves still win, and still fuzz.
    expect(resolveDiagramLang('graph').lang).toBe('graph');
    expect(resolveDiagramLang('timelime').lang).toBe('timeline');
  });

  it('says "auto" for a block with no language, and the word for one that has', () => {
    expect(languageLabel(null)).toBe('auto');
    expect(languageLabel('')).toBe('auto');
    expect(languageLabel('csharp')).toBe('c#');
    // An unknown id shows itself rather than pretending to be plain text: the
    // reader typed it, and hiding it would hide why the block is not coloured.
    expect(languageLabel('zig')).toBe('zig');
  });

  it('the shortlist is signatures only, and the highlighter knows every one', () => {
    expect(CODE_LANGUAGE_SHORTLIST.every((s) => s.tier === 'signature')).toBe(true);
    const known = new Set(lowlight.listLanguages());
    for (const spec of CODE_LANGUAGE_SHORTLIST) {
      expect(known.has(spec.id) || lowlight.registered(spec.id)).toBe(true);
    }
  });
});

/* ============================ guessing a language ======================== */

describe('detecting a language', () => {
  it('recognises the things people paste', () => {
    expect(detectLanguage('const add = (a, b) => a + b;\nexport default add;')).toBe(
      'javascript',
    );
    expect(detectLanguage('def add(a, b):\n    return a + b')).toBe('python');
    expect(
      detectLanguage('#!/usr/bin/env bash\nset -euo pipefail\nfor f in *.txt; do\n  echo "$f"\ndone'),
    ).toBe('bash');
    expect(detectLanguage('{\n  "name": "alcove",\n  "version": "0.1.0"\n}')).toBe('json');
  });

  it('says nothing rather than guessing at prose', () => {
    // The failure this exists to stop: a sentence scores 4 as CSS, which is
    // exactly what a real one-line SELECT scores, so relevance alone cannot
    // separate them. The punctuation gate runs first.
    expect(
      detectLanguage('This is just a sentence I typed into a code block by accident.'),
    ).toBeNull();
    expect(detectLanguage('Remember to buy milk, eggs and a notebook.')).toBeNull();
    expect(detectLanguage('hello')).toBeNull();
    expect(detectLanguage('')).toBeNull();
  });

  it('reads the language off a VS Code clipboard, in VS Code spelling', () => {
    const clip = (data: Record<string, string>): DataTransfer =>
      ({ getData: (type: string) => data[type] ?? '' }) as unknown as DataTransfer;
    expect(
      clipboardLanguage(clip({ 'vscode-editor-data': '{"mode":"typescriptreact"}' })),
    ).toBe('typescript');
    expect(
      clipboardLanguage(clip({ 'vscode-editor-data': '{"mode":"shellscript"}' })),
    ).toBe('bash');
    expect(clipboardLanguage(clip({}))).toBeNull();
    // A clipboard is somebody else's data structure; malformed is not a crash.
    expect(clipboardLanguage(clip({ 'vscode-editor-data': 'not json' }))).toBeNull();
    expect(clipboardLanguage(null)).toBeNull();
  });
});

describe('a pasted Markdown fence', () => {
  it('becomes a block, language and all', () => {
    const hit = fencedPaste('```python\nprint(1)\n```');
    expect(hit?.language).toBe('python');
    expect(hit?.code).toBe('print(1)');
  });

  it('keeps the word when the language is one this app cannot colour', () => {
    const hit = fencedPaste('```zig\nconst x = 1;\n```');
    expect(hit?.language).toBeNull();
    expect(hit?.rawLanguage).toBe('zig');
  });

  it('accepts tildes, and a wide fence', () => {
    expect(fencedPaste('~~~js\nx\n~~~')?.language).toBe('javascript');
    expect(fencedPaste('````md\n```js\nx\n```\n````')?.code).toBe('```js\nx\n```');
  });

  it('refuses prose that merely CONTAINS a fence', () => {
    // Turning a whole pasted article into one code block is a far worse
    // failure than not helping, so the test is strict on both ends.
    expect(fencedPaste('Here is some code:\n\n```js\nx\n```')).toBeNull();
    expect(fencedPaste('```js\nx\n```\n\nand that is how it works')).toBeNull();
    expect(fencedPaste('no fence at all')).toBeNull();
    expect(fencedPaste('```js\nnever closed')).toBeNull();
  });
});
