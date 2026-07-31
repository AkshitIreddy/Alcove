// @vitest-environment node
/**
 * tests/diagrams.test.ts — pure-layout invariants + wobble stability for the
 * hand-drawn diagram renderers (src/diagrams).
 *
 * Runs in plain Node: the measurer automatically degrades to the
 * deterministic per-character heuristic (no canvas), so every expectation
 * here is stable across machines.
 */

import { describe, expect, it } from 'vitest';

import { heuristicMeasure, wrapText } from '../src/diagrams/measure';
import { nodeBox } from '../src/diagrams/layout/size';
import { layoutMindmap, layoutTree } from '../src/diagrams/layout/tree';
import { layoutGraph } from '../src/diagrams/layout/graph';
import { layoutTimeline } from '../src/diagrams/layout/timeline';
import {
  decodeDiagramData,
  encodeDiagramData,
  parseDiagramSource,
  printDiagramSource,
} from '../src/diagrams/source';
import {
  arrowheadStrokes,
  edgeStrokes,
  nodeSeed,
  shapeStrokes,
  spineStrokes,
} from '../src/diagrams/render/svgParts';
import type { DiagramLayout, LaidNode } from '../src/diagrams/types';
import type { TreeNode } from '../src/script/types';

/* ------------------------------ helpers ---------------------------------- */

const TREE_SOURCE = [
  'Cell biology',
  '  Organelles',
  '    Mitochondria | powerhouse',
  '    Nucleus {color=sky}',
  '    Ribosome',
  '  Membranes',
  '    Lipid bilayer',
].join('\n');

function treeRoots(source = TREE_SOURCE): TreeNode[] {
  const parsed = parseDiagramSource('tree', source);
  if (parsed.data.kind !== 'tree') throw new Error('unexpected kind');
  return parsed.data.roots;
}

function boxesOverlap(a: LaidNode, b: LaidNode, slack = 0.01): boolean {
  return (
    Math.abs(a.x - b.x) + slack < (a.width + b.width) / 2 &&
    Math.abs(a.y - b.y) + slack < (a.height + b.height) / 2
  );
}

function expectInsideCanvas(layout: DiagramLayout): void {
  for (const n of layout.nodes) {
    expect(n.x - n.width / 2).toBeGreaterThanOrEqual(-0.01);
    expect(n.y - n.height / 2).toBeGreaterThanOrEqual(-0.01);
    expect(n.x + n.width / 2).toBeLessThanOrEqual(layout.width + 0.01);
    expect(n.y + n.height / 2).toBeLessThanOrEqual(layout.height + 0.01);
  }
}

/* ------------------------------ measure ----------------------------------- */

describe('measure', () => {
  it('heuristic measure is deterministic and monotonic in text length', () => {
    const font = '14px "Architects Daughter", cursive';
    expect(heuristicMeasure('abc', font)).toBe(heuristicMeasure('abc', font));
    expect(heuristicMeasure('abcdef', font)).toBeGreaterThan(
      heuristicMeasure('abc', font),
    );
    expect(heuristicMeasure('m', font)).toBeGreaterThan(
      heuristicMeasure('i', font),
    );
  });

  it('wrapText respects max width and keeps every word', () => {
    const font = '15px "Patrick Hand", cursive';
    const text = 'a hand drawn timeline of tiny important moments';
    const lines = wrapText(text, 120, font, heuristicMeasure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe(text);
    for (const line of lines) {
      expect(heuristicMeasure(line, font)).toBeLessThanOrEqual(120 + 60);
    }
  });

  it('nodeBox pads clouds/circles wider than rects', () => {
    const rect = nodeBox('Same label', undefined, undefined, {
      measure: heuristicMeasure,
    });
    const cloud = nodeBox('Same label', undefined, { shape: 'cloud' }, {
      measure: heuristicMeasure,
    });
    expect(cloud.width).toBeGreaterThan(rect.width);
    expect(cloud.height).toBeGreaterThan(rect.height);
  });
});

/* ------------------------------- tree ------------------------------------- */

describe('layoutTree', () => {
  it('is deterministic for identical input', () => {
    const a = layoutTree(treeRoots());
    const b = layoutTree(treeRoots());
    expect(a).toEqual(b);
  });

  it('no two node boxes overlap', () => {
    const layout = layoutTree(treeRoots());
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        expect(boxesOverlap(layout.nodes[i], layout.nodes[j])).toBe(false);
      }
    }
  });

  it('children sit strictly below their parent and parent is centered', () => {
    const layout = layoutTree(treeRoots());
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    for (const edge of layout.edges) {
      const from = byId.get(edge.from)!;
      const to = byId.get(edge.to)!;
      expect(to.y).toBeGreaterThan(from.y);
      expect(to.depth).toBe(from.depth + 1);
    }
    // Parent of the first two children ("Organelles") is centered over them.
    const parent = byId.get('0.0')!;
    const kids = layout.nodes.filter((n) => n.id.startsWith('0.0.'));
    const mid =
      (Math.min(...kids.map((k) => k.x)) + Math.max(...kids.map((k) => k.x))) / 2;
    expect(Math.abs(parent.x - mid)).toBeLessThan(0.5);
  });

  it('every node stays inside the reported canvas; forest roots do not collide', () => {
    const layout = layoutTree(treeRoots('A\n  a1\n  a2\nB\n  b1'));
    expectInsideCanvas(layout);
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        expect(boxesOverlap(layout.nodes[i], layout.nodes[j])).toBe(false);
      }
    }
  });

  it('empty input yields an empty layout, not a crash', () => {
    const layout = layoutTree([]);
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
  });
});

