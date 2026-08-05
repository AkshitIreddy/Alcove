// @vitest-environment node
/**
 * The history rewrite is deliberately not exercised here. Its SHA remapper is:
 * a temporary repository and a synthetic filter-repo commit map are enough to
 * prove that every tracked text document is discovered, while binary files and
 * unrelated hexadecimal prose are left byte-for-byte alone.
 */
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT =
  process.env.SHRINK_HISTORY_SCRIPT ??
  resolve(__dirname, '..', 'scripts', 'shrink-history.mjs');
const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const run = (cwd: string, command: string, args: string[]) =>
  execFileSync(command, args, { cwd, encoding: 'utf8' });

describe('history SHA remapping', () => {
  it('rewrites every tracked text file, verifies it, and leaves binary data alone', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'alcove-history-remap-'));
    made.push(cwd);
    run(cwd, 'git', ['init', '--quiet']);

    const oldA = '1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const newA = 'aaaaaaa111111111111111111111111111111111';
    const oldB = '2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const newB = 'bbbbbbb222222222222222222222222222222222';
    writeFileSync(join(cwd, 'HANDOFF.md'), `handoff at ${oldA.slice(0, 7)}\n`);
    writeFileSync(
      join(cwd, 'REVIEW.md'),
      `review at ${oldB.slice(0, 12)}; unrelated digest deadbee\n`,
    );
    mkdirSync(join(cwd, 'notes'));
    writeFileSync(join(cwd, 'notes', 'nested.txt'), `also ${oldA}\n`);
    const binary = Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(oldA), Buffer.from([0, 3])]);
    writeFileSync(join(cwd, 'picture.bin'), binary);
    run(cwd, 'git', ['add', 'HANDOFF.md', 'REVIEW.md', 'notes/nested.txt', 'picture.bin']);

    mkdirSync(join(cwd, '.git', 'filter-repo'), { recursive: true });
    writeFileSync(
      join(cwd, '.git', 'filter-repo', 'commit-map'),
      `old                                      new\n${oldA} ${newA}\n${oldB} ${newB}\n`,
    );

    const output = run(cwd, process.execPath, [SCRIPT, '--remap']);

    expect(readFileSync(join(cwd, 'HANDOFF.md'), 'utf8')).toContain(newA.slice(0, 7));
    expect(readFileSync(join(cwd, 'REVIEW.md'), 'utf8')).toBe(
      `review at ${newB.slice(0, 12)}; unrelated digest deadbee\n`,
    );
    expect(readFileSync(join(cwd, 'notes', 'nested.txt'), 'utf8')).toContain(newA);
    expect(readFileSync(join(cwd, 'picture.bin'))).toEqual(binary);
    expect(output).toContain('remapped 3 reference(s) in 3 file(s)');
    expect(output).toContain('verification passed — no mapped old commit reference remains');
    expect(output).toContain('stage only these');
    expect(readFileSync(SCRIPT, 'utf8')).not.toContain('git add -A');
  });
});
