import { describe, expect, it } from 'vitest';
import {
  collapseDiagramContinuations,
  graphLayerBreaks,
  isDiagramContinuationCarry,
  planDiagramContinuation,
  type DiagramContinuationAttributes,
} from '../src/editor/nodes/diagramPagination';

const FLOWCHART_DATA = JSON.stringify({
  graph: {
    nodes: Array.from({ length: 9 }, (_, index) => ({
      id: `step-${index + 1}`,
      label: `Step ${index + 1}`,
    })),
    edges: Array.from({ length: 8 }, (_, index) => ({
      from: `step-${index + 1}`,
      to: `step-${index + 2}`,
    })),
  },
});

function chart(
  overrides: Partial<DiagramContinuationAttributes> = {},
): DiagramContinuationAttributes {
  return {
    id: 'b_flowchart',
    kind: 'flowchart',
    data: FLOWCHART_DATA,
    width: 640,
    continuationId: null,
    continuationStart: null,
    continuationEnd: null,
    ...overrides,
  };
}

describe('oversized flowchart page continuations', () => {
  it('finds node-safe cuts for both layered and cyclic force-laid graphs', () => {
    expect(
      graphLayerBreaks([
        { y: 40, height: 40, depth: 0 },
        { y: 140, height: 40, depth: 1 },
        { y: 240, height: 40, depth: 2 },
      ]),
    ).toEqual([90, 190]);
    expect(
      graphLayerBreaks([
        { y: 40, height: 40, depth: 0 },
        { y: 160, height: 40, depth: 0 },
        { y: 280, height: 40, depth: 0 },
      ]),
    ).toEqual([100, 220]);
  });

  it('splits at the latest safe layer gap and retains the complete editable source', () => {
    const split = planDiagramContinuation({
      attrs: chart(),
      intrinsicHeight: 920,
      renderedHeight: 920,
      availableHeight: 430,
      safeBreaks: [112, 228, 344, 460, 576, 692, 808],
    });

    expect(split).not.toBeNull();
    expect(split?.head.continuationStart).toBe(0);
    expect(split?.head.continuationEnd).toBe(344);
    expect(split?.tail.continuationStart).toBe(344);
    expect(split?.tail.continuationEnd).toBe(920);
    expect(split?.head.data).toBe(FLOWCHART_DATA);
    expect(split?.tail.data).toBe(FLOWCHART_DATA);
    expect(split?.head.continuationId).toBe('b_flowchart');
    expect(split?.tail.continuationId).toBe('b_flowchart');
    expect(split?.head.id).toBe('b_flowchart');
    expect(split?.tail.id).not.toBe(split?.head.id);
  });

  it('can split a continuation again without gaps or overlapping chart content', () => {
    const split = planDiagramContinuation({
      attrs: chart({
        id: 'b_flowchart__continuation_344',
        continuationId: 'b_flowchart',
        continuationStart: 344,
        continuationEnd: 920,
      }),
      intrinsicHeight: 920,
      renderedHeight: 576,
      availableHeight: 310,
      safeBreaks: [112, 228, 344, 460, 576, 692, 808],
    });

    expect(split?.head.continuationStart).toBe(344);
    expect(split?.head.continuationEnd).toBe(576);
    expect(split?.tail.continuationStart).toBe(576);
    expect(split?.tail.continuationEnd).toBe(920);
    expect(split?.head.continuationId).toBe('b_flowchart');
    expect(split?.tail.continuationId).toBe('b_flowchart');
  });

  it('waits when the SVG still reports the pre-transaction viewport', () => {
    /*
     * Live failure from the empty continuation leaf: ProseMirror had already
     * changed the node from 540–1816 to 540–1184, while Solid's SVG still
     * exposed/drew 540–1816 for this synchronous measurement. Treating that
     * stale 1276px height as the new fragment's 644px height inflated its
     * scale and cut the otherwise empty leaf again at 632.
     */
    expect(
      planDiagramContinuation({
        attrs: chart({
          id: 'b_flowchart__continuation_540',
          continuationId: 'b_flowchart',
          continuationStart: 540,
          continuationEnd: 1184,
        }),
        intrinsicHeight: 1816,
        renderedHeight: 1276,
        renderedStart: 540,
        renderedEnd: 1816,
        availableHeight: 200,
        safeBreaks: [632, 724, 816, 908, 1000, 1092],
      }),
    ).toBeNull();
  });

  it('does not cut through a node when no safe layer gap fits the available space', () => {
    expect(
      planDiagramContinuation({
        attrs: chart(),
        intrinsicHeight: 920,
        renderedHeight: 920,
        availableHeight: 150,
        safeBreaks: [220, 440, 660],
      }),
    ).toBeNull();
  });

  it('allows a provisional backward move when only its flowchart continuation spills', () => {
    const split = planDiagramContinuation({
      attrs: chart(),
      intrinsicHeight: 920,
      renderedHeight: 920,
      availableHeight: 430,
      safeBreaks: [112, 228, 344, 460, 576, 692, 808],
    });
    expect(split).not.toBeNull();
    expect(
      isDiagramContinuationCarry(
        [{ type: 'diagram', attrs: chart() }],
        [{ type: 'diagram', attrs: split!.tail }],
      ),
    ).toBe(true);
  });

  it('keeps ordinary or unrelated overflow as a rejected backward move', () => {
    expect(
      isDiagramContinuationCarry(
        [{ type: 'diagram', attrs: chart() }],
        [{ type: 'paragraph', content: [{ type: 'text', text: 'not the chart' }] }],
      ),
    ).toBe(false);
    expect(
      isDiagramContinuationCarry(
        [{ type: 'diagram', attrs: chart() }],
        [
          {
            type: 'diagram',
            attrs: chart({ continuationId: 'another-chart' }),
          },
        ],
      ),
    ).toBe(false);
  });

  it('reunites every viewport before editing and lets pagination derive fresh cuts', () => {
    const first = chart({
      continuationId: 'b_flowchart',
      continuationStart: 0,
      continuationEnd: 344,
    });
    const second = chart({
      id: 'b_flowchart__continuation_34400',
      continuationId: 'b_flowchart',
      continuationStart: 344,
      continuationEnd: 920,
    });
    const edited = JSON.stringify({ graph: { nodes: [{ id: 'only' }], edges: [] } });
    const result = collapseDiagramContinuations(
      [
        { type: 'doc', content: [{ type: 'diagram', attrs: first }] },
        {
          type: 'doc',
          content: [
            { type: 'diagram', attrs: second },
            { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
          ],
        },
      ],
      'b_flowchart',
      edited,
    );

    expect(result.changedIndices).toEqual([0, 1]);
    expect(result.docs[0]?.content).toEqual([
      {
        type: 'diagram',
        attrs: expect.objectContaining({
          id: 'b_flowchart',
          data: edited,
          continuationId: null,
          continuationStart: null,
          continuationEnd: null,
        }),
      },
    ]);
    expect(result.docs[1]?.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
    ]);
  });
});
