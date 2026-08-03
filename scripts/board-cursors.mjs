/**
 * Specimen board for art/cursors.ts, drawn through the dev server so the board
 * reads the SAME module the app does.
 *
 *   node board-cursors.mjs [--url=http://localhost:1420] [--out=<dir>]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const OUT = opt('out', 'qa/ui');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1500, height: 1000 },
  deviceScaleFactor: 2,
});
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.split('\n')[0]));

await page.goto(`${URL_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });

const build = async (mode) => {
  return page.evaluate(async (mode) => {
    const m = await import('/src/art/cursors.ts');
    document.head.querySelectorAll('style[data-board]').forEach((n) => n.remove());
    const style = document.createElement('style');
    style.dataset.board = '1';
    style.textContent = `
      html, body { margin:0; padding:0; background:#efe7d4; }
      #board { font: 11px 'Nunito Sans', system-ui, sans-serif; color:#4f3120; padding:14px 16px; }
      .row { display:flex; align-items:center; gap:0; margin-bottom:2px; }
      .setname { width:96px; font-weight:700; font-size:12px; }
      .cell { width:52px; text-align:center; }
      .grounds { display:flex; flex-direction:column; }
      .g { height:40px; display:flex; align-items:center; justify-content:center; }
      .cream { background:#f7f1e3; }
      .timber { background:#c08a52; }
      .recess { background:#7d5638; }
      .head { display:flex; margin-bottom:6px; }
      .head .cell { font-size:9px; letter-spacing:.02em; }
      h2 { font: 700 15px 'Nunito Sans', system-ui, sans-serif; margin: 14px 0 8px; }
      .big { display:flex; flex-wrap:wrap; gap:10px; }
      .bigcell { text-align:center; }
      .bigcell .cap { font-size:10px; margin-top:2px; }
      .stack { position:relative; }
      .stack img { display:block; image-rendering:auto; }
      .cross { position:absolute; pointer-events:none; }
    `;
    document.head.append(style);
    document.body.innerHTML = '<div id="board"></div>';
    const board = document.getElementById('board');
    const el = (tag, cls, html) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (html !== undefined) n.innerHTML = html;
      return n;
    };

    const sets = m.CURSOR_SET_IDS.filter((s) => s !== 'system');
    const roles = m.CURSOR_ROLES;

    if (mode === 'actual') {
      const head = el('div', 'head');
      head.append(el('div', 'setname', ''));
      for (const r of roles) head.append(el('div', 'cell', r.replace('-resize', '')));
      board.append(head);
      for (const set of sets) {
        const row = el('div', 'row');
        row.append(el('div', 'setname', m.CURSOR_SETS[set].name));
        for (const role of roles) {
          const img = m.cursorImage(set, role);
          const cell = el('div', 'cell');
          const grounds = el('div', 'grounds');
          for (const g of ['cream', 'timber', 'recess']) {
            const box = el('div', `g ${g}`);
            const i = document.createElement('img');
            i.src = img.url;
            i.width = img.size;
            i.height = img.size;
            box.append(i);
            grounds.append(box);
          }
          cell.append(grounds);
          row.append(cell);
        }
        board.append(row);
      }
      return document.getElementById('board').getBoundingClientRect().height;
    }

    // magnified, with a hotspot crosshair
    const SCALE = 6;
    for (const set of (mode === 'big' ? sets : [mode])) {
      board.append(el('h2', null, `${m.CURSOR_SETS[set].name} — ${m.CURSOR_SETS[set].blurb}`));
      const wrap = el('div', 'big');
      for (const role of roles) {
        const img = m.cursorImage(set, role);
        const cell = el('div', 'bigcell');
        const stack = el('div', 'stack');
        stack.style.width = `${img.size * SCALE}px`;
        stack.style.height = `${img.size * SCALE}px`;
        stack.style.background =
          'linear-gradient(90deg,#f7f1e3 0 50%,#7d5638 50% 100%)';
        const i = document.createElement('img');
        i.src = img.url;
        i.width = img.size * SCALE;
        i.height = img.size * SCALE;
        stack.append(i);
        const cross = el('div', 'cross');
        cross.style.left = `${img.hotspot[0] * SCALE - 7}px`;
        cross.style.top = `${img.hotspot[1] * SCALE - 7}px`;
        cross.innerHTML =
          `<svg width="14" height="14"><path d="M7 0V14M0 7H14" stroke="#e01b24" stroke-width="1.4"/><circle cx="7" cy="7" r="2.6" fill="none" stroke="#e01b24" stroke-width="1.4"/></svg>`;
        stack.append(cross);
        cell.append(stack);
        cell.append(el('div', 'cap', `${role} · ${img.hotspot[0]},${img.hotspot[1]}`));
        wrap.append(cell);
      }
      board.append(wrap);
    }
    return document.getElementById('board').getBoundingClientRect().height;
  }, mode);
};

const h1 = await build('actual');
await page.setViewportSize({ width: 1500, height: Math.ceil(h1) + 40 });
await page.screenshot({ path: `${OUT}/cursors-actual.png` });
console.log('actual size board ->', `${OUT}/cursors-actual.png`);

for (const set of ['paper', 'gilt', 'quill', 'pencil', 'botanical', 'bold']) {
  const h = await build(set);
  await page.setViewportSize({ width: 1500, height: Math.ceil(h) + 40 });
  await page.screenshot({ path: `${OUT}/big-${set}.png` });
  console.log('magnified ->', `${OUT}/big-${set}.png`, Math.ceil(h));
}

await browser.close();
