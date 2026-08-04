/**
 * scripts/gen-readme.mjs — compose the front page's navigation from the two
 * halves, so it cannot describe a document that no longer exists.
 *
 * The README is three pages, not one file: [`README.md`](../README.md) is a
 * front door, and `docs/readme/part-1-users.md` and `part-2-developers.md` are
 * pages a reader opens. That is deliberate and it is load-bearing — the halves
 * write 356 of their relative links as `../../src/…`, which resolve from
 * `docs/readme/` and would 404 from the repo root, and both halves carry a
 * `## Notebook Script` section, which would collide into `#notebook-script` and
 * `#notebook-script-1` the moment they shared a page. Concatenating them is not
 * a formatting choice; it breaks every link in the developer half and silently
 * repoints half the front page's own table. `scripts/check-readme.mjs` says the
 * same thing in its header, having already been wrong about it once.
 *
 * What that leaves is a real assembly problem in a different place. The front
 * page's body is almost entirely *navigation into the halves* — two tables, one
 * row per section, each row an anchor link plus a sentence describing it. Those
 * rows were typed by hand, which is exactly how a fragment goes stale: rename a
 * heading and the row still renders, still looks right, and lands the reader at
 * the top of the page instead of the section. Nothing caught it, because
 * `checkLinks()` splits `#` off and stats the file.
 *
 * So the rows are no longer typed. Each `##` in a half carries an invisible
 * summary next to the thing it summarises:
 *
 *     ## Installing
 *     <!--nav: What the download will be, what the installer does, …-->
 *
 * and this script writes the tables into the marked regions of README.md, in
 * source order, one row per section — no orphans, no phantoms. Same shape as
 * `npm run spec:check`, and for the same reason: a generator nobody runs is
 * worth nothing, a check that fails a test run is worth everything.
 *
 * Usage:
 *   npm run readme:build     rewrite the generated regions of README.md
 *   node scripts/gen-readme.mjs --check     fail if README.md has drifted
 *
 * `--check` is wired into `tests/readme.test.ts`, so a renamed section is a red
 * test rather than a link that quietly goes nowhere.
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const README = 'README.md';

/**
 * The halves, in reading order. `region` is the name in the README placeholder
 * (`<!-- gen:part-1-sections -->`); `href` is how the front page reaches the
 * file, which is root-relative because the front page IS the root.
 */
export const PARTS = [
  { id: 'part-1', region: 'part-1-sections', href: 'docs/readme/part-1-users.md' },
  { id: 'part-2', region: 'part-2-sections', href: 'docs/readme/part-2-developers.md' },
];

/** Every markdown page the front page's navigation spans. */
export const PAGES = [README, ...PARTS.map((p) => p.href)];

/* -------------------------------- headings ------------------------------- */

/**
 * GitHub's heading slug: lowercase, drop anything that is not alphanumeric,
 * space, hyphen or underscore (so backticks, apostrophes, commas and em-dashes
 * vanish rather than becoming hyphens), then spaces to hyphens.
 */
