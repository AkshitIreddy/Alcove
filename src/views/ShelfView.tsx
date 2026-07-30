import type { JSX } from "solid-js";

const rootStyle: JSX.CSSProperties = {
  "min-height": "100vh",
  display: "grid",
  "place-items": "center",
  padding: "var(--space-32)",
};

const cardStyle: JSX.CSSProperties = {
  background: "var(--paper-aged)",
  border: "2px solid var(--ink-sepia-soft)",
  "border-radius": "var(--radius-hand)",
  "box-shadow": "var(--shadow-md)",
  padding: "var(--space-40) var(--space-48)",
  "max-width": "28rem",
  "text-align": "center",
  transform: "rotate(-0.4deg)",
};

/** Placeholder for the hand-drawn bookshelf world (PixiJS, later). */
export default function ShelfView(): JSX.Element {
  return (
    <main style={rootStyle}>
      <section style={cardStyle}>
        <h1 style={{ "font-size": "var(--text-h2)", "margin-bottom": "var(--space-8)" }}>
          The bookshelf grows here
        </h1>
        <p
          class="font-label"
          style={{
            "font-size": "var(--text-label)",
            color: "var(--ink-graphite-soft)",
          }}
        >
          warm wood, little books, and dust motes — coming soon
        </p>
      </section>
    </main>
  );
}
