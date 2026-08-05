/**
 * scripts/gen-readme.mjs — compose the front page OUT OF the two halves, so the
 * page a reader lands on carries the substance instead of pointing at it.
 *
 * The README used to be a signpost: two tables of anchor links and a sentence
 * per row. A reader who wanted to know what the installer puts on their disk had
 * to follow a link to find out, which is the wrong shape for the first page of a
 * shipped product. So the front page now carries the whole user manual and the
 * developer essentials inline — and it carries them WITHOUT anybody copying a
 * paragraph, because a copied paragraph is a paragraph that drifts.
 *
 * Three mechanisms, in the order they run.
 *
 *  1. **Generated regions.** `<!-- gen:name -->…<!-- /gen -->` in any of the
 *     three pages is rewritten from `tables[name]`. That is how the version
 *     appears: `package.json` is the only place `0.1.0` is typed, and the badge
 *     block and the download table are composed from it. A version bump plus
 *     `npm run readme:build` moves every mention of it at once.
 *
 *  2. **Lifts.** A half wraps a run of sections in
 *
 *         <!--lift: manual-->
 *         ## The first ten minutes
 *         …
 *         <!--/lift-->
 *
 *     and the front page places `<!-- gen:lift-manual -->…<!-- /gen -->` where
 *     it wants that text. The half stays the source; the front page gets a copy
 *     that is rebuilt, never edited. Editing a lifted region by hand is a red
 *     test, which is the entire value.
 *
 *  3. **Navigation for what is left.** `<!-- gen:deeper-reading -->` lists only
 *     the sections that were NOT lifted, so the table cannot offer the reader a
 *     link to something they have already read three inches higher up.
 *
 * ### Why concatenating the halves is still wrong, and what a lift does instead
 *
 * The halves live in `docs/readme/` and write 356 of their relative links as
 * `../../src/…`, which resolve from that directory and would 404 from the repo
 * root. Pasting a half into `README.md` breaks every one of them, silently —
 * `checkLinks()` in `check-readme.mjs` resolves a link from the directory of the
 * file it is written in, so it would go on passing while every link on the front
 * page went nowhere. That is why an earlier version of this file said flatly
 * that the halves must not be concatenated, and it was right about the mechanics
 * and wrong about the conclusion: the fix is to rewrite the links, not to refuse
 * to move the text.
 *
 * So `rewriteLift()` retargets every relative link through `path.posix.join`
 * from `docs/readme/` to the root, leaves fenced and inline code alone, and
 * resolves bare `#fragment` links against the front page's OWN headings —
 * keeping the ones that landed there with the text and pointing the rest back at
 * the half they came from. And because both halves carry a `## Notebook Script`
 * section, which would collide into `#notebook-script` and `#notebook-script-1`
 * the moment they shared a page, `assemble()` refuses to build a front page with
 * two headings that slug the same way, naming both lines. Lift one of them or
 * rename it; do not discover it as a link that lands at the top of the page.
 *
 * ### The check REPORTS; it does not block, and it never edits prose
 *
 * The reader's instruction: *"the check exists to say that hey something is
 * missing from readme, but final editing of readme is left in the hands of the
 * dev/ai"*. So `--check` prints a grouped report and exits **0**. Nothing here
 * rewrites a sentence anybody wrote: `--build` recomposes only the regions this
 * file owns — the badge strip, the download table, the contents list, the
 * navigation, and the copies of lifted sections — and every one of those is
 * marked in the source as generated.
 *
 * Two things still hold the line, and neither is this CLI:
 *
 *   - `tests/readme.test.ts` fails on drift. A stale COUNT is a fact, not an
 *     edit, and a fact that has stopped being true should be red.
 *   - `--strict` makes this exit 1, for a caller that wants a gate.
 *
 * Usage:
 *   npm run readme:build     rewrite the generated regions of all three pages
 *   node scripts/gen-readme.mjs --check     report what has drifted (exit 0)
 *   node scripts/gen-readme.mjs --check --strict     …and exit 1 if any has
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const README = 'README.md';

/**
 * Read one page with its line endings normalised to `\n`.
 *
 * Git on Windows is routinely configured with `core.autocrlf=true`, which hands
 * these four markdown files back from a checkout with CRLF endings while storing
 * them as LF. Every pattern in this file that anchors to a newline then stops
 * matching — `REGION_RE` wants `-->\n` and gets `-->\r\n` — and the failure is
 * the worst possible shape: `assemble()` finds none of its own regions, reports
 * all fourteen as "generated but never placed", and `npm run readme:build`
 * cannot rebuild the page it is looking straight at. It cost a session to
 * recognise, because the same test is green on Linux CI where the checkout is LF.
 *
 * Normalising on the way in fixes the composition and normalises the file on the
 * way out, since {@link assemble} writes what it built. LF is what git has stored
 * all along, so a rewritten page is not a diff.
 */
