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
    },
  }),
);
