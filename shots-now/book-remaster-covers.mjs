/** Production covers, with every title, frame and lettering option applied. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const out = 'shots-now/out/book-remaster';
const longTitles = process.argv.includes('--long');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
await page.routeWebSocket('**', ws => ws.close());
await page.goto('http://127.0.0.1:1420/?fx=force');
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {timeout:120000});
const sheets = await page.evaluate(async (longTitles) => {
  const [c, sp, t] = await Promise.all([import('/src/art/covers.ts'), import('/src/art/spines.ts'), import('/src/art/bookTitleArtwork.ts')]);
  await c.preloadCoverArtwork();
  await Promise.all(['600 26px "Caveat Variable"', '400 18px "Patrick Hand"', '400 18px "Kalam"', '400 18px "Architects Daughter"', '500 16px "Nunito Sans"'].map(f => document.fonts.load(f)));
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;padding:20px;background:#e8dfcf;color:#432934;font:14px "Nunito Sans"';
  const categories = [
    ['titles', sp.ACTIVE_TITLE_PLATES.map(id => ({ label: t.REMASTERED_TITLE_LABELS[id], patch: { titlePlate: id } }))],
    ['frames', c.ACTIVE_COVER_FRAMES.map((f, i) => ({ label: f.label, patch: { frame: c.ACTIVE_COVER_FRAME_INDICES[i] } }))],
    ['lettering', c.ACTIVE_COVER_HANDS.map((label, i) => ({ label: label.label, patch: { titleFont: c.ACTIVE_COVER_HAND_INDICES[i] } }))],
  ];
  const ids = [];
  for (const [category, options] of categories) {
    for (let start = 0; start < options.length; start += 10) {
      const sheet = document.createElement('main'); sheet.id = `${category}-${start / 10 + 1}`; ids.push(sheet.id);
      sheet.style.cssText = 'display:grid;grid-template-columns:repeat(5,235px);gap:14px;padding:12px;background:#e8dfcf;margin-bottom:24px';
      document.body.append(sheet);
      for (let i = start; i < Math.min(start + 10, options.length); i++) {
        const card = document.createElement('section'); card.style.cssText = 'padding:12px;background:#faf4e8;border:1px solid #c4b393';
        const label = document.createElement('p'); label.textContent = `${i + 1}. ${options[i].label}`; label.style.cssText = 'height:35px;margin:0 0 8px;font-size:13px'; card.append(label);
        const params = { seed: 317, palette: 18, texture: 0, material: 'smooth-cloth', frame: 2, medallion: 71, titleFont: 0, gilt: true, titlePlate: 'direct-gilt-title', coverBaseHex: '#3f6262', coverAccentHex: '#284546', toolingHex: '#dbc58b', edge: 'plain', ...options[i].patch };
        card.append(c.renderCover(205, 285, params, longTitles ? 'A Quiet Ledger of Small Histories' : 'Field Notes'));
        sheet.append(card);
      }
    }
  }
  return ids;
}, longTitles);
for (const id of sheets) await page.locator(`#${id}`).screenshot({ path: `${out}/${id}${longTitles ? '-long' : ''}.png` });
console.log(sheets.join(', '));
await browser.close();
