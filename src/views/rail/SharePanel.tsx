/**
 * src/views/rail/SharePanel.tsx — "Take it out": the one sheet where a page
 * or a book leaves this app, and where loose files come into it.
 *
 * ## Why this panel exists
 *
 * Four finished, e2e-tested features had no button anywhere in the app. The
 * PDF chooser, the page picture, the Markdown import and the templates gallery
 * were reachable only through `window.__nbGroupD`, the dev bridge group D put
 * up "before the rail buttons are wired". The buttons were never wired, the
 * specs drove the bridge, and everything went on passing. See the docblock on
 * `features/templates/groupD.ts`, and `tests/plugged-in.test.ts` part three,
 * which is the alarm that would now catch it.
 *
 * The templates gallery went to the shelf, where a reader makes a book. The
 * other three came here, TOGETHER: "get this page out of the app" and "get
 * these files into it" are one errand, and splitting them across the rail, the
 * settings sheet and a right-click card is how a reader ends up believing the
 * app cannot do something it has done all along.
 *
 * ## What it does NOT own
 *
 * Nothing. Every row calls the flow's own module-level opener — the same call
 * the keyboard makes through `data/keybindings` — so the button and the key
 * can never drift, and no export logic lives in a view.
 *
 * The bundle row is a doorway rather than a duplicate: the parcel desk
 * (`features/transfer`) is a whole panel of its own, with a scope tree, a
 * conflict matrix and an undo book, and it already answers Ctrl+Shift+E /
 * Ctrl+Shift+I. It is listed here because a reader looking for "how do I get
 * my writing out" should find all of the answers in one place, including the
 * big one.
 */
import { For, type JSX } from 'solid-js';
import { bindingFor, formatBinding } from '../../data/keybindings';
import { settings } from '../../data/settings';
import { exportActivePagePng } from '../../editor/script/exporters/exportPage';
import { openExportPdfDialog } from '../../features/templates/ExportPdfDialog';
import { importMarkdownBooks } from '../../features/templates/importMarkdown';
import {
  ExportPdfIcon,
  ExportPngIcon,
  ImportMdIcon,
  ParcelIcon,
} from '../../features/templates/icons';
import { openTransferPanel } from '../../features/transfer';
import { play } from '../../sound/engine';
import { ExportScriptIcon } from './icons';

export interface SharePanelProps {
  /**
   * Copy this page out as Notebook Script. Owned by BookView because it needs
   * the focused leaf's page id and the live editor — everything else on this
   * sheet resolves its own context.
   */
  onCopyScript(): void;
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
    id: 'script',
    title: 'Copy this page as script',
    hint: 'Notebook Script, to the clipboard',
    icon: ExportScriptIcon,
    keyFor: 'export-script',
    run: (props) => props.onCopyScript(),
  },
];

const IN: readonly ShareRow[] = [
  {
    id: 'markdown',
    title: 'Bring Markdown in',
    hint: 'one book per file, one page per # heading',
    icon: ImportMdIcon,
    keyFor: 'import-markdown',
    run: () => void importMarkdownBooks(),
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
            // The PDF chooser and the parcel desk are modal overlays; a sheet
            // still standing in the left of the window would only be something
            // to look past, and Escape would close the wrong one first.
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
          <span class="nb-share-row-key font-ui" aria-hidden="true">
            {cap(row)}
          </span>
        </button>
      )}
    </For>
  );
}

export default function SharePanel(props: SharePanelProps): JSX.Element {
  return (
    <div class="nb-share">
      {/* NOT "Take it out" again — the sheet's own header says that, and a
          heading repeating the title an inch above it is a heading nobody
          reads. This one says which SCOPE the rows under it work on. */}
      <p class="nb-panel-section-title">This page, or this book</p>
      <Rows rows={OUT} host={props} />

      <div class="nb-panel-section nb-panel-section-divided">
        <p class="nb-panel-section-title">Bring something in</p>
        <Rows rows={IN} host={props} />
      </div>

      <p class="nb-panel-footnote font-ui">
        nothing here changes the book — an export is a copy, and an import only
        ever adds
      </p>
    </div>
  );
}
