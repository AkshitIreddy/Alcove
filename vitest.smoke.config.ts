import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default defineConfig(async (env) =>
  mergeConfig(await viteConfig(env), {
    test: {
      environment: 'node',
      include: [
        'tests/book-appearance-contract.test.ts',
        'tests/book-appearance-publish-atomicity.test.ts',
        'tests/book-design-quality.test.ts',
        'tests/book-surprise-constraints.test.ts',
        'tests/book-surprise-effective-locks.test.ts',
        'tests/book-studio-prefs.test.ts',
        'tests/book-studio-interaction.test.ts',
        'tests/book-studio-painter-colour-locks.test.ts',
        'tests/smoke.test.ts',
        'tests/timeline-colors.test.ts',
        'tests/image-placeholder.test.ts',
        'tests/save-file.test.ts',
        'tests/script-source-clean-authority.test.ts',
        'tests/shelf-studio-hydration.test.ts',
        'tests/shelf-studio-reopen-hydration.test.ts',
        'tests/sound-ambient.test.ts',
        'tests/spine-factory-generation.test.ts',
        'tests/spine-texture-retirement.test.ts',
        'tests/spine-title-zone-solver.test.ts',
        'tests/update-notes.test.ts',
        'tests/release-notes.test.ts',
      ],
      exclude: ['**/node_modules/**'],
      testTimeout: 10_000,
    },
  }),
);
