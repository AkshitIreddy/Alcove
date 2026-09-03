import { describe, expect, it } from 'vitest';

// Runtime editor startup expands Notebook Script's color domain from the
// original seven washes to the complete stationer's tint catalogue.
import { TINT_ALL } from '../src/editor/effects/vocabulary';
import { washOf } from '../src/diagrams/render/NodeShape';
import { timelineColorOf } from '../src/diagrams/render/TimelineDiagram';
import { parse } from '../src/script';
import type { TimelineDiagramBlock } from '../src/script/types';

const WEEK = [
  '```timeline',
  'Monday: Do the Assignments of Last week | color=blush',
  'Tuesday: work stuff i guess',
  'Wednesday: work stuff i guess | color=amber',
  'Thursday: data structures lectures and practice quiz | color=forest',
  'Friday: computer systems lectures and practice quiz | color=coral',
  '```',
].join('\n');

describe('timeline colors', () => {
  it('preserves the complete stationer tint vocabulary in timeline entries', () => {
    const parsed = parse(WEEK);
    const timeline = parsed.blocks.find(
      (block): block is TimelineDiagramBlock =>
        block.kind === 'diagram' && block.lang === 'timeline',
    );

    expect(timeline?.entries.map((entry) => entry.attrs?.color)).toEqual([
      'blush',
      undefined,
      'amber',
      'forest',
      'coral',
    ]);
    expect(parsed.diagnostics).toEqual([]);
  });

  it('does not flatten valid forest and coral timeline tints to plain paper', () => {
    expect(washOf({ color: 'forest' })).toBe('forest');
    expect(washOf({ color: 'coral' })).toBe('coral');
  });

  it('keeps every advertised stationer tint available to diagrams', () => {
    expect(
      TINT_ALL.filter((color) => washOf({ color }) !== color),
    ).toEqual([]);
  });

  it('gives entries without an explicit color a visible default tint', () => {
    const parsed = parse(WEEK);
    const timeline = parsed.blocks.find(
      (block): block is TimelineDiagramBlock =>
        block.kind === 'diagram' && block.lang === 'timeline',
    );

    expect(
      timeline?.entries.map((entry, index) => timelineColorOf(entry.attrs, index)),
    ).toEqual(['blush', 'sky', 'amber', 'forest', 'coral']);
  });
});