describe('layoutMindmap', () => {
  it('is deterministic and single root sits at the drawing center', () => {
    const a = layoutMindmap(treeRoots());
    const b = layoutMindmap(treeRoots());
    expect(a).toEqual(b);
    const root = a.nodes.find((n) => n.id === '0')!;
    expect(Math.abs(root.x - a.width / 2)).toBeLessThan(root.width);
    expect(Math.abs(root.y - a.height / 2)).toBeLessThan(root.height);
  });

  it('ring radius grows with depth', () => {
    const layout = layoutMindmap(treeRoots());
    const root = layout.nodes.find((n) => n.id === '0')!;
    const dist = (n: LaidNode): number => Math.hypot(n.x - root.x, n.y - root.y);
    const d1 = layout.nodes.filter((n) => n.depth === 1).map(dist);
    const d2 = layout.nodes.filter((n) => n.depth === 2).map(dist);
    expect(Math.min(...d2)).toBeGreaterThan(Math.max(...d1));
  });

  it('keeps every node inside the canvas', () => {
    expectInsideCanvas(layoutMindmap(treeRoots()));
  });
});

/* ------------------------------- graph ------------------------------------ */

const FLOW_SOURCE = [
  'Start -> Fetch -> Parse -> Render',
  'Fetch -> Cache',
  'Cache -> Render',
  'Start {color=moss}',
].join('\n');

function graphOf(source = FLOW_SOURCE) {
  const parsed = parseDiagramSource('flowchart', source);
  if (parsed.data.kind !== 'flowchart') throw new Error('unexpected kind');
  return parsed.data.graph;
}

describe('layoutGraph', () => {
  it('is deterministic', () => {
    expect(layoutGraph(graphOf())).toEqual(layoutGraph(graphOf()));
  });

  it('every non-broken edge points strictly downward (layering sanity)', () => {
    const layout = layoutGraph(graphOf());
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    for (const edge of layout.edges) {
      if (edge.broken === true || edge.from === edge.to) continue;
      expect(byId.get(edge.to)!.y).toBeGreaterThan(byId.get(edge.from)!.y);
    }
    expect(layout.warnings).toEqual([]);
  });

  it('longest path wins: Render sits below Cache', () => {
    const layout = layoutGraph(graphOf());
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    // Start(0) -> Fetch(1) -> Cache(2) -> Render(3): longest-path layering.
    expect(byId.get('Render')!.depth).toBe(3);
    expect(byId.get('Cache')!.depth).toBe(2);
    expect(byId.get('Start')!.depth).toBe(0);
  });

  it('nodes never overlap in the layered mode', () => {
    const layout = layoutGraph(graphOf());
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        expect(boxesOverlap(layout.nodes[i], layout.nodes[j])).toBe(false);
      }
    }
    expectInsideCanvas(layout);
  });

  it('breaks cycles with a warning and still lays out', () => {
    const layout = layoutGraph(graphOf('A -> B -> C\nC -> A\nA -> C'));
    expect(layout.warnings.some((w) => w.includes('cycle broken'))).toBe(true);
    const broken = layout.edges.filter((e) => e.broken === true);
    expect(broken.length).toBe(1);
    expect(layout.nodes.length).toBe(3);
  });

  it('mostly-cyclic graphs fall back to the deterministic force layout', () => {
    const cyclic = graphOf('A -> B\nB -> A');
    const a = layoutGraph(cyclic);
    const b = layoutGraph(graphOf('A -> B\nB -> A'));
    expect(a.warnings.some((w) => w.includes('force layout'))).toBe(true);
    expect(a).toEqual(b);
    expectInsideCanvas(a);
  });

  it('force mode keeps nodes apart', () => {
    const layout = layoutGraph(graphOf(), { forceMode: true });
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        const a = layout.nodes[i];
        const b = layout.nodes[j];
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(20);
      }
    }
  });

  it('self-loops keep their edge with a little lasso polyline', () => {
    const layout = layoutGraph(graphOf('A -> A\nA -> B'));
    const loop = layout.edges.find((e) => e.from === 'A' && e.to === 'A')!;
    expect(loop.points.length).toBeGreaterThan(2);
  });
});

