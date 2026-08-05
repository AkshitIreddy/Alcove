import {
  For,
  Show,
  Suspense,
  createSignal,
  lazy,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import { appState, type ViewState } from "./state/app";
import {
  load as loadSettings,
  settings,
  subscribe as subscribeSettings,
} from "./data/settings";
import { installShortcuts, registerCommands } from "./data/keybindings";
import { applySettings } from "./features/settings/apply";
import QuickSwitcher from "./features/quickswitch/QuickSwitcher";
import { PerfHud, initSystemFeatures } from "./features/system";
import { installUiClickSounds } from "./sound/uiClicks";
import TutorialOverlay, { maybeAutoStartTutorial } from "./features/tutorial";
import TasteQuestionnaire from "./features/tutorial/tasteQuestionnaire";
import ShelfView from "./views/ShelfView";
import { CheatSheetHost } from "./views/CheatSheet";
import "./styles/settings.css";
// The Suspense fallback's own stylesheet, in the boot chunk on purpose — see
// the header of opening.css and the `BookOpening` docblock below.
import "./styles/opening.css";

/**
 * The book is the app's other half, and the reader does not start in it.
 *
 * `lazy()` rather than a static import because BookView is the root of the
 * editor stack — TipTap, ProseMirror, highlight.js's 37 languages, the yjs
 * that @tiptap/extension-drag-handle drags behind it — about 1MB minified.
 * Statically imported, every one of those bytes was parsed before the shelf
 * could draw, for a reader who had not opened anything.
 *
 * It is not merely deferred, it is PREFETCHED: `preloadBookView()` below runs
 * on the first idle after boot, so the chunk is parsed and waiting long
 * before a book is pulled off a shelf. Deferring a cost onto the click that
 * needs it would just move the stall somewhere more visible.
 */
const BookView = lazy(() => import("./views/BookView"));

/**
 * The settings sheet, fetched at the moment it is first opened.
 *
 * The sheet was mounted at boot inside a Portal and parked off screen at
 * `xPercent: 105` — the whole keybinding editor, the sound-set catalogue, the
 * backup rows, the diagnostics export, for a reader who has not touched the
 * gear. Measured with `shots-now/_weigh.mjs`: 29.5 kB of the boot chunk,
 * minified.
 *
 * `lazy()` plus the `settingsWanted` latch below, which is the same bargain
 * `RailPanel` strikes on the other side of the window: the sheet arrives on
 * the first ask and then STAYS, so a half-typed rebinding or a scroll position
 * survives closing it. `onMount` inside the sheet parks it before the open
 * effect tweens it in, so the first open still slides.
 *
 * `applySettings` is deliberately NOT behind this — it is imported straight
 * from `features/settings/apply` above, because the theme has to be on the
 * document before the first frame, not after a chunk lands.
 */
const SettingsPanel = lazy(() => import("./features/settings/SettingsPanel"));

/**
 * The parcel desk, opened on demand.
 *
 * `import()` for the same reason BookView is lazy: the panel reads and writes
 * whole books, so it reaches `editor/script/fromTiptap` and from there the
 * editor. A static import of the barrel put TipTap and ProseMirror — 300kB —
 * back in front of the shelf's first frame, silently, from two keyboard
 * commands that a reader may never press. It self-mounts, so there is nothing
 * to await.
 */
function openTransferPanel(tab: "export" | "import" | "history"): void {
  void import("./features/transfer").then((m) => m.openTransferPanel(tab));
}

/** Warm the book chunk once the shelf has had its turn on the main thread. */
function preloadBookView(): () => void {
  const idle =
    typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback
      : (cb: () => void): number => window.setTimeout(cb, 1200);
  const cancel =
    typeof window.cancelIdleCallback === "function"
      ? window.cancelIdleCallback
      : window.clearTimeout;
  const handle = idle(() => void import("./views/BookView"));
  return () => cancel(handle as number);
}

const VIEWS: readonly ViewState[] = ["shelf", "book"];

/**
 * The switcher is DEV chrome: a raw "shelf | book" pill pinned over the
 * bottom-right corner of the book cover in every production screenshot.
 * It stays reachable (the e2e suite and manual QA drive it) but only when
 * asked for — `?dev=1`, a `nb-dev` localStorage flag, or a non-production
 * bundle. Everything else gets a clean corner.
 */
function devChromeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("dev") === "1") return true;
    if (params.get("dev") === "0") return false;
    if (window.localStorage.getItem("nb-dev") === "1") return true;
  } catch {
    // Storage or URL unavailable (packaged webview quirks) — fall through.
  }
  return import.meta.env.DEV === true;
}

