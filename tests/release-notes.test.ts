import { describe, expect, it } from 'vitest';
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
