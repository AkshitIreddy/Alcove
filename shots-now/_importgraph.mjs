/**
 * _importgraph.mjs — the STATIC import graph from src/index.tsx.
 *
 * Scratch tool. Parses `import ... from "x"` / `export ... from "x"` (static
 * only — `import("x")` is deliberately excluded, that is the seam) and walks
 * from the entry, so what it prints is exactly the set a production boot chunk
 * would contain. Prints the shortest chain to any module you name.
 *
 * Usage: node shots-now/_importgraph.mjs [substring ...]
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

const ROOT = resolve(process.cwd(), 'src');
const ENTRY = join(ROOT, 'index.tsx');

const EXT = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];
function resolveSpec(spec, from) {
  if (!spec.startsWith('.')) return null; // bare dep
  const base = resolve(dirname(from), spec);
  for (const e of EXT) {
    const p = base + e;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

/**
 * Static import/export-from specifiers that survive to RUNTIME.
 *
 * `import type` / `export type` are excluded, and so is a clause whose every
 * binding is `type X` — esbuild erases both, so counting them invents edges
 * that no bundler ever draws. Getting this wrong is not a rounding error: it
 * made `toTiptap -> nodes/callout -> @tiptap/core` look like a boot-chunk
 * import when the only thing crossing that edge is a type alias.
 *
 * `import(` is excluded on purpose — that is the seam, not an edge.
 */
const RE = /(?:^|[\s;}])(import|export)\s+(?!type\s)([^'"()]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
const RE_BARE = /(?:^|[\s;}])import\s+['"]([^'"]+)['"]/g;

/** True when every binding in a clause is `type`-qualified (so it erases). */
function allTypeBindings(clause) {
  if (!clause) return false;
  const brace = clause.match(/\{([\s\S]*)\}/);
  if (!brace) return false;
  // A default or namespace binding outside the braces keeps the edge.
  if (clause.slice(0, clause.indexOf('{')).replace(/^\s*/, '').replace(/,\s*$/, '').trim())
    return false;
  const parts = brace[1].split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((p) => /^type\s/.test(p));
}

const graph = new Map(); // file -> {static:[], dynamic:[], bare:[]}
const RE_DYN = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function parse(file) {
  if (graph.has(file)) return;
  const src = readFileSync(file, 'utf8');
  const rec = { static: [], dynamic: [], bare: [] };
  graph.set(file, rec);
  RE.lastIndex = 0;
  let m;
  while ((m = RE.exec(src))) {
    if (allTypeBindings(m[2])) continue;
    const spec = m[3];
    const r = resolveSpec(spec, file);
    if (r) rec.static.push(r);
    else if (!spec.startsWith('.')) rec.bare.push(spec);
  }
  RE_BARE.lastIndex = 0;
  while ((m = RE_BARE.exec(src))) {
    const spec = m[1];
    const r = resolveSpec(spec, file);
    if (r) rec.static.push(r);
    else if (!spec.startsWith('.')) rec.bare.push(spec);
  }
  RE_DYN.lastIndex = 0;
  while ((m = RE_DYN.exec(src))) {
    const r = resolveSpec(m[1], file);
    if (r) rec.dynamic.push(r);
    else if (!m[1].startsWith('.')) rec.bare.push('dyn:' + m[1]);
  }
  for (const s of rec.static) parse(s);
  for (const d of rec.dynamic) parse(d);
}
parse(ENTRY);

// BFS over static edges only, from the entry.
const prev = new Map([[ENTRY, null]]);
const q = [ENTRY];
while (q.length) {
  const f = q.shift();
  for (const s of graph.get(f)?.static ?? []) {
    if (!prev.has(s)) {
      prev.set(s, f);
      q.push(s);
    }
  }
}

const rel = (p) => p.replace(resolve(process.cwd()) + '\\', '').replace(/\\/g, '/');
const eager = [...prev.keys()];
const bytes = (p) => statSync(p).size;

const targets = process.argv.slice(2);
if (targets[0] === '--parents') {
  // EVERY eager importer of a module, not just the shortest chain — the one
  // that decides whether cutting an edge actually removes anything.
  for (const t of targets.slice(1)) {
    const hits = eager.filter((p) => rel(p).includes(t));
    for (const h of hits) {
      const parents = eager.filter((p) => graph.get(p).static.includes(h));
      console.log(`\n${rel(h)}  <- ${parents.length} eager importer(s)`);
      for (const p of parents) console.log('   ' + rel(p));
    }
    if (!hits.length) console.log(`\n${t}: NOT eager`);
  }
} else if (targets[0] === '--dep') {
  for (const dep of targets.slice(1)) {
    console.log(`\n== ${dep} ==`);
    for (const f of prev.keys()) {
      if (!graph.get(f).bare.includes(dep)) continue;
      const chain = [];
      let c = f;
      while (c) {
        chain.push(rel(c));
        c = prev.get(c);
      }
      console.log('  ' + chain.reverse().join('\n   -> '));
    }
  }
} else if (targets.length === 0) {
  const all = [...graph.keys()];
  console.log(`static graph: ${eager.length} of ${all.length} modules are EAGER from index.tsx`);
  const tot = eager.reduce((n, p) => n + bytes(p), 0);
  console.log(`eager source bytes: ${(tot / 1024).toFixed(0)} kB`);
  const bare = new Set();
  for (const f of eager) for (const b of graph.get(f).bare) if (!b.startsWith('dyn:')) bare.add(b);
  console.log(`\neager bare deps (${bare.size}):\n  ${[...bare].sort().join('\n  ')}`);
  console.log('\nbiggest eager modules:');
  for (const p of eager.sort((a, b) => bytes(b) - bytes(a)).slice(0, 40))
    console.log(`  ${(bytes(p) / 1024).toFixed(0).padStart(5)} kB  ${rel(p)}`);
} else {
  for (const t of targets) {
    const hits = eager.filter((p) => rel(p).includes(t));
    if (!hits.length) {
      console.log(`\n${t}: NOT in the eager graph`);
      continue;
    }
    for (const h of hits) {
      const chain = [];
      let c = h;
      while (c) {
        chain.push(rel(c));
        c = prev.get(c);
      }
      console.log(`\n${rel(h)}  (${(bytes(h) / 1024).toFixed(0)} kB)`);
      console.log('  ' + chain.reverse().join('\n   -> '));
    }
  }
}
