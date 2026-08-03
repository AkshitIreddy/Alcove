/**
 * shots-now/binding-surface-board.mjs — the fifty COVERINGS and the fifty
 * ORNAMENTS at the size a reader actually meets them.
 *
 * The silhouettes have their own board (`shape-board.mjs`). This one holds the
 * shape still — one plain flat spine, one cloth — and varies only what is drawn
 * ON it, because that is the axis that has to survive 20–45 world px.
 *
 * Four boards:
 *   materials-shelf.png   every covering at 30px wide, shoulder to shoulder.
 *   materials-detail.png  the same pixels ×3 nearest-neighbour, captioned, and
 *                         each cell drawn at 22 / 30 / 42 px so the floor rules
 *                         are visible (a covering that only works at 42 is a
 *                         covering most readers never see).
 *   decorations-shelf.png / decorations-detail.png — the same for the ornaments.
 *
 * Usage: node shots-now/binding-surface-board.mjs [--tag=before] [--url=…]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const TAG = opt('tag', 'now');

mkdirSync('shots-now/out', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });

await page.evaluate(async () => {
  const bd = await import('/src/art/bookDesign.ts');
  const flat = await import('/src/art/flat.ts');

  const H = 190;
  const PAD = 10;
  const base = bd.resolveBookDesign({ seed: 0x51e5, cloth: 0, accent: 22 });

  /** One spine at one width, on its own canvas, nothing but the axis varying. */
  function draw(w, over) {
    const c = document.createElement('canvas');
    c.width = w + PAD * 2;
    c.height = H + PAD * 2;
    const ctx = c.getContext('2d');
    const design = {
      ...base,
      shape: 'flat',
      material: 'smooth-cloth',
      decorations: ['plain'],
      bands: 0,
      headTail: null,
      ...over,
    };
    bd.drawBookSpine(ctx, PAD, PAD, w, H, design, { ownLabel: true, noContact: true });
    return c;
  }

  const ground = flat.FLAT?.recess ?? '#e9e2d0';
  document.body.innerHTML = '';
  document.body.style.cssText = `margin:0;background:${ground};`;

  const boards = [
    { key: 'materials', ids: bd.MATERIAL_LOOKS, specs: bd.MATERIALS, over: (id) => ({ material: id }) },
    { key: 'decorations', ids: bd.DECORATIONS, specs: bd.DECORS, over: (id) => ({ decorations: [id] }) },
  ];

  for (const b of boards) {
    /* --- board 1: shoulder to shoulder, one to one --- */
    const shelf = document.createElement('div');
    shelf.id = `${b.key}-shelf`;
    shelf.style.cssText =
      `display:flex;align-items:flex-end;gap:0px;padding:16px 12px;background:${ground};width:max-content;`;
    for (const id of b.ids) shelf.append(draw(30, b.over(id)));
    document.body.append(shelf);

    /* --- board 2: same pixels ×3, three widths, captioned --- */
    const detail = document.createElement('div');
    detail.id = `${b.key}-detail`;
    detail.style.cssText =
      `display:grid;grid-template-columns:repeat(10,1fr);gap:6px 4px;padding:14px;background:${ground};` +
      'width:max-content;font:11px "Nunito Sans",system-ui,sans-serif;color:#3a2416;';
    for (const id of b.ids) {
      const spec = b.specs[id];
      const cell = document.createElement('div');
      cell.style.cssText = 'text-align:center;';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:flex-end;justify-content:center;gap:1px;';
      for (const w of [22, 30, 42]) {
        const c = draw(w, b.over(id));
        c.style.cssText = `width:${c.width * 2.2}px;height:${c.height * 2.2}px;image-rendering:pixelated;`;
        row.append(c);
      }
      const cap = document.createElement('div');
      cap.textContent = id;
      cap.style.cssText =
        'margin-top:2px;line-height:1.15;' +
        (spec[id]?.tier === 'oddity' || spec?.[id]?.tier === 'oddity'
          ? 'text-decoration:line-through;opacity:.55;'
          : '');
      cell.append(row, cap);
      detail.append(cell);
    }
    document.body.append(detail);
  }
});

await page.waitForTimeout(900);
for (const key of ['materials', 'decorations']) {
  for (const kind of ['shelf', 'detail']) {
    const path = `shots-now/out/${key}-${kind}-${TAG}.png`;
    await page.locator(`#${key}-${kind}`).screenshot({ path });
    console.log('  shot', path);
  }
}
await browser.close();
