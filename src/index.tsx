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

/* Group D (import/export & templates): the one thing it does AT BOOT is
   hydrate the custom-sticker registry, so that is the only thing imported
   here. The `groupD` barrel itself re-exports the templates gallery, the PDF
   dialog and the Markdown importer, each of which reaches `editor/extensions`
   — importing the barrel for one side effect put TipTap, ProseMirror,
   highlight.js and yjs in front of the shelf's first frame. Rail buttons
   still import their handlers from the barrel; they live inside the book,
   which is a chunk of its own. The dev-only E2E bridge it also installs is
   pulled in below, after the app is on screen. */
import { loadUserStickers } from "./features/templates/userStickers";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Notebook: #root element is missing from index.html");
}

render(() => <App />, root);

/* Persisted custom stickers, hydrated once per boot (roadmap 27). After
   render() rather than before it: it is a database read, and nothing on the
   first screen shows a sticker. */
void loadUserStickers();

/* The `__nbGroupD` bridge the Playwright suite drives. DEV only, and the
   `import()` is dead code in a production build — `import.meta.env.DEV` folds
   to false and rollup drops the whole branch, so the barrel it names never
   reaches a shipped chunk. */
if (import.meta.env.DEV) void import("./features/templates/groupD");
