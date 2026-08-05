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
 * **Nothing tracked at HEAD is removed, and that is enforced rather than
 * promised.** This paragraph used to promise it — "every path in that list is
 * already absent from the working tree or ignored" — and a rehearsal on a
 * throwaway clone showed it was false: the rules reached 26 live files, most of
 * them working QA driver programs, for 0.52 MB of the 1,101 MB saved. Five of
 * them are cited by name from live source. `liveCasualties()` now asks
 * `git ls-files` and refuses, in both `--dry-run` and `--yes`.
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
 *   - **Every commit SHA moves.** The handoff, review and release documents
 *     quote them by the dozen. filter-repo writes a commit map; `--remap`
 *     scans every tracked text file and rewrites those references in one pass,
 *     then scans the same set again to prove no mapped old reference remains.
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
    /*
     * Everything under qa/ EXCEPT three things. The negative lookahead is the
     * whole point, and it grew by two after a rehearsal:
     *
     *   baseline/  the pictures `npm run visual` compares against, and every
     *              earlier version of them.
     *   verify/    eighteen QA DRIVER PROGRAMS — drive-audit, drive-flip,
     *              drive-studio and the rest. Not "capture leftovers": they are
     *              the tools, they are tracked at HEAD, and this rule would have
     *              deleted every one of them.
     *   wip/       `BookView.duplication-fix-v1.tsx`, the discarded first
     *              attempt at the page-duplication fix, kept ON PURPOSE as the
     *              thing three probes are written to fail against — and cited by
     *              name in `src/editor/PageEditor.tsx` and those three probes.
     */
    regex: '^qa/(?!baseline/|verify/|wip/)',
    why: 'capture leftovers, refutation scratch, comparison boards — baseline, verify and wip spared',
  },
  {
    /*
     * Capture OUTPUT under shots-now, but not CODE.
     *
     * The first version was `^shots-now/[^/]+/` on the reasoning that the
     * scripts live at the root and only output lives below. Four of them do
     * not: `hero/accent-board.mjs`, `hero/wall-board.mjs`, `hero/fit-shot.mjs`
     * and `hero/board.py`, two of which are cited by name from
     * `src/art/wallpaperDesign.ts` and `src/styles/tokens.css` as how a figure
     * was made. The lookahead spares anything whose basename is source or a
     * run report; the megabytes are all PNG.
     */
    regex: '^shots-now/[^/]+/(?!.*\\.(?:mjs|py|md|json)$)',
    why: 'room-rank, roster, hero, dice — PNGs only; .mjs/.py/.md/.json spared wherever they sit',
  },
  {
    regex: '^assets/(generated|photoreal|scenes|cutouts)/',
    why: 'the painterly pipeline deleted by RESET-render-architecture.md, and its source art',
  },
];

/**
 * Paths that must survive, checked after a run rather than assumed.
 *
 * This list is a convenience, NOT the safety property — see `liveCasualties`
 * below for that. Six named paths is exactly the kind of check that passes
 * while something else is being deleted, which is what happened: the rehearsal
 * found 26 live files going, and every one of them sat outside this list.
 */
