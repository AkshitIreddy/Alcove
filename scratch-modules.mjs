/* TEMP review tool — which src modules are imported by no other src module. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep, dirname, resolve } from 'node:path';

const ROOT = process.cwd();
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.d\.ts$/.test(e)) out.push(p);
  }
  return out;
};
const srcFiles = walk(join(ROOT, 'src'));
const outside = [
  ...walk(join(ROOT, 'tests')).filter((f) => /\.(ts|tsx)$/.test(f)),
];
const rel = (f) => relative(ROOT, f).split(sep).join('/');

const cands = (base, spec) => {
  const p = resolve(dirname(base), spec);
  return [p, p + '.ts', p + '.tsx', join(p, 'index.ts'), join(p, 'index.tsx')];
};

const importedBy = new Map();
for (const f of srcFiles) importedBy.set(f, new Set());
const all = new Set(srcFiles);

const record = (from, file) => {
  const s = readFileSync(file, 'utf8');
  for (const m of s.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)) {
    const spec = m[1];
    if (!spec.startsWith('.') && !spec.startsWith('/src')) continue;
    const base = spec.startsWith('/src') ? join(ROOT, spec) : null;
    const tries = base
      ? [base, base + '.ts', base + '.tsx', join(base, 'index.ts')]
      : cands(file, spec);
    for (const t of tries) {
      if (all.has(t)) { importedBy.get(t).add(from); break; }
    }
  }
};

for (const f of srcFiles) record(rel(f), f);
for (const f of outside) record('TEST:' + rel(f), f);
// entry points
const entries = ['src/main.tsx', 'src/App.tsx', 'index.html'];

const orphans = [];
for (const f of srcFiles) {
  const by = importedBy.get(f);
  const srcOnly = [...by].filter((b) => !b.startsWith('TEST:'));
  if (srcOnly.length === 0) orphans.push({ file: rel(f), by: [...by] });
}
orphans.sort((a, b) => a.file.localeCompare(b.file));
for (const o of orphans) {
  console.log(`${o.file}  <- ${o.by.length === 0 ? 'NOBODY' : o.by.join(', ')}`);
}
console.log(`\nsrc modules: ${srcFiles.length}; not imported by any src module: ${orphans.length}`);
