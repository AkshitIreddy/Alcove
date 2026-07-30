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
  transform: "rotate(0.4deg)",
};

/** Placeholder for the opened book with block-edited pages (TipTap, later). */
export default function BookView(): JSX.Element {
  return (
    <main style={rootStyle}>
      <section style={cardStyle}>
        <h1 style={{ "font-size": "var(--text-h2)", "margin-bottom": "var(--space-8)" }}>
          A book opens here
        </h1>
        <p
          class="font-label"
          style={{
            "font-size": "var(--text-label)",
            color: "var(--ink-graphite-soft)",
          }}
        >
          pages, ink, and margin doodles — coming soon
        </p>
      </section>
    </main>
  );
}
