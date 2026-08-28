import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { appendBlocksToDoc } from '../src/views/spread';

const paragraph = (text = '') => ({
  type: 'paragraph',
  ...(text === '' ? {} : { content: [{ type: 'text', text }] }),
});

describe('backward page flow', () => {
  it('moves a following block before TipTap trailing-line bookkeeping', () => {
    expect(
      appendBlocksToDoc(
        {
          type: 'doc',
          attrs: { pageStyle: 'ruled' },
          content: [paragraph('previous'), paragraph()],
        },
        [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Next' }] }],
      ),
    ).toEqual({
      type: 'doc',
      attrs: { pageStyle: 'ruled' },
      content: [
        paragraph('previous'),
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Next' }] },
      ],
    });
  });

  it('replaces a truly blank previous page instead of leaving a gap', () => {
    expect(
      appendBlocksToDoc(
        { type: 'doc', content: [paragraph()] },
        [paragraph('pulled back')],
      ).content,
    ).toEqual([paragraph('pulled back')]);
  });

  it('preserves a complete image block while moving it between pages', () => {
    const image = {
      type: 'image',
      attrs: {
        src: 'asset://images/diagram.png',
        assetRelPath: 'images/diagram.png',
        alt: 'A labelled diagram',
        caption: 'The final tree',
        width: 74,
        align: 'right',
        style: 'polaroid',
      },
    };

    expect(
      appendBlocksToDoc(
        { type: 'doc', content: [paragraph('setup')] },
        [image],
      ).content,
    ).toEqual([paragraph('setup'), image]);
  });

  it('appends an ordered multi-block selection as one contiguous run', () => {
    const moved = [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Idea' }],
      },
      paragraph('explanation'),
      {
        type: 'blockquote',
        content: [paragraph('evidence')],
      },
    ];

    expect(
      appendBlocksToDoc(
        { type: 'doc', content: [paragraph('previous'), paragraph()] },
        moved,
      ).content,
    ).toEqual([paragraph('previous'), ...moved]);
  });

  it('uses the live provisional overflow rollback instead of a cloned-DOM fit rejection', () => {
    const source = readFileSync(
      new URL('../src/views/BookView.tsx', import.meta.url),
      'utf8',
    );
    const start = source.indexOf('const moveBlockToPreviousPage =');
    const end = source.indexOf('KEEP TWO COMPLETE, ALREADY-STYLED SPREADS', start);
    const move = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(move).not.toContain('cloneMoveBlocks');
    expect(move).not.toContain('appendedBlocksFit');
    expect(move).not.toContain('getBoundingClientRect');
    expect(move).toContain('backwardMoveOverflowTarget = {');
    expect(move).toContain('overflowed: false');
    expect(move).toContain('if (overflowed)');
    expect(move).toContain('destination.schema.nodeFromJSON(destinationBefore)');
    expect(move).toContain('liveSource.schema.nodeFromJSON(sourceBefore)');
    expect(move).toContain('updatePageDoc(pageId, sourceBefore)');
    expect(move).toContain('updatePageDoc(previous.id, destinationBefore)');
  });

  it('accepts only a generated same-flowchart continuation during a backward move', () => {
    const source = readFileSync(
      new URL('../src/views/BookView.tsx', import.meta.url),
      'utf8',
    );
    const start = source.indexOf('let backwardMoveOverflowTarget');
    const end = source.indexOf('/** Undo one authored edit', start);
    const move = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(move).toContain('isDiagramContinuationCarry(');
    expect(move).toContain('continuationBlocks.push(...blocks)');
    expect(move).toContain(
      'handleOverflow(previous.id, continuationBlocks, false, null, null)',
    );
    expect(move).toContain('backwardMoveOverflowTarget.overflowed = true');
  });
});
