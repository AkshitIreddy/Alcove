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
