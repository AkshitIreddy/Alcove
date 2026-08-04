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
 * The same treatment is given to the SCREENSHOTS, for the same reason and after
 * the same failure — see {@link checkShots} and `docs/readme/img/shots.json`.
 *
 * ## It reports; it does not block, and it never edits prose
 *
 * The reader's instruction, verbatim: *"the check exists to say that hey
 * something is missing from readme, but final editing of readme is left in the
 * hands of the dev/ai"*. So this prints a grouped report and exits **0**. It has
 * never written a word into the markdown and still does not — `npm run
 * readme:build` composes the regions that are marked as generated, and every
 * sentence outside them is somebody's to write.
 *
 * That leaves the numbers gated where they should be: `tests/readme.test.ts`
 * fails on a stale count, because a count that has stopped being true is a fact
 * rather than an editorial choice. `--strict` here exits 1 for a caller that
 * wants the same thing from a shell.
 *
 * It also answers the other half of the question — what is MISSING. See
 * {@link checkCoverage}: a number this script can compute that the page never
 * quotes, a design document nothing links, a directory of the app the map does
 * not name, a screenshot no page shows. None of those is a failure. Each is a
 * line saying "there is a hole here", and what to put in it is yours.
 *
 * Usage:
 *   node scripts/check-readme.mjs            report drift and gaps, exit 0
 *   node scripts/check-readme.mjs --strict   …and exit 1 if anything has drifted
 *   node scripts/check-readme.mjs --facts    print every computed fact
 *
 * The vocabulary counts (how many shelf builds, how many papers) are NOT here:
 * computing them means loading TypeScript, and `tests/readme.test.ts` can
 * simply import those modules. It calls the functions below for everything
 * else, so `npx vitest run` is the gate and this script is the convenience.
 */
import { createHash } from 'node:crypto';
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
  'placeableValues',
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

/* -------------------------------- coverage ------------------------------- */

/**
 * What the repo has that the README never mentions.
 *
 * Everything above answers "is what this page says still true?". This answers
 * the question the reader actually asked for — *"the check exists to say that
 * hey something is missing from readme"* — and it is a different kind of
 * answer, so it is kept apart from {@link checkFacts} and never counted as a
 * failure. A page is allowed to leave things out on purpose. What it is not
 * allowed to do is leave them out by accident, and the difference between those
 * two is a judgement only the person editing can make.
 *
 * Four holes worth naming, each chosen because it has actually opened here:
 *
 *  1. **A number nobody quotes.** This script computes twelve facts and the
 *     test file another thirty-six. A key with no marker anywhere is a claim
 *     the page could make for free and does not.
 *  2. **A design document nothing links.** `docs/design/` is the canonical
 *     record; one that no page points at is a document nobody will ever open.
 *  3. **A part of the app the map does not name.** The map of the app is a
 *     table of directories, and a new feature directory does not add itself.
 *  4. **A screenshot no page shows.** A picture that costs a capture run and
 *     appears nowhere.
 *
 * The vocabulary counts this file cannot compute are covered anyway: they are
 * named in {@link DEFERRED_FACTS}, and a deferred key with no marker is exactly
 * as missing as a computed one.
 */
export function checkCoverage(facts = computeFacts(), docs = readmeDocs()) {
  const prose = docs.map((rel) => readFileSync(join(ROOT, rel), 'utf8')).join('\n');
  const mentioned = (needle) => prose.includes(needle);
  const notes = [];

  const quoted = new Set();
  for (const m of prose.matchAll(FACT_RE)) quoted.add(m[1]);
  for (const key of [...Object.keys(facts), ...DEFERRED_FACTS].sort()) {
    if (!quoted.has(key)) {
      notes.push(`no page quotes '${key}' — a number this run can compute and nothing says`);
    }
  }

  for (const abs of walk(join(ROOT, 'docs', 'design'), (n) => n.endsWith('.md'))) {
    const rel = abs.slice(ROOT.length + 1).split(sep).join('/');
    if (!mentioned(rel.slice('docs/'.length))) {
      notes.push(`nothing links ${rel} — a design record no reader can reach from here`);
    }
  }

  const areas = [];
  for (const dir of ['src', join('src', 'features')]) {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (entry.isDirectory()) areas.push(`${dir.split(sep).join('/')}/${entry.name}/`);
    }
  }
  for (const area of areas.sort()) {
    if (!mentioned(area)) notes.push(`the map of the app never names ${area}`);
  }

  for (const file of shotFiles()) {
    if (!mentioned(`img/${file}`)) notes.push(`no page shows ${SHOTS_DIR}/${file}`);
  }

  return { checked: quoted.size + areas.length, notes };
}

/* ------------------------------ the screenshots -------------------------- */