export function slugify(heading) {
  return heading
    .replace(/^#+\s*/, '')
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Every heading in a markdown source, with the slug a browser would land on.
 *
 * Fenced code is skipped: `# comment` inside a bash block is not a section, and
 * counting it would shift the `-1` suffix of a genuinely repeated heading.
 */
export function headings(text) {
  const out = [];
  const seen = new Map();
  let fenced = false;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const base = slugify(m[2]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.push({
      depth: m[1].length,
      text: m[2],
      slug: n === 0 ? base : `${base}-${n}`,
      line: i + 1,
      next: lines[i + 1] ?? '',
    });
  }
  return out;
}

const NAV_RE = /^<!--nav:\s*([\s\S]*?)\s*-->\s*$/;

/**
 * The `##` sections of one half, each with the summary written beside it.
 *
 * Throws by name when a section has no `<!--nav: …-->`. A section the front
 * page cannot describe is a section it would silently omit, which is the
 * failure this file exists to prevent — so it is loud, and it names the line.
 */
export function sectionsOf(part, text = readFileSync(join(ROOT, part.href), 'utf8')) {
  const sections = [];
  for (const h of headings(text)) {
    if (h.depth !== 2) continue;
    const m = NAV_RE.exec(h.next.trim());
    if (m === null) {
      throw new Error(
        `${part.href}:${h.line} section "${h.text}" has no summary — add\n` +
          `    <!--nav: one sentence saying what the reader gets-->\n` +
          `  on the line directly under the heading, then run: npm run readme:build`,
      );
    }
    sections.push({ text: h.text, slug: h.slug, nav: m[1] });
  }
  if (sections.length === 0) {
    throw new Error(`${part.href} has no '## ' sections — the front page would be blank`);
  }
  return sections;
}

/* ------------------------------- rendering ------------------------------- */

/** A table cell: the one character that would split a row is escaped. */
const cell = (s) => s.replace(/\|/g, '\\|');

/** The navigation table for one half, one row per section, in source order. */
export function renderNavTable(part, sections) {
  return [
    '| Section | What you get |',
    '| --- | --- |',
    ...sections.map(
      (s) => `| [${cell(s.text)}](${part.href}#${s.slug}) | ${cell(s.nav)} |`,
    ),
  ].join('\n');
}

// The body is lazy AND may be empty — an empty region is how a new one is
// added by hand, and a pattern that needs a line to sit in runs straight past
// it into the NEXT region's closing marker, silently swallowing both.
const REGION_RE = /(<!-- gen:([a-z0-9-]+) -->\n)([\s\S]*?)(<!-- \/gen -->)/g;

/**
 * Rewrite every `<!-- gen:name -->…<!-- /gen -->` region of the front page.
 *
 * Unknown region names and unplaced regions both throw: a table generated but
 * never placed is a table nobody reads, and the reverse is a placeholder that
 * renders as a comment forever. `gen-spec.mjs` learned this the same way.
 */
export function buildReadme(current, tables) {
  const placed = new Set();
  const unknown = new Set();
  const body = current.replace(REGION_RE, (match, open, name, _old, close) => {
    const table = tables[name];
    if (table === undefined) {
      unknown.add(name);
      return match;
    }
    placed.add(name);
    return `${open}${table}\n${close}`;
  });
  if (unknown.size > 0) {
    throw new Error(
      `${README} asks for unknown generated region(s): ${[...unknown].join(', ')} — ` +
        `known regions are ${Object.keys(tables).join(', ')}`,
    );
  }
  const orphans = Object.keys(tables).filter((name) => !placed.has(name));
  if (orphans.length > 0) {
    throw new Error(
      `region(s) ${orphans.join(', ')} are generated but never placed — add ` +
        `<!-- gen:${orphans[0]} -->\n<!-- /gen --> to ${README}`,
    );
  }
  return body;
}

/** The front page as it should be: current file, generated regions rewritten. */
export function assemble() {
  const tables = {};
  for (const part of PARTS) {
    tables[part.region] = renderNavTable(part, sectionsOf(part));
  }
  const have = readFileSync(join(ROOT, README), 'utf8');
  return { have, want: buildReadme(have, tables), tables };
}

/* -------------------------------- anchors -------------------------------- */

const LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/**
 * Resolve every `#fragment` across the three pages against the real headings of
 * the file it points into.
 *
 * `check-readme.mjs` splits the fragment off and stats the file, which passes a
 * link to a section that was renamed out from under it. That is precisely the
 * drift the front page is made of — 84 of its links carry a fragment — so it is
 * checked here rather than left to a reader noticing they landed at the top.
 */
export function checkAnchors(pages = PAGES) {
  const problems = [];
  const anchors = new Map();
  const anchorsFor = (rel) => {
    if (!anchors.has(rel)) {
      anchors.set(rel, new Set(headings(readFileSync(join(ROOT, rel), 'utf8')).map((h) => h.slug)));
    }
    return anchors.get(rel);
  };
  let checked = 0;
  for (const rel of pages) {
    const text = readFileSync(join(ROOT, rel), 'utf8');
    const here = dirname(rel);
    for (const m of text.matchAll(LINK_RE)) {
      const target = m[1];
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue;
      const hash = target.indexOf('#');
      if (hash === -1) continue;
      const frag = decodeURI(target.slice(hash + 1));
      if (frag === '') continue;
      const file = decodeURI(target.slice(0, hash));
      const rest = file === '' ? rel : join(here, file).split('\\').join('/');
      if (!rest.endsWith('.md')) continue;
      checked += 1;
      const line = text.slice(0, m.index).split('\n').length;
      try {
        statSync(join(ROOT, rest));
      } catch {
        problems.push(`${rel}:${line} link target does not exist: ${target}`);
        continue;
      }
      if (!anchorsFor(rest).has(frag)) {
        problems.push(`${rel}:${line} no heading '#${frag}' in ${rest}`);
      }
    }
  }
  return { checked, problems };
}

/* ------------------------------ diff reporting --------------------------- */

/** First few differing lines as want/have pairs, for a legible failure. */
export function firstDifferences(want, have, limit = 8) {
  const a = want.split('\n');
  const b = have.split('\n');
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length) && out.length < limit * 2; i++) {
    if (a[i] === b[i]) continue;
    out.push(`  line ${i + 1}: want: ${a[i] ?? '(end of file)'}`);
    out.push(`  line ${i + 1}: have: ${b[i] ?? '(end of file)'}`);
  }
  return out;
}

/**
 * Everything `--check` checks, as data — so the vitest gate and the CLI cannot
 * drift apart by checking different things.
 */
export function checkReadme() {
  const problems = [];
  let want = '';
  try {
    const built = assemble();
    want = built.want;
    if (built.have !== want) {
      problems.push(
        `${README} does not match its sources:`,
        ...firstDifferences(want, built.have),
        '',
        'Run: npm run readme:build',
      );
    }
  } catch (err) {
    problems.push(err instanceof Error ? err.message : String(err));
  }
  const anchors = checkAnchors();
  problems.push(...anchors.problems);
  return { problems, want, anchors: anchors.checked };
}

/* --------------------------------- the CLI ------------------------------- */

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const check = process.argv.includes('--check');
  if (check) {
    const { problems, anchors } = checkReadme();
    for (const p of problems) console.error(p.startsWith(' ') ? p : `  ${p}`);
    console.log(
      `gen-readme: ${PARTS.length} halves composed, ${anchors} anchor ` +
        `link(s) resolved, ${problems.length} problem(s)`,
    );
    process.exit(problems.length === 0 ? 0 : 1);
  }
  const { have, want, tables } = assemble();
  if (have !== want) writeFileSync(join(ROOT, README), want, 'utf8');
  const rows = Object.values(tables).reduce((n, t) => n + t.split('\n').length - 2, 0);
  const anchors = checkAnchors();
  for (const p of anchors.problems) console.error(`  ${p}`);
  console.log(
    `README.md ${have === want ? 'already up to date' : 'rewritten'} — ` +
      `${rows} section row(s) from ${PARTS.length} halves, ` +
      `${anchors.checked} anchor link(s) resolved, ${anchors.problems.length} problem(s)`,
  );
  process.exit(anchors.problems.length === 0 ? 0 : 1);
}
