import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root: here,
  base: './',
  build: { outDir: here + '/dist', emptyOutDir: true, target: 'es2022', minify: false },
  logLevel: 'warn',
});
