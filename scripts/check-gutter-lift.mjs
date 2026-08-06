/**
 * scripts/check-gutter-lift.mjs — is the gutter raised only at the landing?
 *
 * A rule that does not match is indistinguishable from a rule that is not
 * there, so this asks the CSSOM and running elements directly. The rigid DOM
 * gutter must sit under the moving GL curl, then rise over its flat landing
 * frame. `--sabotage` restores the old whole-turn raise and must be rejected.
 */
import { chromium } from 'playwright';

const URL_BASE =
  process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:1420';
const SABOTAGE = process.argv.includes('--sabotage');

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
await page.emulateMedia({ reducedMotion: 'no-preference' });
await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(async () => {
  await globalThis.__shelfWorld.ready;
});
const skip = page.getByText('skip the tour');
if (await skip.count()) {
  await skip.first().click({ force: true });
  await page.waitForTimeout(900);
}
await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  const welcome = list.find((b) => /welcome/i.test(b.title)) ?? list[0];
  app.appState.openBook(welcome.id);
});
await page.waitForSelector('.nb-prose p', { timeout: 60_000 });
await page.waitForTimeout(6000);

if (SABOTAGE) {
  await page.addStyleTag({
    content: `
      .nb-spread:has(.nb-flip-canvas.is-flipping) .nb-spread-gutter {
        z-index: calc(var(--z-flip) + 2) !important;
      }
      .nb-spread:has(.nb-flip-canvas.is-flipping) .nb-page-curl {
        z-index: calc(var(--z-flip) + 3) !important;
      }
    `,
  });
  console.log('SABOTAGE: restored the rigid whole-turn gutter raise');
}

// Park the pointer off the spread so `:hover` is not confused with the fade.
await page.mouse.move(4, 4);
await page.waitForTimeout(300);

const rules = await page.evaluate(() => {
  const found = [];
  for (const sheet of document.styleSheets) {
    let list;
    try {
      list = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of list) {
      const text = rule.selectorText ?? '';
      if (text.includes('is-flipping') || text.includes('is-flip-gesture') || text.includes('is-flip-landing')) {
        found.push(`${text}  {${rule.style?.cssText ?? ''}}`);
      }
    }
  }
  return found;
});
console.log('rules mentioning the flip classes:');
for (const r of rules) console.log(`   ${r}`);

await page.evaluate(() => {
  globalThis.__lift = [];
  globalThis.__liftGo = true;
  const t = setInterval(() => {
    if (!globalThis.__liftGo) {
      clearInterval(t);
      return;
    }
    const spread = document.querySelector('.nb-spread');
    const gutter = document.querySelector('.nb-spread-gutter');
    const curl = document.querySelector('.nb-page-curl');
    const canvas = document.querySelector('canvas.nb-flip-canvas');
    const surface = document.querySelector('.nb-flip-surface');
    globalThis.__lift.push({
      t: Math.round(performance.now()),
      flipping: canvas?.classList.contains('is-flipping') ?? false,
      gesture: surface?.classList.contains('is-flip-gesture') ?? false,
      landing: surface?.classList.contains('is-flip-landing') ?? false,
      hasFlipping: spread?.matches(':has(.nb-flip-canvas.is-flipping)') ?? null,
      hasGesture: spread?.matches(':has(.nb-flip-surface.is-flip-gesture)') ?? null,
      hasLanding: spread?.matches(':has(.nb-flip-surface.is-flip-landing)') ?? null,
      gutterZ: gutter === null ? 'absent' : getComputedStyle(gutter).zIndex,
      canvasZ: canvas === null ? 'absent' : getComputedStyle(canvas).zIndex,
      curlZ: curl === null ? 'absent' : getComputedStyle(curl).zIndex,
      curlOpacity: curl === null ? 'absent' : getComputedStyle(curl).opacity,
    });
  }, 16);
});
await page.evaluate(() => document.activeElement?.blur?.());
await page.locator('.nb-flip-hotspot-next').click({ force: true });
await page.waitForTimeout(2200);
const trace = await page.evaluate(() => {
  globalThis.__liftGo = false;
  return globalThis.__lift;
});

console.log('\n  t     flipping gesture landing :has(flip) :has(land) gutterZ canvasZ curlZ opacity');
const t0 = trace[0]?.t ?? 0;
let last = '';
for (const row of trace) {
  const key = `${row.flipping}${row.gesture}${row.landing}${row.gutterZ}${row.curlZ}${Number(row.curlOpacity).toFixed(1)}`;
  if (key === last) continue; // only print transitions — the rest is noise
  last = key;
  console.log(
    `  +${String(row.t - t0).padStart(4)}  ${String(row.flipping).padEnd(8)} ${String(row.gesture).padEnd(7)} ${String(row.landing).padEnd(7)} ` +
      `${String(row.hasFlipping).padEnd(10)} ${String(row.hasLanding).padEnd(10)} ` +
      `${String(row.gutterZ).padStart(7)} ${String(row.canvasZ).padStart(8)} ${String(row.curlZ).padStart(6)}  ${row.curlOpacity}`,
  );
}

const z = (value) => Number(value);
const moving = trace.filter((row) => row.flipping && row.gesture && !row.landing);
const landing = trace.filter((row) => row.flipping && row.landing);
const movingUnder = moving.length > 0 && moving.every((row) => z(row.gutterZ) < z(row.canvasZ));
const landingAbove = landing.length > 0 && landing.every((row) => z(row.gutterZ) > z(row.canvasZ));
const passes = movingUnder && landingAbove;

console.log(
  `\nverdict: ${moving.length} moving samples under=${movingUnder}; ` +
    `${landing.length} landing samples above=${landingAbove}`,
);
if (SABOTAGE) {
  if (passes) {
    console.error('GATE INERT — the whole-turn raise escaped detection');
    process.exitCode = 1;
  } else {
    console.log('GATE ALIVE — the whole-turn raise was rejected');
  }
} else if (passes) {
  console.log('PASS — moving curl owns the gutter; the DOM gutter returns for landing');
} else {
  console.error('FAIL — gutter phase boundary is wrong or was not observed');
  process.exitCode = 1;
}
await browser.close();
