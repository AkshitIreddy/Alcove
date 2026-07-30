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
import { load as loadSettings, subscribe as subscribeSettings } from "./data/settings";
import { applySettings } from "./features/settings/apply";
import SettingsPanel from "./features/settings/SettingsPanel";
import QuickSwitcher from "./features/quickswitch/QuickSwitcher";
import { initSystemFeatures } from "./features/system";
import ShelfView from "./views/ShelfView";
import BookView from "./views/BookView";
import "./styles/settings.css";

const VIEWS: readonly ViewState[] = ["shelf", "book"];

const pillStyle: JSX.CSSProperties = {
  position: "fixed",
  right: "var(--space-16)",
  bottom: "var(--space-16)",
  "z-index": "var(--z-menus)",
  display: "flex",
  gap: "var(--space-4)",
  padding: "var(--space-4)",
  background: "var(--paper-aged)",
  border: "1px solid var(--paper-edge)",
  "border-radius": "var(--radius-pill)",
  "box-shadow": "var(--shadow-sm)",
  opacity: 0.85,
};

/** Tiny dev-only switcher so both views stay reachable while features land. */
function DevViewSwitcher(): JSX.Element {
  return (
    <nav style={pillStyle} aria-label="Dev view switcher">
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

  onMount(() => {
    // Hydrate persisted settings, then keep the world in sync: subscribe fires
    // immediately with the current snapshot and again after load()/every save().
    void loadSettings();
    const unsubscribe = subscribeSettings(applySettings);
    onCleanup(unsubscribe);
    // Backup scheduler, tray, launch-into-last-book, perf HUD lifecycle.
    onCleanup(initSystemFeatures());
  });

  return (
    <>
      <Show when={appState.viewState() === "book"} fallback={<ShelfView />}>
        <BookView />
      </Show>
      <DevViewSwitcher />
      <QuickSwitcher />

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
