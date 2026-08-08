/**
 * Keep html-to-image clones typographically identical to their source DOM.
 *
 * html-to-image 1.11.13 rewrites every computed pixel font size while cloning:
 * it floors the value and subtracts another 0.1px. On a fixed notebook page,
 * that is enough to move a threshold word to the preceding line. The WebGL
 * page face then disagrees with the live page and visibly re-wraps at land().
 *
 * This tiny install-time patch is intentionally strict and idempotent. If the
 * dependency changes the relevant code, installation fails instead of quietly
 * bringing the landing flicker back.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const files = [
  'node_modules/html-to-image/es/clone-node.js',
  'node_modules/html-to-image/lib/clone-node.js',
];

const variants = [
  `            if (name === 'font-size' && value.endsWith('px')) {\n` +
    `                const reducedFont = Math.floor(parseFloat(value.substring(0, value.length - 2))) - 0.1;\n` +
    `                value = \`\${reducedFont}px\`;\n` +
    `            }\n`,
  `            if (name === 'font-size' && value.endsWith('px')) {\n` +
    `                var reducedFont = Math.floor(parseFloat(value.substring(0, value.length - 2))) - 0.1;\n` +
    `                value = "".concat(reducedFont, "px");\n` +
    `            }\n`,
];

const marker = 'Alcove: preserve the source computed font-size exactly.';
for (const relative of files) {
  const file = resolve(relative);
  const source = readFileSync(file, 'utf8');
  if (source.includes(marker)) continue;
  const old = variants.find((candidate) => source.includes(candidate));
  if (old === undefined) {
    throw new Error(`html-to-image font-size patch seam moved in ${relative}`);
  }
  const replacement =
    `            // ${marker}\n` +
    `            // The upstream floor-and-minus-0.1 rewrite changes line wrapping.\n`;
  writeFileSync(file, source.replace(old, replacement), 'utf8');
}
