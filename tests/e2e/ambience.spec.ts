/**
 * Ambience & sound wiring (wave-2 group E, features 28-30).
 *
 * Deliberately light: headless browsers block/queue actual audio, so these
 * specs assert the engine's *routing state* through the window.__nbSound
 * debug surface (src/sound/engine.ts) — soundscape selection, crossfaded
 * switching, the typing-tick rate limiter, and the chime scheduler surface.
 * DSP quality (loop seams, headroom, scheduler timing) is covered by the
 * node unit suite in tests/sound.test.ts.
 */
import { expect, test, type Page } from 'playwright/test';
import { suppressTour } from './helpers';

/** Load the app and wait until the sound engine's debug surface is up. */
async function gotoWithEngine(page: Page): Promise<void> {
  await suppressTour(page);
  await page.goto('/');
  await expect
    .poll(() => page.evaluate(() => typeof window.__nbSound?.getState), {
      timeout: 45_000,
      message: 'window.__nbSound never appeared (engine module not loaded)',
    })
    .toBe('function');
}

const state = (page: Page) =>
  page.evaluate(() => window.__nbSound!.getState());

test('engine boots with wave-2 defaults: rain scape, typing/chime off', async ({ page }) => {
  await gotoWithEngine(page);
  const s = await state(page);
  expect(s.soundscape).toBe('rain');
  expect(s.ambientPlaying).toBeNull(); // ambientLoop defaults off
  expect(s.typingSounds).toBe(false);
  expect(s.hourlyChime).toBe(false);
  expect(s.muted).toBe(false);
});

test('soundscape picker: start, crossfade-switch, and none-stops (28)', async ({ page }) => {
  await gotoWithEngine(page);

  await page.evaluate(() => window.__nbSound!.startAmbient());
  await expect
    .poll(async () => (await state(page)).ambientPlaying, { timeout: 15_000 })
    .toBe('ambient-rain');

  // Switching soundscapes retargets the bed (engine crossfades internally).
  await page.evaluate(() => window.__nbSound!.setSoundscape('stream'));
  await expect
    .poll(async () => (await state(page)).ambientPlaying, { timeout: 15_000 })
    .toBe('ambient-stream');

  await page.evaluate(() => window.__nbSound!.setSoundscape('fireplace'));
  await expect
    .poll(async () => (await state(page)).ambientPlaying, { timeout: 15_000 })
    .toBe('ambient-fireplace');

  // 'none' silences the bed but keeps the wanted flag (ambientLoop intent).
  await page.evaluate(() => window.__nbSound!.setSoundscape('none'));
  await expect
    .poll(async () => (await state(page)).ambientPlaying, { timeout: 15_000 })
    .toBeNull();
  expect((await state(page)).ambientWanted).toBe(true);

  // Picking a scape again resumes; stopAmbient clears the intent.
  await page.evaluate(() => window.__nbSound!.setSoundscape('crickets'));
  await expect
    .poll(async () => (await state(page)).ambientPlaying, { timeout: 15_000 })
    .toBe('ambient-crickets');
  await page.evaluate(() => window.__nbSound!.stopAmbient());
  await expect
    .poll(async () => (await state(page)).ambientWanted, { timeout: 15_000 })
    .toBe(false);
});

test('typing sounds: gated by the setting and rate-limited to 12/s (29)', async ({ page }) => {
  await gotoWithEngine(page);

  // Disabled (the default): keystrokes never tick.
  await page.evaluate(() => {
    for (let i = 0; i < 10; i++) window.__nbSound!.keystroke(i * 100);
  });
  expect((await state(page)).typingTicksPlayed).toBe(0);

  // Enabled: 40 keystrokes hammered 10 ms apart -> at most ceil(400/83.3)+1.
  await page.evaluate(() => {
    window.__nbSound!.setTypingSounds(true);
    for (let i = 0; i < 40; i++) window.__nbSound!.keystroke(100_000 + i * 10);
  });
  const burst = (await state(page)).typingTicksPlayed;
  expect(burst).toBeGreaterThanOrEqual(1);
  expect(burst).toBeLessThanOrEqual(6);

  // Relaxed typing under the limit ticks every stroke.
  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) window.__nbSound!.keystroke(200_000 + i * 100);
  });
  expect((await state(page)).typingTicksPlayed).toBe(burst + 5);
});

test('hourly chime: toggle reflects in state; mid-hour poll never rings (30)', async ({ page }) => {
  await gotoWithEngine(page);

  await page.evaluate(() => window.__nbSound!.setHourlyChime(true));
  expect((await state(page)).hourlyChime).toBe(true);

  // A poll right after enabling is inside the armed hour (and inside the
  // 10-minute launch grace) — it must never ring.
  await page.evaluate(() => window.__nbSound!.chimeTick());
  expect((await state(page)).chimesPlayed).toBe(0);

  await page.evaluate(() => window.__nbSound!.setHourlyChime(false));
  expect((await state(page)).hourlyChime).toBe(false);
});