/*
 * Everything below exists because the README's thirteen screenshots went stale
 * the way only pictures can: silently, and all at once.
 *
 * The reader's report was "picture in readme uses old name and pic, also some
 * of the other pictures in it are outdated". Every shot in `docs/readme/img/`
 * predated the rename to Alcove — the banner said *Bellanote* over the old blue
 * mark, the open spread was headed "Welcome to Bellanote", the tree diagram had
 * Bellanote at its root — and the shelf shots predated the day the opening room
 * moved off verdigris. Nothing in the repo could tell: a PNG is a PNG, its
 * bytes are valid, its link resolves, and `checkLinks()` above was perfectly
 * happy the whole time.
 *
 * The fix is the same shape as the fact markers: write down what the picture
 * SHOWS, then recompute it. `shots-now/readme-shots.mjs` captures all thirteen
 * in one run and records, in `docs/readme/img/shots.json`, the app it
 * photographed (product name and version), the commit it stood on, a digest of
 * every file whose CONTENT is in shot, and the identity strings the pictures
 * literally spell out. When any of that stops matching the tree, the shots are
 * older than what they claim to depict and the suite says so.
 *
 * Three deliberate non-choices, because each was the obvious first idea:
 *
 *  - **not mtimes.** "Fail when the PNG is older than the source" is what this
 *    wants to mean, but a checkout, a rebase and a `git clean` all rewrite
 *    mtimes in whatever order the filesystem felt like, so it fails for
 *    everybody at random and nobody trusts it a week later.
 *  - **not `commit === HEAD`.** The manifest records the commit for provenance
 *    and every failure message prints it, but comparing it to HEAD would go red
 *    on the very next commit — a check that is red by default is a check that
 *    gets deleted. What is compared is the handful of things that make a
 *    picture a LIE, not the fact that the repo moved on.
 *  - **not a digest of `src/art/`.** The drawing vocabularies change most
 *    weeks and a shelf photograph survives nearly all of it. What ages a shelf
 *    photograph is the room it opens in CHANGING, so the four default ids are
 *    recorded instead — the exact thing that happened when verdigris lost the
 *    slot to lapis.
 *
 * One more failure this could not see, added after it happened: a recapture
 * where the library studio's sheet was still off-screen on its tween when the
 * shutter went, so `studio.png` came out as the shelf with no panel on it —
 * byte for byte the same file as `shelf.png`, taken seconds earlier. Everything
 * above was perfectly happy: the app was Alcove 0.1.0, the room was the default
 * one, the manifest recorded the shot's own digest, and that digest matched.
 * The cause is fixed at the capture end — `onScreen()` in
 * `shots-now/readme-shots.mjs` now waits for the sheet's left edge to be inside
 * the window rather than trusting Playwright's `visible`, which a sheet parked
 * off-canvas satisfies. This is the other end of it, and worth having on its
 * own: two shots with two different captions cannot both be the same picture,
 * whatever went wrong upstream to make them one. {@link checkShots} therefore
 * compares the pictures to EACH OTHER as well as to the tree.
 */

/** Where the capture script writes what it photographed. */
export const SHOTS_MANIFEST = 'docs/readme/img/shots.json';

/** The directory the README's pictures live in. */
export const SHOTS_DIR = 'docs/readme/img';

/**
 * A PNG smaller than this did not photograph an application.
 *
 * The brief for the recapture said a half-loaded shot is worse than the stale
 * one it replaced, and the cheapest signature of one is its size: the app's
 * screens compress to 120–560 kB, while a cream rectangle with nothing on it
 * lands around 15 kB. This is not a quality bar — it is the floor under
 * "something went wrong and the file was written anyway".
 */
export const MIN_SHOT_BYTES = 40_000;

/**
 * Files whose CONTENT is inside a picture, and which picture.
 *
 * Kept to things that are literally visible: the banner is a render of one HTML
 * file and one image, so those two age it and nothing else does. A shot with no
 * entry here is still gated — by the app identity and the depicted strings
 * below, which apply to all of them.
 */
export const SHOT_SOURCES = {
  // BOTH marks, and the second is the one actually drawn. The banner used to
  // embed `alcove-art.png`, the supplied master — which is RGB with a solid
  // white surround baked in, so it painted four white corners onto a cream
  // card. It now embeds `alcove-1024.png`, the same master after
  // `gen-icons.py`'s `unframe()` has cut that surround to alpha. The supplied
  // master stays listed because swapping it is how the mark changes at all;
  // the derived one is listed because regenerating with a different crop or
  // tolerance moves it while the supplied file sits still.
  'hero.png': [
    'shots-now/readme-hero.html',
    'assets/brand/alcove-art.png',
    'assets/brand/alcove-1024.png',
  ],
};

