/* @refresh reload */

/* Fonts (bundled, self-hosted) — see CLAUDE.md font roles */
import "@fontsource-variable/caveat"; /* headings/book titles (>= 20px) */
import "@fontsource/patrick-hand"; /* body */
import "@fontsource/kalam/latin-300.css"; /* accents */
import "@fontsource/kalam/latin-400.css";
import "@fontsource/kalam/latin-700.css";
import "@fontsource/architects-daughter"; /* diagram labels */
import "@fontsource/nunito-sans/latin-400.css"; /* UI micro-copy < 13px */
import "@fontsource/nunito-sans/latin-600.css";
import "@fontsource/nunito-sans/latin-700.css";
/* The catalogue's FONTS shelf. Not app roles — a writer picks these per block
   (`{font=marker}`, src/script/vocab.ts FONT_VALUES). They were in
   package.json and loaded by nobody, so every one of them rendered as the body
   face. */
import "@fontsource/gochi-hand"; /* "marker" */
import "@fontsource/shadows-into-light"; /* "chalk" */
import "@fontsource/lora/latin-400.css"; /* "serif" */
import "@fontsource/lora/latin-600.css";
import "@fontsource/crimson-pro"; /* "book" */

/* Styles — tokens first, then globals that consume them */
import "./styles/tokens.css";
import "./styles/global.css";

import { render } from "solid-js/web";
import App from "./App";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Notebook: #root element is missing from index.html");
}

render(() => <App />, root);

/* Persisted custom stickers, hydrated once per boot (roadmap 27).
 *
 * Group D (import/export & templates) is reached for this ONE side effect, so
 * this is the only thing pulled from it. Not the `groupD` barrel: that
 * re-exports the templates gallery, the PDF dialog and the Markdown importer,
 * each of which reaches `editor/extensions` — importing the barrel for one
 * side effect put TipTap, ProseMirror, highlight.js and yjs in front of the
 * shelf's first frame. Rail buttons still import their handlers from the
 * barrel; they live inside the book, which is a chunk of its own.
 *
 * And `import()` rather than a static import at the top of this file, for the
 * same reason one step further down: the registry lives in
 * `editor/nodes/stickers.ts`, which is 25.5 kB of the boot chunk minified
 * (measured, `shots-now/_weigh.mjs`) — every sticker in the app, as inline
 * SVG. This runs after render() and nothing was ever awaiting it: it is a
 * database read whose result first matters when a PAGE is on screen, and the
 * page is itself a chunk that arrives later. The comment that used to sit on
 * the static import said as much — "nothing on the first screen shows a
 * sticker" — while the import it was attached to loaded them all anyway. */
void import("./features/templates/userStickers").then((m) =>
  m.loadUserStickers(),
);

/* The `__nbGroupD` bridge the Playwright suite drives. DEV only, and the
   `import()` is dead code in a production build — `import.meta.env.DEV` folds
   to false and rollup drops the whole branch, so the barrel it names never
   reaches a shipped chunk. */
if (import.meta.env.DEV) void import("./features/templates/groupD");

/*
 * A web font arriving after the first draw changes every width under its
 * family, and `art/textMetrics.ts` would otherwise keep handing out the
 * fallback's numbers for the rest of the session — titles laid out for one face
 * and painted in another. The cache is told once, when the last face lands.
 *
 * Fire-and-forget on purpose: nothing downstream waits on it, and a browser
 * without `document.fonts` simply never invalidates, which is exactly right
 * because it never swapped a face either.
 */
void import("./art/textMetrics").then(({ invalidateTextMetrics }) => {
  document.fonts?.ready.then(() => invalidateTextMetrics());
});
