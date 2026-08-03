/**
 * scripts/check-readme.mjs — keep the README honest about its own repo.
 *
 * The README claims things a repo can drift away from: that a file is at a
 * path, that 222 of 230 source files open with a module docstring, that there
 * are 48 unit-test files and 15 e2e specs, that five design docs carry a
 * superseded banner. Every one of those was true when it was typed and none of
 * them is self-maintaining.
 *
 * So they are not typed as prose. Each is written into the markdown wrapped in
 * an invisible marker:
 *
 *     <!--f:srcDocstrings-->222<!--/f-->
 *
 * GitHub renders that as `222` and nothing else. This script recomputes every
 * key from the tree and fails if the checked-in number disagrees — the same
 * shape as `npm run spec:check`, and for the same reason: a generator nobody
 * runs is worth nothing, a check that fails a test run is worth everything.
 *
 * It also resolves every relative link, **against the directory the file it is
 * written in actually lives in** — which is what a browser does. `README.md` is
 * the front door and its links are therefore root-relative; the two halves live
 * in `docs/readme/` and reach the tree with `../../`. An earlier version of this
 * file resolved everything from the root on the grounds that the halves were
 * fragments assembled into `README.md`. They are not — they are pages a reader
 * opens — so root-relative resolution was passing every link in `docs/readme/`
 * while every one of them 404'd for that reader, including the screenshots.
 *
 * Usage:
 *   node scripts/check-readme.mjs            check, exit 1 on any drift
 *   node scripts/check-readme.mjs --facts    print every computed fact
 *
 * The vocabulary counts (how many shelf builds, how many papers) are NOT here:
 * computing them means loading TypeScript, and `tests/readme.test.ts` can
 * simply import those modules. It calls the functions below for everything
 * else, so `npx vitest run` is the gate and this script is the convenience.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The assembled README plus the fragments it is assembled from. */
export const README_FILES = ['README.md', 'docs/readme'];

/* ------------------------------ file walking ----------------------------- */

function walk(dir, match, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, match, out);
    else if (match(e.name)) out.push(p);
  }
  return out;
}

const isSource = (name) => /\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name);

/** Every markdown file the README is made of, as repo-relative paths. */
export function readmeDocs() {
  const found = [];
  for (const entry of README_FILES) {
    const abs = join(ROOT, entry);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) found.push(...walk(abs, (n) => n.endsWith('.md')));
    else found.push(abs);
  }
  return found.map((p) => p.slice(ROOT.length + 1).split(sep).join('/')).sort();
}

/* -------------------------------- the facts ------------------------------ */

/**
 * Recompute every checkable number from the tree.
 *
 * Keys are deliberately boring nouns: the marker in the markdown is the only
 * place they are spelled twice, and a key that reads as a sentence invites
 * somebody to reword it.
 */
export function computeFacts() {
  const sources = walk(join(ROOT, 'src'), isSource);
  let docstrings = 0;
  let docstringLines = 0;
  for (const f of sources) {
    const text = readFileSync(f, 'utf8').replace(/^﻿/, '');
    if (!text.startsWith('/**')) continue;
    docstrings += 1;
    docstringLines += text.slice(0, text.indexOf('*/')).split('\n').length;
  }

  const designDocs = walk(join(ROOT, 'docs', 'design'), (n) => n.endsWith('.md'));
  let superseded = 0;
  for (const f of designDocs) {
    const head = readFileSync(f, 'utf8').split('\n').slice(0, 6).join('\n');
    if (/superseded/i.test(head)) superseded += 1;
  }

  // The AI-facing spec is a generated file the user half quotes the size of.
  // Counted the way a reader would count it: lines in the file they paste.
  const specPath = join(ROOT, 'src-tauri', 'resources', 'notebook-script-spec.md');
  let specLines = 0;
  try {
    specLines = readFileSync(specPath, 'utf8').replace(/\n$/, '').split('\n').length;
  } catch {
    specLines = 0;
  }

  // The Rust half is small enough that its size is part of the architecture
  // claim ("almost everything interesting happens in the frontend"), so it is
  // measured rather than estimated.
  const lineCount = (file) => {
    const text = readFileSync(file, 'utf8');
    return text.length === 0 ? 0 : text.replace(/\n$/, '').split('\n').length;
  };
  const rustSources = walk(join(ROOT, 'src-tauri', 'src'), (n) => n.endsWith('.rs'));
  const libRs = readFileSync(join(ROOT, 'src-tauri', 'src', 'lib.rs'), 'utf8');

  return {
    srcFiles: sources.length,
    srcDocstrings: docstrings,
    docstringLines,
    specLines,
    rustFiles: rustSources.length,
    rustLines: rustSources.reduce((sum, f) => sum + lineCount(f), 0),
    // Every migration registered with the sqlx migrator. Counted off the
    // `version:` field so a migration added without one cannot hide.
    dbMigrations: (libRs.match(/^\s*version:\s*\d+\s*,/gm) ?? []).length,
    // Code generators: the ones whose output is checked in and gated.
    generatorScripts: readdirSync(join(ROOT, 'scripts')).filter((n) =>
      /^gen-.*\.(mjs|py)$/.test(n),
    ).length,
    readmeShots: walk(join(ROOT, 'docs', 'readme', 'img'), (n) => n.endsWith('.png')).length,
    unitTests: walk(join(ROOT, 'tests'), (n) => n.endsWith('.test.ts')).length,
    e2eSpecs: walk(join(ROOT, 'tests', 'e2e'), (n) => n.endsWith('.spec.ts')).length,
    probeScripts: readdirSync(join(ROOT, 'scripts')).filter((n) =>
      /^probe-.*\.mjs$/.test(n),
    ).length,
    designDocs: designDocs.length,
    supersededDesignDocs: superseded,
    rustCommands: (
      readFileSync(join(ROOT, 'src-tauri', 'src', 'lib.rs'), 'utf8').match(
        /generate_handler!\[([\s\S]*?)\]/,
      )?.[1] ?? ''
    )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean).length,
  };
}