/**
 * Tiny dev-only switcher so both views stay reachable while features land.
 *
 * Placement/opacity live in settings.css (`.nb-dev-switcher`), NOT in an
 * inline style: inline styles outrank the stylesheet, so an inline `opacity`
 * here would beat the focus-mode fade rule and leave the pill glowing over a
 * deliberately dimmed desk.
 */
function DevViewSwitcher(): JSX.Element {
  return (
    <nav class="nb-dev-switcher" aria-label="Dev view switcher">
      <For each={VIEWS}>
        {(view) => {
          const active = () => appState.viewState() === view;
          return (
            <button
              type="button"
              class="font-ui"
              style={{
                padding: "var(--space-4) var(--space-12)",
                "border-radius": "var(--radius-pill)",
                background: active() ? "var(--wash-amber-light)" : "transparent",
                color: active() ? "var(--ink-sepia)" : "var(--ink-graphite-soft)",
                "font-weight": active() ? 700 : 400,
                transition: "background var(--dur-xs) var(--ease-out), color var(--dur-xs) var(--ease-out)",
              }}
              onClick={() => appState.setViewState(view)}
            >
              {view}
            </button>
          );
        }}
      </For>
    </nav>
  );
}

/**
 * The book, a moment before it has anything in it.
 *
 * This is the Suspense fallback, and it is drawn rather than written because
 * of what it stands in for: the spread mounting blocks the main thread for the
 * best part of two seconds (the numbers are on the boundary below), so the
 * reader stares at this frame, unmoving, for as long as that takes. A caption
 * in the middle of an empty window says "the app has lost its place". The book
 * already standing open on the desk, in the same box the real spread is about
 * to fill, says "your book is opening" — and when the spread lands it lands ON
 * this, same size, same corner radii, same terracotta board, so the handover
 * is a fill rather than a jump.
 *
 * Nothing here is a component from the book half, and it must stay that way:
 * importing one would pull the editor stack into the boot chunk that
 * `BookView`'s `lazy()` exists to keep it out of. It is plain markup over
 * styles/opening.css, which App.tsx imports directly for the same reason —
 * the old rules lived in editor.css and so arrived with the module they were
 * covering for.
 *
 * `aria-live="polite"` on the region and `aria-hidden` on the drawing: a
 * screen reader gets "opening the book" once, not a description of a rectangle.
 */
