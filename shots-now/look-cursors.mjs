/**
 * shots-now/look-cursors.mjs — every cursor set × every state at the size it
 * is actually shipped (32 CSS px, 40 for Bold), on BOTH grounds it has to
 * survive: cream paper and dark timber.
 *
 * `art/cursors.ts` claims "a cursor is judged at 32px". This renders exactly
 * that, plus a ×4 nearest blow-up of the same pixels so the ink outline can be
 * inspected without redrawing it larger.
 *
 * Usage: node shots-now/look-cursors.mjs --url=http://[::1]:1420
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const URL_BASE = opt('url', 'http://[::1]:1420');
const OUT = 'shots-now/roster';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 1200 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => import('/src/art/cursors.ts').then(() => true, () => false),
  null,
  { polling: 300 },
);

const report = await page.evaluate(async () => {
  const cur = await import('/src/art/cursors.ts');
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;font:11px "Nunito Sans",system-ui,sans-serif;';

  const sets = cur.CURSOR_SET_IDS;
  const roles = cur.CURSOR_ROLES;

  const build = (ground, label, magnify) => {
    const wrap = document.createElement('div');
    wrap.style.cssText =
      `background:${ground};padding:14px;width:max-content;color:${
        ground === '#f7f1e3' ? '#3a2416' : '#f0e6d2'
      };`;
    const head = document.createElement('div');
    head.textContent = label;
    head.style.cssText = 'font-weight:700;margin-bottom:8px;';
    wrap.append(head);
    for (const s of sets) {
      if (s === 'system') continue;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';
      const name = document.createElement('div');
      name.textContent = cur.CURSOR_SETS[s].label ?? s;
      name.style.cssText = 'width:96px;flex:0 0 96px;';
      row.append(name);
      for (const r of roles) {
        const img = cur.cursorImage(s, r);
        const box = document.createElement('div');
        const px = magnify ? img.size * 4 : img.size;
        box.style.cssText =
          `width:${px}px;height:${px}px;background-image:url("${img.url}");` +
          `background-size:${px}px ${px}px;background-repeat:no-repeat;` +
          `image-rendering:pixelated;flex:0 0 ${px}px;`;
        row.append(box);
      }
      wrap.append(row);
    }
    const foot = document.createElement('div');
    foot.textContent = roles.join('  ·  ');
    foot.style.cssText = 'margin-top:6px;opacity:.7;';
    wrap.append(foot);
    return wrap;
  };

  const a = build('#f7f1e3', 'cream paper #f7f1e3 — shipped size', false);
  a.id = 'cream';
  const b = build('#7d5638', 'dark timber #7d5638 (FLAT.recess) — shipped size', false);
  b.id = 'dark';
  const c = build('#f7f1e3', 'cream — same pixels ×4 nearest', true);
  c.id = 'cream-mag';
  const d = build('#7d5638', 'dark timber — same pixels ×4 nearest', true);
  d.id = 'dark-mag';
  document.body.append(a, b, c, d);

  // How many of the 14 states are actually different pictures, per set?
  const perSet = {};
  for (const s of sets) {
    const seen = new Map();
    for (const r of roles) {
      const im = cur.cursorImage(s, r);
      if (im === null) continue;
      const uri = im.url;
      seen.set(uri, [...(seen.get(uri) ?? []), r]);
    }
    perSet[s] = {
      distinct: seen.size,
      dupes: [...seen.values()].filter((g) => g.length > 1).map((g) => g.join('==')),
    };
  }
  // And across sets: is a given role actually different set to set?
  const perRole = {};
  for (const r of roles) {
    const seen = new Map();
    for (const s of sets) {
      const im = cur.cursorImage(s, r);
      if (im === null) continue;
      const uri = im.url;
      seen.set(uri, [...(seen.get(uri) ?? []), s]);
    }
    perRole[r] = {
      distinct: seen.size,
      dupes: [...seen.values()].filter((g) => g.length > 1).map((g) => g.join('==')),
    };
  }
  return { sets: [...sets], roles: [...roles], perSet, perRole };
});

for (const id of ['cream', 'dark', 'cream-mag', 'dark-mag']) {
  await page.locator(`#${id}`).screenshot({ path: `${OUT}/cursors-${id}.png` });
}
console.log(JSON.stringify(report, null, 2));
await browser.close();