function readPage(rel) {
  return readFileSync(join(ROOT, rel), 'utf8').split('\r\n').join('\n');
}

/**
 * The halves, in reading order. `href` is how the front page reaches the file,
 * which is root-relative because the front page IS the root; `title` is what the
 * navigation calls it.
 */
export const PARTS = [
  {
    id: 'part-1',
    title: 'Part 1 — Using Alcove',
    href: 'docs/readme/part-1-users.md',
    audience: 'for the person writing in it',
    note: 'the whole user manual, as a page of its own — everything in Part 1 above',
  },
  {
    id: 'part-2',
    title: 'Part 2 — Building Alcove',
    href: 'docs/readme/part-2-developers.md',
    audience: 'for a developer, or for an AI agent helping one',
    note: 'the long form of Part 2 above, plus every corner this page does not go into',
  },
];

/** Every markdown page this script composes or navigates. */
export const PAGES = [README, ...PARTS.map((p) => p.href)];

/**
 * Pages that are not composed but are still navigated — their links and
 * fragments are resolved with everybody else's.
 *
 * The release notes were the first: they used to open the front page, which is
 * the wrong thing to hand somebody who has not installed the app yet, so they
 * moved to a page of their own and the front page links to them. A page that is
 * linked but unchecked is how the last set of broken anchors happened.
 */
export const SIDE_PAGES = ['docs/readme/releases.md'];

/** Every markdown page this script knows about, composed or not. */
export const DOC_PAGES = [...PAGES, ...SIDE_PAGES];

/* --------------------------- the shipped product ------------------------- */

/** Where releases are published. The repo the remote actually points at. */
export const RELEASES = 'https://github.com/AkshitIreddy/alcove/releases';

/**
 * Rounded size of the NSIS installer, for the download table.
 *
 * Measured off the 0.2.0 bundle — `Alcove_0.2.0_x64-setup.exe` is 16,961,883
 * bytes — and deliberately NOT a `<!--f:…-->` marker: the bundle is not checked
 * in, so a marker recomputed from the tree would read 0 on every clean clone and
 * a fact that quietly reads 0 is worse than a rounded one that says "about".
 *
 * It grew 1.6 MB at 0.2.0 and that was a decision, not drift:
 * `webviewInstallMode` moved from `downloadBootstrapper` to `embedBootstrapper`,
 * so the installer carries Microsoft's WebView2 bootstrapper instead of fetching
 * it. docs/packaging-windows.md has all three modes with their measured sizes.
 */
const INSTALLER_SIZE = 'about 16 MB';

/**
 * The version, from the one file that owns it — cross-checked against the Rust
 * side, because a `package.json` and a `tauri.conf.json` that disagree ship an
 * installer whose filename does not match the number on the badge.
 */
