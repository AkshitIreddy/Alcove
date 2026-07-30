import { For, Show, type JSX } from "solid-js";
import { appState, type ViewState } from "./state/app";
import ShelfView from "./views/ShelfView";
import BookView from "./views/BookView";

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

export default function App(): JSX.Element {
  return (
    <>
      <Show when={appState.viewState() === "book"} fallback={<ShelfView />}>
        <BookView />
      </Show>
      <DevViewSwitcher />
    </>
  );
}
