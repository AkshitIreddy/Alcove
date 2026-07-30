/**
 * src/diagrams/slashCommands.ts — slash-menu entries for diagram blocks.
 *
 * Exported for the orchestrator to append to the slash registry
 * (src/editor/slash/registry.ts is not edited here):
 *
 *   import { SLASH_DIAGRAM_COMMANDS } from '../../diagrams/slashCommands';
 *   // ...append to SLASH_COMMANDS
 *
 * Each command inserts a `diagram` node seeded with a tiny starter template,
 * parsed through the real script parsers so data always matches the AST.
 */

import type { SlashCommand } from '../editor/slash/registry';
import { encodeDiagramData, parseDiagramSource } from './source';
import type { DiagramKind } from './types';

interface DiagramTemplate {
  id: string;
  kind: DiagramKind;
  title: string;
  subtitle: string;
  glyph: string;
  keywords: string[];
  source: string;
}

const TEMPLATES: DiagramTemplate[] = [
  {
    id: 'diagram-tree',
    kind: 'tree',
    title: 'Tree',
    subtitle: 'Hand-drawn branching hierarchy',
    glyph: '⑂',
    keywords: ['tree', 'hierarchy', 'outline', 'branch', 'diagram', 'org'],
    source: ['Topic', '  Branch one', '    A little leaf', '  Branch two'].join(
      '\n',
    ),
  },
  {
    id: 'diagram-mindmap',
    kind: 'mindmap',
    title: 'Mindmap',
    subtitle: 'Radial idea map around a center',
    glyph: '✳',
    keywords: ['mindmap', 'mind map', 'radial', 'brainstorm', 'ideas', 'diagram'],
    source: [
      'Big idea {color=amber, shape=cloud}',
      '  First thought',
      '  Second thought',
      '  Third thought',
    ].join('\n'),
  },
  {
    id: 'diagram-flowchart',
    kind: 'flowchart',
    title: 'Flowchart',
    subtitle: 'Boxes and pencil arrows',
    glyph: '⇢',
    keywords: ['flowchart', 'flow', 'graph', 'arrows', 'process', 'diagram', 'dag'],
    source: [
      'Start {color=moss}',
      'Start -> Decide',
      'Decide -> Do it: yes',
      'Decide -> Let it go: no',
    ].join('\n'),
  },
  {
    id: 'diagram-timeline',
    kind: 'timeline',
    title: 'Timeline',
    subtitle: 'Events along a hand-ruled spine',
    glyph: '‖',
    keywords: ['timeline', 'history', 'events', 'dates', 'chronology', 'diagram'],
    source: [
      '1900: Something began | color=sky',
      '1950: It grew and grew',
      'Now: Here we are | color=amber',
    ].join('\n'),
  },
];

export const SLASH_DIAGRAM_COMMANDS: readonly SlashCommand[] = TEMPLATES.map(
  (template) => ({
    id: template.id,
    title: template.title,
    subtitle: template.subtitle,
    icon: { kind: 'text', text: template.glyph },
    keywords: template.keywords,
    section: 'blocks',
    run: ({ editor, range }) => {
      const parsed = parseDiagramSource(template.kind, template.source);
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'diagram',
          attrs: {
            kind: template.kind,
            data: encodeDiagramData(parsed.data),
          },
        })
        .run();
    },
  }),
);
