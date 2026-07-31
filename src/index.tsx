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

/* Group D (import/export & templates) wiring surface: hydrates the custom
   sticker registry at boot and exposes dev-only E2E hooks. Rail buttons
   import their handlers from this module. */
import "./features/templates/groupD";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Notebook: #root element is missing from index.html");
}

render(() => <App />, root);
