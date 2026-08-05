/**
 * scripts/shrink-history.mjs — drop a gigabyte of dead capture output out of
 * the repository's HISTORY, not just its working tree.
 *
 * ## Why this exists
 *
 * The clean pass untracked 469 MB and deleted another 88 MB, and said at the
 * time exactly what it had not done: *it does not shrink a clone, git still
 * holds every old copy.* It holds 1.4 GB of them, which is what somebody
 * downloads to look at a 61 MB checkout.
 *
 * Measured by summing every blob reachable from `--all` by its top two path
 * segments:
 *
 *     qa/**             ~685 MB   capture leftovers, refutation scratch,
 *                                 comparison boards — every one of them the
 *                                 output of a run that has already been read
 *     shots-now/**      ~223 MB   room-rank, roster, hero, dice — same again
 *     assets/generated   ~89 MB   the painterly pipeline's baked output
 *     assets/photoreal   ~23 MB   its source material, deleted with it
 *     assets/scenes      ~17 MB
 *     assets/cutouts     ~16 MB
 *
 * Every path in that list is already absent from the working tree or ignored,
 * and the four `assets/` directories do not exist at all. Nobody loses anything
 * they can currently open.
 *
 * ## What is SPARED, and why the filter is written as exceptions
 *
 * The tempting version of this script is six `--path` arguments and a big
 * number at the end. It would take three live things with it:
 *
 *   - `qa/baseline/**` — the visual-regression pictures `npm run visual`
 *     compares against. 65 tracked files. Deleting their history would not
 *     break the suite today, but it would delete every earlier baseline, which
 *     is the only record of what a surface used to look like.
 *   - `shots-now/*.mjs` — the capture scripts. Only the capture OUTPUT
 *     directories are dead weight; the programs that write them are the tools.
 *   - anything under `docs/readme/img/**` and `public/sounds/**`, which are
 *     shipped and are not matched by any rule here — listed so that the next
 *     person to widen a pattern reads why they should not.
 *
 * So the rules are regexes with holes in them rather than plain prefixes, and
 * `--dry-run` prints what each one would take before anything is rewritten.
 *
 * ## The two costs, stated rather than discovered
 *
 *   - **Every commit SHA moves.** TODO.md and docs/readme/releases.md quote
 *     them by the dozen. filter-repo writes a commit map; `--remap` reads it
 *     and rewrites those references in one pass, which is the only way that
 *     does not miss some.
 *   - **Anybody holding a clone must re-clone.** For a repository whose only
 *     other copy is the owner's remote, that is nobody.
 *
 * ## Usage
 *
 *     node scripts/shrink-history.mjs --dry-run     what would go, and how much
 *     node scripts/shrink-history.mjs --bundle      write the safety net only
 *     node scripts/shrink-history.mjs --yes         do it (implies --bundle)
 *     node scripts/shrink-history.mjs --remap       rewrite SHAs after a run
 *
 * `--yes` refuses to start unless the working tree is clean, a bundle of every
 * ref has been written, and `git filter-repo` is on PATH. It does NOT push;
 * pushing a rewritten history over a public branch is a separate, deliberate
 * command a person types.
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const flag = (name) => process.argv.includes(`--${name}`);
const DRY = flag('dry-run');
const YES = flag('yes');
const BUNDLE_ONLY = flag('bundle');
const REMAP = flag('remap');

const sh = (cmd) => execSync(cmd, { encoding: 'utf8', maxBuffer: 1 << 28 }).trim();
const trySh = (cmd) => {
  try {
    return sh(cmd);
  } catch {
    return '';
  }
};

/* ---------------------------------------------------------------------------
   What goes, expressed as Python regexes for `git filter-repo --path-regex`.

   filter-repo matches these against the path as it appears in the tree, with
   no leading slash. With `--invert-paths` every rule here is a rule about what
   to REMOVE, so each one is written to describe only dead output.
   ------------------------------------------------------------------------- */
