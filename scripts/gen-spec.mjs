/**
 * Regenerates src/editor/script/spec.ts from the canonical spec file at
 * src-tauri/resources/notebook-script-spec.md so the frontend copy can never
 * drift. Run after editing the resource: node scripts/gen-spec.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(
  join(root, 'src-tauri', 'resources', 'notebook-script-spec.md'),
  'utf8',
);

const banner = `/**
 * GENERATED FILE — do not edit by hand.
 * Source of truth: src-tauri/resources/notebook-script-spec.md
 * Regenerate with: node scripts/gen-spec.mjs
 */

/** The complete Notebook Script spec, shown/copied for the user's AI. */
export const NOTEBOOK_SCRIPT_SPEC: string = `;

const literal = JSON.stringify(source);
writeFileSync(
  join(root, 'src', 'editor', 'script', 'spec.ts'),
  `${banner}${literal};\n`,
  'utf8',
);
console.log('spec.ts regenerated,', source.length, 'chars');