/* ------------------------------- the checks ------------------------------ */

/**
 * Blank out code — fenced and inline — so a marker or a link QUOTED in prose is
 * illustration rather than a claim. Replaced character-for-character with
 * spaces (newlines kept) so reported line numbers stay honest.
 */
function stripCode(text) {
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  return text
    .replace(/^```[\s\S]*?^```/gm, blank)
    .replace(/(`+)[^\n]*?\1/g, blank);
}

const FACT_RE = /<!--\s*f:([A-Za-z][A-Za-z0-9_]*)\s*-->([\s\S]*?)<!--\s*\/f\s*-->/g;

/**
 * Keys this script knows about but cannot compute, because computing them
 * means loading TypeScript modules. `tests/readme.test.ts` imports those
 * modules directly and passes the values in, so the numbers ARE gated — just
 * by `npx vitest run` rather than by the CLI. The CLI skips them and says so.
 */
export const DEFERRED_FACTS = [
  'shelfBuilds',
  'shelfPatterns',
  'shelfPresets',
  'wallpaperMotifs',
  'wallpaperPapers',
  'bookShapes',
  'bookMaterials',
  'bookDecorations',
  'bookPresets',
  'roomThemes',
  'bookCloths',
  'soundSets',
  'soundCues',
  'ambienceBeds',
  'roomPresets',
  'ribbonPresets',
  'coverPigments',
  'coverFrames',
  'coverMedallions',
  'slashCommands',
  'stickers',
  'effectAxes',
  'effectValues',
  'blockEffectTypes',
  'scriptContainers',
  'scriptContainerAliases',
  'scriptAttrKeys',
  'scriptDiagrams',
  'settingsOptions',
  'rebindableKeys',
  'templates',
  'defaultFloors',
  'maxFloors',
  'packCategories',
  'packRefusals',
  'tourSteps',
];

/**
 * Compare every `<!--f:key-->value<!--/f-->` marker against `facts`.
 *
 * Values are compared after stripping `,` and `_` group separators, so the
 * prose may write `3,841` while the fact is 3841.
 */
export function checkFacts(facts, docs = readmeDocs()) {
  const problems = [];
  let checked = 0;
  let deferred = 0;
  for (const rel of docs) {
    const text = stripCode(readFileSync(join(ROOT, rel), 'utf8'));
    for (const m of text.matchAll(FACT_RE)) {
      const [, key, raw] = m;
      const line = text.slice(0, m.index).split('\n').length;
      if (!(key in facts)) {
        if (DEFERRED_FACTS.includes(key)) deferred += 1;
        else problems.push(`${rel}:${line} unknown fact '${key}'`);
        continue;
      }
      checked += 1;
      const written = raw.trim().replace(/[,_]/g, '');
      const actual = String(facts[key]);
      if (written !== actual) {
        problems.push(
          `${rel}:${line} '${key}' says ${written}, the tree says ${actual}`,
        );
      }
    }
  }
  return { checked, deferred, problems };
}

const LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)|<img[^>]+src="([^"]+)"/g;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/**
 * Resolve every relative link in the README and the two halves.
 *
 * Resolved from the directory of the file the link is written in, because that
 * is what a reader's browser does and these are three pages, not one assembled
 * one. `README.md` therefore writes `docs/design/x.md` and the halves write
 * `../design/x.md` for the same file; both are checked the same way.
 */
export function checkLinks(docs = readmeDocs()) {
  const problems = [];
  let checked = 0;
  for (const rel of docs) {
    // Code is illustration, not navigation.
    const prose = stripCode(readFileSync(join(ROOT, rel), 'utf8'));
    const here = dirname(join(ROOT, rel));
    for (const m of prose.matchAll(LINK_RE)) {
      const target = m[1] ?? m[2];
      if (!target || EXTERNAL.test(target)) continue;
      checked += 1;
      const path = decodeURI(target.split('#')[0].split('?')[0]);
      if (!path) continue;
      const line = prose.slice(0, m.index).split('\n').length;
      try {
        statSync(join(here, path));
      } catch {
        problems.push(`${rel}:${line} link target does not exist: ${target}`);
      }
    }
  }
  return { checked, problems };
}

/* --------------------------------- the CLI ------------------------------- */

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const facts = computeFacts();
  if (process.argv.includes('--facts')) {
    for (const [k, v] of Object.entries(facts)) console.log(`${k}\t${v}`);
    process.exit(0);
  }
  const docs = readmeDocs();
  if (docs.length === 0) {
    console.error('check-readme: no README.md and no docs/readme/*.md found');
    process.exit(1);
  }
  const links = checkLinks(docs);
  const marks = checkFacts(facts, docs);
  const problems = [...links.problems, ...marks.problems];
  for (const p of problems) console.error(`  ${p}`);
  console.log(
    `check-readme: ${docs.length} file(s), ${links.checked} relative link(s), ` +
      `${marks.checked} fact marker(s) checked, ${marks.deferred} deferred to ` +
      `tests/readme.test.ts, ${problems.length} problem(s)`,
  );
  process.exit(problems.length === 0 ? 0 : 1);
}
