/**
 * Playwright E2E configuration.
 *
 * Targets the Vite dev server (browser mode, stubbed in-memory SQLite) at
 * http://localhost:1420 — an already-running server is reused, otherwise
 * `npm run dev` is started. Headless WebGL runs on SwiftShader, which can
 * throttle rAF to ~10fps: specs poll for state instead of fixed waits.
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
   * One retry, and only because of how this suite is run.
   *
   * Zero is the honest default when a suite is deterministic, and most of the
   * assertions here are — they poll for state rather than fixed-waiting,
   * precisely so they do not depend on timing. What is NOT deterministic is the
   * environment: `reuseExistingServer` is true, so these run against whatever
   * dev server is already up, sharing a CPU with SwiftShader's software WebGL
   * and with a Vite process that may be mid-HMR from another window. A first
   * attempt can lose to a 45s boot timeout for reasons that have nothing to do
   * with the code under test.
   *
   * One retry, not two: it should absorb a starved boot, not paper over a race.
   * A test that only passes on the second attempt is still a failing test, and
   * the list reporter says which ones retried.
   */
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:1420',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.5,
    screenshot: 'only-on-failure',
    trace: 'off',
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
