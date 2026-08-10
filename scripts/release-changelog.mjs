import { readFileSync } from 'node:fs';

/** Extract the hand-written changelog body for one exact release tag. */
export function changelogForTag(
  releaseTag,
  markdown = readFileSync(
    new URL('../docs/readme/releases.md', import.meta.url),
    'utf8',
  ),
) {
  const version = releaseTag.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) return '';
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = new RegExp(`^##\\s+${escaped}(?:\\s|—|$).*?$`, 'm').exec(markdown);
  if (!start) return '';
  const bodyStart = start.index + start[0].length;
  const next = /^##\s+/m.exec(markdown.slice(bodyStart));
  return markdown
    .slice(bodyStart, next ? bodyStart + next.index : undefined)
    .trim();
}

/** A versioned publication may never silently omit its detailed section. */
export function requiredChangelogForTag(releaseTag, markdown) {
  const changelog = changelogForTag(releaseTag, markdown);
  if (/^v?\d+\.\d+\.\d+/.test(releaseTag) && changelog === '') {
    throw new Error(
      `docs/readme/releases.md has no detailed changelog section for ${releaseTag}`,
    );
  }
  return changelog;
}
