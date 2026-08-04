/**
 * The editor's extension set — docs/design/block-editor.md §2, everything
 * installed in package.json (Mathematics/TableOfContents are not installed,
 * so they are not listed).
 *
 * `createEditorExtensions()` builds the full schema; UI-coupled extensions
 * (drag handle, slash menu, placeholder) are opt-in so pure-logic tests can
 * derive the storage schema with `getSchema()` in a Node environment.
 */
import type { AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { DragHandle, type DragHandleOptions } from '@tiptap/extension-drag-handle';
import NodeRange from '@tiptap/extension-node-range';
import Placeholder from '@tiptap/extension-placeholder';
import { TableKit } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { TextStyleKit } from '@tiptap/extension-text-style';
import UniqueID from '@tiptap/extension-unique-id';
import { offset } from '@floating-ui/dom';
import { nanoid } from 'nanoid';
import { NotebookDocument } from './document';
import { NotebookCodeBlock } from './nodes/codeBlock';
import { NotebookHighlight } from './highlightStyles';
import { NotebookFace } from './marks/face';
import { MediaImage } from './media';
import { customNodeExtensions } from './nodes';
import { PageLinkSuggestions } from './links/extension';
import { SlashCommands } from './slash/extension';
import { TableSort } from './tables/sortable';
import { SelectionToolbarExtension } from './toolbar/extension';

/** Block-level types that carry a stable UniqueID `id` attribute. */
export const BLOCK_ID_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'codeBlock',
  'horizontalRule',
  'table',
  'details',
  'callout',
  'imageRow',
  'sticky-note',
  'polaroid',
  'washi-box',
  'card',
  'quote-card',
  'banner',
  'spoiler',
  'columns',
  'col',
  // The rest of the stationery drawer and all of the keepsake drawer.
  //
  // These were missing, and the symptom was invisible rather than broken:
  // several of these nodes seed their tilt from `node.attrs.id`
  // (containers.ts `seededTilt`), so with no UniqueID every pressed flower on
  // a page hashed the same string and lay at the same angle — a column of
  // identical sprigs, which is the exact "clip art" reading the seeding
  // exists to avoid.
  'index-card',
  'envelope',
  'stamp',
  'tag',
  'marginalia',
  'pressed-flower',
  'ticket-stub',
  'postcard',
  'ledger',
  'photo-corner',
  'wax-seal',
  'map-pin',
] as const;

export interface EditorExtensionsOptions {
  /**
   * Interactive chrome: drag handle, slash menu, placeholder. Off for
   * schema-only use (tests, script round-tripping).
   */
  interactive?: boolean;
  /** Placeholder text for empty blocks. */
  placeholder?: string;
  /** Drag handle config (element factory + callbacks), required if interactive. */
  dragHandle?: Pick<
    DragHandleOptions,
    'render' | 'onNodeChange' | 'onElementDragStart' | 'onElementDragEnd'
  >;
}

export function createEditorExtensions(
  options: EditorExtensionsOptions = {},
): AnyExtension[] {
  const extensions: AnyExtension[] = [
    NotebookDocument,

    StarterKit.configure({
      // Our Document carries pageStyle/lineHeightPx.
      document: false,
      // `NotebookCodeBlock` below replaces the plain code block.
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4] },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
      },
      // The drop indicator is the only thing telling you where a dragged
      // block will land, so it is inked rather than tinted, and thick enough
      // to read against ruled paper at 20px body size.
      //
      // `class` is not decoration: prosemirror-dropcursor only names its
      // element when this option is set, so without it NOTHING can style the
      // indicator — including flip.css's rule that keeps it out of page
      // snapshots, which is why the ProseMirror name is kept alongside ours.
      dropcursor: {
        color: 'var(--accent-deep)',
        width: 4,
        class: 'ProseMirror-dropcursor nb-dropcursor',
      },
    }),

    UniqueID.configure({
      attributeName: 'id',
      types: [...BLOCK_ID_TYPES],
      generateID: () => `b_${nanoid(10)}`,
    }),

    Details.configure({ persist: true }),
    DetailsSummary,
    DetailsContent,

    TableKit.configure({
      table: { resizable: true, lastColumnResizable: false },
    }),
    // Column sorting. Not interactive-only: the `sortCol`/`sortDir`/`docOrder`
    // attributes are part of the STORAGE schema, so a doc saved sorted has to
    // parse back the same way in a schema-only context (script round-tripping,
    // the export capture) or the sort would be dropped on the way through.
    TableSort,

    TaskList,
    TaskItem.configure({ nested: true }),

    // TextStyleKit bundles TextStyle + Color/FontFamily/FontSize/LineHeight…
    //
    // …except FontFamily, which is switched off so `marks/face.ts` is the ONE
    // way a run gets a face. FontFamily stores a raw CSS stack in an inline
    // `style`, from anywhere, at any size: it is a second copy of the hand
    // table frozen at the moment of the click, it beats every stylesheet rule
    // in the app, and it is how a paste out of a word processor lands a face
    // nobody offered on a page at a size nothing can read. The `face` mark
    // stores a hand ID instead and enforces that face's legibility floor.
    // Nothing in `src/` ever called `setFontFamily`, so no stored page loses
    // anything by this being off — `setColor` (the ink rows) is untouched.
    TextStyleKit.configure({ fontFamily: false }),
    // Highlight + hand-drawn style attr (marker / squiggle / circle).
    NotebookHighlight.configure({ multicolor: true }),
    // The hand a RUN of words is written in — a mark, so two runs in one
    // paragraph can disagree. Schema-level, not interactive-only: it is part
    // of the stored document, so a schema-only reader (script round-tripping,
    // the export capture) has to parse it back the same way.
    NotebookFace,

    MediaImage.configure({ allowBase64: true }),

    // The code block. `nodes/codeBlock.tsx` extends CodeBlockLowlight rather
    // than replacing it, so this is the same node every existing page already
    // stores — with a language picker, indentation, paste detection and a
    // look the reader owns. It carries its own lowlight instance (one for the
    // app, 76 grammars) so there is nothing to configure here.
    NotebookCodeBlock,

    NodeRange.configure({ key: null }),

    ...customNodeExtensions(),
  ];

  if (options.interactive ?? false) {
    extensions.push(
      Placeholder.configure({
        placeholder: options.placeholder ?? 'Type / for commands…',
        includeChildren: true,
      }),
      SlashCommands,
      // `[[` opens the page picker. Interactive-only, unlike the pageLink NODE
      // it inserts (which is a custom node and therefore in the schema
      // everywhere) — a read-only page still has to DRAW its references, it
      // just cannot be used to make new ones.
      PageLinkSuggestions,
      // The six inline marks, on a card that follows the selection. A plugin
      // view on <body> — see toolbar/extension.ts for why it must not be a
      // node view.
      SelectionToolbarExtension,
    );
    if (options.dragHandle) {
      extensions.push(
        DragHandle.configure({
          ...options.dragHandle,
          computePositionConfig: {
            // `left-start` anchors the grip to the block's FIRST line, which
            // is what you aim at. The offset keeps it inside the 40px gutter
            // the prose reserves (editor.css) with a couple of px of air, so
            // the grab lane never overlaps the text it would drag.
            placement: 'left-start',
            middleware: [offset(8)],
          },
        }),
      );
    }
  }

  return extensions;
}
