import {
  For,
  Show,
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
import SettingsPanel from "./features/settings/SettingsPanel";
import QuickSwitcher from "./features/quickswitch/QuickSwitcher";
import { initSystemFeatures } from "./features/system";
import { installUiClickSounds } from "./sound/uiClicks";
import TutorialOverlay, { maybeAutoStartTutorial } from "./features/tutorial";
import TasteQuestionnaire from "./features/tutorial/tasteQuestionnaire";
import ShelfView from "./views/ShelfView";
import { CheatSheetHost } from "./views/CheatSheet";
import "./styles/settings.css";

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
        // "Take it out" sheet.
        //
        // Reached by `import()`: the importer turns Markdown into TipTap
        // documents, so a static import would put the whole editor back into
        // the boot chunk that BookView was just lifted out of. The command
        // opens a file dialog first, so nobody can perceive the load.
        "import-markdown": () =>
          void import("./features/templates/importMarkdown").then((m) =>
            m.importMarkdownBooks(),
          ),
        "open-settings": () => setSettingsOpen((open) => !open),
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
      <Show when={appState.viewState() === "book"} fallback={<ShelfView />}>
        <BookView />
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

      <button
        type="button"
        class="nbs-gear-button"
        aria-label="Settings"
        aria-haspopup="dialog"
        aria-expanded={settingsOpen()}
        onClick={() => setSettingsOpen((open) => !open)}
      >
        <GearIcon />
      </button>

      <Portal>
        <SettingsPanel
          open={settingsOpen()}
          onClose={() => setSettingsOpen(false)}
        />
      </Portal>
    </>
  );
}
