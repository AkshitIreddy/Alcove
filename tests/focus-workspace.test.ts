import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizePageDoc } from '../src/editor/document';
import {
  erasePageWritingsAt,
  parsePageWritings,
  serializePageWritings,
  type PageWritingStroke,
} from '../src/editor/media/pageWritings';
import { moveFocusPan } from '../src/views/rail/focusLevels';

const stroke: PageWritingStroke = {
  id: 'page-ink-one',
  tool: 'pen',
  colour: 'sepia',
  size: 7,
  points: [
    { x: 0.2, y: 0.25 },
    { x: 0.6, y: 0.5 },
  ],
};

describe('focus workspace camera', () => {
  it('allows deep two-dimensional pan at 100% without clamping', () => {
    expect(moveFocusPan({ x: 0, y: 0 }, { x: 4200.4, y: -3100.7 })).toEqual({
      x: 4200,
      y: -3101,
    });
    expect(moveFocusPan({ x: 4200, y: -3101 }, { x: -9000, y: 8000 })).toEqual({
      x: -4800,
      y: 4899,
    });
  });

  it('centres either canonical half without changing leaf layout', () => {
    const css = readFileSync('src/styles/reader.css', 'utf8');
    expect(css).toMatch(/data-solo-leaf='left'[^}]+translate3d\(25%, 0, 0\)/s);
    expect(css).toMatch(/data-solo-leaf='right'[^}]+translate3d\(-25%, 0, 0\)/s);
    expect(css).not.toMatch(/data-solo-leaf[^}]*\{[^}]*flex:\s*0\s+0\s+0/s);
  });
});

describe('durable whole-page writing', () => {
  it('round-trips the same rich vector vocabulary as image annotations', () => {
    const saved = serializePageWritings([stroke]);
    expect(saved).toContain('"version":1');
    expect(parsePageWritings(saved)).toEqual([stroke]);
  });

  it('survives document normalization as a root page attribute', () => {
    const saved = serializePageWritings([stroke]);
    const normalized = normalizePageDoc({
      type: 'doc',
      attrs: { mouseWritings: saved },
      content: [{ type: 'paragraph' }],
    });
    expect(parsePageWritings(normalized.attrs?.mouseWritings)).toEqual([stroke]);
  });

  it('erases by normalized page geometry without affecting distant marks', () => {
    const distant = { ...stroke, id: 'far', points: [{ x: 0.9, y: 0.9 }] };
    expect(erasePageWritingsAt([stroke, distant], { x: 0.2, y: 0.25 }, 1.4, 12))
      .toEqual([distant]);
  });

  it('is mounted by both the live editor and offscreen export path', () => {
    const editor = readFileSync('src/editor/PageEditor.tsx', 'utf8');
    const capture = readFileSync('src/editor/script/exporters/capture.ts', 'utf8');
    expect(editor).toContain('<PageWritingLayer');
    expect(capture).toContain('mountStoredPageWritings(page, doc.attrs?.mouseWritings)');
  });
});