const MUST_SURVIVE = [
  'qa/baseline',
  'qa/verify',
  'qa/wip',
  'shots-now/visual-suite.mjs',
  'shots-now/demo-gif.mjs',
  'shots-now/hero/wall-board.mjs',
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

/**
 * THE SAFETY PROPERTY: **nothing tracked at HEAD may be removed from history.**
 *
 * This is the invariant, and everything else in this file is a convenience.
 * Deleting a path's history is defensible only when the path is already gone —
 * then the history is a record of something nobody can open. The moment a rule
 * reaches a file that exists in the current tree, the rewrite stops being a
 * cleanup and becomes a deletion, and it takes the file off disk as well, since
 * filter-repo re-checks-out afterwards.
 *
 * It is enforced rather than asserted because it was asserted and was false.
 * The header of this file used to say "every path in that list is already
 * absent from the working tree or ignored… nobody loses anything they can
 * currently open". A rehearsal on a throwaway clone found 26 tracked files
 * going: eighteen QA driver programs under `qa/verify/`, the deliberately-kept
 * discarded duplication fix under `qa/wip/`, four capture scripts inside
 * `shots-now/hero/`, and three run reports. Five of them are cited by name from
 * live source, so the comments would have become pointers to nothing. Together
 * they are 0.52 MB of the 1,101 MB the rewrite saves — a rounding error traded
 * for twenty-two working programs.
 *
 * A named-paths list did not catch it: `MUST_SURVIVE` had six entries and all
 * 26 casualties sat outside them. Only asking the actual index can.
 */
function liveCasualties(matchers) {
  return sh('git ls-files')
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .filter((p) => matchers.some((m) => m.re.test(p)));
}

/** The rules, compiled once. JS and Python agree on all the syntax used here. */
const matchersOf = (rules) => rules.map((r) => ({ ...r, re: new RegExp(r.regex) }));

/* ---------------------------------------------------------------------- dry */

if (DRY) {
  const rows = blobsByPath();
  const matchers = matchersOf(REMOVE);
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

  // The invariant, last and loudest, because it is the one that matters.
  const casualties = liveCasualties(matchers);
  console.log('');
  if (casualties.length === 0) {
    console.log('  no file tracked at HEAD is matched by any rule.\n');
  } else {
    const bytes = casualties.reduce(
      (sum, p) => sum + (rows.find((r) => r.path === p)?.bytes ?? 0),
      0,
    );
    console.log(
      `  REFUSING: ${casualties.length} file(s) tracked at HEAD would be deleted` +
        ` (${mb(bytes)} of the saving):`,
    );
    for (const p of casualties.slice(0, 40)) console.log(`    ${p}`);
    if (casualties.length > 40) console.log(`    …and ${casualties.length - 40} more`);
    console.log('');
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}

/* ------------------------------------------------------------------- bundle */

/**
 * The only undo there is, written OUTSIDE the repository on purpose.
 *
 * It used to go in `qa/tmp/`, which is gitignored — a directory whose whole
 * character is "safe to delete", holding the sole surviving copy of 1.4 GB of
 * history. The rehearsal also established that filter-repo **wipes the reflog**,
 * so there is no second escape hatch: after the rewrite, this file is it.
 *
 * So it goes beside the repository rather than inside it, where a "clean up the
 * scratch directories" pass cannot reach it and where it is not confusable with
 * working output.
 */
function writeBundle() {
  const at = trySh('git rev-parse --short HEAD');
  const dir = join(sh('git rev-parse --show-toplevel'), '..');
  const out = join(dir, `alcove-pre-rewrite-${at}.bundle`);
  console.log(`  writing safety net: ${out}`);
  execFileSync('git', ['bundle', 'create', out, '--all'], { stdio: 'inherit' });
  console.log('  every ref is in that file; `git clone <file>` brings it all back.');
  console.log('  filter-repo wipes the reflog — after this runs, that file is the ONLY undo.\n');
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
   * was dropped entirely maps to all-zeros. Documents normally quote seven
   * characters, so entries are bucketed by the short form. A collision is
   * resolved only when a longer token identifies one entry; a seven-character
   * collision is named for a human rather than guessed at.
   */
  const byShort = new Map(); // short old prefix -> [{ oldSha, newSha }]
  for (const line of readFileSync(mapPath, 'utf8').split('\n')) {
    const [oldSha, newSha] = line.trim().split(/\s+/);
    if (!/^[0-9a-f]{40}$/.test(oldSha ?? '') || !/^[0-9a-f]{40}$/.test(newSha ?? '')) {
      continue;
    }
    const key = oldSha.slice(0, 7);
    const entries = byShort.get(key) ?? [];
    if (!entries.some((entry) => entry.oldSha === oldSha && entry.newSha === newSha)) {
      entries.push({ oldSha, newSha });
      byShort.set(key, entries);
    }
  }

  /**
   * Every tracked, non-binary file that could contain a hexadecimal token.
   *
   * `git grep -I` uses Git's own binary classification and searches the index's
   * tracked set. The small `[0-9a-f]` prefilter cannot omit a SHA, and it avoids
   * reading PNGs merely to decide they are PNGs. `-z` keeps spaces and other
   * ordinary filename punctuation lossless.
   */
  const trackedTextFiles = () => {
    try {
      const out = execFileSync(
        'git',
        ['grep', '-I', '-l', '-z', '-e', '[0-9a-f]', '--', '.'],
        { encoding: 'utf8', maxBuffer: 1 << 28 },
      );
      return out.split('\0').filter(Boolean);
    } catch (error) {
      // `git grep` uses 1 for the ordinary "nothing matched" result.
      if (error && typeof error === 'object' && error.status === 1) return [];
      throw error;
    }
  };

  const remapText = (text, file) => {
    const issues = [];
    let replacements = 0;
    const output = text.replace(/\b[0-9a-f]{7,40}\b/g, (sha) => {
      const entries = byShort.get(sha.slice(0, 7));
      if (!entries) return sha; // a hex colour, digest, or unrelated revision

      // Seven characters identify the bucket; longer references must agree
      // with the old full SHA over their whole quoted length.
      const matching = entries.filter(
        (entry) => sha.length === 7 || entry.oldSha.startsWith(sha),
      );
      if (matching.length === 0) return sha;
      if (matching.length > 1) {
        issues.push(`AMBIGUOUS ${sha} in ${file} — resolve by hand`);
        return sha;
      }
      const [{ newSha }] = matching;
      if (/^0+$/.test(newSha)) {
        issues.push(`DROPPED ${sha} in ${file} — its commit has no replacement`);
        return sha;
      }
      const next = newSha.slice(0, sha.length);
      if (next !== sha) replacements += 1;
      return next;
    });
    return { output, replacements, issues };
  };
  /*
   * A longer reference gets the SAME number of characters back.
   *
   * This line used to read `next.padEnd(sha.length, '')`, and `padEnd` with an
   * empty pad string is a no-op — so a 40-character SHA quoted in prose would
   * have been silently replaced by a 7-character one. Nothing in the tree
   * exercises it today (all 75 references are 7 chars, counted), which is
   * exactly why it would have survived to surprise somebody later.
   *
   * The full map is kept alongside the short one so a long reference is
   * rewritten from the real new SHA rather than padded from its prefix.
   */
  const files = trackedTextFiles();
  const changedFiles = [];
  let changed = 0;
  for (const file of files) {
    const before = readFileSync(file, 'utf8');
    const result = remapText(before, file);
    changed += result.replacements;
    if (result.output !== before) {
      writeFileSync(file, result.output);
      changedFiles.push(file);
    }
  }

  /*
   * Verification is a second read, not an assertion about the values above.
   * If a write was skipped, a new tracked document was forgotten, or a mapped
   * commit was dropped/ambiguous, this pass sees the stale token on disk.
   */
  const unresolved = [];
  for (const file of trackedTextFiles()) {
    const result = remapText(readFileSync(file, 'utf8'), file);
    unresolved.push(...result.issues);
    if (result.replacements > 0) {
      unresolved.push(`STALE mapped reference(s) remain in ${file}`);
    }
  }
  const uniqueUnresolved = [...new Set(unresolved)];
  console.log(
    `  remapped ${changed} reference(s) in ${changedFiles.length} file(s); ` +
      `verified ${files.length} tracked text file(s).`,
  );
  if (changedFiles.length > 0) {
    console.log('  changed files (stage only these):');
    for (const file of changedFiles) console.log(`    ${file}`);
  }
  if (uniqueUnresolved.length > 0) {
    console.error(`  verification failed — ${uniqueUnresolved.length} unresolved item(s):`);
    for (const issue of uniqueUnresolved) console.error(`    ${issue}`);
  } else {
    console.log('  verification passed — no mapped old commit reference remains.');
  }
  process.exit(uniqueUnresolved.length > 0 ? 1 : 0);
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
  console.error('  (a stash is safe — filter-repo rewrites refs/stash too, verified.)');
  process.exit(1);
}
if (!trySh('git filter-repo --version')) {
  console.error('  git filter-repo is not on PATH.');
  process.exit(1);
}

/*
 * The invariant, checked HERE too and not only in --dry-run.
 *
 * A guard that lives in the reporting mode is a guard the destructive mode does
 * not have, and the two get out of step the first time somebody widens a rule
 * and skips the dry run.
 */
{
  const casualties = liveCasualties(matchersOf(REMOVE));
  if (casualties.length > 0) {
    console.error(
      `\n  REFUSING: ${casualties.length} file(s) tracked at HEAD are matched by a removal rule.`,
    );
    console.error('  Deleting the history of a file that still exists also deletes the file.\n');
    for (const p of casualties.slice(0, 40)) console.error(`    ${p}`);
    if (casualties.length > 40) console.error(`    …and ${casualties.length - 40} more`);
    console.error('\n  Narrow the rule, or delete the file first and say so in the commit.\n');
    process.exit(1);
  }
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
    git diff --name-only                        inspect the files --remap printed
    git add -- <only those files> && git commit that remap as its own commit
    git remote add origin <url>                 filter-repo drops the remote
    git push --force origin main                deliberate, and typed by a person
    git push --force --tags origin              SEE BELOW — not optional
    git tag -a v0.4.0 && git push origin v0.4.0 AFTER the force-push, never before

  THE TAGS ARE NOT OPTIONAL. filter-repo rewrites v0.2.0 and v0.3.0 to point at
  the new commits, and a force-push of \`main\` alone leaves the REMOTE tags on
  the old ones. Nothing looks broken — GitHub keeps the old objects, and both
  Releases stay attached to their tag names — but the release pipeline calls
  \`git describe --tags --abbrev=0 <tag>~1\` to find the previous version, and a
  tag hanging off a parallel history is exactly the input that makes that answer
  quietly wrong. The notes for 0.4.0 would be diffed against a commit that is
  not this branch's 0.3.0.
`);
