/**
 * shots-now/own-sounds.mjs — look at the "add your own set" rows.
 *
 * Two states, because they are different surfaces: no own set yet (one button
 * and its naming hint), and one selected (its base picker, its 13 cue rows,
 * the forget button).
 *
 *   node shots-now/own-sounds.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const OUT = 'qa/ui';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const poll = async (fn, ms = 60000, label = 'condition') => {
  const t0 = Date.now();
  for (;;) {
    if (await p.evaluate(fn)) return true;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${label}`);
    await p.waitForTimeout(200);
  }
};

await p.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await p.evaluate(() => localStorage.clear());
await p.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await poll(() => globalThis.__nbUserSoundSets !== undefined, 120000, 'own-set bridge');

const openSettings = async () => {
  await p.locator('.nbs-gear-button').click();
  await p.waitForTimeout(700);
};
const toSoundSets = async () => {
  const anchor = p.getByText('add your own set', { exact: true }).first();
  await anchor.scrollIntoViewIfNeeded();
  await p.waitForTimeout(500);
};

await openSettings();
await toSoundSets();
await p.screenshot({ path: `${OUT}/ownsound-1-empty.png` });

// Seed a set the way the file dialog would, then look at it selected.
await p.evaluate(async () => {
  const set = await globalThis.__nbUserSoundSets.seed('typewriter', 'far-room', {
    'click-soft': '/sounds/chime-hour-1.wav?nbown=1',
    'typing-tick': '/sounds/pop-soft-1.wav?nbown=2',
  });
  await globalThis.__nbSoundSets.save(set.id);
});
await p.waitForTimeout(800);
await toSoundSets();
await p.screenshot({ path: `${OUT}/ownsound-2-selected.png` });

await p.getByText('other rooms to build on', { exact: true }).first().scrollIntoViewIfNeeded();
await p.waitForTimeout(400);
await p.getByRole('button', { name: /show all \d+/ }).last().click();
await p.waitForTimeout(900);
await p
  .getByText('the rest of this set', { exact: true })
  .first()
  .scrollIntoViewIfNeeded({ timeout: 10000 })
  .catch(() => null);
await p.waitForTimeout(500);
await p.screenshot({ path: `${OUT}/ownsound-5-bases.png` });

await p.getByRole('button', { name: /place \d+ cues/ }).first().click();
await p.waitForTimeout(600);
await p.getByText('pressing a button', { exact: true }).first().scrollIntoViewIfNeeded();
await p.waitForTimeout(400);
await p.screenshot({ path: `${OUT}/ownsound-3-cues.png` });

await p.getByText('the hour', { exact: true }).first().scrollIntoViewIfNeeded();
await p.waitForTimeout(400);
await p.screenshot({ path: `${OUT}/ownsound-4-cues-end.png` });

console.log('wrote ownsound-1-empty / 2-selected / 3-cues / 4-cues-end / 5-bases to qa/ui');
await browser.close();
