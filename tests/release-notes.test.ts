import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
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

describe('generated release-note order', () => {
  it("opens with What's new and What's fixed without redundant changelog wrappers", () => {
    const output = execFileSync(
      process.execPath,
      ['scripts/release-notes.mjs', 'v0.6.1'],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    const title = output.indexOf('# Alcove v0.6.1');
    const whatsNew = output.indexOf("## What's new");
    const whatsFixed = output.indexOf("## What's fixed");
    const install = output.indexOf('## Which file do I want?');

    expect(title).toBeGreaterThanOrEqual(0);
    expect(whatsNew).toBeGreaterThan(title);
    expect(whatsFixed).toBeGreaterThan(whatsNew);
    expect(install).toBeGreaterThan(whatsFixed);
    expect(output).not.toContain('## What changed');
    expect(output).not.toContain('## Detailed changelog');

    // The release signature and install guidance stay part of the generated
    // body even though the changelog is now the first reader-facing content.
    expect(output).toContain('Every Alcove release');
    expect(output).toContain('`SHA256SUMS.txt`');
    expect(output).toContain('%APPDATA%\\com.alcove.app');
  });

  it('adds the first explanatory commit paragraph beneath its summary', () => {
    const output = execFileSync(
      process.execPath,
      ['scripts/release-notes.mjs', 'HEAD'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          ALCOVE_RELEASE_LOG_TEST: [
            '\u001efix(editor): keep a visual unit together',
            '',
            'Move the heading and its short setup with the diagram so the page reads as one composed idea.',
            '',
            '\u001efeat(studio): add a useful control',
            '',
            'The control is discoverable from the existing panel and persists its value.',
          ].join('\n'),
        },
      },
    );

    expect(output).toContain('- **editor** — Keep a visual unit together');
    expect(output).toContain(
      'Move the heading and its short setup with the diagram so the page reads as one composed idea.',
    );
    expect(output).toContain('- **studio** — Add a useful control');
    expect(output).toContain(
      'The control is discoverable from the existing panel and persists its value.',
    );
  });
});