export function appVersion() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const conf = JSON.parse(readFileSync(join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  if (pkg.version !== conf.version) {
    throw new Error(
      `package.json says version ${pkg.version} and src-tauri/tauri.conf.json says ` +
        `${conf.version} — the installer is named from the second and the badge from ` +
        `the first, so they have to agree before this page can be built`,
    );
  }
  return pkg.version;
}

const badgeText = (s) => encodeURIComponent(s.replace(/-/g, '--').replace(/_/g, '__'));
const shield = (label, message, colour) =>
  `https://img.shields.io/badge/${badgeText(label)}-${badgeText(message)}-${colour}` +
  `?style=flat-square&labelColor=4f3120`;

/** The badge strip: composed, so the version on it cannot lag `package.json`. */
export function renderBadges(version = appVersion()) {
  const img = (label, message, colour, alt) =>
    `  <img src="${shield(label, message, colour)}" alt="${alt}">`;
  return [
    '<p align="center">',
    `  <a href="${RELEASES}/latest"><img src="${shield(
      'download',
      `Alcove ${version}`,
      'c96f4a',
    )}" alt="Download Alcove ${version}"></a>`,
    /*
     * LIVE shields, now that the repository is public.
     *
     * These two were static images with a comment above the generated block
     * explaining why: shields.io cannot read a private repo's releases or its
     * actions, and would have rendered "inaccessible" where a fact should be.
     * That constraint is gone, and a badge that reports the real latest release
     * and the real build status is worth more than one that repeats
     * package.json back at itself.
     */
    `  <a href="${RELEASES}/latest"><img src="https://img.shields.io/github/v/release/AkshitIreddy/alcove?style=flat-square&labelColor=4f3120&color=b8863b&label=latest" alt="Latest release"></a>`,
    `  <a href="https://github.com/AkshitIreddy/alcove/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/AkshitIreddy/alcove/release.yml?style=flat-square&labelColor=4f3120&label=build" alt="Release build status"></a>`,
    // Windows first because it is the platform this was built and used on, but
    // no longer ALONE: the release workflow builds a universal macOS .dmg and
    // Linux packages from the same tag, and a badge that said Windows only
    // would now be telling two thirds of the readers to go away.
    img(
      'platform',
      'Windows · macOS · Linux',
      '7d915c',
      'Platforms: Windows, macOS and Linux',
    ),
    img('offline', 'no account · no cloud', '5f7d8c', 'Offline: no account, no cloud'),
    img('licence', 'MIT', '6f6a86', 'Licence: MIT'),
    '</p>',
  ].join('\n');
}

/**
 * The download table: one row per platform, all three of them.
 *
 * It used to say "not built yet" against macOS and Linux, which was true of the
 * old single-job workflow and stopped being true when the release job grew a
 * three-runner matrix. The rows now name the file each platform actually gets
 * and what it costs you on first launch.
 *
 * It also used to end by telling the reader what to do if the Releases page was
 * empty, and to hand them `npm run tauri build` in the same breath. Both went at
 * 0.2.0, on the reader's instruction to *"write the readme like install exe and
 * published version is there"*: a download section that hedges about whether
 * there is anything to download reads as a project rather than a product, and
 * building from source is a developer errand that Part 2 already covers. What
 * stays is the one caveat a reader meets in the first thirty seconds anyway —
 * that nothing is signed, so the OS will say so.
 *
 * Every path in it is inline code and every link is absolute, deliberately: this
 * table is written into a half and then lifted to the root, and a repo-relative
 * link would have to be correct in two directories at once.
 */
export function renderDownloads(version = appVersion()) {
  const exe = `Alcove_${version}_x64-setup.exe`;
  const msi = `Alcove_${version}_x64_en-US.msi`;
  const dmg = `Alcove_${version}_universal.dmg`;
  return [
    '| Platform | What to download | First launch |',
    '| --- | --- | --- |',
    `| **Windows 10 / 11** · x64 | [\`${exe}\`](${RELEASES}/latest) · ${INSTALLER_SIZE} | ` +
      'Double-click. It installs for **the current user**, so Windows never asks for an ' +
      'administrator. SmartScreen warns once — *More info* → *Run anyway*. |',
    `| **macOS 11+** · Apple silicon and Intel | [\`${dmg}\`](${RELEASES}/latest) | ` +
      'One universal disk image for both chips, so there is nothing to choose between. ' +
      'Unsigned, so the first open is right-click → *Open* rather than a double-click. |',
    `| **Linux** · x64 | [\`.deb\`, \`.rpm\` or \`.AppImage\`](${RELEASES}/latest) | ` +
      'Built on Ubuntu 22.04, so it runs on 22.04 and anything newer. The AppImage needs ' +
      'no install — mark it executable and run it. |',
    '',
    'All three are built from the same tag by `.github/workflows/release.yml` ' +
      'and attached to the GitHub Release with a `SHA256SUMS.txt` beside them. ' +
      `Windows also gets \`${msi}\`, the same app as an MSI, for anyone who deploys ` +
      'software with a policy rather than a double-click.',
    '',
    `There is a second Windows file, \`Alcove_${version}_x64-setup-offline.exe\`, and ` +
      'you almost certainly do not want it. Alcove draws itself in the Microsoft Edge ' +
      'WebView2 runtime, which is already on any current Windows — the normal installer ' +
      'fetches it in the rare case it is missing, and the offline one carries the whole ' +
      'runtime instead, which is why it is around 217 MB rather than 16. Take it only if ' +
      'the machine has no internet, or the normal installer failed while fetching.',
    '',
    '**Nothing is signed on any platform yet**, which is why the first-launch column ' +
      'says what it says, and why the checksums are there: the line for your file in ' +
      '`SHA256SUMS.txt` is how you check the download yourself rather than taking ' +
      "anybody's word for it.",
  ].join('\n');
}

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

/**
 * Two headings that slug the same way on one page: the second is reachable only
 * as `#slug-1`, which nothing writes, so every link meant for it lands on the
 * first. Cheap to detect, invisible to a reader, and the exact reason the halves
 * were kept apart before lifts existed.
 */
export function duplicateSlugs(text) {
  const seen = new Map();
  const problems = [];
  for (const h of headings(text)) {
    const base = slugify(h.text);
    const first = seen.get(base);
    if (first === undefined) seen.set(base, h);
    else
      problems.push(
        `heading '${h.text}' (line ${h.line}) slugs to '#${base}', the same as ` +
          `'${first.text}' (line ${first.line}) — only the first is reachable`,
      );
  }
  return problems;
}

/* --------------------------------- lifts --------------------------------- */

const LIFT_OPEN = /^<!--lift:\s*([a-z0-9-]+)\s*-->\s*$/;
const LIFT_CLOSE = /^<!--\/lift-->\s*$/;

/**
 * Every `<!--lift: name-->…<!--/lift-->` block of one source, plus the line span
 * each covers so a section can be asked whether it was lifted.
 *
 * Unclosed blocks throw by name: a lift that runs to the end of the file would
 * quietly move the whole half onto the front page.
 */
export function liftsOf(text) {
  const lines = text.split('\n');
  const found = new Map();
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const start = LIFT_OPEN.exec(lines[i]);
    if (start !== null) {
      if (open !== null) {
        throw new Error(
          `line ${i + 1}: <!--lift: ${start[1]}--> opens inside <!--lift: ${open.name}--> ` +
            `(line ${open.from}) — lifts do not nest`,
        );
      }
      open = { name: start[1], from: i + 1, body: [] };
      continue;
    }
    if (LIFT_CLOSE.test(lines[i])) {
      if (open === null) throw new Error(`line ${i + 1}: <!--/lift--> with no lift open`);
      if (found.has(open.name)) {
        throw new Error(`two lifts are named '${open.name}' — names are the region key`);
      }
      found.set(open.name, { name: open.name, from: open.from, to: i + 1, body: open.body.join('\n') });
      open = null;
      continue;
    }
    if (open !== null) open.body.push(lines[i]);
  }
  if (open !== null) {
    throw new Error(`<!--lift: ${open.name}--> (line ${open.from}) is never closed`);
  }
  return found;
}

