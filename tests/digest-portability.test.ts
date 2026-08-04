/**
 * tests/digest-portability.test.ts — a digest has to mean the same thing on two
 * machines, or it is not a check, it is a machine fingerprint.
 *
 * `checkShots()` decides whether a screenshot is stale by comparing the digest
 * of each file whose content is IN the picture against the digest recorded when
 * it was taken. That is the right idea and it was computed over raw bytes,
 * which is the wrong unit: this checkout has `core.autocrlf=true`, so git stores
 * LF and checks out CRLF, and the digest recorded on Windows could never match
 * the one computed on the Linux runner.
 *
 * The result was a staleness alarm nobody could clear. Recapturing on Windows
 * re-recorded the same CRLF digest, so the banner was reported "changed since
 * the shot that draws it was taken" on every CI run — and it failed the 0.2.0
 * release at the gates, after the local suite had been green all day.
 *
 * The property that matters is not "these bytes are equal" but "this is the
 * same file git has". So text is normalised to LF before hashing and binary is
 * hashed as it lies, and this pins both halves — including the second, because
 * normalising a PNG would silently corrupt the very thing it claims to check.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { digestOf, sourceDigests } from '../scripts/check-readme.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** What a checkout with LF line endings — every CI runner — holds. */
function lfDigest(rel: string): string {
  const text = readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex').slice(0, 16);
}

describe('shot source digests survive a change of line ending', () => {
  it('a text source digests the same here as on a Linux checkout', () => {
    // The exact file that failed the release.
    expect(digestOf('shots-now/readme-hero.html')).toBe(lfDigest('shots-now/readme-hero.html'));
  });

  it('every text source in the manifest agrees with its LF form', () => {
    const mismatched: string[] = [];
    for (const rel of Object.keys(sourceDigests())) {
      if (!/\.(html|md|css|mjs|js|ts|tsx|json|svg)$/i.test(rel)) continue;
      if (digestOf(rel) !== lfDigest(rel)) mismatched.push(rel);
    }
    expect(mismatched, mismatched.join('\n')).toEqual([]);
  });

  it('a binary source is hashed as it lies, not normalised', () => {
    // The failure this prevents is worse than the one above: a PNG contains
    // 0x0d 0x0a pairs by chance, so "normalising" one rewrites its bytes and
    // the digest stops describing the file at all — quietly, and only for
    // images that happen to contain the pair.
    const dir = mkdtempSync(join(tmpdir(), 'alcove-digest-'));
    try {
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x0d, 0x0a]);
      const rel = 'assets/brand/alcove-1024.png';
      const onDisk = readFileSync(join(ROOT, rel));
      expect(digestOf(rel)).toBe(
        createHash('sha256').update(onDisk).digest('hex').slice(0, 16),
      );
      // And prove the pair really is present in real image data, so the case
      // above is not hypothetical.
      writeFileSync(join(dir, 'probe.bin'), bytes);
      expect(onDisk.includes(Buffer.from([0x0d, 0x0a]))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
