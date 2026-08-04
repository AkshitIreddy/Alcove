/**
 * vitest.config.ts — reuses the app's vite config (solid plugin, aliases)
 * but pins the default test environment to node: jsdom is not installed, and
 * vite-plugin-solid would otherwise default `test.environment` to jsdom in
 * test mode, making every `vitest run` exit 1 with MISSING DEPENDENCY.
 * Individual files can still opt into another environment with a
 * `// @vitest-environment` pragma once that environment is installed.
 */
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default defineConfig(async (env) =>
  mergeConfig(await viteConfig(env), {
    test: {
      environment: 'node',
      // Keep the Playwright E2E suite (tests/e2e/*.spec.ts, `npm run e2e`)
      // out of Vitest's default `{test,spec}` collection glob.
      include: ['tests/**/*.test.ts'],
      exclude: ['**/node_modules/**', 'tests/e2e/**'],
      /*
       * Vitest's default is 5 s, and that is not enough here — not because any
       * test is slow, but because of WHAT the slow ones do. A dozen of them
       * reach for a big module with `await import('../src/data/seed')` or
       * `../src/features/settings/appearance`, and the first such import in a
       * worker pays for Vite transforming that module and everything it pulls
       * in. On an idle machine that lands around a second; with anything else
       * running it does not.
       *
       * Found the honest way: five files failed together while a screenshot
       * capture and a dev server were using the machine, every one of them
       * "timed out in 5000ms", and every one passed on its own seconds later.
       * That is a flaky gate rather than a real signal, and `.github/workflows/
       * release.yml` blocks the release on this suite — a shared CI runner is
       * exactly the loaded machine that reproduces it.
       *
       * 20 s is chosen to be far above the transform cost and still far below
       * "this test hangs". A genuine hang fails, just later.
       */
      testTimeout: 20_000,
    },
  }),
);