// A markdown link, an HTML `src="…"`, or a run of inline code. Code comes first
// so a path quoted as an illustration is never retargeted; a link whose LABEL
// contains code still matches as a link, because the `[` is reached first.
//
// The label may wrap across lines — the halves are hard-wrapped at 80 columns
// and several links break mid-label — but not across a blank line, which would
// let one stray `[` in a paragraph swallow the next paragraph's link. Inline
// code, by contrast, is line-bounded: an unpaired backtick is a typo, not an
// invitation to treat the rest of the section as code.
const INLINE_RE =
  /(`+[^`\n]*?`+)|(!?\[(?:[^\]\n]|\n(?!\n))*\])\(\s*([^)\s]+)((?:\s+"[^"]*")?)\s*\)|(src=")([^"]+)(")/g;

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * One link, moved from a page in `fromDir` to the repo root.
 *
 * A bare `#fragment` is the interesting case: it means "elsewhere on my own
 * page", and once the text is on the front page that is only true if the heading
 * came with it. So it is resolved against the front page's real slugs, and
 * pointed back at `href` when it is not there.
 *
 * The mirror of that: a link INTO the other half, at a section the front page
 * also carries, collapses to the plain fragment. Otherwise the page a reader is
 * already reading would send them somewhere else to read the same words, which
 * is the signpost behaviour this whole mechanism exists to end.
 */
