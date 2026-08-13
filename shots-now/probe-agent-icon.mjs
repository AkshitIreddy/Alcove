/**
 * Render the shipped AgentIcon at every size where the product uses it.
 *
 * The SVG is extracted from icons.tsx itself. This is intentionally not a
 * second drawing: if the component changes, the specimen changes with it.
 * Output: qa/visual/report/agent-icon-specimen.png
 */
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE = resolve(ROOT, 'src/views/rail/icons.tsx');
const OUTPUT = resolve(ROOT, 'qa/visual/report/agent-icon-specimen.png');

const source = await readFile(SOURCE, 'utf8');
const agentSource = source.match(
  /export function AgentIcon\(\): JSX\.Element \{([\s\S]*?)\n\}\n\n\/\*\*/,
)?.[1];
if (!agentSource) throw new Error('AgentIcon source boundary was not found');

const attr = (sourceText, name) =>
  sourceText.match(new RegExp(`${name}="([^"]+)"`))?.[1];
const pathMarkup = [...agentSource.matchAll(/<path([\s\S]*?)\/>/g)].map((match) => {
  const attributes = match[1];
  const d = attr(attributes, 'd');
  if (!d) throw new Error('AgentIcon contains a path without static path data');
  return [
    `<path d="${d}"`,
    `data-part="${attr(attributes, 'data-part') ?? 'detail'}"`,
    `fill="${attr(attributes, 'fill') ?? 'none'}"`,
    `stroke="currentColor"`,
    `stroke-width="${attr(attributes, 'stroke-width') ?? '1.8'}"`,
    `stroke-linecap="round" stroke-linejoin="round"`,
    attr(attributes, 'fill-opacity')
      ? `fill-opacity="${attr(attributes, 'fill-opacity')}"`
      : '',
    '/>',
  ].filter(Boolean).join(' ');
}).join('');

if (pathMarkup.match(/<path/g)?.length !== 5) {
  throw new Error('AgentIcon specimen expects five authored path layers');
}

const svg = (className = '') =>
  `<svg class="agent ${className}" viewBox="0 0 24 24" aria-hidden="true">${pathMarkup}</svg>`;

const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    background: #d8c7aa;
    color: #49372e;
    font-family: "Nunito Sans", system-ui, sans-serif;
  }
  main {
    width: 1100px;
    padding: 38px 42px 42px;
    background: #f5ecd9;
    border: 2px solid #49372e;
    border-radius: 28px 24px 30px 25px;
    box-shadow: 10px 12px 0 #b29a76;
  }
  h1 { margin: 0 0 6px; font: 700 28px/1.1 Georgia, serif; }
  .dek { margin: 0 0 28px; color: #745f50; font-size: 14px; }
  .grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; align-items: stretch; }
  .card {
    min-width: 0;
    min-height: 250px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 17px;
    padding: 22px 12px 18px;
    background: #fffaf0;
    border: 1.5px solid #705b49;
    border-radius: 16px 19px 15px 18px;
  }
  .context { min-height: 90px; display: grid; place-items: center; }
  .agent { display: block; overflow: visible; }
  .rail {
    width: 40px; height: 40px; display: grid; place-items: center;
    color: #5d493a; background: #efe3ca; border: 1.5px solid #6e5847;
    border-radius: 10px 12px 9px 11px; transform: rotate(-.7deg);
  }
  .rail .agent { width: 24px; height: 24px; }
  .header {
    width: 34px; height: 34px; display: grid; place-items: center;
    color: #634937; background: #f4dfac; border: 1.5px solid #634937;
    border-radius: 12px 15px 11px 14px; transform: rotate(-1.4deg);
  }
  .header .agent { width: 23px; height: 23px; }
  .empty {
    position: relative; width: 86px; height: 74px; display: grid; place-items: center;
    color: #634937; background: #f4dfac; border: 2px solid #634937;
    border-radius: 24px 31px 22px 29px; transform: rotate(-1.4deg);
    box-shadow: 4px 5px 0 #dfc99b;
  }
  .empty .agent { width: 56px; height: 56px; }
  .empty::after {
    content: "✦"; position: absolute; right: -13px; top: -13px;
    width: 33px; height: 33px; display: grid; place-items: center;
    color: #a76526; background: #fffaf0; border: 1.5px solid #634937;
    border-radius: 50%; font-size: 19px;
  }
  .connect {
    display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px;
    color: #fffaf0; background: #50704a; border: 2px solid #3e322b;
    border-radius: 11px 15px 12px 14px; font-size: 12px; font-weight: 700;
  }
  .connect .agent { width: 22px; height: 22px; flex: 0 0 auto; }
  .selection {
    display: flex; gap: 5px; padding: 7px;
    color: #574439; background: #fffaf0; border: 1.5px solid #574439;
    border-radius: 12px 15px 11px 14px; box-shadow: 3px 4px 0 #decfb4;
  }
  .selection span { width: 30px; height: 30px; display: grid; place-items: center; background: #f5e9d2; border-radius: 8px; }
  .selection .agent { width: 21px; height: 21px; }
  .label { text-align: center; }
  .label strong { display: block; font: 700 16px/1.2 Georgia, serif; }
  .label span { color: #7a6555; font-size: 12px; }
</style>
<body>
  <main>
    <h1>Agent toy-robot mark — shipped-size specimen</h1>
    <p class="dek">The same five-path SVG rendered in each actual product context; no enlargement-only judgement.</p>
    <div class="grid">
      <section class="card"><div class="context"><div class="rail">${svg()}</div></div><div class="label"><strong>Book rail</strong><span>24px · warm paper</span></div></section>
      <section class="card"><div class="context"><div class="header">${svg()}</div></div><div class="label"><strong>Agent header</strong><span>23px · amber mark</span></div></section>
      <section class="card"><div class="context"><div class="empty">${svg()}</div></div><div class="label"><strong>Empty state</strong><span>56px · hero scale</span></div></section>
      <section class="card"><div class="context"><div class="connect">${svg()}<span>Connect Cohere</span></div></div><div class="label"><strong>Connect action</strong><span>22px · reversed ink</span></div></section>
      <section class="card"><div class="context"><div class="selection"><span>B</span><span><i>I</i></span><span>${svg()}</span></div></div><div class="label"><strong>Selection tool</strong><span>21px · compact chrome</span></div></section>
    </div>
  </main>
</body>
</html>`;

await mkdir(resolve(ROOT, 'qa/visual/report'), { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 660 },
    deviceScaleFactor: 1.5,
  });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: OUTPUT });
  const report = await page.locator('.agent').evaluateAll((icons) => icons.map((icon) => ({
    width: Math.round(icon.getBoundingClientRect().width),
    height: Math.round(icon.getBoundingClientRect().height),
    parts: icon.querySelectorAll('path').length,
    clipped: icon.getBoundingClientRect().left < 0 || icon.getBoundingClientRect().top < 0,
  })));
  if (report.some((item) => item.parts !== 5 || item.clipped)) {
    throw new Error(`invalid rendered icon specimen: ${JSON.stringify(report)}`);
  }
  console.log(JSON.stringify({ output: OUTPUT, icons: report }, null, 2));
} finally {
  await browser.close();
}
