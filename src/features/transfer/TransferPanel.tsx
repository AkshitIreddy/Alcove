/**
 * src/features/transfer/TransferPanel.tsx — the parcel desk.
 *
 * One aged-paper overlay with a left icon rail (never a top bar) and three
 * rooms:
 *
 *   Export   scope picker → item tree → packing options → a preview of
 *            exactly what will be in the parcel, with counts and size.
 *   Import   pick a bundle → pick-and-choose tree with conflict badges and a
 *            per-book resolution, then "what will happen" before it happens.
 *   History  every restore point, with "revert this import" available long
 *            after the fact — and reverting is itself undoable.
 *
 * The panel owns no data logic: it renders pure results from ./scope,
 * ./conflicts and ./restore, and calls ./io + ./library to act.
 */
import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import { appState } from '../../state/app';
import { editorState } from '../../editor/state';
import { notify } from '../../editor/script/exporters/toast';
import { play } from '../../sound/engine';
import {
  BOOK_RESOLUTIONS,
  CONFLICT_BADGES,
  RESOLUTION_LABELS,
  buildImportPlan,
  buildLibraryIndex,
  defaultResolution,
  detectBookConflict,
  detectPageConflict,
  selectAllPages,
  type BookResolution,
  type ImportPlan,
} from './conflicts';
import { describeCounts, formatBytes } from './format';
import {
  AlertIcon,
  BookIcon,
  ChevronIcon,
  DashIcon,
  ExportIcon,
  HistoryIcon,
  ImportIcon,
  PageIcon,
  ParcelMark,
  TickIcon,
  UndoIcon,
} from './icons';
import { pickAndReadBundle, writeBundle, type ReadBundleResult } from './io';
import { applyImportPlan, loadLibrarySnapshot, revertRestorePoint } from './library';
import {
  RETENTION_AGE_CHOICES,
  RETENTION_COUNT_CHOICES,
  describeRestorePoint,
  expiresInDays,
  formatWhen,
  type RestorePoint,
} from './restore';
import {
  DEFAULT_EXPORT_OPTIONS,
  buildExportPlan,
  occupiedFloors,
  planLabel,
  resolveScopeSelection,
  suggestedFileName,
  type ExportOptions,
  type ExportScope,
  type LibrarySnapshot,
} from './scope';
import { loadHistory, setRetention } from './store';
// The shared toast chrome `notify()` renders into lives in insert.css.
import '../../styles/insert.css';
import '../../styles/transfer.css';

export type TransferTab = 'export' | 'import' | 'history';

const APP_VERSION = '0.1.0';

const TABS: ReadonlyArray<{ id: TransferTab; label: string; icon: () => JSX.Element }> = [
  { id: 'export', label: 'Send out', icon: () => <ExportIcon /> },
  { id: 'import', label: 'Bring in', icon: () => <ImportIcon /> },
  { id: 'history', label: 'Undo book', icon: () => <HistoryIcon /> },
];

/* -------------------------------- controls -------------------------------- */

function Tick(props: { state: 'on' | 'off' | 'some' }): JSX.Element {
  return (
    <span class="nb-tr-box" data-state={props.state} aria-hidden="true">
      <Show when={props.state === 'on'}>
        <TickIcon />
      </Show>
      <Show when={props.state === 'some'}>
        <DashIcon />
      </Show>
    </span>
  );
}

function Toggle(props: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange(next: boolean): void;
}): JSX.Element {
  return (
    <button
      type="button"
      class="nb-tr-toggle"
      role="switch"
      aria-checked={props.checked}
      onClick={() => props.onChange(!props.checked)}
    >
      <Tick state={props.checked ? 'on' : 'off'} />
      <span class="nb-tr-toggle-text">
        <span class="nb-tr-toggle-label">{props.label}</span>
        <Show when={props.hint !== undefined}>
          <span class="nb-tr-toggle-hint font-ui">{props.hint}</span>
        </Show>
      </span>
    </button>
  );
}

function ChipRow<T>(props: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onPick(value: T): void;
  ariaLabel: string;
}): JSX.Element {
  return (
    <div class="nb-tr-chips" role="group" aria-label={props.ariaLabel}>
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            class="nb-tr-chip font-ui"
            aria-pressed={option.value === props.value}
            data-active={option.value === props.value ? 'true' : 'false'}
            onClick={() => props.onPick(option.value)}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  );
}

