/**
 * scripts/demo-sheets.mjs — the demo GIF as boards you can actually look at.
 *
 * The reader: *"i want there to be some sort of AI (you) in the loop testing
 * where you check each part of the gif to verify and find these issues … what
 * is important is for you to visually verify the UI and visuals of the things
 * as you do it, and for that to be the testing mechanism."*
 *
 * A 1397-frame GIF cannot be reviewed by opening 1397 files. This tiles it into
 * numbered boards — every Nth frame, labelled with its frame number and its
 * time — so a reviewer (a person or an agent) can look at a whole passage at
 * once, name the frame where something is wrong, and then pull that single
 * frame at full size with `--frame=NNNN`.
 *
 *   node scripts/demo-sheets.mjs                 boards every 7th frame
 *   node scripts/demo-sheets.mjs --every=3       finer
 *   node scripts/demo-sheets.mjs --frame=412     one frame, full size
 *   node scripts/demo-sheets.mjs --range=400-460 every frame in a range
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const arg = (n, d) => {
  const h = process.argv.find((a) => a.startsWith(`--${n}=`));
  return h ? h.split('=').slice(1).join('=') : d;
};
const SRC = arg('src', 'docs/readme/img/demo.gif');
const FRAMES = 'qa/demo/frames';
const OUT = 'qa/demo/sheets';
const EVERY = Number(arg('every', 7));
const COLS = Number(arg('cols', 4));
const ROWS = Number(arg('rows', 4));

const ff = (args) => execFileSync('ffmpeg', ['-v', 'error', ...args], { encoding: 'utf8' });

const frames = () =>
  readdirSync(FRAMES).filter((f) => f.endsWith('.png')).sort();

if (readdirSync(FRAMES).length === 0) {
  mkdirSync(FRAMES, { recursive: true });
  ff(['-i', SRC, '-vsync', '0', join(FRAMES, 'f%04d.png')]);
}

const single = arg('frame', '');
if (single !== '') {
  const n = String(Number(single)).padStart(4, '0');
  console.log(join(FRAMES, `f${n}.png`));
  process.exit(0);
}

const range = arg('range', '');
if (range !== '') {
  const [a, b] = range.split('-').map(Number);
  for (let i = a; i <= b; i += 1) console.log(join(FRAMES, `f${String(i).padStart(4, '0')}.png`));
  process.exit(0);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const all = frames();
const picked = all.filter((_, i) => i % EVERY === 0);
const per = COLS * ROWS;
const sheets = Math.ceil(picked.length / per);
console.log(`${all.length} frames · every ${EVERY} -> ${picked.length} · ${sheets} boards of ${per}`);

for (let s = 0; s < sheets; s += 1) {
  const slice = picked.slice(s * per, (s + 1) * per);
  const inputs = slice.flatMap((f) => ['-i', join(FRAMES, f)]);
  /*
   * NO drawtext. It needs fontconfig and this machine's ffmpeg has none
   * ("Cannot load default config file"), which kills the whole render — so the
   * frame numbers are printed BESIDE the board instead, in reading order. The
   * grid is deterministic, so tile 7 of a 4-wide board is row 2, column 4, and
   * a finding can still name an exact frame.
   */
  const labels = slice
    .map((_, i) => `[${i}:v]scale=440:-1[t${i}]`)
    .join(';');
  const stack = slice.map((_, i) => `[t${i}]`).join('');
  const file = join(OUT, `sheet-${String(s + 1).padStart(2, '0')}.png`);
  ff([
    ...inputs,
    '-filter_complex',
    `${labels};${stack}xstack=inputs=${slice.length}:layout=${
      slice.map((_, i) => `${(i % COLS) === 0 ? '0' : `w0*${i % COLS}`}_${
        Math.floor(i / COLS) === 0 ? '0' : `h0*${Math.floor(i / COLS)}`}`).join('|')
    }[out]`,
    '-map', '[out]', '-frames:v', '1', '-y', file,
  ]);
  const nums = slice.map((f) => Number(f.replace(/\D/g, '')));
  console.log(`  ${file}`);
  for (let r = 0; r < ROWS; r += 1) {
    const row = nums.slice(r * COLS, (r + 1) * COLS);
    if (row.length) console.log(`      row ${r + 1}: ${row.map((n) => `${n} (${(n / 14).toFixed(1)}s)`).join('  ·  ')}`);
  }
}
