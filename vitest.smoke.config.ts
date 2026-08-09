import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default defineConfig(async (env) =>
  mergeConfig(await viteConfig(env), {
    test: {
      environment: 'node',
      include: [
        'tests/smoke.test.ts',
        'tests/sound-ambient.test.ts',
        'tests/update-notes.test.ts',
      ],
      exclude: ['**/node_modules/**'],
      testTimeout: 10_000,
    },
  }),
);