export function retarget(target, fromDir, href, slugs) {
  if (EXTERNAL.test(target)) return target;
  if (target.startsWith('#')) {
    return slugs.has(decodeURI(target.slice(1))) ? target : `${href}${target}`;
  }
  const hash = target.indexOf('#');
  const file = hash === -1 ? target : target.slice(0, hash);
  const frag = hash === -1 ? '' : target.slice(hash);
  if (file === '') return target;
  const moved = posix.join(fromDir, file);
  if (frag !== '' && PARTS.some((p) => p.href === moved) && slugs.has(decodeURI(frag.slice(1)))) {
    return frag;
  }
  return moved + frag;
}

const FENCE_RE = /^\s*(`{3,}|~{3,})/;

/**
 * Rewrite every link in `text` outside fenced code, leaving code untouched.
 *
 * The fence is tracked by its own marker rather than toggled on sight, because
 * the user half quotes a whole Notebook Script document inside a ````` ```` `````
 * fence and that document contains ` ```graph ` fences of its own. Toggling
 * would treat the graph's body as prose.
 */
function rewriteLinks(text, map) {
  const out = [];
  let prose = [];
  let fence = null;
  // Prose is rewritten in runs rather than line by line, so a link whose label
  // wraps is still one match. Everything inside a fence is emitted untouched.
  const flush = () => {
    if (prose.length === 0) return;
    out.push(
      prose.join('\n').replace(INLINE_RE, (whole, code, label, target, title, pre, src, post) => {
        if (code !== undefined) return whole;
        if (label !== undefined) return `${label}(${map(target)}${title ?? ''})`;
        return `${pre}${map(src)}${post}`;
      }),
    );
    prose = [];
  };
  for (const line of text.split('\n')) {
    const m = FENCE_RE.exec(line);
    if (m !== null) {
      if (fence === null) {
        flush();
        fence = m[1];
      } else if (m[1][0] === fence[0] && m[1].length >= fence.length) {
        fence = null;
      }
      out.push(line);
      continue;
    }
    if (fence !== null) out.push(line);
    else prose.push(line);
  }
  flush();
  return out.join('\n');
}

/**
 * One lift, as the front page should carry it: nested generated markers
 * dropped, links moved to the root, fragments resolved against the front page's
 * own headings.
 *
 * The `<!-- gen:… -->` markers go because a generated region inside a generated
 * region is a region nobody can rewrite. The `<!--nav: …-->` summaries **stay**:
 * they used to be stripped on the grounds that they described a row in a table
 * about the half rather than about this page, and that stopped being true when
 * the front page's contents list grew a line of description per section. They
 * are HTML comments, so a reader never sees them either way — and keeping them
 * means the sentence describing a section is written once, beside it.
 */
export function rewriteLift(lift, part, slugs) {
  const fromDir = posix.dirname(part.href.split('\\').join('/'));
  const kept = lift.body
    .split('\n')
    .filter(
      (line) =>
        !/^<!--\s*gen:[a-z0-9-]+\s*-->\s*$/.test(line) &&
        !/^<!--\s*\/gen\s*-->\s*$/.test(line),
    )
    .join('\n');
  return rewriteLinks(kept, (t) => retarget(t, fromDir, part.href, slugs)).trim();
}

/* ------------------------------- navigation ------------------------------ */

const NAV_RE = /^<!--nav:\s*([\s\S]*?)\s*-->\s*$/;

/**
 * The `##` sections of one half, each with the summary written beside it and a
 * flag saying whether the front page already carries it.
 *
 * Throws by name when a section has no `<!--nav: …-->`. A section the front page
 * cannot describe is a section it would silently omit, which is the failure this
 * file exists to prevent — so it is loud, and it names the line.
 */
export function sectionsOf(part, text = readPage(part.href)) {
  const lifts = [...liftsOf(text).values()];
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
    sections.push({
      text: h.text,
      slug: h.slug,
      nav: m[1],
      lifted: lifts.some((l) => h.line > l.from && h.line < l.to),
    });
  }
  if (sections.length === 0) {
    throw new Error(`${part.href} has no '## ' sections — the front page would be blank`);
  }
  return sections;
}

