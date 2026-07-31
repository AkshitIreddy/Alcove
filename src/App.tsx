import {
  For,
  Show,
  createSignal,
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
import { matchesBinding } from "./data/keybindings";
import { applySettings } from "./features/settings/apply";
import SettingsPanel from "./features/settings/SettingsPanel";
import QuickSwitcher from "./features/quickswitch/QuickSwitcher";
import { initSystemFeatures } from "./features/system";
import { installUiClickSounds } from "./sound/uiClicks";
import TutorialOverlay, { maybeAutoStartTutorial } from "./features/tutorial";
import { openTransferPanel } from "./features/transfer";
import ShelfView from "./views/ShelfView";
import BookView from "./views/BookView";
import "./styles/settings.css";

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

    // Library import/export: rows in the settings sheet, plus these two combos.
    // Read from settings so the shortcut list the sheet renders IS the binding.
    const onKeyDown = (event: KeyboardEvent): void => {
      const keys = settings.keybindings;
      if (matchesBinding(event, keys["export-library"] ?? "mod+shift+e")) {
        event.preventDefault();
        openTransferPanel("export");
      } else if (matchesBinding(event, keys["import-library"] ?? "mod+shift+i")) {
        event.preventDefault();
        openTransferPanel("import");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));

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
      <TutorialOverlay />

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
