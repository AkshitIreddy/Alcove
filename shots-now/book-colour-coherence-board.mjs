/**
 * Focused before/after evidence for the one-role Surprise colour-lock repair.
 * It renders the real spine and cover painters and writes outside the repo.
 *
 *   node shots-now/book-colour-coherence-board.mjs
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright';

const hit = process.argv.find((arg) => arg.startsWith('--url='));
const url = hit?.slice('--url='.length) || 'http://127.0.0.1:1420';
const output = 'E:/temp/alcove-book-colour-coherence/green-spine-storybook.png';
mkdirSync(dirname(output), { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1160, height: 650 } });
await page.routeWebSocket('**', (socket) => socket.close());
await page.goto(`${url}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });

const report = await page.evaluate(async () => {
  const design = await import('/src/art/bookDesign.ts');
  const surprise = await import('/src/art/bookSurprise.ts');
  const style = await import('/src/art/bookStyle.ts');
  const spines = await import('/src/art/spines.ts');
  const covers = await import('/src/art/covers.ts');
  const palette = await import('/src/art/palette.ts');
  const flat = await import('/src/art/flat.ts');
  await covers.preloadCoverArtwork();
  await document.fonts.ready;

  const seed = 0x51a7;
  const initial = style.resolveBookStyle(seed, undefined, {
    spineBaseHex: '#315b50',
  }, { binding: 'plain-cloth' });
  const initialSpine = spines.resolveSpineBinding({ ...initial.spine, binding: 'plain-cloth' });
  const initialProjection = surprise.resolveBookSurpriseColourProjection(
    initialSpine,
    initial.cover,
    initial.style,
  );
  const request = {
    direction: 'storybook',
    seed: 2,
    current: {
      binding: 'plain-cloth',
      style: initial.style,
      pinned: initial.pinned,
      visibleColours: initialProjection.visible,
      colourSources: initialProjection.sources,
    },
    locks: ['colour.spine-base'],
  };
  const fixedRecipe = surprise.surpriseBookRecipe(request);

  const circularGap = (first, second) => {
    const a = palette.toOklch(first);
    const b = palette.toOklch(second);
    const direct = Math.abs(a.h - b.h);
    return Math.min(direct, 360 - direct);
  };

  // The red regression captured the old painter output as #b2597f. Resolve
  // every authored Storybook palette through the same binding and select the
  // exact/nearest source, instead of treating a painter output as an input.
  const bodyFields = ['spineAccentHex', 'coverBaseHex', 'coverAccentHex'];
  const oldPalette = surprise.BOOK_SURPRISE_PALETTES.storybook.reduce((best, candidate) => {
    const candidateStyle = { ...fixedRecipe.style };
    for (const field of bodyFields) candidateStyle[field] = candidate[field];
    const candidateResolved = style.resolveBookStyle(seed, undefined, candidateStyle, {
      binding: fixedRecipe.preset,
    });
    const candidateSpine = spines.resolveSpineBinding({
      ...candidateResolved.spine,
      binding: fixedRecipe.preset,
    });
    const candidateVisible = surprise.resolveBookSurpriseColourProjection(
      candidateSpine,
      candidateResolved.cover,
      candidateResolved.style,
    ).visible.coverBaseHex;
    const a = palette.toOklch(candidateVisible);
    const b = palette.toOklch('#b2597f');
    const distance = Math.abs(a.L - b.L) + Math.abs(a.C - b.C) + circularGap(candidateVisible, '#b2597f') / 360;
    return distance < best.distance ? { candidate, distance } : best;
  }, { candidate: surprise.BOOK_SURPRISE_PALETTES.storybook[0], distance: Infinity }).candidate;
  const previousStyle = {
    ...fixedRecipe.style,
    spineAccentHex: oldPalette.spineAccentHex,
    coverBaseHex: oldPalette.coverBaseHex,
    coverAccentHex: oldPalette.coverAccentHex,
  };

  const specimens = [
    { label: 'Before · unrelated unlocked palette', overrides: previousStyle },
    { label: 'After · one coordinated binding family', overrides: fixedRecipe.style },
  ].map((item) => {
    const resolved = style.resolveBookStyle(seed, undefined, item.overrides, {
      binding: fixedRecipe.preset,
    });
    const spine = spines.resolveSpineBinding({ ...resolved.spine, binding: fixedRecipe.preset });
    const projection = surprise.resolveBookSurpriseColourProjection(
      spine,
      resolved.cover,
      resolved.style,
    );
    return { ...item, resolved, projection };
  });

  document.body.innerHTML = '';
  document.body.style.cssText =
    `margin:0;padding:28px 32px;background:${flat.FLAT.recess};color:${flat.FLAT.ink};` +
    'font:14px "Nunito Sans",system-ui,sans-serif;';
  const heading = document.createElement('h1');
  heading.textContent = 'Held spine colour · Storybook Surprise';
  heading.style.cssText = 'margin:0 0 4px;font:600 34px "Caveat Variable",cursive;';
  const note = document.createElement('p');
  note.textContent = 'Same green spine lock, same binding and tonal contrast; only unlocked hue families change.';
  note.style.cssText = 'margin:0 0 22px;opacity:.72;';
  const grid = document.createElement('main');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:24px;';
  document.body.append(heading, note, grid);

  const rows = [];
  for (const specimen of specimens) {
    const card = document.createElement('section');
    card.style.cssText =
      'padding:18px;background:#f5eee2;border:2px solid #56392f;border-radius:16px 13px 17px 14px;';
    const label = document.createElement('h2');
    label.textContent = specimen.label;
    label.style.cssText = 'margin:0;font:600 24px "Caveat Variable",cursive;';
    const art = document.createElement('div');
    art.style.cssText = 'height:390px;display:flex;align-items:flex-end;justify-content:center;gap:22px;';
    const scale = 1.28;
    const bookH = 300;
    const spine = document.createElement('canvas');
    spine.width = Math.ceil(specimen.resolved.style.thickness * scale + 10);
    spine.height = 330;
    spines.renderSpine(
      spine.getContext('2d'),
      { ...specimen.resolved.spine, binding: fixedRecipe.preset },
      5,
      25,
      bookH,
      scale,
      { hiRes: true },
    );
    const cover = document.createElement('canvas');
    cover.width = 228;
    cover.height = 330;
    covers.renderCoverInto(
      cover.getContext('2d'),
      216,
      bookH,
      specimen.resolved.cover,
      'The Lantern Atlas',
    );
    cover.style.transform = 'translateY(-5px)';
    art.append(spine, cover);
    const values = document.createElement('p');
    const spineBody = specimen.projection.visible.spineBaseHex;
    const coverBody = specimen.projection.visible.coverBaseHex;
    const gap = circularGap(spineBody, coverBody);
    values.textContent = `${spineBody} spine · ${coverBody} cover · ${gap.toFixed(1)}° hue gap`;
    values.style.cssText = 'margin:8px 0 0;text-align:center;font-size:12px;';
    card.append(label, art, values);
    grid.append(card);
    rows.push({ label: specimen.label, spineBody, coverBody, hueGap: gap });
  }
  return { binding: fixedRecipe.preset, rows };
});

await page.screenshot({ path: output, animations: 'disabled', caret: 'hide' });
console.log(JSON.stringify({ output, ...report }));
await browser.close();
