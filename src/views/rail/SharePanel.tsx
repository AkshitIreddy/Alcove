/**
 * src/views/rail/SharePanel.tsx — "In and out": the one sheet for everything
 * that arrives in a book or leaves it, and the one place an assistant is
 * handed the format.
 *
 * ## Why this panel exists (twice)
 *
 * FIRST, because four finished, e2e-tested features had no button anywhere in
 * the app. The PDF chooser, the page picture, the Markdown import and the
 * templates gallery were reachable only through `window.__nbGroupD`, the dev
 * bridge group D put up "before the rail buttons are wired". The buttons were
 * never wired, the specs drove the bridge, and everything went on passing. See
 * the docblock on `features/templates/groupD.ts`, and `tests/plugged-in.test.ts`
 * part three, which is the alarm that would now catch it.
 *
 * SECOND, because the fix scattered them. Those four arrived beside three
 * script tools that had grown up separately — insert script, export script,
 * copy the AI spec — and the rail ended up carrying SEVEN icons for one
 * errand. The reader counted:
 *
 *   > "maybe condense insert, copy AI spec, export things into a single
 *   >  setting in side bar, with the above options as well in its panel below"
 *
 * So four rail icons became one. `insert`, `export`, `spec` and `templates`
 * came off the rail and became rows here, under the button that already opened
 * this sheet — the rail is down from fourteen buttons to ten, and every one of
 * those flows is one press further in rather than one icon further down.
 *
 * ## Three groups, because there are three questions
 *
 * A reader arrives here asking one of exactly three things, and the sheet is
 * ordered so the answer is the group heading rather than a row they have to
 * read to rule out:
 *
 *   bring in   — I have something that should be in this book
 *   take out   — I want this page, or this book, somewhere else
 *   for an AI  — I want an assistant to write one of these
 *
 * The AI pair is last and together on purpose. Copying the spec and copying
 * the page are the two halves of one loop — hand the format to an assistant,
 * hand it the page you already have — and they were at opposite ends of the
 * rail, one of them next to "add a page".
 *
 * ## What it does NOT own
 *
 * Almost nothing. Every row that can calls the flow's own module-level opener
 * — the same call the keyboard makes through `data/keybindings` — so the
 * button and the key can never drift, and no export logic lives in a view.
 * The three that arrive as props do so because they need what only `BookView`
 * has: the focused leaf's page id (copy this page), the live editor's dialog
 * (paste a script), and the toast (copy the spec).
 *
 * ## The doors that stayed open
 *
 * Consolidating is not the same as walling off, and every place a reader would
 * already look still works:
 *
 *   - every shortcut in the sheet is the SAME id it always was, registered by
 *     `BookView` / `App` and rebindable in settings;
 *   - the shelf dock's template button and the bare-plank right-click card
 *     still open the gallery, because that is where a reader MAKES a book;
 *   - the settings sheet still imports Markdown, because that is a library
 *     errand as much as a book one;
 *   - the insert dialog still carries its own "Copy the format for your AI",
 *     because wanting the format is what you discover while staring at an empty
 *     paste box. Word for word the same as the row below, deliberately: it read
 *     "Copy spec for your AI" over there and "Copy the format for your AI"
 *     here, which is one action wearing two names in two places a reader meets
 *     inside a minute of each other.
 *
 * The bundle row is a doorway rather than a duplicate: the parcel desk
 * (`features/transfer`) is a whole panel of its own, with a scope tree, a
 * conflict matrix and an undo book, and it already answers Ctrl+Shift+E /
 * Ctrl+Shift+I. It is listed here because a reader looking for "how do I get
 * my writing out" should find all of the answers in one place, including the
 * big one.
 */
