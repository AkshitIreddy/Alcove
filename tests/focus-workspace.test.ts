import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizePageDoc } from '../src/editor/document';
import {
  erasePageWritingsAt,
  parsePageWritings,
  serializePageWritings,
  type PageWritingStroke,
} from '../src/editor/media/pageWritings';
import {
  focusPanForAnchoredZoom,
  moveFocusPan,
} from '../src/views/rail/focusLevels';

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

  it('keeps the wheel cursor anchored while zoom changes', () => {
    expect(focusPanForAnchoredZoom(
      { x: 0, y: 0 },
      1,
      1.1,
      { x: 300, y: -200 },
    )).toEqual({ x: -30, y: 20 });
    expect(focusPanForAnchoredZoom(
      { x: -30, y: 20 },
      1.1,
      1,
      { x: 300, y: -200 },
    )).toEqual({ x: 0, y: 0 });
  });

  it('centres either canonical half without changing leaf layout', () => {
    const css = readFileSync('src/styles/reader.css', 'utf8');
    expect(css).toMatch(/data-solo-leaf='left'[^}]+translate3d\(25%, 0, 0\)/s);
    expect(css).toMatch(/data-solo-leaf='right'[^}]+translate3d\(-25%, 0, 0\)/s);
    expect(css).not.toMatch(/data-solo-leaf[^}]*\{[^}]*flex:\s*0\s+0\s+0/s);
  });

  it('uses the wheel only for zoom and reserves free panning for the middle button', () => {
    const view = readFileSync('src/views/BookView.tsx', 'utf8');
    const wheel = view.slice(view.indexOf('const onWheel'), view.indexOf('const onDeskPointerMove'));
    const pan = view.slice(view.indexOf('const onPanDown'), view.indexOf('// -------------------------------------------------------------------------\n  // Rail actions'));
    expect(wheel).toContain('zoomFocusAt(event.clientX, event.clientY');
    expect(wheel).not.toContain('setFocusPan((pan) => moveFocusPan');
    expect(pan).toContain('event.button !== 1');
    expect(pan).not.toContain('isTypingTarget');
  });

  it('keeps the writing tool pocket independently closable while write mode stays active', () => {
    const rail = readFileSync('src/views/rail/FocusRail.tsx', 'utf8');
    expect(rail).toContain('writingPaletteOpen');
    expect(rail).toContain('Close writing tools');
    expect(rail).toContain('onCloseWritingPalette');
  });
});

describe('durable whole-page writing', () => {
  it('round-trips the same rich vector vocabulary as image annotations', () => {
    const saved = serializePageWritings([stroke]);
    expect(saved).toContain('"version":1');
    expect(parsePageWritings(saved)).toEqual([stroke]);
  });

  it('preserves finite page-relative margin ink outside the physical paper', () => {
    const marginStroke: PageWritingStroke = {
      ...stroke,
      id: 'margin-ink',
      points: [
        { x: -0.35, y: 0.2 },
        { x: 1.4, y: 1.25 },
      ],
    };
    expect(parsePageWritings(serializePageWritings([marginStroke]))).toEqual([
      marginStroke,
    ]);
  });

  it('mounts one viewport writing workspace above prose instead of leaf-clipped canvases', () => {
    const view = readFileSync('src/views/BookView.tsx', 'utf8');
    expect(view).toContain('nb-focus-writing-workspace');
    expect(view.match(/Temporary mouse writing canvas/g)).toHaveLength(1);
    expect(view).not.toContain('writingPointAt(target, event)');
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