/**
 * Identity the pictures spell out in words, deferred to `tests/readme.test.ts`
 * for the same reason {@link DEFERRED_FACTS} is: reading these means loading
 * TypeScript, and a vitest file can simply import the modules.
 *
 * These are the five things whose change made the last set of shots wrong: the
 * title written across the open spread and drawn into the root of the tree
 * diagram, and the four ids that decide what an untouched bookcase and the wall
 * behind it look like on the day somebody opens the app.
 */
export const DEPICTED_KEYS = [
  'welcomeTitle',
  'defaultTheme',
  'defaultBuild',
  'defaultPattern',
  'defaultWallpaper',
];

/** First 16 hex of the sha256 of a repo-relative file. Short enough to read. */
export function digestOf(rel) {
  return createHash('sha256').update(readFileSync(join(ROOT, rel))).digest('hex').slice(0, 16);
}

/** Every path any shot declares a source, digested — the recorded shape. */
export function sourceDigests() {
  const out = {};
  for (const paths of Object.values(SHOT_SOURCES)) {
    for (const rel of paths) out[rel] = digestOf(rel);
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * The app as the shots would have photographed it: the name on the window and
 * the version in package.json. The rename is exactly what the old shots got
 * wrong, and the version is what makes a release recapture them.
 */
export function appIdentity() {
  const tauri = JSON.parse(readFileSync(join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  return { product: String(tauri.productName), version: String(pkg.version) };
}

/** Every screenshot on disk, as bare file names, sorted. */
export function shotFiles() {
  try {
    return readdirSync(join(ROOT, SHOTS_DIR))
      .filter((n) => n.endsWith('.png'))
      .sort();
  } catch {
    return [];
  }
}

/** `{ bytes, sha256, width, height }` for one shot, read off the file itself. */
export function measureShot(file) {
  const buf = readFileSync(join(ROOT, SHOTS_DIR, file));
  // IHDR is the first chunk of every PNG: 8-byte signature, 4-byte length,
  // 4-byte type, then width and height as big-endian uint32.
  const png = buf.length > 24 && buf.readUInt32BE(12) === 0x49484452;
  return {
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex').slice(0, 16),
    width: png ? buf.readUInt32BE(16) : 0,
    height: png ? buf.readUInt32BE(20) : 0,
  };
}

/** The manifest as written, or null if it is missing or unreadable. */
export function readShotsManifest() {
  try {
    return JSON.parse(readFileSync(join(ROOT, SHOTS_MANIFEST), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Compare `docs/readme/img/shots.json` against the tree.
 *
 * `depicted` carries the values from {@link DEPICTED_KEYS} that only a
 * TypeScript import can supply; anything missing from it is counted as deferred
 * rather than failed, so the CLI stays runnable on its own and
 * `tests/readme.test.ts` is where those become a gate.
 */
export function checkShots(depicted = {}) {
  const problems = [];
  const manifest = readShotsManifest();
  if (manifest === null) {
    return {
      checked: 0,
      deferred: 0,
      problems: [`${SHOTS_MANIFEST} is missing or unreadable — run 'node shots-now/readme-shots.mjs'`],
    };
  }

  /*
   * Provenance is quoted, never compared. The manifest records the commit each
   * shot was taken at and every failure below prints it, so the fix is always
   * "here is how old this picture is and what has moved since" — but comparing
   * it to HEAD would go red on the very next commit, and a check that is red by
   * default is a check somebody deletes.
   */
  const at = (entry) => (entry?.commit ? ` (taken at ${entry.commit})` : '');
  const from = at(manifest.commit?.short ? { commit: manifest.commit.short } : null);
  const stale = (what, entry) =>
    problems.push(
      `${what}${entry ? at(entry) : from} — recapture with ` +
        "'node shots-now/readme-shots.mjs' (needs 'npm run dev')",
    );

  /* 1. the app in the picture */
  const app = appIdentity();
  const shotApp = manifest.app ?? {};
  if (shotApp.product !== app.product) {
    stale(`shots were taken of '${shotApp.product}', this app is called '${app.product}'`);
  }
  if (shotApp.version !== app.version) {
    stale(`shots are of version ${shotApp.version}, package.json says ${app.version}`);
  }

  /* 2. the strings the pictures spell out */
  let deferred = 0;
  const shown = manifest.depicts ?? {};
  for (const key of DEPICTED_KEYS) {
    if (!(key in shown)) {
      problems.push(`${SHOTS_MANIFEST} records no '${key}' — the manifest predates this check`);
      continue;
    }
    if (!(key in depicted)) {
      deferred += 1;
      continue;
    }
    if (String(shown[key]) !== String(depicted[key])) {
      stale(`shots show ${key} '${shown[key]}', the tree says '${depicted[key]}'`);
    }
  }
  for (const key of Object.keys(shown)) {
    if (!DEPICTED_KEYS.includes(key)) {
      problems.push(`${SHOTS_MANIFEST} records '${key}', which nothing checks`);
    }
  }

  /* 3. the files whose content is in shot */
  const digests = sourceDigests();
  const recorded = manifest.sources ?? {};
  for (const [rel, digest] of Object.entries(digests)) {
    if (!(rel in recorded)) {
      problems.push(`${SHOTS_MANIFEST} records no digest for ${rel}`);
    } else if (recorded[rel] !== digest) {
      stale(`${rel} has changed since the shot that draws it was taken`);
    }
  }
  for (const rel of Object.keys(recorded)) {
    if (!(rel in digests)) {
      problems.push(`${SHOTS_MANIFEST} records ${rel}, which no shot declares a source`);
    }
  }

  /* 4. the pictures themselves */
  const listed = new Map((manifest.shots ?? []).map((s) => [s.file, s]));
  const onDisk = shotFiles();
  let checked = 0;
  /*
   * Every shot has its own caption in `docs/readme/part-1-users.md`, so no two
   * of them can honestly be the same image. When they are, a capture step did
   * not reach the state it was aiming at and photographed the previous one
   * again — which is how a `studio.png` with no studio in it got past every
   * other check on this page. Keyed by content, so it catches the pair
   * regardless of which one of them was the accident.
   */
  const byPicture = new Map();
  for (const file of onDisk) {
    const entry = listed.get(file);
    if (entry === undefined) {
      problems.push(`${SHOTS_DIR}/${file} is not in the manifest — nothing knows how old it is`);
      continue;
    }
    checked += 1;
    if (!entry.commit || !entry.at) {
      problems.push(`${SHOTS_MANIFEST} says nothing about when ${file} was taken`);
    }
    const now = measureShot(file);
    if (now.bytes < MIN_SHOT_BYTES) {
      problems.push(
        `${SHOTS_DIR}/${file} is ${now.bytes} bytes — under ${MIN_SHOT_BYTES}, ` +
          'which is a blank or half-loaded capture, not a screenshot',
      );
    }
    const twin = byPicture.get(now.sha256);
    if (twin === undefined) byPicture.set(now.sha256, file);
    else {
      problems.push(
        `${SHOTS_DIR}/${file} and ${SHOTS_DIR}/${twin} are the same picture, byte for ` +
          'byte — one of the two never reached the state its caption describes',
      );
    }
    if (entry.sha256 !== now.sha256) {
      stale(`${SHOTS_DIR}/${file} was edited after it was recorded`, entry);
    }
    if (entry.width !== now.width || entry.height !== now.height) {
      problems.push(
        `${SHOTS_DIR}/${file} is ${now.width}×${now.height}, the manifest says ` +
          `${entry.width}×${entry.height}`,
      );
    }
  }
  for (const file of listed.keys()) {
    if (!onDisk.includes(file)) problems.push(`${SHOTS_MANIFEST} lists ${file}, which is gone`);
  }
  for (const file of Object.keys(SHOT_SOURCES)) {
    if (!listed.has(file)) problems.push(`SHOT_SOURCES names ${file}, which is not a shot`);
  }

  return { checked, deferred, problems };
}

/* --------------------------------- the CLI ------------------------------- */

/** One headed block of the report, or nothing at all when the list is empty. */
function block(title, lines, advice) {
  if (lines.length === 0) return;
  console.log(`\n  ${title} (${lines.length})`);
  for (const line of lines) console.log(`    ${line}`);
  if (advice) console.log(`    → ${advice}`);
}

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
  const strict = process.argv.includes('--strict');
  const links = checkLinks(docs);
  const marks = checkFacts(facts, docs);
  const shots = checkShots();
  const cover = checkCoverage(facts, docs);
  const problems = [...links.problems, ...marks.problems, ...shots.problems];

  console.log(
    `README report — ${docs.length} file(s), ${links.checked} relative link(s), ` +
      `${marks.checked} fact marker(s) and ${shots.checked} screenshot(s) checked, ` +
      `${marks.deferred + shots.deferred} deferred to tests/readme.test.ts`,
  );
  block(
    'numbers that no longer match the tree',
    marks.problems,
    'these are facts, not prose — npm run readme:facts prints the true values',
  );
  block('links that go nowhere', links.problems, 'fix the path, or the file that moved');
  block(
    'pictures that no longer show this app',
    shots.problems,
    "node shots-now/readme-shots.mjs (needs 'npm run dev')",
  );
  block(
    'in the repo, not on the page',
    cover.notes,
    'nothing here is wrong — decide whether the page should say it',
  );
  if (problems.length === 0 && cover.notes.length === 0) {
    console.log('\n  nothing has drifted, nothing is missing.');
  } else if (!strict) {
    console.log(
      '\n  Reported, not enforced — the editing is yours.\n' +
        '  (npx vitest run tests/readme.test.ts is the gate; --strict exits 1 here.)',
    );
  }
  process.exit(strict && problems.length > 0 ? 1 : 0);
}
