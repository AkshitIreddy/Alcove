import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
  '## A deliberately explained improvement',
  '',
  'This release changes the Agent boundary so a reader understands what became more reliable, why the old behavior failed, and which local safeguards still remain in control. It is written as release prose rather than copied from a commit subject.',
  '',
  '## Recovery and compatibility',
  '',
  'Tool failures now carry structured recovery information, while transport, revision and final approval failures remain deterministic local responsibilities. The distinction matters because the model cannot analyse an HTTP rejection that occurs before it receives a turn.',
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
    const explanation = output.indexOf('## A deliberately explained improvement');
    const recovery = output.indexOf('## Recovery and compatibility');
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

  it('rejects generic, tiny or placeholder-filled notes before a release build', () => {
    for (const body of [
      '## Tiny\n\nNot enough.\n\n## Still tiny\n\nNo.',
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

  it('validates a substantive authored note without reading commit subjects', () => {
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

  it('keeps the current unreleased note substantive and ready to version', () => {
    const body = readFileSync('release-notes/unreleased.md', 'utf8');
    const output = execFileSync(
      process.execPath,
      ['scripts/release-notes.mjs', 'v0.7.4', '--check'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, ALCOVE_RELEASE_NOTES_TEST_BODY: body },
      },
    );
    expect(body).toContain('## An agent that can reconsider its own route');
    expect(body).toContain('## Release notes written for the release');
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
