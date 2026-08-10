/**
 * Turns the commits since the previous version tag into concise release notes.
 *
 * Not a raw commit dump: subjects are cleaned up, grouped into reader-facing
 * sections, and grouped again by scope so "what actually happened" reads as a
 * short summary rather than a changelog wall.
 *
 * Usage: node scripts/release-notes.mjs [tag]   (defaults to the current HEAD tag)
 */
import { execSync } from 'node:child_process';
import { requiredChangelogForTag } from './release-changelog.mjs';

const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const trySh = (cmd) => {
  try {
    return sh(cmd);
  } catch {
    return '';
  }
};

const label = process.argv[2] ?? trySh('git describe --tags --exact-match HEAD') ?? '';
/*
 * Resolve to something git can actually walk — an unknown tag falls back to HEAD.
 *
 * NO `^` ANYWHERE IN THESE COMMANDS. `execSync` runs them through the platform
 * shell, and on Windows that is cmd.exe, where `^` is the escape character:
 * `git rev-parse --verify v0.3.0^{commit}` arrives as `v0.3.0{commit}`, fails,
 * and the tag argument is silently discarded. Running this locally for any tag
 * therefore described HEAD instead, and did it without a word — the notes for
 * v0.2.0 came out listing the 0.3 work. The release workflow runs on Linux, so
 * CI was right the whole time and only a human checking a tag by hand was lied
 * to. `~0` and `~1` mean the same things and survive both shells.
 */
const rev = label && trySh(`git rev-parse --verify ${label}~0`) ? label : 'HEAD';
const tag = label || 'unreleased';

/**
 * The hand-written release section is the actual product changelog. Commit
 * subjects are useful as an index, but they cannot replace the explanation of
 * what changed and why. A version tag therefore has a hard dependency on its
 * matching `## x.y.z` section: publishing without it is an error, not a link
 * to somewhere the reader may never open.
 */
const detailedChangelog = requiredChangelogForTag(tag);

/** The tag before this one, if any — otherwise summarise the whole history. */
const previous = trySh(`git describe --tags --abbrev=0 ${rev}~1`);

const range = previous ? `${previous}..${rev}` : rev;
const log = trySh(`git log ${range} --no-merges --pretty=format:%s`);
const subjects = log ? log.split('\n') : [];

// Reader-facing sections. Types not listed here fall into "Under the hood".
const SECTIONS = [
  { key: 'feat', title: "What's new" },
  { key: 'fix', title: 'Fixed' },
  { key: 'perf', title: 'Faster' },
  { key: 'docs', title: 'Docs' },
];
const HIDDEN = new Set(['chore', 'ci', 'build', 'test', 'style', 'refactor', 'wip']);

/*
 * Scopes that are hidden even when their TYPE is reader-facing.
 *
 * `docs(todo)` is the repository's own work list. Its subjects are written for
 * whoever picks the list up next and they are meaningless — occasionally
 * alarming — to somebody who has arrived to download an app: "restore two
 * entries lost in a bulk edit", "f225 re-checked against the running app — 51
 * canvases, 0 blank", "tick what landed — eleven items". v0.3.0 published three
 * of those under **Docs**; v0.4.0 would have published six, which is more lines
 * than the Fixed section it sits under.
 *
 * They are counted, not deleted — they roll into the "Plus N maintenance
 * changes" line at the foot, so the total still adds up and nothing is hidden
 * from anyone reading the compare view one link below.
 */
const HIDDEN_SCOPES = new Set(['todo']);
// Page-flip handoff commits record diagnostic checkpoints, including subjects
// such as "unresolved" that can be superseded later in the same release. Keep
// the reader-facing flip fixes, but leave those internal docs checkpoints out
// of the generated GitHub summary; the detailed changelog carries the resolved
// narrative instead.
const HIDDEN_TYPE_SCOPES = new Set(['docs:flip']);
const HIDDEN_TEXT = [/^checkpoint the owner-tested /i];
const isHidden = (c) =>
  HIDDEN.has(c.type) ||
  HIDDEN_SCOPES.has(c.scope) ||
  HIDDEN_TYPE_SCOPES.has(`${c.type}:${c.scope}`) ||
  HIDDEN_TEXT.some((pattern) => pattern.test(c.text));

const parsed = subjects
  .map((subject) => {
    const match = /^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/.exec(subject);
    if (!match) return { type: 'other', scope: '', text: subject };
    return { type: match[1], scope: match[2] ?? '', text: match[3] };
  })
  // Drop the noise commits and any interim "partial"/"wip" markers.
  .filter((c) => !/\b(wip|partial)\b/i.test(c.text));

/** Sentence-case, strip trailing periods, keep it scannable. */
const tidy = (text) =>
  text
    .replace(/\s+/g, ' ')
    .replace(/\.$/, '')
    .replace(/^([a-z])/, (m) => m.toUpperCase());

/*
 * THE DOWNLOAD TABLE GOES FIRST, above everything.
 *
 * The reader: *"in the releases page, the table of what is what should be at
 * top, and then under it what's new — otherwise that table gets buried in the
 * 'read more' of the GitHub UI."* Exactly right, and it is not a matter of
 * taste: GitHub collapses a long release body behind a fold, and the one thing
 * every visitor to a release page came for is which file to click. A changelog
 * is what you read AFTER you have the app.
 *
 * So the notes are composed in three parts and joined at the end, rather than
 * pushed onto one array in the order they happen to be computed.
 */
const REPO = 'https://github.com/AkshitIreddy/Alcove';
const RAW = 'https://raw.githubusercontent.com/AkshitIreddy/Alcove/main';