/* ------------------------------ timeline ---------------------------------- */

const TL_SOURCE = [
  '1839: Schwann proposes all living things are made of cells | color=sky',
  '1855: Virchow — omnis cellula e cellula',
  '1931: Electron microscope built',
  '1953: DNA double helix described | color=amber',
].join('\n');

function entriesOf(source = TL_SOURCE) {
  const parsed = parseDiagramSource('timeline', source);
  if (parsed.data.kind !== 'timeline') throw new Error('unexpected kind');
  return parsed.data.entries;
}

describe('layoutTimeline', () => {
  it('is deterministic', () => {
    expect(layoutTimeline(entriesOf())).toEqual(layoutTimeline(entriesOf()));
  });

  it('dots descend strictly in entry order and sides alternate', () => {
    const layout = layoutTimeline(entriesOf());
    expect(layout.cards.length).toBe(4);
    for (let i = 0; i < layout.cards.length; i++) {
      const card = layout.cards[i];
      expect(card.side).toBe(i % 2 === 0 ? 'left' : 'right');
      if (i > 0) expect(card.dotY).toBeGreaterThan(layout.cards[i - 1].dotY);
    }
  });

  it('same-side cards never overlap vertically', () => {
    const layout = layoutTimeline(entriesOf());
    for (const side of ['left', 'right'] as const) {
      const cards = layout.cards.filter((c) => c.side === side);
      for (let i = 1; i < cards.length; i++) {
        expect(cards[i].y).toBeGreaterThanOrEqual(
          cards[i - 1].y + cards[i - 1].height,
        );
      }
    }
  });

  it('cards straddle the spine and fit the canvas', () => {
    const layout = layoutTimeline(entriesOf());
    for (const card of layout.cards) {
      if (card.side === 'left') {
        expect(card.x + card.width).toBeLessThan(layout.spineX);
      } else {
        expect(card.x).toBeGreaterThan(layout.spineX);
      }
      expect(card.y).toBeGreaterThanOrEqual(0);
      expect(card.y + card.height).toBeLessThanOrEqual(layout.height);
      expect(card.x + card.width).toBeLessThanOrEqual(layout.width);
    }
  });

  it('skips fully empty entries with a warning', () => {
    const entries = entriesOf(':\n1900: real entry');
    const layout = layoutTimeline(entries);
    expect(layout.cards.length).toBe(1);
    expect(layout.warnings.length).toBe(1);
  });
});

/* --------------------------- wobble stability ------------------------------ */

