/* TEMP review tool — exported components under src/ that are never RENDERED. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

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
const testFiles = walk(join(ROOT, 'tests')).filter((f) => /\.(ts|tsx)$/.test(f));
const read = (f) => readFileSync(f, 'utf8');

const bodies = new Map();
for (const f of [...srcFiles, ...testFiles]) bodies.set(f, read(f));

// exported PascalCase functions/consts in .tsx (component-shaped)
const comps = [];
for (const f of srcFiles) {
  if (!f.endsWith('.tsx')) continue;
  const s = bodies.get(f);
  for (const m of s.matchAll(
    /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|const)\s+([A-Z][\w$]*)/gm,
  )) {
    comps.push({ file: f, name: m[1] });
  }
}

const rows = [];
for (const { file, name } of comps) {
  const jsx = new RegExp(`<${name}[\\s/>]`);
  const dyn = new RegExp(`component=\\{\\s*${name}\\b|\\b${name}\\s*\\(\\s*\\{`);
  const renderedIn = [];
  for (const [f, s] of bodies) {
    if (f === file) continue;
    if (jsx.test(s) || dyn.test(s)) renderedIn.push(f);
  }
  const selfJsx = jsx.test(bodies.get(file).replace(/^\s*export[\s\S]*?$/m, ''));
  if (renderedIn.length === 0) {
    // is it at least imported anywhere?
    const importedIn = [...bodies].filter(
      ([f, s]) => f !== file && new RegExp(`\\b${name}\\b`).test(s),
    ).map(([f]) => relative(ROOT, f).split(sep).join('/'));
    rows.push({
      file: relative(ROOT, file).split(sep).join('/'),
      name,
      renderedInOwnFile: selfJsx,
      mentionedIn: importedIn,
    });
  }
}
rows.sort((a, b) => a.file.localeCompare(b.file));
for (const r of rows) {
  const where = r.mentionedIn.length === 0 ? 'NOWHERE' : r.mentionedIn.join(', ');
  console.log(
    `${r.file} :: <${r.name}> never rendered outside its file` +
      (r.renderedInOwnFile ? ' (used inside own file)' : '') +
      `  | mentioned in: ${where}`,
  );
}
console.log(`\ncomponents scanned: ${comps.length}; never rendered elsewhere: ${rows.length}`);
