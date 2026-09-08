import { chromium } from 'playwright';

const realSize = process.argv.includes('--real-size');
const longTitle = process.argv.includes('--long-title');
const coverWidth = realSize ? 180 : 250;
const coverHeight = realSize ? 250 : 350;
const columns = realSize ? 6 : 5;
const boardWidth = realSize ? 1190 : 1390;
const out = realSize
  ? `shots-now/out/title-artwork-remaster-real-size${longTitle ? '-long' : ''}.png`
  : 'shots-now/out/title-artwork-remaster.png';
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
page.on('pageerror', (error) => console.error('[pageerror]', error.message));
page.on('console', (message) => {
  if (message.type() === 'error') console.error('[console]', message.text());
});
await page.goto('http://127.0.0.1:1420', { waitUntil: 'domcontentloaded' });
await page.setContent(`
  <style>
    @font-face { font-family: Patrick; src: url('/node_modules/@fontsource/patrick-hand/files/patrick-hand-latin-400-normal.woff2'); }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 34px; background: #eadbbf; color: #432934; font-family: Patrick, Georgia, serif; }
    header { width: ${boardWidth}px; margin: 0 auto 24px; border-bottom: 2px solid #432934; padding: 0 2px 16px; }
    h1 { font: 38px Patrick, Georgia, serif; margin: 0 0 4px; }
    p { margin: 0; font: 16px Georgia, serif; }
    main { width: ${boardWidth}px; margin: auto; display: grid; grid-template-columns: repeat(${columns}, 1fr); gap: 22px 18px; }
    article { min-width: 0; }
    canvas { display: block; width: ${coverWidth}px; height: ${coverHeight}px; }
    h2 { margin: 9px 0 2px; font-size: 18px; font-weight: 400; line-height: 1.05; }
    code { font: 11px Consolas, monospace; opacity: .72; }
  </style>
  <header><h1>Alcove · remastered title furniture</h1><p>26 persisted treatments · one authored vector master per identity · safe live-title fitting shown</p></header>
  <main id="board"></main>
`);
await page.evaluate(async ({ coverWidth, coverHeight, longTitle }) => {
  const art = await import('/src/art/bookTitleArtwork.ts');
  const covers = ['#86583f', '#3f6262', '#77434d', '#4f5a39', '#34556d', '#9a7138'];
  const board = document.querySelector('#board');
  for (let index = 0; index < art.REMASTERED_TITLE_IDS.length; index += 1) {
    const id = art.REMASTERED_TITLE_IDS[index];
    const layout = art.REMASTERED_TITLE_LAYOUTS[id];
    const article = document.createElement('article');
    const canvas = document.createElement('canvas');
    canvas.width = coverWidth * 2;
    canvas.height = coverHeight * 2;
    const ctx = canvas.getContext('2d');
    const face = covers[index % covers.length];
    const scaleX = coverWidth / 250;
    const scaleY = coverHeight / 350;
    ctx.scale(2 * scaleX, 2 * scaleY);
    ctx.fillStyle = '#d6c3a0';
    ctx.beginPath();
    ctx.roundRect(8, 8, 238, 338, 5);
    ctx.fill();
    ctx.fillStyle = '#432934';
    ctx.beginPath();
    ctx.roundRect(4, 4, 238, 338, 5);
    ctx.fill();
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.roundRect(7, 4, 235, 335, 4);
    ctx.fill();
    ctx.strokeStyle = '#2f2430';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.roundRect(7.5, 4.5, 234, 334, 4);
    ctx.stroke();
    ctx.strokeStyle = '#c5a465';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.roundRect(18, 16, 212, 310, 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(23, 21, 202, 300, 2);
    ctx.stroke();

    const b = layout.coverBox;
    const ax = 7 + b.x * 235;
    const ay = 4 + b.y * 335;
    const aw = b.width * 235;
    const ah = b.height * 335;
    const groundByStyle = {
      'laid-paper-ticket': '#f2e6ce', 'deckled-paper-ticket': '#f2e6ce',
      'vellum-rule-ticket': '#ead9b9', 'parchment-slip': '#d2b98e',
      'morocco-single-rule': '#4b2934', 'morocco-double-rule': '#4b2934',
      'morocco-clipped-rule': '#4b2934', 'calf-blind-label': '#a86843',
      'two-tone-leather-label': '#392733', 'library-buckram-label': '#3c5868',
      'dyed-leather-crossband': '#4b2934', 'gilt-ruled-crossband': '#30252d',
      'cloth-inlay-crossband': '#425b56', 'split-leather-crossband': '#a86843',
      'renaissance-title-window': '#f2e6ce',
    };
    art.paintRemasteredTitle(ctx, ax, ay, aw, ah, id, {
      ground: groundByStyle[id] ?? face, ink: '#432934', tooling: '#d8b762',
    });

    if (id !== 'none') {
      const t = layout.textRect;
      const tx = ax + t.x * aw;
      const ty = ay + t.y * ah;
      const tw = t.width * aw;
      const th = t.height * ah;
      const vertical = layout.orientation !== 'horizontal';
      const title = vertical ? 'FIELD NOTES' : (longTitle ? 'THE\nCOLLECTED\nNOTES' : 'FIELD\nNOTES');
      const darkGround = new Set([
        'morocco-single-rule', 'morocco-double-rule', 'morocco-clipped-rule',
        'two-tone-leather-label', 'library-buckram-label', 'dyed-leather-crossband', 'gilt-ruled-crossband',
        'cloth-inlay-crossband',
      ]).has(id);
      ctx.save();
      ctx.fillStyle = darkGround ? '#f2e6ce' : (id.includes('gilt') || id.includes('french') || id.includes('cambridge') || id.includes('inscription') ? '#d8b762' : '#432934');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const minimumVirtualPx = layout.minFontPx / scaleY;
      ctx.font = `${Math.max(minimumVirtualPx, Math.min(vertical ? tw * 0.42 : th * 0.35, 18) * layout.typeScale)}px Patrick, Georgia, serif`;
      if (vertical) {
        ctx.translate(tx + tw / 2, ty + th / 2);
        ctx.rotate(layout.orientation === 'vertical-clockwise' ? Math.PI / 2 : -Math.PI / 2);
        const limit = th * 0.9;
        let size = Math.max(minimumVirtualPx, Math.min(tw * 0.42, 17) * layout.typeScale);
        ctx.font = `${size}px Patrick, Georgia, serif`;
        while (ctx.measureText(title).width > limit && size > minimumVirtualPx) {
          size -= 0.5;
          ctx.font = `${size}px Patrick, Georgia, serif`;
        }
        ctx.fillText(title, 0, 0);
      } else {
        const lines = title.split('\n');
        const line = Math.max(minimumVirtualPx, Math.min(19, th * (lines.length === 3 ? 0.24 : 0.34)) * layout.typeScale);
        ctx.font = `${line}px Patrick, Georgia, serif`;
        const leading = Math.max(line * 1.06, th / (lines.length + 0.7));
        const firstY = ty + th / 2 - leading * (lines.length - 1) / 2;
        lines.forEach((value, lineIndex) => ctx.fillText(value, tx + tw / 2, firstY + lineIndex * leading, tw));
      }
      ctx.restore();
    }

    article.append(canvas);
    const heading = document.createElement('h2');
    heading.textContent = art.REMASTERED_TITLE_LABELS[id];
    article.append(heading);
    const code = document.createElement('code');
    code.textContent = id;
    article.append(code);
    board.append(article);
  }
}, { coverWidth, coverHeight, longTitle });
await page.locator('main article').last().waitFor();
await page.screenshot({ path: out, fullPage: true, timeout: 120_000, animations: 'disabled' });
for (const [index, name] of [[7, 'vertical-paper'], [9, 'vertical-parchment'], [12, 'lozenge'], [13, 'oval'], [18, 'vertical-inlay'], [24, 'lobed'], [25, 'quadrilobe']]) {
  await page.locator('article').nth(index).screenshot({
    path: `shots-now/out/title-artwork-remaster-${realSize ? 'real-' : ''}${name}.png`,
    timeout: 30_000,
    animations: 'disabled',
  });
}
console.log(out);
await browser.close();