/* --------------------------------- export --------------------------------- */

function ExportRoom(props: {
  snapshot: LibrarySnapshot | undefined;
  loading: boolean;
  onClose(): void;
}): JSX.Element {
  const [scope, setScope] = createSignal<ExportScope>({ kind: 'library' });
  const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  const [options, setOptions] = createStore<ExportOptions>({
    ...DEFAULT_EXPORT_OPTIONS,
  });
  const [busy, setBusy] = createSignal(false);

  const snapshot = (): LibrarySnapshot =>
    props.snapshot ?? { books: [], assets: [], theme: null };

  // The scope chips seed the selection once (see `pickScope`); after that the
  // ticks own it. Re-seeding on every scope change would undo a hand-picked
  // selection the moment the first page was unticked, because unticking
  // switches the scope chip to "pick by hand".
  createEffect(
    on(
      () => props.snapshot,
      (snapshot) => {
        if (snapshot === undefined) return;
        setSelected(resolveScopeSelection(snapshot, scope()));
      },
    ),
  );

  const plan = createMemo(() =>
    buildExportPlan(snapshot(), selected(), options),
  );

  const scopeOptions = createMemo(() => {
    const floors = occupiedFloors(snapshot());
    const list: Array<{ value: string; label: string }> = [
      { value: 'library', label: 'whole library' },
    ];
    for (const floor of floors.slice(0, 6)) {
      list.push({ value: `floor:${floor}`, label: `floor ${floor + 1}` });
    }
    const open = editorState.openBookId();
    if (open !== null && snapshot().books.some((book) => book.id === open)) {
      list.push({ value: `book:${open}`, label: 'this book' });
    }
    list.push({ value: 'selection', label: 'pick by hand' });
    return list;
  });

  const scopeValue = (): string => {
    const current = scope();
    if (current.kind === 'floor') return `floor:${current.floor ?? 0}`;
    if (current.kind === 'book') return `book:${current.bookId ?? ''}`;
    return current.kind;
  };

  const pickScope = (value: string): void => {
    void play('tick-hover');
    if (value === 'selection') {
      // "pick by hand" only changes the label — it keeps what is ticked.
      setScope({ kind: 'selection' });
      return;
    }
    const next: ExportScope = value.startsWith('floor:')
      ? { kind: 'floor', floor: Number(value.slice(6)) }
      : value.startsWith('book:')
        ? { kind: 'book', bookId: value.slice(5) }
        : { kind: 'library' };
    setScope(next);
    if (props.snapshot !== undefined) {
      setSelected(resolveScopeSelection(props.snapshot, next));
    }
  };

  const togglePage = (pageId: string): void => {
    const next = new Set(selected());
    if (next.has(pageId)) next.delete(pageId);
    else next.add(pageId);
    setSelected(next);
    setScope({ kind: 'selection' });
  };

  const toggleBook = (bookId: string): void => {
    const book = snapshot().books.find((entry) => entry.id === bookId);
    if (book === undefined) return;
    const next = new Set(selected());
    const allOn = book.pages.every((page) => next.has(page.id));
    for (const page of book.pages) {
      if (allOn) next.delete(page.id);
      else next.add(page.id);
    }
    setSelected(next);
    setScope({ kind: 'selection' });
  };

  const bookState = (bookId: string): 'on' | 'off' | 'some' => {
    const book = snapshot().books.find((entry) => entry.id === bookId);
    if (book === undefined || book.pages.length === 0) return 'off';
    const on = book.pages.filter((page) => selected().has(page.id)).length;
    return on === 0 ? 'off' : on === book.pages.length ? 'on' : 'some';
  };

  const toggleExpanded = (bookId: string): void => {
    const next = new Set(expanded());
    if (next.has(bookId)) next.delete(bookId);
    else next.add(bookId);
    setExpanded(next);
  };

  const singleMarkdown = (): boolean =>
    options.variant === 'markdown' && options.layout === 'single-file';

  const runExport = async (): Promise<void> => {
    const current = plan();
    if (busy() || current.empty) return;
    setBusy(true);
    try {
      const fileName = suggestedFileName(current, scope(), options);
      const result = await writeBundle(
        {
          snapshot: snapshot(),
          plan: current,
          options: { ...options },
          label: planLabel(current, scope()),
          createdAt: new Date().toISOString(),
          appVersion: APP_VERSION,
        },
        fileName,
        singleMarkdown(),
      );
      if (result.outcome === 'saved') {
        void play('pop-soft');
        notify(`${fileName} · ${formatBytes(result.bytes)}`);
      } else if (result.outcome === 'failed') {
        notify('could not write the bundle');
      }
    } catch {
      notify('could not build the bundle');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="nb-tr-room" data-room="export">
      <div class="nb-tr-col nb-tr-col-tree">
        <h3 class="nb-tr-h3">What goes in the parcel</h3>
        <ChipRow
          ariaLabel="Export scope"
          options={scopeOptions()}
          value={scopeValue()}
          onPick={pickScope}
        />
        <div class="nb-tr-tree" role="tree" aria-label="Books and pages to export">
          <Show
            when={!props.loading && snapshot().books.length > 0}
            fallback={
              <p class="nb-tr-empty font-ui">
                {props.loading ? 'reading the shelves…' : 'no books on the shelf yet'}
              </p>
            }
          >
            <For each={snapshot().books}>
              {(book) => (
                <div class="nb-tr-node" data-state={bookState(book.id)}>
                  <div class="nb-tr-row nb-tr-row-book">
                    <button
                      type="button"
                      class="nb-tr-disclose"
                      aria-label={`${expanded().has(book.id) ? 'Collapse' : 'Expand'} ${book.title}`}
                      data-open={expanded().has(book.id) ? 'true' : 'false'}
                      onClick={() => toggleExpanded(book.id)}
                    >
                      <ChevronIcon />
                    </button>
                    <button
                      type="button"
                      class="nb-tr-pick"
                      aria-pressed={bookState(book.id) === 'on'}
                      onClick={() => toggleBook(book.id)}
                    >
                      <Tick state={bookState(book.id)} />
                      <span class="nb-tr-glyph">
                        <BookIcon />
                      </span>
                      <span class="nb-tr-title">{book.title}</span>
                      <span class="nb-tr-meta font-ui">
                        {book.pages.length} page{book.pages.length === 1 ? '' : 's'}
                      </span>
                    </button>
                  </div>
                  <Show when={expanded().has(book.id)}>
                    <div class="nb-tr-children">
                      <For each={book.pages}>
                        {(page) => (
                          <button
                            type="button"
                            class="nb-tr-row nb-tr-row-page"
                            aria-pressed={selected().has(page.id)}
                            onClick={() => togglePage(page.id)}
                          >
                            <Tick state={selected().has(page.id) ? 'on' : 'off'} />
                            <span class="nb-tr-glyph">
                              <PageIcon />
                            </span>
                            <span class="nb-tr-title">{page.title}</span>
                            <span class="nb-tr-meta font-ui">{page.chars} chars</span>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </div>
      </div>

      <div class="nb-tr-col nb-tr-col-side">
        <h3 class="nb-tr-h3">How to pack it</h3>
        <div class="nb-tr-options">
          <Toggle
            label="bring the pictures"
            hint="media files referenced by these pages"
            checked={options.includeAssets}
            onChange={(next) => setOptions('includeAssets', next)}
          />
          <Toggle
            label="keep covers & spines"
            hint="each book's painted cover, charms and spine"
            checked={options.includeCoverStyling}
            onChange={(next) => setOptions('includeCoverStyling', next)}
          />
          <Toggle
            label="include the library look"
            hint="wood stain, wallpaper, ink and paper defaults"
            checked={options.includeLibraryTheme}
            onChange={(next) => setOptions('includeLibraryTheme', next)}
          />
          <Toggle
            label="perfect fidelity"
            hint="ship the editor's own JSON so nothing is lost"
            checked={options.losslessDocs}
            onChange={(next) => setOptions('losslessDocs', next)}
          />
          <div class="nb-tr-optrow">
            <span class="nb-tr-optlabel font-ui">written as</span>
            <ChipRow<ExportOptions['variant']>
              ariaLabel="File format"
              options={[
                { value: 'bundle', label: 'Notebook Script' },
                { value: 'markdown', label: 'plain Markdown' },
              ]}
              value={options.variant}
              onPick={(value) => setOptions('variant', value)}
            />
          </div>
          <div class="nb-tr-optrow">
            <span class="nb-tr-optlabel font-ui">split as</span>
            <ChipRow<ExportOptions['layout']>
              ariaLabel="File layout"
              options={[
                { value: 'per-page', label: 'one file per page' },
                { value: 'single-file', label: 'one file per book' },
              ]}
              value={options.layout}
              onPick={(value) => setOptions('layout', value)}
            />
          </div>
        </div>

        <div class="nb-tr-parcel">
          <h4 class="nb-tr-h4">In the parcel</h4>
          <p class="nb-tr-parcel-counts font-ui">
            {describeCounts(plan().counts)} · about{' '}
            {formatBytes(plan().estimatedBytes)}
          </p>
          <ul class="nb-tr-parcel-list">
            <For each={plan().books.slice(0, 7)}>
              {(book) => (
                <li class="nb-tr-parcel-item">
                  <span class="nb-tr-parcel-name">{book.title}</span>
                  <span class="nb-tr-parcel-note font-ui">
                    {book.pages.length} page{book.pages.length === 1 ? '' : 's'}
                    {book.omittedPages > 0 ? ` · ${book.omittedPages} left out` : ''}
                  </span>
                </li>
              )}
            </For>
            <Show when={plan().books.length > 7}>
              <li class="nb-tr-parcel-item nb-tr-parcel-more font-ui">
                and {plan().books.length - 7} more…
              </li>
            </Show>
            <Show when={plan().empty}>
              <li class="nb-tr-parcel-item nb-tr-parcel-more font-ui">
                nothing ticked yet
              </li>
            </Show>
          </ul>
          <span class="nb-tr-parcel-mark" aria-hidden="true">
            <ParcelMark />
          </span>
          <p class="nb-tr-filename font-ui">
            saves as <strong>{suggestedFileName(plan(), scope(), options)}</strong>
          </p>
        </div>

        <div class="nb-tr-actions">
          <button type="button" class="nb-tr-button font-ui" onClick={props.onClose}>
            Close
          </button>
          <span class="nb-tr-spacer" />
          <button
            type="button"
            class="nb-tr-button nb-tr-button-primary font-ui"
            disabled={busy() || plan().empty}
            onClick={() => void runExport()}
          >
            {busy() ? 'packing…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- import --------------------------------- */

function ImportRoom(props: {
  snapshot: LibrarySnapshot | undefined;
  onImported(): void;
  onClose(): void;
}): JSX.Element {
  const [bundle, setBundle] = createSignal<ReadBundleResult | null>(null);
  const [selectedPages, setSelectedPages] = createSignal<ReadonlySet<string>>(new Set());
  const [resolutions, setResolutions] = createSignal<ReadonlyMap<string, BookResolution>>(
    new Map(),
  );
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = createSignal(false);
  const [done, setDone] = createSignal<string | null>(null);

  const index = createMemo(() =>
    buildLibraryIndex(props.snapshot ?? { books: [], assets: [], theme: null }),
  );

  const plan = createMemo(() => {
    const current = bundle()?.contents;
    if (current === undefined || current === null) return null;
    return buildImportPlan(current.manifest, index(), {
      pages: selectedPages(),
      resolutions: resolutions(),
    });
  });

  const choose = async (): Promise<void> => {
    if (busy()) return;
    setBusy(true);
    try {
      const result = await pickAndReadBundle();
      if (result.contents === null && result.errors.length === 0 && result.fileName === '') {
        return; // cancelled
      }
      setBundle(result);
      setDone(null);
      if (result.contents !== null) {
        void play('pop-soft');
        setSelectedPages(selectAllPages(result.contents.manifest));
        const initial = new Map<string, BookResolution>();
        const expandedNext = new Set<string>();
        for (const book of result.contents.manifest.books) {
          initial.set(book.id, defaultResolution(detectBookConflict(book, index())));
          expandedNext.add(book.id);
        }
        setResolutions(initial);
        setExpanded(expandedNext);
      }
    } finally {
      setBusy(false);
    }
  };

  const setResolution = (bookId: string, resolution: BookResolution): void => {
    const next = new Map(resolutions());
    next.set(bookId, resolution);
    setResolutions(next);
    void play('tick-hover');
  };

  const togglePage = (pageId: string): void => {
    const next = new Set(selectedPages());
    if (next.has(pageId)) next.delete(pageId);
    else next.add(pageId);
    setSelectedPages(next);
  };

  const toggleBook = (bookId: string): void => {
    const book = bundle()?.contents?.manifest.books.find((entry) => entry.id === bookId);
    if (book === undefined) return;
    const next = new Set(selectedPages());
    const allOn = book.pages.every((page) => next.has(page.id));
    for (const page of book.pages) {
      if (allOn) next.delete(page.id);
      else next.add(page.id);
    }
    setSelectedPages(next);
  };

  const bookState = (bookId: string): 'on' | 'off' | 'some' => {
    const book = bundle()?.contents?.manifest.books.find((entry) => entry.id === bookId);
    if (book === undefined || book.pages.length === 0) return 'off';
    const on = book.pages.filter((page) => selectedPages().has(page.id)).length;
    return on === 0 ? 'off' : on === book.pages.length ? 'on' : 'some';
  };

  const apply = async (): Promise<void> => {
    const contents = bundle()?.contents;
    const current = plan();
    if (busy() || contents === undefined || contents === null || current === null) return;
    if (current.empty) return;
    setBusy(true);
    try {
      const outcome = await applyImportPlan(
        contents,
        current,
        bundle()?.fileName ?? 'bundle',
      );
      void play('pop-soft');
      setDone(
        `added ${outcome.createdPageCount} page${outcome.createdPageCount === 1 ? '' : 's'} — undo any time from the undo book`,
      );
      notify('imported — you can undo this from the undo book');
      props.onImported();
      if (outcome.focusBookId !== null) {
        editorState.setOpenBookId(outcome.focusBookId);
        appState.openBook(outcome.focusBookId);
      }
    } catch {
      notify('could not finish the import');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="nb-tr-room" data-room="import">
      <Show
        when={bundle()?.contents}
        fallback={
          <div class="nb-tr-dropplate">
            <div class="nb-tr-dropart" aria-hidden="true">
              <ImportIcon weight={1.7} />
            </div>
            <h3 class="nb-tr-h3">Bring a bundle in</h3>
            <p class="nb-tr-lede font-ui">
              Nothing is ever replaced. You choose what comes in, book by book and
              page by page — and a restore point is written before the first row
              is touched, so the whole import can be undone months later.
            </p>
            <button
              type="button"
              class="nb-tr-button nb-tr-button-primary font-ui"
              disabled={busy()}
              onClick={() => void choose()}
            >
              {busy() ? 'reading…' : 'Choose a .nbk bundle'}
            </button>
            <Show when={(bundle()?.errors.length ?? 0) > 0}>
              <ul class="nb-tr-errors font-ui">
                <For each={bundle()?.errors}>{(error) => <li>{error}</li>}</For>
              </ul>
            </Show>
          </div>
        }
      >
        {(contents) => (
          <>
            <div class="nb-tr-col nb-tr-col-tree">
              <h3 class="nb-tr-h3">{contents().manifest.label}</h3>
              <p class="nb-tr-lede font-ui">
                {describeCounts(contents().manifest.counts)} · from{' '}
                {bundle()?.fileName} · tick what you want
              </p>
              <div class="nb-tr-tree" role="tree" aria-label="Bundle contents">
                <For each={contents().manifest.books}>
                  {(book) => {
                    const conflict = (): ReturnType<typeof detectBookConflict> =>
                      detectBookConflict(book, index());
                    const resolution = (): BookResolution =>
                      resolutions().get(book.id) ?? defaultResolution(conflict());
                    return (
                      <div class="nb-tr-node" data-state={bookState(book.id)}>
                        <div class="nb-tr-row nb-tr-row-book">
                          <button
                            type="button"
                            class="nb-tr-disclose"
                            aria-label={`Toggle ${book.title}`}
                            data-open={expanded().has(book.id) ? 'true' : 'false'}
                            onClick={() => {
                              const next = new Set(expanded());
                              if (next.has(book.id)) next.delete(book.id);
                              else next.add(book.id);
                              setExpanded(next);
                            }}
                          >
                            <ChevronIcon />
                          </button>
                          <button
                            type="button"
                            class="nb-tr-pick"
                            aria-pressed={bookState(book.id) === 'on'}
                            onClick={() => toggleBook(book.id)}
                          >
                            <Tick state={bookState(book.id)} />
                            <span class="nb-tr-glyph">
                              <BookIcon />
                            </span>
                            <span class="nb-tr-title">{book.title}</span>
                            <Show when={conflict() !== 'none'}>
                              <span class="nb-tr-badge" data-kind={conflict()}>
                                <AlertIcon />
                                <span class="font-ui">{CONFLICT_BADGES[conflict()]}</span>
                              </span>
                            </Show>
                            <span class="nb-tr-meta font-ui">
                              {book.pages.length} page{book.pages.length === 1 ? '' : 's'}
                            </span>
                          </button>
                        </div>
                        <div class="nb-tr-resolve">
                          <For each={BOOK_RESOLUTIONS}>
                            {(option) => (
                              <button
                                type="button"
                                class="nb-tr-chip nb-tr-chip-sm font-ui"
                                data-active={option === resolution() ? 'true' : 'false'}
                                aria-pressed={option === resolution()}
                                onClick={() => setResolution(book.id, option)}
                              >
                                {RESOLUTION_LABELS[option]}
                              </button>
                            )}
                          </For>
                        </div>
                        <Show when={expanded().has(book.id)}>
                          <div class="nb-tr-children">
                            <For each={book.pages}>
                              {(page) => (
                                <button
                                  type="button"
                                  class="nb-tr-row nb-tr-row-page"
                                  aria-pressed={selectedPages().has(page.id)}
                                  onClick={() => togglePage(page.id)}
                                >
                                  <Tick
                                    state={selectedPages().has(page.id) ? 'on' : 'off'}
                                  />
                                  <span class="nb-tr-glyph">
                                    <PageIcon />
                                  </span>
                                  <span class="nb-tr-title">{page.title}</span>
                                  <Show when={detectPageConflict(page, index()) !== 'none'}>
                                    <span class="nb-tr-badge" data-kind="same-id">
                                      <AlertIcon />
                                      <span class="font-ui">already here</span>
                                    </span>
                                  </Show>
                                </button>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </div>
            </div>

            <div class="nb-tr-col nb-tr-col-side">
              <h3 class="nb-tr-h3">What will happen</h3>
              <ul class="nb-tr-plan">
                <For each={plan()?.books ?? []}>
                  {(book) => (
                    <li class="nb-tr-plan-item" data-action={book.action}>
                      {book.summary}
                    </li>
                  )}
                </For>
                <li class="nb-tr-plan-total font-ui">{planTotals(plan())}</li>
              </ul>
              <Show when={(bundle()?.warnings.length ?? 0) > 0}>
                <ul class="nb-tr-warnings font-ui">
                  <For each={bundle()?.warnings}>{(warning) => <li>{warning}</li>}</For>
                </ul>
              </Show>
              <p class="nb-tr-promise font-ui">
                A restore point is written before anything changes. Nothing in your
                library is replaced or deleted by an import.
              </p>
              <Show when={done() !== null}>
                <p class="nb-tr-done font-ui">{done()}</p>
              </Show>
              <div class="nb-tr-actions">
                <button
                  type="button"
                  class="nb-tr-button font-ui"
                  onClick={() => setBundle(null)}
                >
                  Pick another
                </button>
                <span class="nb-tr-spacer" />
                <button
                  type="button"
                  class="nb-tr-button nb-tr-button-primary font-ui"
                  disabled={busy() || (plan()?.empty ?? true)}
                  onClick={() => void apply()}
                >
                  {busy() ? 'adding…' : 'Add to my library'}
                </button>
              </div>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}

/** "2 new books · 1 gains pages · 9 pages in all" — the plan's bottom line. */
function planTotals(plan: ImportPlan | null): string {
  if (plan === null) return '';
  const parts: string[] = [];
  if (plan.counts.newBooks > 0) {
    parts.push(`${plan.counts.newBooks} new book${plan.counts.newBooks === 1 ? '' : 's'}`);
  }
  if (plan.counts.appendedBooks > 0) {
    parts.push(
      `${plan.counts.appendedBooks} book${plan.counts.appendedBooks === 1 ? '' : 's'} gains pages`,
    );
  }
  if (plan.counts.skippedBooks > 0) {
    parts.push(`${plan.counts.skippedBooks} skipped`);
  }
  parts.push(`${plan.counts.pages} page${plan.counts.pages === 1 ? '' : 's'} in all`);
  return `— ${parts.join(' · ')} —`;
}

/* -------------------------------- history --------------------------------- */

function HistoryRoom(props: { revision: number; onChanged(): void }): JSX.Element {
  const [history, { refetch }] = createResource(
    () => props.revision,
    () => loadHistory(),
  );
  const [busy, setBusy] = createSignal<string | null>(null);
  const now = new Date();

  const revert = async (point: RestorePoint): Promise<void> => {
    if (busy() !== null) return;
    setBusy(point.id);
    try {
      const outcome = await revertRestorePoint(point.id);
      if (outcome === null || outcome.restorePoint === null) {
        notify('nothing left to undo for that import');
      } else {
        void play('pop-soft');
        notify(
          `undone — ${outcome.removedBooks} book${outcome.removedBooks === 1 ? '' : 's'} and ${outcome.removedPages} page${outcome.removedPages === 1 ? '' : 's'} removed`,
        );
      }
      props.onChanged();
      void refetch();
    } catch {
      notify('could not undo that import');
    } finally {
      setBusy(null);
    }
  };

  const retention = (): { maxAgeDays: number; maxCount: number } =>
    history()?.retention ?? { maxAgeDays: 90, maxCount: 20 };

  const changeRetention = async (patch: {
    maxAgeDays?: number;
    maxCount?: number;
  }): Promise<void> => {
    await setRetention({ ...retention(), ...patch });
    void refetch();
  };

  return (
    <div class="nb-tr-room" data-room="history">
      <div class="nb-tr-col nb-tr-col-wide">
        <h3 class="nb-tr-h3">The undo book</h3>
        <p class="nb-tr-lede font-ui">
          Every import writes a restore point here first. Undo one whenever you
          like — even the undo itself is undoable.
        </p>
        <div class="nb-tr-history">
          <Show
            when={(history()?.points.length ?? 0) > 0}
            fallback={
              <div class="nb-tr-empty-card">
                <div class="nb-tr-dropart" aria-hidden="true">
                  <HistoryIcon weight={1.7} />
                </div>
                <p class="nb-tr-empty font-ui">
                  no imports yet — once you bring a bundle in, its restore point
                  waits here for {retention().maxAgeDays === 0 ? 'ever' : `${retention().maxAgeDays} days`}
                </p>
              </div>
            }
          >
            <For each={history()?.points ?? []}>
              {(point) => (
                <article class="nb-tr-hist" data-kind={point.kind}>
                  <div class="nb-tr-hist-main">
                    <h4 class="nb-tr-hist-title">{point.label}</h4>
                    <p class="nb-tr-hist-meta font-ui">
                      {describeRestorePoint(point, now)}
                      <Show when={expiresInDays(point, retention(), now) !== null}>
                        {' '}
                        · kept {expiresInDays(point, retention(), now)} more days
                      </Show>
                    </p>
                    <Show when={point.revertedAt !== null}>
                      <p class="nb-tr-hist-note font-ui">
                        reverted {formatWhen(point.revertedAt ?? '', now)}
                      </p>
                    </Show>
                  </div>
                  <div class="nb-tr-hist-side">
                    <span class="nb-tr-kind font-ui">{point.kind}</span>
                    <button
                      type="button"
                      class="nb-tr-button nb-tr-button-undo font-ui"
                      disabled={busy() !== null || point.revertedAt !== null}
                      onClick={() => void revert(point)}
                    >
                      <UndoIcon />
                      {point.kind === 'revert' ? 'Undo this revert' : 'Revert this import'}
                    </button>
                  </div>
                </article>
              )}
            </For>
            <p class="nb-tr-hist-end font-ui">
              — the undo book keeps{' '}
              {retention().maxAgeDays === 0
                ? 'every restore point forever'
                : `${retention().maxAgeDays} days`}
              {retention().maxCount === 0
                ? ''
                : ` and the last ${retention().maxCount} imports`} —
            </p>
          </Show>
        </div>

        <div class="nb-tr-retention">
          <span class="nb-tr-optlabel font-ui">keep restore points for</span>
          <ChipRow
            ariaLabel="Retention age"
            options={RETENTION_AGE_CHOICES.map((choice) => ({
              value: choice.value,
              label: choice.label,
            }))}
            value={retention().maxAgeDays}
            onPick={(value) => void changeRetention({ maxAgeDays: value })}
          />
          <span class="nb-tr-optlabel font-ui">and at most</span>
          <ChipRow
            ariaLabel="Retention count"
            options={RETENTION_COUNT_CHOICES.map((choice) => ({
              value: choice.value,
              label: choice.label,
            }))}
            value={retention().maxCount}
            onPick={(value) => void changeRetention({ maxCount: value })}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- the panel -------------------------------- */

export interface TransferPanelProps {
  initialTab?: TransferTab;
  onClose(): void;
}

export function TransferPanel(props: TransferPanelProps): JSX.Element {
  const [tab, setTab] = createSignal<TransferTab>(props.initialTab ?? 'export');
  const [revision, setRevision] = createSignal(0);
  const [snapshot, { refetch }] = createResource(
    () => revision(),
    () => loadLibrarySnapshot(),
  );

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') props.onClose();
  };
  onMount(() => document.addEventListener('keydown', onKeyDown));
  onCleanup(() => document.removeEventListener('keydown', onKeyDown));

  const bump = (): void => {
    setRevision((value) => value + 1);
    void refetch();
  };

  return (
    <div
      class="nb-tr-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div
        class="nb-tr-card"
        role="dialog"
        aria-modal="true"
        aria-label="Export, import and undo"
      >
        <nav class="nb-tr-rail" aria-label="Transfer sections">
          <For each={TABS}>
            {(entry) => (
              <button
                type="button"
                class="nb-tr-rail-button"
                data-active={tab() === entry.id ? 'true' : 'false'}
                aria-pressed={tab() === entry.id}
                onClick={() => {
                  setTab(entry.id);
                  void play('tick-hover');
                }}
              >
                {entry.icon()}
                <span class="nb-tr-rail-label font-ui">{entry.label}</span>
              </button>
            )}
          </For>
          <span class="nb-tr-rail-spacer" />
          <button
            type="button"
            class="nb-tr-rail-close font-ui"
            aria-label="Close"
            onClick={props.onClose}
          >
            ✕
          </button>
        </nav>

        <div class="nb-tr-body">
          <header class="nb-tr-head">
            <h2 class="nb-tr-headline">
              {tab() === 'export'
                ? 'Send part of your library out'
                : tab() === 'import'
                  ? 'Bring someone else’s pages in'
                  : 'Undo an import, whenever'}
            </h2>
          </header>
          <Show when={tab() === 'export'}>
            <ExportRoom
              snapshot={snapshot()}
              loading={snapshot.loading}
              onClose={props.onClose}
            />
          </Show>
          <Show when={tab() === 'import'}>
            <ImportRoom
              snapshot={snapshot()}
              onImported={bump}
              onClose={props.onClose}
            />
          </Show>
          <Show when={tab() === 'history'}>
            <HistoryRoom revision={revision()} onChanged={bump} />
          </Show>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ imperative -------------------------------- */

let openHost: HTMLElement | null = null;

/** Open the transfer panel. Idempotent — a second call is a no-op. */
export function openTransferPanel(initialTab: TransferTab = 'export'): void {
  if (openHost !== null) return;
  const host = document.createElement('div');
  host.className = 'nb-tr-host';
  document.body.appendChild(host);
  openHost = host;
  const dispose = render(
    () => (
      <TransferPanel
        initialTab={initialTab}
        onClose={() => {
          dispose();
          host.remove();
          openHost = null;
        }}
      />
    ),
    host,
  );
}

/** True while the panel is mounted (used by the rail's aria-expanded). */
export function isTransferPanelOpen(): boolean {
  return openHost !== null;
}