import { For, Show, type JSX } from 'solid-js';
import { bindingFor, formatBinding } from '../../data/keybindings';
import { settings } from '../../data/settings';
import { exportActivePagePng } from '../../editor/script/exporters/exportPage';
import { openExportPdfDialog } from '../../features/templates/ExportPdfDialog';
import { importMarkdownBooks } from '../../features/templates/importMarkdown';
import { openTemplatesGallery } from '../../features/templates/TemplatesGallery';
import {
  ExportPdfIcon,
  ExportPngIcon,
  ImportMdIcon,
  ParcelIcon,
  TemplatesIcon,
} from '../../features/templates/icons';
import { openTransferPanel } from '../../features/transfer';
import { play } from '../../sound/engine';
import { AiSpecIcon, ExportScriptIcon, InsertScriptIcon } from './icons';

export interface SharePanelProps {
  /**
   * The paste box for Notebook Script. Owned by BookView because the dialog is
   * mounted against the focused leaf's page id and talks to the live editor.
   */
  onInsertScript(): void;
  /**
   * Copy this page out as Notebook Script. Owned by BookView for the same
   * reason — everything else on this sheet resolves its own context.
   */
  onCopyScript(): void;
  /** Put the whole Notebook Script spec on the clipboard, and say so. */
  onCopySpec(): void;
  /** Close the sheet behind a row that opens a modal over it. */
  onClose(): void;
}

interface ShareRow {
  readonly id: string;
  readonly title: string;
  readonly hint: string;
  readonly icon: () => JSX.Element;
  /** Action id in the central map, for the key cap. */
  readonly keyFor?: string;
  /** True when the row opens something that would sit under this sheet. */
  readonly closesPanel?: boolean;
  readonly run: (props: SharePanelProps) => void;
}

interface ShareGroup {
  readonly id: string;
  readonly title: string;
  readonly rows: readonly ShareRow[];
}

const IN: readonly ShareRow[] = [
  {
    id: 'insert',
    title: 'Paste a script in',
    hint: 'Notebook Script, turned into real blocks',
    icon: InsertScriptIcon,
    keyFor: 'insert-script',
    closesPanel: true,
    run: (props) => props.onInsertScript(),
  },
  {
    id: 'markdown',
    title: 'Bring Markdown in',
    hint: 'a book per file, a page per # heading',
    icon: ImportMdIcon,
    keyFor: 'import-markdown',
    run: () => void importMarkdownBooks(),
  },
  {
    id: 'templates',
    title: 'Start from a template',
    hint: 'a written book, or its pages in this one',
    icon: TemplatesIcon,
    keyFor: 'templates',
    closesPanel: true,
    run: () => openTemplatesGallery(),
  },
];

const OUT: readonly ShareRow[] = [
  {
    id: 'pdf',
    title: 'Export as PDF',
    hint: 'this page, or the whole book — rendered at 2×',
    icon: ExportPdfIcon,
    keyFor: 'export-pdf',
    closesPanel: true,
    run: () => openExportPdfDialog(),
  },
  {
    id: 'png',
    // Short enough to stay on ONE line beside a four-part key cap. "Save this
    // page as a picture" wrapped after "as a", which reads as a mistake.
    title: 'This page as a picture',
    hint: 'a PNG of the leaf under the caret, at 2×',
    icon: ExportPngIcon,
    keyFor: 'export-png',
    run: () => void exportActivePagePng(),
  },
  {
    id: 'parcel',
    title: 'The parcel desk…',
    hint: 'whole bundles in and out, and undo an import',
    icon: ParcelIcon,
    keyFor: 'export-library',
    closesPanel: true,
    run: () => openTransferPanel('export'),
  },
];

const AI: readonly ShareRow[] = [
  {
    id: 'spec',
    // No key cap, and that is honest: nothing in `data/keybindings` binds this
    // one. A borrowed combination on the row would be a shortcut that opens
    // something else.
    title: 'Copy the format for your AI',
    hint: 'the whole Notebook Script spec, to the clipboard',
    icon: AiSpecIcon,
    run: (props) => props.onCopySpec(),
  },
  {
    id: 'script',
    title: 'Copy this page as script',
    hint: 'this page, back out as Notebook Script',
    icon: ExportScriptIcon,
    keyFor: 'export-script',
    run: (props) => props.onCopyScript(),
  },
];

