import { describe, expect, it } from 'vitest';
import { classifyStructuredPaste } from '../src/editor/smartPaste';

describe('structured page paste', () => {
  it('turns spreadsheet TSV and quoted CSV into Notebook Script tables', () => {
    const tsv = classifyStructuredPaste('name\tscore\nMiso\t9\nPip\t7');
    expect(tsv?.kind).toBe('table');
    expect(tsv?.script).toContain('| name | score |');
    expect(tsv?.script).toContain('| Miso | 9 |');

    const csv = classifyStructuredPaste('name,note\nMiso,"purrs, loudly"\nPip,chirps');
    expect(csv?.kind).toBe('table');
    expect(csv?.script).toContain('| Miso | purrs, loudly |');
  });

  it('turns arrays of records into tables and keeps other JSON as code', () => {
    const records = classifyStructuredPaste('[{"sound":"meow","frequency":0.4},{"sound":"purr","frequency":0.25}]');
    expect(records?.kind).toBe('json-table');
    expect(records?.script).toContain('| sound | frequency |');

    const object = classifyStructuredPaste('{\n  "root": {"left": "meow"}\n}');
    expect(object).toMatchObject({ kind: 'code' });
    expect(object?.script).toContain('```json');
    expect(classifyStructuredPaste('{"root":{"left":"meow"}}')).toMatchObject({ kind: 'code' });
  });

  it('recognises fenced and high-confidence source code without stealing prose', () => {
    expect(classifyStructuredPaste('```python\ndef encode(x):\n  return x\n```')?.kind)
      .toBe('notebook-script');
    expect(classifyStructuredPaste('def encode(symbol):\n    return codes[symbol]')?.kind)
      .toBe('code');
    expect(classifyStructuredPaste('const kitten = true;')?.kind).toBe('code');
    expect(classifyStructuredPaste('This is a normal paragraph,\nwith an ordinary second line.'))
      .toBeNull();
    expect(classifyStructuredPaste('Hello, friend\nGoodbye, friend')).toBeNull();
  });

  it('preserves every large row and splits tall tables into page-safe blocks', () => {
    const csv = ['name,value', ...Array.from({ length: 205 }, (_, index) => `r${index},${index}`)].join('\n');
    const result = classifyStructuredPaste(csv);
    expect(result?.kind).toBe('table');
    expect(result?.script).toContain('| r204 | 204 |');
    expect(result?.script.match(/\| name \| value \|/g)?.length).toBeGreaterThan(1);

    const json = JSON.stringify(Array.from({ length: 105 }, (_, index) => ({ index, value: `v${index}` })));
    const jsonResult = classifyStructuredPaste(json);
    expect(jsonResult?.script).toContain('| 104 | v104 |');
  });

  it('keeps Markdown headings, lists, tasks and diagrams as native blocks', () => {
    expect(classifyStructuredPaste('# Huffman tree\n\n- merge two lows\n- repeat')?.kind)
      .toBe('notebook-script');
    expect(classifyStructuredPaste('```flowchart\nA -> B\nB -> C\n```')?.kind)
      .toBe('notebook-script');
  });
});
