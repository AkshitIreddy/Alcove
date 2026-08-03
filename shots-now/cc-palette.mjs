/**
 * shots-now/cc-palette.mjs — specimen board for the pigment shelf.
 *
 * Renders all 24 swatches (light / base / deep), a row of colours a reader
 * might type and what they come back as, and real `.nb-callout` cards painted
 * through the same `--co-*` triple the node writes. tokens.css and the callout
 * block of editor.css are inlined verbatim, so what is on screen here is what
 * the app paints.
 *
 * Usage: node shots-now/cc-palette.mjs <swatches.json> <out.png> [theme]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const jsonPath = process.argv[2];
const out = process.argv[3] ?? 'shots-now/cc-palette.png';
const theme = process.argv[4] ?? '';

const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
const tokens = readFileSync('src/styles/tokens.css', 'utf8');
const settings = readFileSync('src/styles/settings.css', 'utf8');
const editor = readFileSync('src/styles/editor.css', 'utf8');
const calloutCss = editor.slice(
  editor.indexOf('.nb-callout {'),
  editor.indexOf('.nb-callout-icon'),
);

const cell = (faces, label, sub, fold) => `
  <div class="cell${fold ? ' fold' : ''}">
    <div class="stack">
      <div class="f" style="background:${faces.light}"></div>
      <div class="f" style="background:${faces.base}"></div>
      <div class="f" style="background:${faces.deep}"></div>
    </div>
    <div class="lbl">${label}</div>
    <div class="hex">${sub}</div>
  </div>`;

const chips = data.swatches
  .map((s, i) => cell(s.css, `${i + 1}. ${s.label}`, s.paint.base, i === 20))
  .join('');

const customs = data.customs
  .map((c) => cell(c.faces, `typed ${c.hex}`, `painted ${c.faces.base}`, false))
  .join('');

const card = (faces, title) => `
  <div class="nb-callout" style="--co-light:${faces.light};--co-base:${faces.base};--co-deep:${faces.deep}">
    <div class="body"><b>${title}</b> — the quick brown fox jumps over the lazy dog, twice over.</div>
  </div>`;

const callouts =
  [...data.swatches.slice(0, 6), ...data.swatches.slice(20)]
    .map((s) => card(s.css, s.label))
    .join('') + data.customs.slice(0, 4).map((c) => card(c.faces, `custom ${c.hex}`)).join('');

const html = `<!doctype html><html${theme ? ` data-theme="${theme}"` : ''}><meta charset="utf-8"><style>
${tokens}
${settings}
${calloutCss}
body { margin:0; padding:24px; background:var(--wall); font-family:"Nunito Sans",system-ui,sans-serif; }
h2 { font:600 15px/1.3 "Nunito Sans",system-ui; color:var(--ink-line); margin:24px 0 10px; }
.grid { display:grid; grid-template-columns:repeat(8,1fr); gap:12px; }
.cell.fold .stack { outline:2px dashed var(--accent-deep); outline-offset:3px }
.stack { display:flex; height:62px; border:2px solid var(--ink-line);
  border-radius:10px 13px 9px 14px/13px 9px 14px 10px; overflow:hidden }
.f { flex:1 }
.lbl { font:600 11px/1.4 "Nunito Sans"; color:var(--ink-line); margin-top:5px }
.hex { font:500 10px/1.3 ui-monospace,monospace; color:var(--ink-sepia-soft) }
.callouts { display:grid; grid-template-columns:repeat(2,1fr); gap:10px; max-width:1200px }
.nb-callout .body { font:400 16px/1.5 system-ui; color:var(--ink-sepia) }
</style>
<h2>The pigment shelf — 24 swatches, light / base / deep. Dashed = where the picker folds to "more".</h2>
<div class="grid">${chips}</div>
<h2>A colour the reader typed, pulled into the band</h2>
<div class="grid">${customs}</div>
<h2>Real callouts: the six that existed, the four neutrals, four custom colours</h2>
<div class="callouts">${callouts}</div>
</html>`;

writeFileSync(out.replace(/\.png$/, '.html'), html);

const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 1400 }, deviceScaleFactor: 2 });
await p.setContent(html, { waitUntil: 'load' });
await p.waitForTimeout(400);
await p.screenshot({ path: out, fullPage: true });
console.log(`done -> ${out}`);
await b.close();
