/**
 * src/diagrams — hand-drawn diagram renderers (trees, mindmaps, graphs,
 * flowcharts, timelines). Public surface:
 *
 *   - pure layouts:    layoutTree / layoutMindmap / layoutGraph / layoutTimeline
 *   - Solid renderers: DiagramRenderer (+ per-kind components)
 *   - source bridge:   printDiagramSource / parseDiagramSource /
 *                      encodeDiagramData / decodeDiagramData
 *   - slash surface:   SLASH_DIAGRAM_COMMANDS (append to the slash registry)
 *
 * The TipTap block node itself lives in src/editor/nodes/diagram.tsx.
 */

export * from './types';
export { measureText, heuristicMeasure, wrapText, type TextMeasurer } from './measure';
export { layoutTree, layoutMindmap, type TreeLayoutOptions, type RadialLayoutOptions } from './layout/tree';
export { layoutGraph, type GraphLayoutOptions } from './layout/graph';
export { layoutTimeline, type TimelineLayoutOptions } from './layout/timeline';
export { nodeBox, shapeOf, type NodeBox, type NodeBoxOptions } from './layout/size';
export {
  decodeDiagramData,
  encodeDiagramData,
  parseDiagramSource,
  printDiagramSource,
  toSrcLines,
  type ParsedDiagramSource,
} from './source';
export { DiagramRenderer, type DiagramRendererProps } from './render/DiagramRenderer';
export { TreeDiagram } from './render/TreeDiagram';
export { GraphDiagram } from './render/GraphDiagram';
export { TimelineDiagram } from './render/TimelineDiagram';
export { SLASH_DIAGRAM_COMMANDS } from './slashCommands';
