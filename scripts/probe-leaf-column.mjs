/**
 * scripts/probe-leaf-column.mjs — is a leaf at 1280x800 a SMALLER leaf, or the
 * same leaf with less of it?
 *
 * `probe-leaf-capacity.mjs` established that a leaf's capacity is the window
 * height less a fixed 179px of chrome — exactly, at five window sizes. That is
 * the vertical half of the question, and on its own it would say the budget is
 * the only thing that has to move when the window shrinks.
 *
 * But `.nb-spread-stage` takes its WIDTH from the height —
 * `min(100%, (100vh - 96px) * 1.58, 1760px)` — so a shorter window is a
 * narrower book, and a narrower book might be a narrower text column. If it is,
 * then `CHARS_PER_LINE` (split.ts, 72) is as window-dependent as the budget is,
 * every paragraph cost in the estimator is calibrated at the wrong width, and
 * lowering the budget alone would fix half the problem.
 *
 * So this measures the column itself: the prose box, the type set in it, and —
 * the reading that settles it — how many lines a paragraph of known length
 * actually wraps to on the page.
 */
import { chromium } from 'playwright';

const URL_BASE =
  process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:1420';
const SIZES = [
  { w: 1600, h: 1000, note: 'what the estimator was calibrated at' },
  { w: 1280, h: 800, note: 'the DEFAULT window' },
  { w: 1360, h: 850, note: 'the demo recording' },
  { w: 1100, h: 720, note: 'a small laptop' },
  { w: 960, h: 620, note: 'the MINIMUM window' },
];

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

console.log(
  '\n  window        stage   paper    prose   font    line   scale   px/char  chars/line',
);
console.log(
  '  ------------  -----   -----    -----   ----    ----   -----   -------  ----------',
);
for (const s of SIZES) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h } });
  await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
    polling: 400,
  });
  await page.evaluate(async () => {
    await globalThis.__shelfWorld.ready;
  });
  const skip = page.getByText('skip the tour');
  if (await skip.count()) {
    await skip.first().click({ force: true });
    await page.waitForTimeout(700);
  }
  await page.evaluate(async () => {
    const app = await import('/src/state/app.ts');
    const books = await import('/src/data/books.ts');
    const list = await books.listBooksByFloorRange(0, 20);
    const w = list.find((b) => /welcome/i.test(b.title)) ?? list[0];
    app.appState.openBook(w.id);
  });
  await page.waitForSelector('.nb-prose', { timeout: 60_000 });
  await page.waitForTimeout(4000);

  const m = await page.evaluate(() => {
    const stage = document.querySelector('.nb-spread-stage');
    const paper = document.querySelector('.nb-leaf-paper');
    const prose = document.querySelector('.nb-prose');
    if (paper === null || prose === null || stage === null) return null;
    const cs = getComputedStyle(prose);
    const rect = paper.getBoundingClientRect();
    const scale = paper.clientHeight > 0 ? rect.height / paper.clientHeight : 1;

    /* The reading that settles it: a paragraph of known length, measured where
       it is actually set. A ruler span inside the prose box inherits the
       column's width and the column's type, so its wrapped height over the
       line height IS the wrap the estimator is trying to predict. */
    const LONG =
      'Lx and then a good deal more of it, because a container is narrower ' +
      'than the leaf it stands on and the only way to learn how much narrower ' +
      'is to let a real sentence wrap inside one and count the lines it took ' +
      'to say itself, which is what this paragraph is doing right now on your ' +
      'behalf.';
    const p = document.createElement('p');
    p.textContent = LONG;
    p.style.margin = '0';
    prose.appendChild(p);
    const line = Number.parseFloat(cs.lineHeight) || 32;
    const wrapped = Math.round((p.getBoundingClientRect().height / scale / line) * 100) / 100;
    /* ...and the same words on one line, which gives px per character in the
       body hand without guessing at the face's metrics. */
    p.style.whiteSpace = 'nowrap';
    p.style.display = 'inline-block';
    const oneLine = p.getBoundingClientRect().width / scale;
    p.remove();

    return {
      stage: Math.round(stage.getBoundingClientRect().width / scale),
      paper: Math.round(paper.clientWidth),
      prose: Math.round(prose.clientWidth),
      font: cs.fontSize,
      line,
      scale: Math.round(scale * 1000) / 1000,
      perChar: Math.round((oneLine / LONG.length) * 100) / 100,
      wrapped,
      chars: Math.round(prose.clientWidth / (oneLine / LONG.length)),
    };
  });
  await page.close();
  if (m === null) {
    console.log(`  ${s.w}x${s.h}  — no leaf`);
    continue;
  }
  console.log(
    `  ${String(s.w + 'x' + s.h).padEnd(12)}  ${String(m.stage).padStart(5)}   ` +
      `${String(m.paper).padStart(5)}   ${String(m.prose).padStart(6)}   ` +
      `${m.font.padStart(5)}  ${String(m.line).padStart(4)}px  ${String(m.scale).padStart(5)}   ` +
      `${String(m.perChar).padStart(7)}  ${String(m.chars).padStart(6)}   ` +
      `(287 chars wrap to ${m.wrapped})   ${s.note}`,
  );
}
await browser.close();