/** A table cell: the one character that would split a row is escaped. */
const cell = (s) => s.replace(/\|/g, '\\|');

/**
 * One half's own contents list, as bullets with the summary beside each.
 *
 * Composed rather than typed for the reason everything else on these pages is:
 * the hand-written version of this list on Part 1 outlived two renamed sections
 * and one deleted one, and a contents list that lies about its own page is
 * worse than no contents list. The sentences are the `<!--nav: …-->` lines that
 * already sit beside each heading, so there is exactly one place to write them.
 */
export function renderPartContents(part, sections) {
  return sections.map((s) => `- [${cell(s.text)}](#${s.slug}) — ${cell(s.nav)}`).join('\n');
}

/** The navigation table for one half, one row per section, in source order. */
export function renderNavTable(part, sections) {
  return [
    '| Section | What you get |',
    '| --- | --- |',
    ...sections.map((s) => `| [${cell(s.text)}](${part.href}#${s.slug}) | ${cell(s.nav)} |`),
  ].join('\n');
}

/**
 * What is left after the lifts: per half, a line saying what it is, and a table
 * of only the sections the front page does NOT already carry.
 */
export function renderDeeper(halves) {
  const out = [];
  for (const { part, want } of halves) {
    const rest = sectionsOf(part, want).filter((s) => !s.lifted);
    const note = part.note.charAt(0).toUpperCase() + part.note.slice(1);
    out.push(`**[${part.title}](${part.href})** — *${part.audience}.* ${note}.`);
    if (rest.length > 0) out.push('', renderNavTable(part, rest));
    out.push('');
  }
  return out.join('\n').trimEnd();
}

/**
 * The front page's contents: a bullet list, grouped under the `#` dividers that
 * split the page into its two halves, each line carrying the one-sentence
 * summary written beside its heading.
 *
 * This was one run-on paragraph of twenty-two links separated by interpuncts,
 * and the reader's words about it were *"the on this page section could perhaps
 * be better with a bullet list or something"*. The grouping is the more
 * important half of the fix: a reader who wants to know how to use the app
 * should be able to see, without reading a single link, where the half written
 * for them stops and the half written for somebody changing the code starts.
 *
 * The group titles and their descriptions are the `#` headings and their own
 * `<!--nav: …-->` lines, so this function invents no words — it is a view of the
 * page it is given.
 */
export function renderContents(text) {
  const groups = [];
  let group = { title: null, nav: '', items: [] };
  for (const h of headings(text)) {
    const nav = NAV_RE.exec(h.next.trim());
    const summary = nav === null ? '' : nav[1].trim();
    if (h.depth === 1) {
      if (group.items.length > 0) groups.push(group);
      group = { title: h.text, nav: summary, items: [] };
      continue;
    }
    if (h.depth !== 2) continue;
    group.items.push({ text: h.text, slug: h.slug, nav: summary });
  }
  if (group.items.length > 0) groups.push(group);

  const out = [];
  for (const g of groups) {
    if (out.length > 0) out.push('');
    if (g.title !== null) {
      out.push(g.nav === '' ? `**${g.title}**` : `**${g.title}** — ${g.nav}`, '');
    }
    for (const item of g.items) {
      const link = `[${cell(item.text)}](#${item.slug})`;
      out.push(item.nav === '' ? `- ${link}` : `- ${link} — ${item.nav}`);
    }
  }
  return out.join('\n');
}

/* -------------------------------- assembly ------------------------------- */

// The body is lazy AND may be empty — an empty region is how a new one is
// added by hand, and a pattern that needs a line to sit in runs straight past
// it into the NEXT region's closing marker, silently swallowing both.
const REGION_RE = /(<!-- gen:([a-z0-9-]+) -->\n)([\s\S]*?)(<!-- \/gen -->)/g;