describe('hand-drawn SVG parts', () => {
  it('nodeSeed is stable and scope-separated', () => {
    expect(nodeSeed('tree', '0.1|Label')).toBe(nodeSeed('tree', '0.1|Label'));
    expect(nodeSeed('tree', '0.1|Label')).not.toBe(
      nodeSeed('mindmap', '0.1|Label'),
    );
  });

  it('shapeStrokes are byte-identical per seed, distinct across seeds', () => {
    for (const shape of ['rect', 'cloud', 'circle'] as const) {
      const a = shapeStrokes(shape, 140, 44, 1234);
      const b = shapeStrokes(shape, 140, 44, 1234);
      expect(a).toEqual(b);
      const c = shapeStrokes(shape, 140, 44, 4321);
      expect(c.passes[0]).not.toBe(a.passes[0]);
      // Double stroke: two different passes over the same geometry.
      expect(a.passes[0]).not.toBe(a.passes[1]);
    }
  });

  it('edge strokes overshoot their joints slightly', () => {
    const strokes = edgeStrokes(
      [
        { x: 10, y: 10 },
        { x: 110, y: 10 },
      ],
      99,
    );
    expect(strokes.passes.length).toBe(2);
    // First M x — should start left of x=10 (overshoot back along direction).
    const m = /^M (-?\d+(?:\.\d+)?)/.exec(strokes.passes[0])!;
    expect(Number(m[1])).toBeLessThan(10);
    // Determinism.
    expect(
      edgeStrokes(
        [
          { x: 10, y: 10 },
          { x: 110, y: 10 },
        ],
        99,
      ),
    ).toEqual(strokes);
  });

  it('arrowheads are two distinct little strokes starting at the tip', () => {
    const [a, b] = arrowheadStrokes({ x: 50, y: 50 }, 0, 7);
    expect(a).not.toBe(b);
    for (const d of [a, b]) {
      // Wobble may nudge the start by a sub-pixel amount — check proximity.
      const m = /^M (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/.exec(d)!;
      expect(Math.hypot(Number(m[1]) - 50, Number(m[2]) - 50)).toBeLessThan(2);
    }
    // Determinism per seed.
    expect(arrowheadStrokes({ x: 50, y: 50 }, 0, 7)).toEqual([a, b]);
  });

  it('spine strokes are deterministic', () => {
    expect(spineStrokes(100, 0, 400, 5)).toEqual(spineStrokes(100, 0, 400, 5));
  });
});

/* ----------------------------- source bridge ------------------------------- */

describe('diagram source bridge', () => {
  it('print → parse round-trips the tree AST (modulo spans)', () => {
    const roots = treeRoots();
    const printed = printDiagramSource({ kind: 'tree', roots });
    const reparsed = parseDiagramSource('tree', printed);
    expect(reparsed.data.kind).toBe('tree');
    if (reparsed.data.kind === 'tree') {
      const strip = (ns: TreeNode[]): unknown[] =>
        ns.map((n) => ({
          label: n.label,
          note: n.note,
          attrs: n.attrs,
          children: strip(n.children),
        }));
      expect(strip(reparsed.data.roots)).toEqual(strip(roots));
    }
  });

  it('print → parse round-trips graph edges and labels', () => {
    const graph = graphOf('A -> B: go\nB -> C\nB {shape=cloud, color=sky}');
    const printed = printDiagramSource({ kind: 'graph', graph });
    const reparsed = parseDiagramSource('graph', printed);
    expect(reparsed.data.kind).toBe('graph');
    if (reparsed.data.kind === 'graph') {
      expect(reparsed.data.graph.edges.map((e) => [e.from, e.to, e.label])).toEqual(
        graph.edges.map((e) => [e.from, e.to, e.label]),
      );
      const b = reparsed.data.graph.nodes.find((n) => n.id === 'B')!;
      expect(b.attrs).toEqual({ shape: 'cloud', color: 'sky' });
    }
  });

  /**
   * The diagram popover calls the mini-language parsers DIRECTLY, not through
   * parseDoc — so `parseDiagramSource` has to locate and sort the diagnostics
   * itself, or every warning it shows lands at line 0. Same contract as
   * script.parse(): 1-based line/column, source order, never throws.
   */
  it('locates and sorts the diagnostics it returns', () => {
    const { diagnostics } = parseDiagramSource('graph', 'A -> B\n-> C\nB ->');
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map((d) => [d.code, d.line, d.column])).toEqual([
      ['graph-missing-source', 2, 1],
      ['graph-dangling-arrow', 3, 1],
    ]);
    // `expected` is the half a writer can act on, so it must survive the trip.
    expect(diagnostics[0]!.expected).toBeTruthy();
  });

  it('stays total on junk, with no diagnostic left unlocated', () => {
    for (const kind of ['tree', 'graph', 'timeline'] as const) {
      const { diagnostics } = parseDiagramSource(kind, '}{ -> ->\n\n:::\n\t ');
      for (const d of diagnostics) {
        expect(d.line).toBeGreaterThan(0);
        expect(d.column).toBeGreaterThan(0);
      }
    }
  });

  it('encode/decode round-trips through the data attr', () => {
    const data = parseDiagramSource('timeline', TL_SOURCE).data;
    const decoded = decodeDiagramData('timeline', encodeDiagramData(data));
    expect(decoded).toEqual(data);
  });

  it('malformed data degrades to an empty diagram of the right kind', () => {
    expect(decodeDiagramData('tree', 'not json')).toEqual({
      kind: 'tree',
      roots: [],
    });
    expect(decodeDiagramData('graph', '{"entries":[]}')).toEqual({
      kind: 'graph',
      graph: { nodes: [], edges: [] },
    });
    expect(decodeDiagramData('timeline', undefined)).toEqual({
      kind: 'timeline',
      entries: [],
    });
  });
});
