/** Small visual studies after the owner rejected the first remaster. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1120, height: 960 }, deviceScaleFactor: 1.5 });
await page.goto('http://127.0.0.1:1420');
await page.evaluate(async () => {
  await Promise.all(['600 26px "Caveat Variable"', '400 22px "Patrick Hand"', '600 18px "Nunito Sans"'].map(f => document.fonts.load(f)));
  const ink = '#503527';
  const leaf = `<path d="M0 20 Q1 2 13 -13 M3 9 Q-11 5 -9 -4 Q3 -2 3 9 M8 -1 Q6 -13 15 -17 Q19 -6 8 -1 M0 16 Q10 18 16 10 Q9 5 0 16" fill="currentColor" stroke="none"/>`;
  const flower = `<path d="M0 14 L0 26 M0 19 Q-9 18 -11 12 Q-3 10 0 19 M0 16 Q8 10 12 13 Q9 20 0 21" fill="currentColor"/><path d="M0 2 C-14 -10 -18 4 -8 9 C-14 20 1 25 3 13 C15 24 23 10 12 5 C21 -6 7 -14 3 -2 C0 -12 -9 -9 0 2Z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="3" cy="7" r="2" fill="currentColor"/>`;
  const books = [
    { name: 'Plain Cloth', face: '#667561', spine: '#465a48', foil: '#eee0b5', title: ['FIELD', 'NOTES'], hand: 'print', mark: leaf },
    { name: 'Library Buckram', face: '#3b5663', spine: '#2c414e', foil: '#e8d4a0', title: ['The Lantern', 'Atlas'], hand: 'label', mark: leaf },
    { name: 'Half Calf', face: '#855862', spine: '#684738', foil: '#efdaa8', title: ['Small', 'Histories'], hand: 'hand', mark: flower },
  ];
  const svg = (b, decorative) => `<svg viewBox="0 0 220 310" width="220" height="310" xmlns="http://www.w3.org/2000/svg">
    <path d="M28 20 H201 Q208 20 208 27 V287 Q208 291 201 291 H28Z" fill="#f2e8d4" stroke="${ink}" stroke-width="1.8"/>
    <path d="M203 34 V278 M200 44 V274" fill="none" stroke="#c7bba4" stroke-width=".8"/>
    <path d="M22 16 Q102 14 196 17 Q201 17 201 22 V286 Q201 292 195 292 L22 293Z" fill="${b.face}" stroke="${ink}" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M22 16 Q14 18 14 25 V285 Q14 292 22 293 H37 Q32 289 32 283 V26 Q32 20 37 16Z" fill="${b.spine}" stroke="${ink}" stroke-width="1.7"/>
    <path d="M29 28 V281" fill="none" stroke="${ink}" stroke-width=".75"/>
    <path d="M17 50 H29 M17 254 H29" fill="none" stroke="${b.foil}" stroke-width="1.4"/>
    ${b.name === 'Half Calf' ? `<path d="M176 17 H196 Q201 17 201 22 V48Z M201 261 V286 Q201 292 195 292 H176Z" fill="${b.spine}" stroke="${ink}" stroke-width="1.2"/>` : ''}
    ${decorative ? `<path d="M50 37 H181 V269 H50Z" fill="none" stroke="${b.foil}" stroke-width="1"/><path d="M56 43 H175 V263 H56Z" fill="none" stroke="${b.foil}" stroke-width=".55"/><path d="M50 48 Q61 48 61 37 M170 37 Q170 48 181 48 M50 258 Q61 258 61 269 M170 269 Q170 258 181 258" fill="none" stroke="${b.foil}" stroke-width="1.1"/>` : `<path d="M54 245 H178" fill="none" stroke="${b.foil}" stroke-width=".65"/>`}
    ${b.hand === 'label' ? `<path d="M59 71 Q115 70 175 71 L175 140 Q115 141 59 140Z" fill="#eee4cd" stroke="${ink}" stroke-width="1.2"/><path d="M65 77 H169 V134 H65Z" fill="none" stroke="#b9a985" stroke-width=".6"/>` : ''}
    <g fill="${b.hand === 'label' ? ink : b.foil}" text-anchor="middle" font-family="${b.hand === 'print' ? 'Nunito Sans' : b.hand === 'label' ? 'Patrick Hand' : 'Caveat Variable'}" font-size="${b.hand === 'print' ? 19 : b.hand === 'label' ? 22 : 29}" font-weight="${b.hand === 'label' ? 400 : 600}" letter-spacing="${b.hand === 'print' ? 2.1 : 0}">
      <text x="117" y="99">${b.title[0]}</text><text x="117" y="${b.hand === 'hand' ? 129 : 124}">${b.title[1]}</text>
    </g>
    <g transform="translate(111 194) scale(${decorative ? 1 : .76})" color="${b.foil}">${b.mark}</g>
  </svg>`;
  document.body.innerHTML = `<style>*{box-sizing:border-box}body{margin:0;background:#e9e3d7;color:#503527;font-family:'Nunito Sans';padding:24px}main{width:1010px;margin:auto}section{display:grid;grid-template-columns:210px repeat(3,240px);gap:20px;align-items:center;padding:22px 0;border-bottom:1px solid #c6baa4}h1{font:600 30px 'Caveat Variable';margin:0 0 9px}h2{font-size:17px;font-weight:600;margin:0 0 10px}p{font-size:13px;line-height:1.6;max-width:180px}figure{margin:0;text-align:center}figcaption{font-size:12px;margin-top:8px}</style><main id="studies"><h1>Book artwork · simpler construction studies</h1><section><header><h2>Quiet bindings</h2><p>Cloth, a clean title, one small stamped motif.</p></header>${books.map(b => `<figure>${svg(b, false)}<figcaption>${b.name}</figcaption></figure>`).join('')}</section><section><header><h2>Decorative bindings</h2><p>The same proportions with restrained corner tooling.</p></header>${books.map(b => `<figure>${svg(b, true)}<figcaption>${b.name}</figcaption></figure>`).join('')}</section></main>`;
});
mkdirSync('shots-now/out/book-remaster', { recursive: true });
await page.locator('#studies').screenshot({ path: 'shots-now/out/book-remaster/direction-studies.png' });
await browser.close();
