import { describe, expect, it } from 'vitest';
import {
  reversePaginationLegs,
  type PaginationUndoLeg,
} from '../src/editor/paginationUndo';

const paragraph = (text = '') => ({
  type: 'paragraph',
  ...(text === '' ? {} : { content: [{ type: 'text', text }] }),
});

describe('cross-page pagination undo', () => {
  it('returns displaced blocks to their source and restores the target exactly', () => {
    const sourceAfterCarry = { type: 'doc', content: [paragraph('typed')] };
    const targetBefore = { type: 'doc', content: [paragraph('next')] };
    const moved = [paragraph('displaced')];
    const targetAfter = {
      type: 'doc',
      content: [...moved, paragraph('next')],
    };
    const leg: PaginationUndoLeg = {
      sourcePageId: 'source',
      targetPageId: 'target',
      moved,
      targetBefore,
      targetAfter,
      createdTarget: false,
    };

    expect(
      reversePaginationLegs(
        new Map([
          ['source', sourceAfterCarry],
          ['target', targetAfter],
        ]),
        [leg],
        {},
      ),
    ).toEqual(
      new Map([
        ['source', { type: 'doc', content: [paragraph('typed'), ...moved] }],
        ['target', targetBefore],
      ]),
    );
  });

  it('reverses a cascade from the last page back to the first', () => {
    const b = paragraph('B');
    const c = paragraph('C');
    const target2Before = { type: 'doc', content: [paragraph('tail')] };
    const legs: PaginationUndoLeg[] = [
      {
        sourcePageId: 'p1',
        targetPageId: 'p2',
        moved: [b],
        targetBefore: { type: 'doc', content: [c] },
        targetAfter: { type: 'doc', content: [b, c] },
        createdTarget: false,
      },
      {
        sourcePageId: 'p2',
        targetPageId: 'p3',
        moved: [c],
        targetBefore: target2Before,
        targetAfter: { type: 'doc', content: [c, paragraph('tail')] },
        createdTarget: false,
      },
    ];

    expect(
      reversePaginationLegs(
        new Map([
          ['p1', { type: 'doc', content: [paragraph('typed')] }],
          ['p2', { type: 'doc', content: [b] }],
          ['p3', legs[1]!.targetAfter],
        ]),
        legs,
        {},
      ),
    ).toEqual(
      new Map([
        ['p1', { type: 'doc', content: [paragraph('typed'), b] }],
        ['p2', { type: 'doc', content: [c] }],
        ['p3', target2Before],
      ]),
    );
  });

  it('fails closed when a target page changed after the carry', () => {
    const leg: PaginationUndoLeg = {
      sourcePageId: 'source',
      targetPageId: 'target',
      moved: [paragraph('displaced')],
      targetBefore: { type: 'doc', content: [paragraph('next')] },
      targetAfter: { type: 'doc', content: [paragraph('displaced'), paragraph('next')] },
      createdTarget: false,
    };
    expect(
      reversePaginationLegs(
        new Map([
          ['source', { type: 'doc', content: [paragraph('typed')] }],
          ['target', { type: 'doc', content: [paragraph('reader changed this')] }],
        ]),
        [leg],
        {},
      ),
    ).toBeNull();
  });
});