/** Rewrite every `<!-- gen:name -->…<!-- /gen -->` region of one page. */
function replaceRegions(current, tables, placed, unknown) {
  return current.replace(REGION_RE, (match, open, name, _old, close) => {
    const body = tables[name];
    if (body === undefined) {
      unknown.add(name);
      return match;
    }
    placed.add(name);
    return `${open}${body === '' ? '' : `${body}\n`}${close}`;
  });
}

/**
 * All three pages as they should be, beside the ones on disk.
 *
 * Two passes, because the front page's own table of contents and its lifted
 * `#fragment` links both need to know what headings the finished page has. Pass
 * one settles that; nothing in pass two adds or removes a heading, so pass two
 * is the fixed point rather than the start of an iteration.
 */
export function assemble() {
  const version = appVersion();
  const shared = { badges: renderBadges(version), downloads: renderDownloads(version) };

  const halves = PARTS.map((part) => {
    const have = readPage(part.href);
    // The lifted copy has to come from the half as it SHOULD be, or a stale
    // generated region in a half would be copied onto the front page as fact.
    const want = replaceRegions(have, shared, new Set(), new Set());
    return { part, have, want, lifts: liftsOf(want) };
  });

  const lifted = [];
  for (const half of halves) {
    for (const lift of half.lifts.values()) {
      const region = `lift-${lift.name}`;
      if (lifted.some((l) => l.region === region)) {
        throw new Error(`two halves both lift '${lift.name}' — the region name would collide`);
      }
      lifted.push({ region, lift, part: half.part });
    }
  }

  const tablesFor = (slugs, contents) => {
    const tables = { ...shared, contents, 'deeper-reading': renderDeeper(halves) };
    for (const half of halves) {
      tables[`contents-${half.part.id}`] = renderPartContents(
        half.part,
        sectionsOf(half.part, half.want),
      );
    }
    for (const { region, lift, part } of lifted) tables[region] = rewriteLift(lift, part, slugs);
    return tables;
  };

  const haveReadme = readPage(README);
  const draft = replaceRegions(haveReadme, tablesFor(new Set(), ''), new Set(), new Set());
  const collisions = duplicateSlugs(draft);
  if (collisions.length > 0) {
    throw new Error(
      `${README} would have two headings with one slug — lift only one of them, or ` +
        `rename it:\n  ${collisions.join('\n  ')}`,
    );
  }

  const tables = tablesFor(new Set(headings(draft).map((h) => h.slug)), renderContents(draft));
  const placed = new Set();
  const unknown = new Set();
  const pages = [
    { rel: README, have: haveReadme, want: replaceRegions(haveReadme, tables, placed, unknown) },
    ...halves.map((h) => ({
      rel: h.part.href,
      have: h.have,
      want: replaceRegions(h.have, tables, placed, unknown),
    })),
  ];

  if (unknown.size > 0) {
    throw new Error(
      `asked for unknown generated region(s): ${[...unknown].join(', ')} — known ` +
        `regions are ${Object.keys(tables).join(', ')}`,
    );
  }
  const orphans = Object.keys(tables).filter((name) => !placed.has(name));
  if (orphans.length > 0) {
    throw new Error(
      `region(s) ${orphans.join(', ')} are generated but never placed — add ` +
        `<!-- gen:${orphans[0]} -->\n<!-- /gen --> to ${README}`,
    );
  }
  return { pages, tables };
}

/* -------------------------------- anchors -------------------------------- */

const LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/**
 * Resolve every `#fragment` across the three pages against the real headings of
 * the file it points into.
 *
 * `check-readme.mjs` splits the fragment off and stats the file, which passes a
 * link to a section that was renamed out from under it. That is precisely the
 * drift the front page is made of — most of its links carry a fragment — so it
 * is checked here rather than left to a reader noticing they landed at the top.
 */