function BookOpening(): JSX.Element {
  return (
    <div class="nb-book-opening" role="status" aria-live="polite">
      <div class="nb-opening-stage">
        <div class="nb-opening-header">
          <p class="nb-opening-plate">
            opening the book
            <span class="nb-opening-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </p>
        </div>
        <div class="nb-opening-cover" aria-hidden="true">
          <div class="nb-opening-leaves">
            <div class="nb-opening-leaf" data-side="left">
              <div class="nb-opening-rules" />
            </div>
            <div class="nb-opening-leaf" data-side="right">
              <div class="nb-opening-rules" />
            </div>
            <div class="nb-opening-gutter" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Hand-drawn gear (pre-wobbled static paths — no runtime filters). */
function GearIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 40 40" class="nbs-gear-icon" aria-hidden="true">
      <path
        d="M 31.2 20.3 A 11.2 10.8 8 1 1 30.8 18.9 M 24.6 20.1 A 4.6 4.3 0 1 1 24.2 19.1 M 31.3 20.8 L 35.0 21.0 M 27.1 28.2 L 29.4 30.8 M 19.4 31.4 L 19.2 34.8 M 12.3 27.4 L 9.1 30.5 M 8.8 19.6 L 5.6 19.5 M 12.3 11.7 L 9.8 9.1 M 20.2 9.3 L 20.2 5.8 M 28.0 12.3 L 30.7 9.7"
        fill="none"
        stroke="currentColor"
        stroke-width="2.1"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export default function App(): JSX.Element {
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  /** Latch — see the SettingsPanel docblock. Never goes back to false. */
  const [settingsWanted, setSettingsWanted] = createSignal(false);
  const openSettings = (): void => {
    setSettingsWanted(true);
    setSettingsOpen((open) => !open);
  };
  const showDevChrome = devChromeEnabled();

  onMount(() => {
    // Hydrate persisted settings, then keep the world in sync: subscribe fires
    // immediately with the current snapshot and again after load()/every save().
    void loadSettings();
    const unsubscribe = subscribeSettings(applySettings);
    onCleanup(unsubscribe);
    // Backup scheduler, tray, launch-into-last-book, perf HUD lifecycle.
    onCleanup(initSystemFeatures());
    // One delegated listener gives every button in the app its soft click.
    onCleanup(installUiClickSounds());

    // First run opens the guided tour; it no-ops once completed.
    void maybeAutoStartTutorial();

    // The book half, fetched on the first idle rather than at boot.
    onCleanup(preloadBookView());

    // THE keyboard listener, for the whole app. Every rebindable shortcut runs
    // through it; a view says what its commands DO by registering them (see
    // data/keybindings), never which key runs them. Installed here rather than
    // in a view because it must outlive both scenes — the shelf and the book
    // swap under it, and their commands come and go with them.
    onCleanup(installShortcuts(() => settings.keybindings));

    // The commands the shell itself performs. These were three hand-rolled
    // `matchesBinding` branches in a keydown handler; the dispatcher does the
    // matching now, so what is left here is only the doing.
    onCleanup(
      registerCommands({
        "export-library": () => openTransferPanel("export"),
        "import-library": () => openTransferPanel("import"),
        // Loose Markdown files become BOOKS, so this belongs to the shell
        // rather than to the book view: a reader standing at the shelf wants
        // it at least as much as one already inside a book. Its buttons are
        // the settings sheet's "Library files" section and the book rail's
        // "In and out" sheet.
        //
        // Reached by `import()`: the importer turns Markdown into TipTap
        // documents, so a static import would put the whole editor back into
        // the boot chunk that BookView was just lifted out of. The command
        // opens a file dialog first, so nobody can perceive the load.
        "import-markdown": () =>
          void import("./features/templates/importMarkdown").then((m) =>
            m.importMarkdownBooks(),
          ),
        "open-settings": () => openSettings(),
      }),
    );

    // The OS reduced-motion switch can flip while the app is open; re-apply so
    // the inline --motion-scale follows it (see settings/apply.ts).
    if (typeof window.matchMedia === "function") {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      const onMotionChange = (): void => applySettings(settings);
      query.addEventListener("change", onMotionChange);
      onCleanup(() => query.removeEventListener("change", onMotionChange));
    }
  });

  return (
    <>
      {/*
        THE SHELF IS ALWAYS HERE. It is not the fallback of the `<Show>` below,
        and that is the fix for the second half of a bug whose first half is
        already commented inside it.

        As a fallback, ShelfView was unmounted for as long as a book was open —
        so "back to shelf" did not return to a room, it BUILT one: a new PixiJS
        application, a fresh bake of the case, the wall and every spine. The
        reader got a blank cream window with the dock and the zoom pill floating
        on it for about a second, every single time. It is visible in the demo
        recording at `qa/demo/frames/f1352.png`, and it is the same shape of
        defect as the Suspense gap below, in the opposite direction — which is
        exactly why it survived: the fix for the way IN said nothing about the
        way back.

        So the room stays standing and is marked away instead. The world stops
        its loop (`ShelfWorld.pause`), the DOM goes `visibility: hidden` and
        `inert`, and everything the shelf had open is closed — see the away
        effect in `features/bookshelf/BookshelfWorld.tsx`, which owns all of it.
        Returning is then a class and a synchronous render: the camera, the
        zoom and the scroll are not RESTORED, they were never lost.
      */}
      <ShelfView />
      <Show when={appState.viewState() === "book"}>
        {/*
          A SUSPENSE BOUNDARY, and it is not decoration.

          Two things here suspend: `BookView` is `lazy()`, and inside it the
          book's session is a `createResource` reading SQLite. With no boundary,
          Solid hides the WHOLE subtree while either is pending — including the
          icon rail and BookView's own "opening the book…" fallback, which is
          rendered outside the session `<Show>` precisely so it would show.

          The result was a genuinely empty screen between the shelf standing
          down and the spread arriving: cream, the settings seal, nothing else.
          It is brief, and it was invisible in every test because tests wait for
          `.nb-prose` rather than watching the gap — it turned up as two blank
          frames in the middle of the README's demo GIF, in a production build,
          which is where a reader meets it too.

          THEN THE BOUNDARY BECAME THE GAP. The fallback was one 14px caption in
          the middle of a 1440x900 window, and the demo recording shows it held
          for nineteen frames (`qa/demo/frames/f0421.png` onward, ~1.5s at 14fps)
          with the pointer parked on top of it covering a word. Fixing a blank
          screen with an almost-blank screen is not fixing it.

          Where the time actually goes, measured by `scripts/probe-book-opening.mjs`
          rather than guessed at — it is NEITHER of the two things this comment
          blames:

              import('/src/views/BookView.tsx') at the press ...  11ms
              getBook + listPages ..............................   1ms
              long task at +62ms ...............................  785ms
              long task at +1407ms .............................. 1157ms

          `preloadBookView()` is doing its job (the module is requested ~1.2s
          into the page's life, long before anyone pulls a book) and the session
          read is a single row and a page list. The wait is the spread MOUNTING:
          the cover bake, the flip surface, one TipTap editor per leaf. Real
          work, on the main thread, in BookView and PageEditor — not something a
          boundary out here can shorten.

          So the boundary's job is to make the wait look like what it is. See
          `BookOpening` above and the header of styles/opening.css: because the
          main thread is blocked solid for those two tasks, the fallback is
          frozen while it is up, and the only properties that keep moving are
          compositor-driven transform and opacity.
        */}
        <Suspense fallback={<BookOpening />}>
          <BookView />
        </Suspense>
      </Show>
      <Show when={showDevChrome}>
        <DevViewSwitcher />
      </Show>
      <QuickSwitcher />
      {/* The taste questionnaire, mounted once for the life of the app and
          inert until something opens it. It opens ITSELF when the tour reaches
          the step whose id is `taste` (it polls the overlay's own
          `data-tutorial-step` attribute), and `replayTaste()` opens it from the
          settings sheet's "choose my look again" row.

          Before <TutorialOverlay />, so the modal in front gets first refusal
          on a key press. That is a preference, NOT the mechanism: both hold a
          capture-phase keydown on `window`, and `stopPropagation()` does not
          stop listeners on the same target, so ordering alone cannot stop
          Escape closing the question and ending the tour underneath it in the
          same breath. The overlay standing down is what does that — see
          `modalOverTour` in TutorialOverlay.tsx. */}
      <TasteQuestionnaire />
      <TutorialOverlay />
      {/* The cheat-sheet lives at the root so `?` answers on the shelf too —
          it used to belong to BookView, which meant the first screen a reader
          ever sees was the one screen that could not tell them the keys. */}
      <CheatSheetHost />

      {/* The perf HUD (gated by `settings.perfHud`, `position: fixed`, so it
          needs no layer around it). It used to be mounted inside
          SettingsPanel's always-present layer; the sheet is a `lazy()` now, so
          a reader who left the HUD on would have had to open settings once
          per launch to see it again. Its module is in the boot chunk either
          way — `features/system/diagnostics.ts` reads `collectPixiStats` from
          it — so the move costs nothing. */}
      <PerfHud />

      <button
        type="button"
        class="nbs-gear-button"
        aria-label="Settings"
        aria-haspopup="dialog"
        aria-expanded={settingsOpen()}
        onClick={openSettings}
      >
        <GearIcon />
      </button>

      <Portal>
        <Show when={settingsWanted()}>
          <SettingsPanel
            open={settingsOpen()}
            onClose={() => setSettingsOpen(false)}
          />
        </Show>
      </Portal>
    </>
  );
}