const REMOVE = [
  {
    // Everything under qa/ EXCEPT the visual baselines. The negative lookahead
    // is the whole point: `^qa/` alone would take the pictures the visual
    // suite compares against, and their entire history with them.
    regex: '^qa/(?!baseline/)',
    why: 'capture leftovers, refutation scratch, comparison boards — qa/baseline spared',
  },
  {
    // Capture OUTPUT lives in subdirectories of shots-now; the scripts live at
    // its root. `[^/]+/` matches "is inside a subdirectory" and nothing else.
    regex: '^shots-now/[^/]+/',
    why: 'room-rank, roster, hero, dice — the *.mjs capture scripts at the root are spared',
  },
  {
    regex: '^assets/(generated|photoreal|scenes|cutouts)/',
    why: 'the painterly pipeline deleted by RESET-render-architecture.md, and its source art',
  },
];

/** Paths that must survive, checked after a run rather than assumed. */
const MUST_SURVIVE = [
  'qa/baseline',
  'shots-now/visual-suite.mjs',
  'shots-now/demo-gif.mjs',
  'docs/readme/img',
  'public/sounds',
  'src-tauri/icons',
];

/* ------------------------------------------------------------------ helpers */

/** Every blob in every ref, as {path, bytes}. Slow; only used by --dry-run. */
function blobsByPath() {
  const objects = sh('git rev-list --objects --all');
  const check = execFileSync(
    'git',
    ['cat-file', '--batch-check=%(objecttype) %(objectname) %(objectsize) %(rest)'],
    { input: objects, encoding: 'utf8', maxBuffer: 1 << 30 },
  );
  const rows = [];
  for (const line of check.split('\n')) {
    const [type, , size, ...rest] = line.split(' ');
    if (type !== 'blob' || rest.length === 0) continue;
    rows.push({ path: rest.join(' '), bytes: Number(size) });
  }
  return rows;
}

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

/* ---------------------------------------------------------------------- dry */

if (DRY) {
  const rows = blobsByPath();
  const matchers = REMOVE.map((r) => ({ ...r, re: new RegExp(r.regex.replace('(?!', '(?!')) }));
  let total = 0;
  let kept = 0;
  const taken = new Map();
  for (const row of rows) {
    const hit = matchers.find((m) => m.re.test(row.path));
    total += row.bytes;
    if (hit) {
      taken.set(hit.regex, (taken.get(hit.regex) ?? 0) + row.bytes);
    } else {
      kept += row.bytes;
    }
  }
  console.log(`\n  every blob in every ref: ${mb(total)} across ${rows.length} entries\n`);
  for (const rule of REMOVE) {
    console.log(`  ${mb(taken.get(rule.regex) ?? 0).padStart(10)}  ${rule.regex}`);
    console.log(`              ${rule.why}`);
  }
  console.log(`\n  would remain: ${mb(kept)}\n`);

  /*
   * The spared paths, proved rather than promised — and proved against the
   * REAL paths in the history rather than a synthetic child of each.
   *
   * The first version of this check appended `/x` to every entry and asked
   * whether that matched. For a directory that is the right question; for
   * `shots-now/visual-suite.mjs` it asks whether a file INSIDE that file would
   * be removed, which `^shots-now/[^/]+/` says yes to, and the check reported
   * the capture scripts as TAKEN when the rule spares them. A guard that cries
   * wolf gets switched off, so it is worth getting right: gather every real
   * path under each entry and ask the rules about those.
   */
  console.log('  spared (blob bytes still reachable under each):');
  for (const path of MUST_SURVIVE) {
    const under = rows.filter((r) => r.path === path || r.path.startsWith(`${path}/`));
    const bytes = under.reduce((sum, r) => sum + r.bytes, 0);
    const casualties = under.filter((r) => matchers.some((m) => m.re.test(r.path)));
    const ok = under.length > 0 && casualties.length === 0;
    console.log(
      `    ${ok ? '  ok  ' : 'TAKEN '} ${mb(bytes).padStart(10)}  ${path}` +
        (casualties.length ? `  — ${casualties.length} would go, e.g. ${casualties[0].path}` : '') +
        (under.length === 0 ? '  — NOTHING FOUND, is the path right?' : ''),
    );
    if (!ok) process.exitCode = 1;
  }
  console.log('');
  process.exit(process.exitCode ?? 0);
}

/* ------------------------------------------------------------------- bundle */

function writeBundle() {
  mkdirSync('qa/tmp', { recursive: true });
  const at = trySh('git rev-parse --short HEAD');
  const out = join('qa', 'tmp', `pre-rewrite-${at}.bundle`);
  console.log(`  writing safety net: ${out}`);
  execFileSync('git', ['bundle', 'create', out, '--all'], { stdio: 'inherit' });
  console.log('  every ref is in that file; `git clone <file>` brings it all back.\n');
  return out;
}

