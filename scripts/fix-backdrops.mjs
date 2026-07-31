/**
 * One-shot: make every theme default to a QUIET wall.
 *
 * Per the user: the default backdrop should be a plain wall or wood that
 * matches the case — not a floral pattern behind every world. The backdrop
 * system already supports finishes that ignore the pattern entirely
 * ('plastered' | 'boarded' | 'panelled' | 'glazed' | 'shoji'); the bug was
 * that almost every theme listed 'papered' first, so the pattern always won.
 *
 * Patterns remain available — they are now an explicit choice in the studio.
 */
import { readFile, writeFile } from 'node:fs/promises';

const FILE = 'src/art/themes.ts';

/** theme id -> the quiet finish that belongs to that room. */
const QUIET = {
  blossom: 'plastered',
  robot: 'panelled',
  dino: 'boarded',
  candy: 'panelled',
  reef: 'plastered',
  star: 'plastered',
  athenaeum: 'panelled',
  conservatory: 'glazed',
  observatory: 'plastered',
  cottage: 'boarded',
  scriptorium: 'plastered',
  sakura: 'shoji',
  attic: 'boarded',
  apothecary: 'panelled',
};

const src = await readFile(FILE, 'utf8');
const lines = src.split(/\r?\n/);

// Walk the file, remembering the most recent `id: '...'` so each backdrops
// array can be attributed to its theme.
let currentId = null;
let changed = 0;
for (let i = 0; i < lines.length; i++) {
  const idMatch = /^\s*id:\s*'([a-z-]+)'/.exec(lines[i]);
  if (idMatch) currentId = idMatch[1];

  const bd = /^(\s*)backdrops:\s*\[([^\]]*)\],?\s*$/.exec(lines[i]);
  if (!bd) continue;

  const indent = bd[1];
  const list = bd[2].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
  const quiet = QUIET[currentId];
  if (!quiet) continue;

  // Quiet finish first, keeping the shortlist at its curated length: if the
  // quiet finish is not already offered, it REPLACES the first entry rather
  // than being prepended (each room curates two or three walls, not four).
  const rest = list.filter((x) => x !== quiet);
  const reordered = list.includes(quiet) ? [quiet, ...rest] : [quiet, ...rest.slice(1)];
  const next = `${indent}backdrops: [${reordered.map((x) => `'${x}'`).join(', ')}],`;
  if (next !== lines[i]) {
    lines[i] = next;
    changed++;
    process.stdout.write(`  ${currentId}: ${list[0]} -> ${quiet}\n`);
  }
}

await writeFile(FILE, lines.join('\n'), 'utf8');
process.stdout.write(`\n${changed} themes now default to a quiet wall\n`);
