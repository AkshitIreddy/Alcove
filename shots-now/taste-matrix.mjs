/**
 * shots-now/taste-matrix.mjs — does "a reading room" always mean brown?
 *
 * The taste questionnaire picks a preset from the ROOM answer first and only
 * repaints when that family cannot answer the COLOUR one. That is a claim
 * about an interaction between two questions, and the honest way to check it
 * is to answer every combination and photograph the room each one produces.
 *
 * The case under suspicion: "a reading room" is the Formal family, which is
 * the brown-panelled one — so a reader who wants a formal SHAPE and plenty of
 * colour must not be handed a brown box anyway.
 *
 * Usage: node shots-now/taste-matrix.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'shots-now/out/taste';
mkdirSync(OUT, { recursive: true });

const ROOMS = ['reading-room', 'chapter-house', 'good-parlour', 'toy-box'];
const COLOURS = ['hushed', 'warm', 'deep', 'bright'];

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1300, height: 820 }, deviceScaleFactor: 1 });

await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 120000 });
await p.evaluate(() => localStorage.clear());
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 120000 });

const t0 = Date.now();
for (;;) {
  const ok = await p.evaluate(
    () => globalThis.__nbTaste !== undefined && globalThis.__shelfDesign !== undefined,
  );
  if (ok || Date.now() - t0 > 90000) break;
  await p.waitForTimeout(400);
}
if (!(await p.evaluate(() => globalThis.__nbTaste !== undefined))) {
  console.log('  FAIL — no __nbTaste bridge; cannot resolve answers');
  await b.close();
  process.exit(1);
}

for (const skip of ['skip the tour', 'I’ll pick later', "I'll pick later"]) {
  const el = p.locator(`text=${skip}`).first();
  if (await el.count()) await el.click({ force: true }).catch(() => {});
  await p.waitForTimeout(400);
}

const rows = [];
for (const room of ROOMS) {
  for (const colour of COLOURS) {
    const applied = await p.evaluate(
      async ([r, c]) => {
        const t = globalThis.__nbTaste;
        // The keys are room / pitch / paper / sound (TASTE_AXES). An earlier
        // run of this file passed `colour` and `wall`, which TasteAnswers
        // simply ignores — every combination then scored identically and the
        // file reported the app as broken when the fault was here.
        await t.apply({ room: r, pitch: c, paper: 'figured', sound: 'house' });
        return null;
      },
      [room, colour],
    );
    void applied;

    // Wait for the shelf to actually re-bake before photographing it.
    const seen = new Set();
    const t1 = Date.now();
    for (;;) {
      const d = await p.evaluate(() => globalThis.__shelfDesign());
      seen.add(d.libraryKey);
      if (d.libraryKey !== '' && d.bakes > 0) break;
      if (Date.now() - t1 > 25000) break;
      await p.waitForTimeout(300);
    }
    await p.waitForTimeout(2200);

    const d = await p.evaluate(() => globalThis.__shelfDesign());
    const theme = d.libraryKey.split('|')[0];
    const timber = d.libraryKey.split('|')[1];
    rows.push({ room, colour, theme, timber, shelf: d.shelf });
    console.log(`  ${room.padEnd(14)} + ${colour.padEnd(7)} -> ${String(theme).padEnd(16)} timber ${timber}  ${d.shelf}`);
    await p.screenshot({ path: `${OUT}/${room}-${colour}.png` });
  }
}

await b.close();

// The question this file exists to answer.
const readingRoom = rows.filter((r) => r.room === 'reading-room');
const distinct = new Set(readingRoom.map((r) => r.timber)).size;
console.log(
  `\n  "a reading room" across four colour answers -> ${distinct} distinct timbers: ` +
    readingRoom.map((r) => `${r.colour}=${r.timber}`).join(', '),
);
console.log(
  distinct > 1
    ? '  PASS — the colour answer moves it; formal is a SHAPE, not a palette'
    : '  FAIL — every colour answer gives the same timber',
);
process.exit(distinct > 1 ? 0 : 1);
