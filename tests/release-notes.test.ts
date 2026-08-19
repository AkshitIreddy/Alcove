import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import {
  changelogForTag,
  requiredChangelogForTag,
} from '../scripts/release-changelog.mjs';

const notes = `# Release notes

## 0.6.1 — current

**First detail.** The complete explanation.

**Second detail.** Another paragraph.

## 0.6.0 — previous

Old material.
`;

describe('release-note changelog embedding', () => {
  it('extracts the exact matching version without the next release', () => {
    const section = changelogForTag('v0.6.1', notes);
    expect(section).toContain('**First detail.**');
    expect(section).toContain('**Second detail.**');
    expect(section).not.toContain('0.6.0');
    expect(section).not.toContain('Old material');
  });

  it('returns empty when the required version is absent', () => {
    expect(changelogForTag('v9.9.9', notes)).toBe('');
  });

  it('blocks a versioned release when its detailed section is absent', () => {
    expect(() => requiredChangelogForTag('v9.9.9', notes)).toThrow(
      'no detailed changelog section for v9.9.9',
    );
  });
});

const authoredRelease = [
  '## A steadier Agent',
  '',
  'Picture requests now recover from more provider reply variations instead of stopping before a draft appears. Alcove still checks that the exact attachment reaches the final preview.',
  '',
  '## Smoother editing',
  '',
  'Block handles remain beside their blocks while panels open or the book changes size, avoiding the brief jump across the page.',
].join('\n');

describe('authored release-note order', () => {
  it('publishes the exact authored explanation before stable download guidance', () => {
    const output = execFileSync(
      process.execPath,
      ['scripts/release-notes.mjs', 'v0.6.1'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, ALCOVE_RELEASE_NOTES_TEST_BODY: authoredRelease },
      },
    );

    const title = output.indexOf('# Alcove v0.6.1');
    const explanation = output.indexOf('## A steadier Agent');
    const recovery = output.indexOf('## Smoother editing');
    const install = output.indexOf('## Which file do I want?');

    expect(title).toBeGreaterThanOrEqual(0);
    expect(explanation).toBeGreaterThan(title);
    expect(recovery).toBeGreaterThan(explanation);
    expect(install).toBeGreaterThan(recovery);
    expect(output).toContain(authoredRelease);

    // Branding and install guidance remain stable around the custom message.
    expect(output).toContain('Every Alcove release');
    expect(output).toContain('`SHA256SUMS.txt`');
    expect(output).toContain('%APPDATA%\\com.alcove.app');
  });

  it('rejects tiny, overly long or placeholder-filled notes before a release build', () => {
    for (const body of [
      '## Tiny\n\nNot enough.\n\n## Still tiny\n\nNo.',
      `## Release essay\n\n${'Reader-facing detail repeated far past a useful summary. '.repeat(40)}`,
      '## One\n\nA visible improvement readers can understand.\n\n## Two\n\nA second improvement.\n\n## Three\n\nA third improvement.\n\n## Four\n\nToo many release-note sections for a quick summary.',
      `${authoredRelease}\n\nTODO: describe this later.`,
    ]) {
      expect(() => execFileSync(
        process.execPath,
        ['scripts/release-notes.mjs', 'v0.6.1', '--check'],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, ALCOVE_RELEASE_NOTES_TEST_BODY: body },
        },
      )).toThrow();
    }
  });

  it('validates a brief substantive authored note without reading commit subjects', () => {
    const output = execFileSync(
      process.execPath,
      ['scripts/release-notes.mjs', 'v0.6.1', '--check'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, ALCOVE_RELEASE_NOTES_TEST_BODY: authoredRelease },
      },
    );
    expect(output).toMatch(/verified authored release note/i);
  });

  it('allows one useful section when the release does not need more', () => {
    const oneSection = [
      '## A focused fix',
      '',
      'Picture requests can continue when the provider uses another valid streamed reply shape. The exact attachment remains visible in the reviewed preview, so readers get the requested page without a long list of internal implementation details.',
    ].join('\n');
    const output = execFileSync(
      process.execPath,
      ['scripts/release-notes.mjs', 'v0.6.1', '--check'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, ALCOVE_RELEASE_NOTES_TEST_BODY: oneSection },
      },
    );
    expect(output).toMatch(/1 sections/);
  });

  it('keeps the current authored note substantive before and after versioning', () => {
    const version = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
    const draftPath = 'release-notes/unreleased.md';
    const notePath = existsSync(draftPath)
      ? draftPath
      : `release-notes/v${version}.md`;
    const body = readFileSync(notePath, 'utf8');
    const output = execFileSync(
      process.execPath,
      ['scripts/release-notes.mjs', `v${version}`, '--check'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, ALCOVE_RELEASE_NOTES_TEST_BODY: body },
      },
    );
    const headings = body.match(/^##\s+\S.+$/gm) ?? [];
    expect(body.trim().length).toBeGreaterThanOrEqual(180);
    expect(headings.length).toBeGreaterThanOrEqual(1);
    expect(headings.length).toBeLessThanOrEqual(3);
    expect(body).not.toMatch(/\b(?:TODO|TBD|PLACEHOLDER)\b/i);
    expect(output).toMatch(/verified authored release note/i);
  });

  it('blocks the platform build before packaging when the authored note is absent', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
    const noteGate = workflow.indexOf('- name: Authored release note is ready');
    const install = workflow.indexOf('- name: Install dependencies');
    const publish = workflow.indexOf('- name: Write release notes');
    expect(noteGate).toBeGreaterThanOrEqual(0);
    expect(noteGate).toBeLessThan(install);
    expect(workflow).toContain('node scripts/release-notes.mjs "$TAG" --check');
    expect(publish).toBeGreaterThan(noteGate);
  });
});