const head = [];
// Centred mark and title. GitHub release bodies do not resolve repo-relative
// image paths, so this has to be an absolute raw URL.
head.push('<div align="center">');
head.push('');
head.push(`<img src="${RAW}/assets/brand/alcove-1024.png" width="96" alt="">`);
head.push('');
head.push(`# Alcove ${tag}`);
head.push('');
head.push('**Built like a storybook library, with cozy shelves and patterned walls. Open every book into notebook pages filled with diagrams, notes, tape, and stickers.**');
head.push('');
head.push('</div>');
head.push('');

const total = parsed.length;
const feats = parsed.filter((c) => c.type === 'feat' && !isHidden(c)).length;
const fixes = parsed.filter((c) => c.type === 'fix' && !isHidden(c)).length;

const lines = [];

for (const section of SECTIONS) {
  const items = parsed.filter((c) => c.type === section.key && !isHidden(c));
  if (items.length === 0) continue;
  lines.push(`### ${section.title}`);
  // Group by scope so related work reads together.
  const byScope = new Map();
  for (const item of items) {
    const scope = item.scope || 'general';
    if (!byScope.has(scope)) byScope.set(scope, []);
    byScope.get(scope).push(tidy(item.text));
  }
  for (const [scope, texts] of [...byScope.entries()].sort()) {
    const unique = [...new Set(texts)];
    if (scope === 'general') {
      for (const text of unique) lines.push(`- ${text}`);
    } else {
      lines.push(`- **${scope}** — ${unique.join('; ')}`);
    }
  }
  lines.push('');
}

const hidden = parsed.filter(
  (c) => isHidden(c) || (c.type === 'other' && !SECTIONS.some((s) => s.key === c.type)),
);
if (hidden.length > 0) {
  lines.push(`_Plus ${hidden.length} maintenance change${hidden.length === 1 ? '' : 's'}._`);
  lines.push('');
}

if (detailedChangelog !== '') {
  lines.push('## Detailed changelog');
  lines.push('');
  lines.push(detailedChangelog);
  lines.push('');
}

/*
 * The way out of the summary and into the detail.
 *
 * These notes are deliberately short — grouped subjects, not a commit wall —
 * which is only defensible if the long version is one click away. Two links,
 * because they answer different questions: the changelog PAGE is the written
 * account of what each version changed and why, and the compare view is the
 * literal diff for anyone who would rather read the code than the prose.
 */
lines.push(
  `📖 **[Every Alcove release](${REPO}/blob/main/docs/readme/releases.md)**` +
    (previous ? ` · [every commit in ${previous}…${tag}](${REPO}/compare/${previous}...${tag})` : ''),
);
lines.push('');
lines.push('---');
lines.push('');

/*
 * Which file to take.
 *
 * Two of the six downloads are Windows installers that differ only in what they
 * do about the Edge WebView2 runtime, so the difference has to be stated right
 * here — a reader looking at two setup.exes 200 MB apart with no explanation
 * will pick wrong, and the wrong one is a quarter-gigabyte download they did
 * not need.
 *
 * Windows is first and says "the one to take", which is enough of an answer —
 * an earlier version put a ✔ column beside it and the reader asked what it was
 * for. A tick that decorates the row you would have read first anyway is a
 * third column of nothing.
 *
 * And no SmartScreen or administrator paragraph: *"no need to talk about
 * smartscreen admin stuff"*. It described a warning dialog before the reader
 * had downloaded anything, which is a worse first impression than the dialog.
 *
 * THE TABLE COMES AFTER "What changed", which reverses where it started. It was
 * moved to the top so GitHub's fold could not bury it — then seen in place:
 * *"in releases can you actually put what changed at top"*. A release page that
 * opens with a download table reads like a download page; what a release is
 * FOR is what it changed, and the table is two lines below either way.
 */
const install = [];
install.push('## Which file do I want?');
install.push('');
install.push('| You are on | Take this |');
install.push('| --- | --- |');
install.push(
  '| **Windows** | `_x64-setup.exe` — the one to take. |',
);
install.push(
  '| Windows, offline | `_x64-setup-offline.exe` — the same app, about 200 MB bigger ' +
    'because it carries the whole Edge WebView2 runtime instead of fetching it. Only if ' +
    'the one above fails. |',
);
install.push('| Windows, by policy | `_x64_en-US.msi` — the same app as an MSI. |');
install.push(
  '| **macOS** | `_universal.dmg` — one file for both Apple silicon and Intel. |',
);
install.push(
  '| **Linux** | `.deb`, `.rpm`, or `.AppImage` — the AppImage runs without installing. |',
);
install.push('');
install.push(
  'Your library lives in `%APPDATA%\\com.alcove.app` on Windows. Upgrading never touches ' +
    'it, and the uninstaller leaves it alone unless you tick the box that says otherwise. ' +
    '`SHA256SUMS.txt` is attached if you would rather check a download than trust one.',
);
install.push('');

/* ------------------------------------------------------------------------- */

const body = [];
if (total > 0) {
  const bits = [];
  if (feats) bits.push(`${feats} improvement${feats === 1 ? '' : 's'}`);
  if (fixes) bits.push(`${fixes} fix${fixes === 1 ? '' : 'es'}`);
  body.push(
    bits.length
      ? `## What changed\n\n${bits.join(' and ')}${previous ? ` since ${previous}` : ''}.`
      : `## What changed${previous ? `\n\nSince ${previous}.` : ''}`,
  );
  body.push('');
}
body.push(...lines);

/*
 * Collapse any run of blank lines the three parts leave where they meet, so
 * the seams between head, install and body are invisible in the rendered page.
 */
const out = [...head, ...body, ...install]
  .join('\n')
  .replace(/\n{3,}/g, '\n\n');
process.stdout.write(out + '\n');