if (BUNDLE_ONLY && !YES) {
  writeBundle();
  process.exit(0);
}

/* -------------------------------------------------------------------- remap */

if (REMAP) {
  const mapPath = '.git/filter-repo/commit-map';
  if (!existsSync(mapPath)) {
    console.error(`  no commit map at ${mapPath} — run the rewrite first.`);
    process.exit(1);
  }
  /*
   * The map is "<old> <new>" per line, full 40-char SHAs, and a commit that
   * was dropped entirely maps to all-zeros. Documents quote SHAs at seven
   * characters, so the lookup is built on the short form — and a short SHA is
   * only unambiguous because git says so, which is why a prefix that matches
   * two entries is reported rather than guessed at.
   */
  const short = new Map();
  const ambiguous = new Set();
  for (const line of readFileSync(mapPath, 'utf8').split('\n')) {
    const [oldSha, newSha] = line.trim().split(/\s+/);
    if (!oldSha || !newSha) continue;
    if (/^0+$/.test(newSha)) continue; // the commit itself is gone
    const key = oldSha.slice(0, 7);
    if (short.has(key) && short.get(key) !== newSha) ambiguous.add(key);
    short.set(key, newSha.slice(0, 7));
  }
  const files = ['TODO.md', 'docs/readme/releases.md', 'CLAUDE.md'];
  let changed = 0;
  let missed = 0;
  for (const file of files) {
    if (!existsSync(file)) continue;
    const before = readFileSync(file, 'utf8');
    const after = before.replace(/\b[0-9a-f]{7,40}\b/g, (sha) => {
      const key = sha.slice(0, 7);
      if (ambiguous.has(key)) {
        console.error(`  AMBIGUOUS ${key} in ${file} — resolve by hand`);
        missed += 1;
        return sha;
      }
      const next = short.get(key);
      if (!next) return sha; // not a commit of ours: a hex colour, a hash, prose
      changed += 1;
      return sha.length > 7 ? next.padEnd(sha.length, '') : next;
    });
    if (after !== before) writeFileSync(file, after);
  }
  console.log(`  remapped ${changed} reference(s); ${missed} left for a human.`);
  process.exit(missed > 0 ? 1 : 0);
}

/* ---------------------------------------------------------------------- run */

if (!YES) {
  console.log(`
  Nothing done. This script rewrites history and that is not a default.

    --dry-run   what would go, and what is spared
    --bundle    write the safety net and stop
    --yes       rewrite (writes the bundle first)
    --remap     after a rewrite, fix the SHAs quoted in the docs
`);
  process.exit(0);
}

if (trySh('git status --porcelain') !== '') {
  console.error('  working tree is not clean. Commit or stash first.');
  process.exit(1);
}
if (!trySh('git filter-repo --version')) {
  console.error('  git filter-repo is not on PATH.');
  process.exit(1);
}

writeBundle();

/*
 * `--force` because filter-repo refuses to touch a repo that is not a fresh
 * clone, and this one is the working copy on purpose: the bundle above is the
 * undo, and a fresh clone would have to be pushed from anyway.
 */
const args = ['filter-repo', '--force', '--invert-paths'];
for (const rule of REMOVE) args.push('--path-regex', rule.regex);
console.log(`  git ${args.join(' ')}\n`);
execFileSync('git', args, { stdio: 'inherit' });

console.log('\n  rewritten. Checking that the spared paths are still here:');
let bad = 0;
for (const path of MUST_SURVIVE) {
  const files = trySh(`git ls-files "${path}"`).split('\n').filter(Boolean).length;
  console.log(`    ${files > 0 ? '  ok  ' : 'GONE  '} ${String(files).padStart(4)} file(s)  ${path}`);
  if (files === 0) bad += 1;
}
if (bad > 0) {
  console.error('\n  A spared path is missing. Restore from the bundle before doing anything else.');
  process.exit(1);
}

console.log(`
  Next, in this order:

    node scripts/shrink-history.mjs --remap     the SHAs in the docs moved
    git add -A && git commit                    that remap as its own commit
    git remote add origin <url>                 filter-repo drops the remote
    git push --force origin main                deliberate, and typed by a person
    git tag -a v0.4.0 && git push origin v0.4.0 AFTER the force-push, never before
`);