/**
 * The sheet, in reading order. ONE table rather than three hand-placed
 * sections, so a row added to a group cannot be added to the markup and
 * forgotten in the heading — the divider, the heading and the rows all come
 * from the same entry.
 */
const GROUPS: readonly ShareGroup[] = [
  { id: 'in', title: 'Bring something in', rows: IN },
  { id: 'out', title: 'Take this page, or this book, out', rows: OUT },
  { id: 'ai', title: 'For an assistant', rows: AI },
];

function Rows(props: {
  rows: readonly ShareRow[];
  host: SharePanelProps;
}): JSX.Element {
  const cap = (row: ShareRow): string | undefined =>
    row.keyFor === undefined
      ? undefined
      : formatBinding(bindingFor(row.keyFor, settings.keybindings));
  return (
    <For each={props.rows}>
      {(row) => (
        <button
          type="button"
          class="nb-share-row"
          data-share={row.id}
          /* NO data-tooltip, deliberately, and for the reason Tooltip.tsx
             states: a bubble repeating text that is sitting in full underneath
             it is noise. This row already carries its name, a sentence saying
             what it will do, AND its key cap. The bubbles in this app are for
             icon-only controls — the rail button that OPENS this sheet has one,
             and so does the shelf dock's template button. (Same call the
             settings sheet's rebind rows make, for the same reason.) */
          aria-label={
            cap(row) === undefined
              ? `${row.title} — ${row.hint}`
              : `${row.title} — ${row.hint} (${cap(row)})`
          }
          onClick={() => {
            void play('pop-soft');
            // The PDF chooser, the paste box, the gallery and the parcel desk
            // are modal overlays; a sheet still standing in the left of the
            // window would only be something to look past, and Escape would
            // close the wrong one first.
            if (row.closesPanel === true) props.host.onClose();
            row.run(props.host);
          }}
        >
          <span class="nb-share-row-glyph" aria-hidden="true">
            {row.icon()}
          </span>
          <span class="nb-share-row-text">
            <span class="nb-share-row-title">{row.title}</span>
            <span class="nb-share-row-hint font-ui">{row.hint}</span>
          </span>
          {/* `Show`, not a bare `{cap(row)}` — the cap is a bordered pill, and
              an empty one drew a small blank box on the AI-spec row (the one
              row nothing binds). A key nobody has is nothing to show, not an
              empty frame. */}
          <Show when={cap(row)} keyed>
            {(key) => (
              <span class="nb-share-row-key font-ui" aria-hidden="true">
                {key}
              </span>
            )}
          </Show>
        </button>
      )}
    </For>
  );
}

export default function SharePanel(props: SharePanelProps): JSX.Element {
  return (
    <div class="nb-share">
      <For each={GROUPS}>
        {(group, index) => (
          <section
            class="nb-share-group"
            classList={{
              // The first group needs no rule above it — the sheet's own
              // header is the line, and a second one an inch under it reads
              // as an empty section.
              'nb-panel-section': index() > 0,
              'nb-panel-section-divided': index() > 0,
            }}
            data-share-group={group.id}
            aria-label={group.title}
          >
            {/* NOT the sheet's title again — the header says "In and out" an
                inch above, and a heading repeating it is a heading nobody
                reads. Each of these says which QUESTION its rows answer. */}
            <p class="nb-panel-section-title">{group.title}</p>
            <Rows rows={group.rows} host={props} />
          </section>
        )}
      </For>

      <p class="nb-panel-footnote font-ui">
        taking something out is always a copy — the book itself is never
        touched. Bringing something in only ever adds: a script lands where the
        caret is, and everything else arrives as new pages.
      </p>
    </div>
  );
}
