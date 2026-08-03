/**
 * Playwright E2E configuration.
 *
 * Targets the Vite dev server (browser mode, stubbed in-memory SQLite) at
 * http://localhost:1420 — an already-running server is reused, otherwise
 * `npm run dev` is started. Headless WebGL runs on SwiftShader, which can
 * throttle rAF to ~10fps: specs poll for state instead of fixed waits.
 *
 * How to read a red run — including why `retries` is not 0 — is written down in
 * `docs/e2e.md`. Read that before changing anything below.
 */
import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'tests/e2e/.artifacts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // One worker: every test boots the same in-memory-DB app; SwiftShader is
  // CPU-rendered and parallel WebGL contexts starve each other headless.
  workers: 1,
  /*
   * One retry, and it is about the ENVIRONMENT, not about shaky specs.
   *
   * `reuseExistingServer` is true, so a run happens against whatever dev server
   * is already up — and this repo is regularly worked by several agents and
   * windows at once. The moment any of them saves a module Vite cannot hot-swap,
   * the HMR client issues a **full page reload to every open page**, including
   * the one Playwright is halfway through a drag on. The test dies on a
   * destroyed execution context or a locator whose element went away, and the
   * message describes none of that. Several failures in the 2026-08-01 session
   * were exactly this and nothing else. The same shared server is also sharing a
   * CPU with SwiftShader's software WebGL, so a first attempt can lose to the
   * 45s boot poll in `helpers.ts` for reasons unrelated to the code under test.
   *
   * **This does not hide flakes, and anyone about to set it back to 0 on that
   * reasoning should check first.** Playwright buckets a test that failed and
   * then passed as *flaky*, names it in the list reporter and counts it in the
   * run summary — a retry RELABELS the failure, it does not swallow it. Zero
   * surfaces no extra information; it only turns a known environmental class
   * into a red run that reads as a product regression.
   *
   * One, not two: one absorbs a single reload or a starved boot. A genuine race
   * generally loses twice, so it stays red. When you want the honest
   * determinism check, ask for it explicitly on a quiet repo —
   * `npx playwright test --retries=0`, or `--repeat-each=3`.
   */
  retries: 1,
  reporter: [
    ['list'],
    // The HTML report is only here to put the trace below one click away
    // (`npx playwright show-report`). `playwright-report/` is gitignored.
    ['html', { open: 'never' }],
  ],
  use: {
    baseURL: 'http://localhost:1420',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.5,
    screenshot: 'only-on-failure',
    /*
     * Keep the trace of the attempt that FAILED, because that is the only way
     * to tell the two kinds of red apart after the fact.
     *
     * Playwright has no conditional retry — there is no "retry only if the page
     * navigated under us" hook, so the retry above is necessarily blanket. What
     * it can do is preserve the evidence, and a Vite full-reload is unmistakable
     * in a trace: a navigation nobody in the spec asked for, immediately before
     * the error, with `[vite] page reload …` (or `[vite] server connection
     * lost`) in the console tab. A real product failure has no such navigation.
     * So: the retry absorbs it, and the trace says which kind it was.
     *
     * `on-first-retry` would be the cheaper mode and is the wrong one — it
     * traces the attempt that usually PASSES. Screenshots are off inside the
     * trace: `screenshot: 'only-on-failure'` above already captures the frame,
     * the screencast would spend the SwiftShader budget re-rasterising a canvas
     * it renders poorly anyway, and the navigation shows up in the action
     * timeline with or without it.
     */
    trace: {
      mode: 'retain-on-first-failure',
      screenshots: false,
      snapshots: true,
      sources: false,
    },
    launchOptions: {
      args: [
        '--enable-unsafe-swiftshader',
        '--use-gl=angle',
        '--use-angle=swiftshader',
      ],
    },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