export function checkAnchors(pages = DOC_PAGES) {
  const problems = [];
  const anchors = new Map();
  const anchorsFor = (rel) => {
    if (!anchors.has(rel)) {
      anchors.set(rel, new Set(headings(readPage(rel)).map((h) => h.slug)));
    }
    return anchors.get(rel);
  };
  let checked = 0;
  for (const rel of pages) {
    const text = readPage(rel);
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

/* ------------------------------ what is missing -------------------------- */

/**
 * Front-page sections with no `<!--nav: …-->` beside the heading.
 *
 * Not a failure — a NOTE. The contents list simply has no sentence to put next
 * to that link, so the section is harder to find than its neighbours. Which
 * sentence to write is an editorial decision, and this file does not make
 * editorial decisions; it says which line is blank and leaves it there.
 *
 * The halves are not scanned here because {@link sectionsOf} already refuses to
 * build a page from a section that has no summary at all.
 */
export function missingSummaries(page = README) {
  const text = readPage(page);
  const notes = [];
  for (const h of headings(text)) {
    if (h.depth > 2) continue;
    if (NAV_RE.test(h.next.trim())) continue;
    notes.push(
      `${page}:${h.line} "${h.text}" has no <!--nav: …--> summary — it will appear ` +
        'in the contents list as a bare link',
    );
  }
  return notes;
}

/**
 * Everything `--check` looks at, as data — so the vitest gate and the CLI
 * cannot drift apart by checking different things.
 *
 * `problems` are things that are WRONG: a page that no longer matches the
 * sources it is composed from, a fragment that lands nowhere. `notes` are
 * things that are MISSING, which is a different kind of statement and is
 * reported rather than failed.
 */
export function checkReadme() {
  const problems = [];
  try {
    for (const page of assemble().pages) {
      if (page.have === page.want) continue;
      problems.push(
        `${page.rel} does not match its sources:`,
        ...firstDifferences(page.want, page.have),
        '',
        'Run: npm run readme:build',
      );
    }
  } catch (err) {
    problems.push(err instanceof Error ? err.message : String(err));
  }
  const anchors = checkAnchors();
  problems.push(...anchors.problems);
  let notes = [];
  try {
    notes = missingSummaries();
  } catch (err) {
    problems.push(err instanceof Error ? err.message : String(err));
  }
  return { problems, notes, anchors: anchors.checked };
}

/* --------------------------------- the CLI ------------------------------- */

/** One headed block of a report, or nothing at all when the list is empty. */
function block(title, lines, advice) {
  if (lines.length === 0) return;
  console.log(`\n  ${title} (${lines.length})`);
  for (const line of lines) console.log(`    ${line.startsWith(' ') ? line.trim() : line}`);
  if (advice) console.log(`    → ${advice}`);
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const strict = process.argv.includes('--strict');
  if (process.argv.includes('--check')) {
    const { problems, notes, anchors } = checkReadme();
    console.log(
      `README composition — ${PAGES.length} page(s) composed, ${anchors} anchor link(s) ` +
        'resolved',
    );
    block('out of date, and this script can rewrite it', problems, 'npm run readme:build');
    block('no summary written for it yet', notes, 'add <!--nav: one sentence--> under the heading');
    if (problems.length === 0 && notes.length === 0) {
      console.log('\n  nothing has drifted, nothing is missing.');
    } else if (!strict) {
      console.log(
        '\n  Reported, not enforced — what the page should say is yours to decide.\n' +
          '  (npx vitest run tests/readme.test.ts is the gate; --strict exits 1 here.)',
      );
    }
    process.exit(strict && problems.length > 0 ? 1 : 0);
  }
  const { pages, tables } = assemble();
  const rewritten = [];
  for (const page of pages) {
    if (page.have === page.want) continue;
    writeFileSync(join(ROOT, page.rel), page.want, 'utf8');
    rewritten.push(page.rel);
  }
  const liftedLines = Object.entries(tables)
    .filter(([name]) => name.startsWith('lift-'))
    .reduce((n, [, body]) => n + body.split('\n').length, 0);
  const anchors = checkAnchors();
  console.log(
    `${rewritten.length === 0 ? 'already up to date' : `rewritten: ${rewritten.join(', ')}`} — ` +
      `${Object.keys(tables).length} generated region(s), ${liftedLines} line(s) lifted ` +
      `from the halves, ${anchors.checked} anchor link(s) resolved`,
  );
  block('fragments that land nowhere', anchors.problems, 'rename the link, or the heading');
  process.exit(strict && anchors.problems.length > 0 ? 1 : 0);
}
