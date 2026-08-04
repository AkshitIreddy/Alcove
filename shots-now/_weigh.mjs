/**
 * _weigh.mjs — what the boot actually WEIGHS, minified.
 *
 * Scratch measuring tool, not part of the app's build. Source bytes are a lie
 * for this codebase: it is heavily commented on purpose, so `stat`ing a file
 * charges the boot for prose that never ships. esbuild bundles the entry the
 * way rollup would (static imports followed, `import()` split into its own
 * chunk) and the metafile reports the MINIFIED bytes each module contributed —
 * which is the number that moves when an import is made lazy.
 *
 * Two things it has to get right or it lies:
 *
 *   1. the `@xmldom/xmldom` alias from vite.config.ts. Without it the report
 *      charges the boot 66 kB for an XML DOM the shipped app replaces with a
 *      four-line shim, and 66 kB of phantom is enough to send you optimising
 *      the wrong module.
 *   2. the boot is the entry chunk PLUS every chunk it reaches by a static
 *      `import` statement. With splitting on, code shared between the entry
 *      and a lazy chunk is hoisted into a third chunk that the entry still
 *      loads eagerly — counting only the entry chunk hides it.
 *
 * It is not the shipped bundle (rollup mangles and tree-shakes differently and
 * the Solid JSX transform here is esbuild's, not babel-preset-solid), so quote
 * it as a DELTA between two runs, never as an absolute ship size.
 *
 * Usage: node shots-now/_weigh.mjs [out.json]
 */
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = process.argv[2] || null;

const result = await build({
  entryPoints: ['src/index.tsx'],
  bundle: true,
  minify: true,
  splitting: true,
  format: 'esm',
  outdir: 'zz-weigh-tmp',
  write: false,
  metafile: true,
  target: 'es2020',
  jsx: 'transform',
  jsxFactory: 'h',
  jsxFragment: 'Fragment',
  loader: { '.css': 'css', '.svg': 'text', '.woff': 'file', '.woff2': 'file', '.ttf': 'file' },
  logLevel: 'silent',
  external: ['@tauri-apps/*'],
  alias: {
    // Mirrors vite.config.ts — see the docblock above.
    '@xmldom/xmldom': fileURLToPath(new URL('../scripts/shims/xmldom-browser.mjs', import.meta.url)),
  },
});

const meta = result.metafile;
const entryName = Object.entries(meta.outputs).find(([, o]) => o.entryPoint === 'src/index.tsx')[0];

/** Chunks the boot loads: the entry, plus everything it static-imports. */
const eagerChunks = new Set([entryName]);
for (let grew = true; grew; ) {
  grew = false;
  for (const name of [...eagerChunks]) {
    for (const imp of meta.outputs[name]?.imports ?? []) {
      if (imp.kind !== 'import-statement') continue;
      if (!eagerChunks.has(imp.path)) {
        eagerChunks.add(imp.path);
        grew = true;
      }
    }
  }
}

const rows = [];
let bootBytes = 0;
for (const name of eagerChunks) {
  const o = meta.outputs[name];
  bootBytes += o.bytes;
  for (const [p, v] of Object.entries(o.inputs)) rows.push({ p, b: v.bytesInOutput });
}
rows.sort((a, b) => b.b - a.b);

const total = Object.values(meta.outputs).reduce((n, o) => n + o.bytes, 0);
console.log(`BOOT   ${(bootBytes / 1024).toFixed(1)} kB minified over ${eagerChunks.size} chunk(s), ${rows.length} modules`);
console.log(`total  ${(total / 1024).toFixed(1)} kB over ${Object.keys(meta.outputs).length} chunks`);

const byDir = {};
for (const r of rows) {
  const seg = r.p.startsWith('src/')
    ? r.p.split('/').slice(0, 3).join('/')
    : 'node_modules/' + (r.p.split('node_modules/')[1] ?? r.p).split('/')[0];
  byDir[seg] ??= 0;
  byDir[seg] += r.b;
}
console.log('\n== boot by area ==');
for (const [d, b] of Object.entries(byDir).sort((a, b) => b[1] - a[1]).slice(0, 28))
  console.log(`  ${(b / 1024).toFixed(1).padStart(8)} kB  ${d}`);

console.log('\n== biggest modules in the boot ==');
for (const r of rows.slice(0, 40)) console.log(`  ${(r.b / 1024).toFixed(1).padStart(8)} kB  ${r.p}`);

if (OUT) writeFileSync(OUT, JSON.stringify({ bootBytes, total, chunks: [...eagerChunks], rows }, null, 1));
