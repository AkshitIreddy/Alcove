/**
 * Turn the recorded README demo into numbered 4 x 4 review boards.
 *
 *   node scripts/demo-sheets.mjs                 every seventh frame
 *   node scripts/demo-sheets.mjs --every=3       finer review boards
 *   node scripts/demo-sheets.mjs --frame=412     print one full-size frame path
 *   node scripts/demo-sheets.mjs --range=400-460 print a full-size frame range
 *
 * Extracted frames are cached under ignored QA output, but the cache is tied
 * to the source bytes. A new demo can never silently reuse an old frame set.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};

const SRC = arg('src', 'docs/readme/img/demo.webp');
const FRAMES = 'qa/demo/frames';
const OUT = 'qa/demo/sheets';
const DIGEST_FILE = join(FRAMES, '.source-sha256');
const TIMELINE_FILE = join(FRAMES, '.timeline.json');
const EVERY = Number(arg('every', 7));
const COLS = Number(arg('cols', 4));
const ROWS = Number(arg('rows', 4));
const FPS = Number(arg('fps', 14));

if (!existsSync(SRC)) throw new Error(`Demo source does not exist: ${SRC}`);
for (const [label, value] of Object.entries({ every: EVERY, cols: COLS, rows: ROWS, fps: FPS })) {
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new Error(`--${label} must be a positive integer (got ${value})`);
  }
}

const run = (command, args) => execFileSync(command, args, { encoding: 'utf8' });
const ffmpeg = (args) => run('ffmpeg', ['-v', 'error', ...args]);
const digest = createHash('sha256').update(readFileSync(SRC)).digest('hex');
const pngs = (dir) => existsSync(dir)
  ? readdirSync(dir).filter((file) => file.endsWith('.png')).sort()
  : [];
const clearPngs = (dir) => {
  for (const file of pngs(dir)) unlinkSync(join(dir, file));
};

mkdirSync(FRAMES, { recursive: true });
mkdirSync(OUT, { recursive: true });
const cachedDigest = existsSync(DIGEST_FILE) ? readFileSync(DIGEST_FILE, 'utf8').trim() : '';
if (cachedDigest !== digest || pngs(FRAMES).length === 0) {
  clearPngs(FRAMES);
  clearPngs(OUT);
  if (SRC.toLowerCase().endsWith('.webp')) {
    // ffmpeg 7's WebP demuxer cannot decode libwebp_anim delta frames. The
    // shipped Windows ImageMagick has the WebP delegate and coalesces those
    // deltas into complete reviewable frames.
    run('magick', [SRC, '-coalesce', join(FRAMES, 'f%04d.png')]);
    const rawTimeline = run('magick', ['identify', '-format', '%s|%T\n', SRC]);
    let elapsedCentiseconds = 0;
    const timeline = rawTimeline.trim().split(/\r?\n/).map((line, index) => {
      const [sceneText, delayText] = line.split('|');
      const delayCentiseconds = Number(delayText);
      const entry = {
        file: `f${String(Number(sceneText) || index).padStart(4, '0')}.png`,
        seconds: elapsedCentiseconds / 100,
      };
      elapsedCentiseconds += Number.isFinite(delayCentiseconds) ? delayCentiseconds : 0;
      return entry;
    });
    writeFileSync(TIMELINE_FILE, `${JSON.stringify(timeline, null, 2)}\n`);
  } else {
    ffmpeg(['-i', SRC, '-vsync', '0', join(FRAMES, 'f%04d.png')]);
    writeFileSync(TIMELINE_FILE, '[]\n');
  }
  writeFileSync(DIGEST_FILE, `${digest}\n`);
}

const single = arg('frame', '');
if (single !== '') {
  const frame = String(Number(single)).padStart(4, '0');
  console.log(join(FRAMES, `f${frame}.png`));
  process.exit(0);
}

const range = arg('range', '');
if (range !== '') {
  const [first, last] = range.split('-').map(Number);
  if (!Number.isInteger(first) || !Number.isInteger(last) || first > last) {
    throw new Error(`--range must be FIRST-LAST (got ${range})`);
  }
  for (let frame = first; frame <= last; frame += 1) {
    console.log(join(FRAMES, `f${String(frame).padStart(4, '0')}.png`));
  }
  process.exit(0);
}

clearPngs(OUT);
const all = pngs(FRAMES);
const timeline = existsSync(TIMELINE_FILE)
  ? JSON.parse(readFileSync(TIMELINE_FILE, 'utf8'))
  : [];
const timeFor = (file, fallbackIndex) => {
  const entry = timeline.find((item) => item.file === file);
  return entry ? entry.seconds : fallbackIndex / FPS;
};
const picked = all.filter((_, index) => index % EVERY === 0);
const perBoard = COLS * ROWS;
const boardCount = Math.ceil(picked.length / perBoard);
console.log(`${all.length} frames | every ${EVERY} -> ${picked.length} | ${boardCount} boards of ${perBoard}`);

for (let board = 0; board < boardCount; board += 1) {
  const slice = picked.slice(board * perBoard, (board + 1) * perBoard);
  const inputs = slice.flatMap((file) => ['-i', join(FRAMES, file)]);
  const scales = slice.map((_, index) => `[${index}:v]scale=440:-1[t${index}]`).join(';');
  const stack = slice.map((_, index) => `[t${index}]`).join('');
  const position = (index) => {
    const col = index % COLS;
    const row = Math.floor(index / COLS);
    const x = col === 0
      ? '0'
      : Array.from({ length: col }, (_, cell) => `w${row * COLS + cell}`).join('+');
    const y = row === 0
      ? '0'
      : Array.from({ length: row }, (_, priorRow) => `h${priorRow * COLS}`).join('+');
    return `${x}_${y}`;
  };
  const destination = join(OUT, `sheet-${String(board + 1).padStart(2, '0')}.png`);
  ffmpeg([
    ...inputs,
    '-filter_complex',
    `${scales};${stack}xstack=inputs=${slice.length}:layout=${slice.map((_, index) => position(index)).join('|')}[out]`,
    '-map', '[out]', '-frames:v', '1', '-y', destination,
  ]);
  const frameNumbers = slice.map((file) => Number(file.replace(/\D/g, '')));
  console.log(`  ${destination}`);
  for (let row = 0; row < ROWS; row += 1) {
    const rowStart = row * COLS;
    const rowFrames = frameNumbers.slice(rowStart, rowStart + COLS);
    const rowFiles = slice.slice(rowStart, rowStart + COLS);
    if (rowFrames.length === 0) continue;
    const labels = rowFrames.map((frame, index) => {
      const seconds = timeFor(rowFiles[index], board * perBoard * EVERY + (rowStart + index) * EVERY);
      return `${frame} (${seconds.toFixed(1)}s)`;
    });
    console.log(`      row ${row + 1}: ${labels.join(' | ')}`);
  }
}
