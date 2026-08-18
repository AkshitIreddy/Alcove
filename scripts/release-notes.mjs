/**
 * Assemble one GitHub Release body from a deliberately authored version note.
 *
 * Reader-facing changes are not inferred from commit subjects. Before tagging,
 * write `release-notes/vX.Y.Z.md` in plain, descriptive prose about the work
 * that actually shipped. This script validates that note, then adds only the
 * stable Alcove heading, history links and download guidance.
 *
 * Usage:
 *   node scripts/release-notes.mjs v0.8.0
 *   node scripts/release-notes.mjs v0.8.0 --check
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = 'https://github.com/AkshitIreddy/Alcove';
const RAW = 'https://raw.githubusercontent.com/AkshitIreddy/Alcove/main';
const tag = process.argv[2] ?? '';
const checkOnly = process.argv.includes('--check');
const sourceOverride = process.argv.find((argument) => argument.startsWith('--source='))
  ?.slice('--source='.length);

if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) {
  throw new Error(`expected an explicit version tag such as v0.8.0, received ${tag || '(none)'}`);
}

const notesDirectory = resolve(
  process.env.ALCOVE_RELEASE_NOTES_DIR ?? 'release-notes',
);
const notePath = sourceOverride === undefined
  ? join(notesDirectory, `${tag}.md`)
  : resolve(sourceOverride);
let authored = process.env.ALCOVE_RELEASE_NOTES_TEST_BODY;
if (authored === undefined) {
  try {
    authored = readFileSync(notePath, 'utf8');
  } catch {
    throw new Error(
      `missing authored release note ${notePath}; write it from the completed work before tagging ${tag}`,
    );
  }
}

authored = authored.replace(/^\uFEFF/, '').trim();
const sectionHeadings = authored.match(/^##\s+\S.+$/gm) ?? [];
const placeholder = /\b(?:TODO|TBD|PLACEHOLDER|WRITE RELEASE NOTES|FILL THIS IN)\b/i;
if (authored.length < 320) {
  throw new Error(`authored release note for ${tag} is too short to explain the release (${authored.length} characters)`);
}
if (sectionHeadings.length < 2) {
  throw new Error(`authored release note for ${tag} needs at least two descriptive ## sections`);
}
if (/^#\s+/m.test(authored)) {
  throw new Error('authored release content starts at ##; the assembler owns the single Alcove release title');
}
if (placeholder.test(authored)) {
  throw new Error(`authored release note for ${tag} still contains placeholder language`);
}
if (/##\s+Which file do I want\?/i.test(authored)) {
  throw new Error('download guidance is appended centrally; keep the authored note about this release');
}

if (checkOnly) {
  console.log(`verified authored release note ${notePath} (${authored.length} characters, ${sectionHeadings.length} sections)`);
  process.exit(0);
}

function previousTag() {
  try {
    return execFileSync(
      'git',
      ['describe', '--tags', '--abbrev=0', `${tag}~1`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    return '';
  }
}

const previous = previousTag();
const head = [
  '<div align="center">',
  '',
  `<img src="${RAW}/assets/brand/alcove-1024.png" width="96" alt="">`,
  '',
  `# Alcove ${tag}`,
  '',
  '**Built like a storybook library, with cozy shelves and patterned walls. Open every book into notebook pages filled with diagrams, notes, tape, and stickers.**',
  '',
  '</div>',
  '',
];

const history = [
  '',
  `📖 **[Every Alcove release](${REPO}/blob/main/docs/readme/releases.md)**` +
    (previous ? ` · [every commit in ${previous}…${tag}](${REPO}/compare/${previous}...${tag})` : ''),
  '',
  '---',
  '',
];

const install = [
  '## Which file do I want?',
  '',
  '| You are on | Take this |',
  '| --- | --- |',
  '| **Windows** | `_x64-setup.exe` — the one to take. |',
  '| Windows, offline | `_x64-setup-offline.exe` — the same app, about 200 MB bigger because it carries the whole Edge WebView2 runtime instead of fetching it. Only if the one above fails. |',
  '| Windows, by policy | `_x64_en-US.msi` — the same app as an MSI. |',
  '| **macOS** | `_universal.dmg` — one file for both Apple silicon and Intel. |',
  '| **Linux** | `.deb`, `.rpm`, or `.AppImage` — the AppImage runs without installing. |',
  '',
  'Your library lives in `%APPDATA%\\com.alcove.app` on Windows. Upgrading never touches it, and the uninstaller leaves it alone unless you tick the box that says otherwise. `SHA256SUMS.txt` is attached if you would rather check a download than trust one.',
  '',
];

const output = [...head, authored, ...history, ...install]
  .join('\n')
  .replace(/\n{3,}/g, '\n\n');
process.stdout.write(`${output.trim()}\n`);
