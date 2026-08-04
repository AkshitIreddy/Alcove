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

const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const trySh = (cmd) => {
  try {
    return sh(cmd);
  } catch {
    return '';
  }
};

const label = process.argv[2] ?? trySh('git describe --tags --exact-match HEAD') ?? '';
/** Resolve to something git can actually walk — an unknown tag falls back to HEAD. */
const rev = label && trySh(`git rev-parse --verify ${label}^{commit}`) ? label : 'HEAD';
const tag = label || 'unreleased';

/** The tag before this one, if any — otherwise summarise the whole history. */
const previous = trySh(`git describe --tags --abbrev=0 ${rev}^`);

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

const lines = [];
lines.push(`## Alcove ${tag}`);
lines.push('');

const total = parsed.length;
const feats = parsed.filter((c) => c.type === 'feat').length;
const fixes = parsed.filter((c) => c.type === 'fix').length;
if (total > 0) {
  const bits = [];
  if (feats) bits.push(`${feats} improvement${feats === 1 ? '' : 's'}`);
  if (fixes) bits.push(`${fixes} fix${fixes === 1 ? '' : 'es'}`);
  lines.push(
    bits.length
      ? `${bits.join(' and ')}${previous ? ` since ${previous}` : ''}.`
      : `Changes${previous ? ` since ${previous}` : ''}.`,
  );
  lines.push('');
}

for (const section of SECTIONS) {
  const items = parsed.filter((c) => c.type === section.key);
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
  (c) => HIDDEN.has(c.type) || (c.type === 'other' && !SECTIONS.some((s) => s.key === c.type)),
);
if (hidden.length > 0) {
  lines.push(`_Plus ${hidden.length} maintenance change${hidden.length === 1 ? '' : 's'}._`);
  lines.push('');
}

// Which file to take. Two of the six downloads below are Windows installers
// that differ only in what they do about the Edge WebView2 runtime, so the
// difference has to be stated here — a reader looking at two setup.exes that
// differ by 200 MB and no explanation will pick wrong.
lines.push('### Install');
lines.push('');
lines.push('| You are on | Take | |');
lines.push('| --- | --- | --- |');
lines.push(
  '| **Windows** | `_x64-setup.exe` | The one to take. Installs for the current user — ' +
    'no administrator prompt. |',
);
lines.push(
  '| Windows, no internet | `_x64-setup-offline.exe` | Same app. ~200 MB bigger because it ' +
    'carries the whole Edge WebView2 runtime instead of fetching it, so it installs on a ' +
    'machine that is offline or behind a proxy that blocks Microsoft. Only take this one if ' +
    'the other fails. |',
);
lines.push('| Windows, deployed by policy | `_x64_en-US.msi` | The same app as an MSI. |');
lines.push(
  '| **macOS** | `_universal.dmg` | One file for both Apple silicon and Intel. |',
);
lines.push('| **Linux** | `.deb` / `.rpm` / `.AppImage` | The AppImage runs without installing. |');
lines.push('');
lines.push(
  'Nothing is code-signed, so Windows shows a SmartScreen warning the first time and macOS ' +
    'quarantines the first launch. `SHA256SUMS.txt` is attached if you want to check a download.',
);
lines.push('');
lines.push(
  'Your library lives in `%APPDATA%\\com.alcove.app` on Windows. Upgrading never touches it, ' +
    'and the uninstaller keeps it unless you tick the box that says otherwise.',
);

process.stdout.write(lines.join('\n') + '\n');
