/**
 * scripts/gen-sounds.mjs — builds public/sounds/ from real, licensed recordings.
 *
 *   node scripts/gen-sounds.mjs
 *
 * Requires `ffmpeg` on PATH (decoding only) and, on a cold cache, network
 * access to the source URLs below. Sources are cached outside the repo
 * (os.tmpdir()/notebook-sound-sources) so the ~20 MB of raw material never
 * lands in git; only the conditioned cues under public/sounds/ are committed.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE NO LONGER SYNTHESIZES ANYTHING
 * ─────────────────────────────────────────────────────────────────────────
 * It used to. Every cue was rendered from scratch — layered noise, struck
 * resonators, an 8-line FDN room — and it was tuned twice against review
 * feedback ("very rough, low quality", then "very bad"). The second pass
 * measured a 779 Hz mean spectral centroid with essentially nothing above
 * 4 kHz, i.e. it had comprehensively won the argument it was having about
 * brightness, and the result was still rejected. That falsifies the premise
 * rather than the tuning: what was missing is not a filter setting but the
 * irregularity of a real object being handled — no two page turns sharing an
 * envelope, a book shutting with a body resonance no oscillator was asked to
 * model. So a third synthesis pass was not attempted.
 *
 * Everything here is a real recording, curated from public-domain and CC0
 * libraries, sliced to a single event and conditioned. Provenance for every
 * file is in SOURCES below, is re-emitted to public/sounds/CREDITS.json on
 * every build, and is written up in docs/design/sound.md.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE ONE PROCESSING IDEA: WARM ONLY AS MUCH AS IS NEEDED
 * ─────────────────────────────────────────────────────────────────────────
 * A close-miked page turn measures a 5-7 kHz spectral centroid. That is too
 * bright and too present for an app you sit inside all day, and the house
 * style is a quiet room. But a fixed "warm it up" EQ is how the synthesized
 * set ended up sounding like a pillow: applied uniformly it takes the same
 * octave off a bright riffle and an already-dark book thump.
 *
 * So the conditioning SOLVES for the mildest high shelf that brings each cue
 * under its own centroid ceiling (fitWarmth) and stops there. A recording
 * that is already warm is left nearly alone; only the bright ones are pulled
 * down, and only as far as the ceiling. That keeps the transient structure
 * and the per-take variation — the part synthesis could not fake — while
 * still landing the whole set in one room.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 44100;
const TWO_PI = Math.PI * 2;

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'public', 'sounds');
const CACHE_DIR = join(tmpdir(), 'notebook-sound-sources');

/* ═════════════════════════════════ sources ═════════════════════════════════ */

/**
 * Every recording this app is built from, with the provenance that makes it
 * safe to ship. `licence` is the operative grant, `licenceUrl` its text, and
 * `page` where that grant is asserted, so a reader can re-verify all of it.
 *
 * Two rules were applied while sourcing, and both rejected candidates:
 *   - The licence has to be asserted by someone in a position to grant it.
 *     archive.org carries commercial SFX libraries — and outright console
 *     game rips — re-uploaded with a CC0 tag by people who plainly do not own
 *     them; none of that is used here regardless of how good it sounds.
 *   - The site has to permit automated access. freesound.org has by far the
 *     best CC0 catalogue for this brief, and its robots.txt disallows
 *     ClaudeBot site-wide and /search/ for every agent, so it was not used.
 */
const SOURCES = {
  oldBook: {
    title: 'Old book (leafing through pages, flicking pages, shutting book)',
    author: 'cori',
    licence: 'Public domain (PD-author, via pdsounds.org)',
    licenceUrl: 'https://commons.wikimedia.org/wiki/Template:PD-pdsounds.org',
    page: 'https://commons.wikimedia.org/wiki/File:Old_book.ogg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/b/bf/Old_book.ogg',
    origin: 'http://www.pdsounds.org/sounds/old_book',
  },
  bookPaper: {
    title: 'Book, Paper, Pages, assorted',
    author: 'stephan',
    licence: 'Public domain (PD-author, via pdsounds.org)',
    licenceUrl: 'https://commons.wikimedia.org/wiki/Template:PD-pdsounds.org',
    page: 'https://commons.wikimedia.org/wiki/File:Book_paper_pages_assorted.ogg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/7/79/Book_paper_pages_assorted.ogg',
    origin: 'http://www.pdsounds.org/sounds/book_paper_pages_assorted',
  },
  pencil: {
    title: 'Pencil Scratchings (mechanical pencil on paper on a wooden desk)',
    author: 'gypsygirl',
    licence: 'Public domain (PD-author, via pdsounds.org)',
    licenceUrl: 'https://commons.wikimedia.org/wiki/Template:PD-pdsounds.org',
    page: 'https://commons.wikimedia.org/wiki/File:Pencil_scratchings.ogg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/9/9f/Pencil_scratchings.ogg',
    origin: 'http://www.pdsounds.org/sounds/pencil_scratchings',
  },
  flips: {
    title: '10 Book Page Flips',
    author: 'StarNinjas',
    licence: 'CC0 1.0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    page: 'https://opengameart.org/content/10-book-page-flips',
    url: 'https://opengameart.org/sites/default/files/book_flips_-_starninjas.zip',
    member: 'book_flip.%d.ogg',
    zip: true,
  },
  kenney: {
    title: 'Interface Sounds (1.0)',
    author: 'Kenney (kenney.nl)',
    licence: 'CC0 1.0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    page: 'https://opengameart.org/content/interface-sounds',
    url: 'https://opengameart.org/sites/default/files/kenney_interfaceSounds.zip',
    member: '%s.ogg',
    zip: true,
  },
  bell: {
    title: 'Bell dings/chimes',
    author: 'PWL',
    licence: 'CC0 1.0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    page: 'https://opengameart.org/content/bell-dingschimes',
    url: 'https://opengameart.org/sites/default/files/bell_ding%d.wav',
    indexed: true,
  },
  fire: {
    title: 'Fireplace Sound loop',
    author: 'PagDev',
    licence: 'CC0 1.0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    page: 'https://opengameart.org/content/fireplace-sound-loop',
    url: 'https://opengameart.org/sites/default/files/fire.wav',
  },
  crickets: {
    title: 'Crickets Ambient Noise - loopable',
    author: 'Wolfgang_ (Ted Kerr)',
    licence: 'CC0 1.0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    page: 'https://opengameart.org/content/crickets-ambient-noise-loopable',
    url: 'https://opengameart.org/sites/default/files/crickets-oneloop.mp3',
  },
  rain: {
    title: 'Rain on Window Loop',
    author: 'alxl',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    page: 'https://opengameart.org/content/rain-on-window-loop',
    url: 'https://opengameart.org/sites/default/files/rain_on_window_loop.wav',
    // The submission's structured licence field says CC-BY 4.0 while its
    // free-text note says "available under CC0". We honour the stricter of the
    // two and ship the credit, which satisfies either reading. Nothing else in
    // the set carries an obligation; the in-app credits panel reads this flag
    // out of CREDITS.json rather than hard-coding the sentence.
    attribution: true,
    attributionNote: 'Rain on Window Loop by alxl (OpenGameArt) — CC BY 4.0',
  },

  /* ── the soundscape beds ──────────────────────────────────────────────────
   * Wikimedia Commons rather than the recordists' own sites: Commons carries
   * a reviewed licence template per file, serves upload.wikimedia.org to
   * automated clients, and (for the two freesound mirrors below) preserves the
   * CC0 the recordist chose there without us touching a site whose robots.txt
   * says no. Every one of these is a single continuous field recording, which
   * is what an ambience bed has to be — the loop that got cut was a synthesized
   * "room tone" and it read as a haunting.
   */
  wind: {
    title: 'Howling wind',
    author: 'Tvabutzku1234',
    licence: 'CC0 1.0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    page: 'https://commons.wikimedia.org/wiki/File:Howling_wind.ogg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/2/2d/Howling_wind.ogg',
  },
  storm: {
    title: 'Light Rain Distant Thunder July 5th 2016',
    author: 'kvgarlic',
    licence: 'CC0 1.0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    page: 'https://commons.wikimedia.org/wiki/File:Light_Rain_Distant_Thunder_July_5th_2016.wav',
    url: 'https://upload.wikimedia.org/wikipedia/commons/b/b6/Light_Rain_Distant_Thunder_July_5th_2016.wav',
    origin: 'https://freesound.org/people/kvgarlic/sounds/349454/',
  },
  stream: {
    title: 'Stream / river water up close',
    author: 'jackthemurray',
    licence: 'CC0 1.0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    page: 'https://commons.wikimedia.org/wiki/File:433589_jackthemurray_stream-river-water-up-close.wav',
    url: 'https://upload.wikimedia.org/wikipedia/commons/5/54/433589_jackthemurray_stream-river-water-up-close.wav',
    origin: 'https://freesound.org/people/jackthemurray/sounds/433589/',
  },
  forest: {
    title: 'Grunewald (woodland ambience)',
    author: 'dbspin',
    licence: 'CC0 1.0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    page: 'https://commons.wikimedia.org/wiki/File:245286_dbspin_grunewald.wav',
    url: 'https://upload.wikimedia.org/wikipedia/commons/7/70/245286_dbspin_grunewald.wav',
    origin: 'https://freesound.org/people/dbspin/sounds/245286/',
  },
  cafe: {
    title: 'Restaurant ambience',
    author: 'stephan',
    licence: 'Public domain (PD-author, via pdsounds.org)',
    licenceUrl: 'https://commons.wikimedia.org/wiki/Template:PD-pdsounds.org',
    page: 'https://commons.wikimedia.org/wiki/File:Restaurant_ambience.ogg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/b/b5/Restaurant_ambience.ogg',
    origin: 'http://www.pdsounds.org/sounds/restaurant_ambience',
  },
  shore: {
    title: 'On a pebble beach',
    author: 'earthcalling',
    licence: 'Public domain (PD-author, via pdsounds.org)',
    licenceUrl: 'https://commons.wikimedia.org/wiki/Template:PD-pdsounds.org',
    page: 'https://commons.wikimedia.org/wiki/File:On_a_pebble_beach.ogg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/7/73/On_a_pebble_beach.ogg',
    origin: 'http://www.pdsounds.org/sounds/on_a_pebble_beach',
  },
};

/* ══════════════════════════════ fetch + decode ══════════════════════════════ */

/**
 * Wikimedia's policy asks automated clients to identify themselves and give a
 * contact; a browser-shaped UA gets 429'd off upload.wikimedia.org on the
 * second or third file.
 */
const UA = 'notebook-app-asset-build/1.0 (https://github.com/AkshitIreddy/notebook)';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchTo(url, path) {
  if (existsSync(path)) return path;
  for (let attempt = 0; ; attempt++) {
    process.stdout.write(`  fetching ${url}\n`);
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) {
      writeFileSync(path, Buffer.from(await res.arrayBuffer()));
      break;
    }
    if (attempt >= 4) throw new Error(`${res.status} fetching ${url}`);
    await sleep(4000 * (attempt + 1)); // back off a rate limit rather than fail the build
  }
  await sleep(1200); // be a polite guest on a shared CDN
  return path;
}

const safeName = (s) => s.replace(/[^a-z0-9.]+/gi, '_');

/**
 * Decode anything ffmpeg understands into mono 44.1 kHz **32-bit float**.
 *
 * Float, not the 16-bit the cues ship at, because the field recordings behind
 * the soundscapes are quiet: the stream measures −59 dBFS RMS and the woodland
 * −47. Quantizing those to 16 bits before conditioning leaves five or six
 * usable bits, and the 25 dB of make-up gain that `normalizeTo` then applies
 * brings the quantization floor up with the water. Decoding to float costs
 * disk in a cache that is thrown away and nothing else.
 */
function decode(src, dest) {
  if (existsSync(dest)) return dest;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-ac', '1', '-ar', String(SR),
    '-c:a', 'pcm_f32le', dest], { stdio: 'pipe' });
  return dest;
}

/** Pull one member out of a cached zip via .NET's zip reader (no unzip needed). */
function unzipMember(zipPath, member, destDir) {
  const out = join(destDir, safeName(member));
  if (existsSync(out)) return out;
  mkdirSync(destDir, { recursive: true });
  const q = (s) => s.replace(/'/g, "''");
  execFileSync('powershell', ['-NoProfile', '-Command',
    "$ErrorActionPreference='Stop';"
    + 'Add-Type -AssemblyName System.IO.Compression.FileSystem;'
    + `$z=[IO.Compression.ZipFile]::OpenRead('${q(zipPath)}');`
    + `$e=$z.Entries|Where-Object{$_.Name -eq '${q(member)}'}|Select-Object -First 1;`
    + `if(-not $e){$z.Dispose();throw 'member not found: ${q(member)}'};`
    + `[IO.Compression.ZipFileExtensions]::ExtractToFile($e,'${q(out)}',$true);`
    + '$z.Dispose()'], { stdio: 'pipe' });
  return out;
}

const cache = new Map();

/** Load a source (fetching, unzipping and decoding as needed) as float samples. */
async function load(key, arg) {
  const id = arg === undefined ? key : `${key}:${arg}`;
  if (cache.has(id)) return cache.get(id);
  const s = SOURCES[key];
  if (!s) throw new Error(`unknown source ${key}`);
  mkdirSync(CACHE_DIR, { recursive: true });

  let raw;
  if (s.zip) {
    const zip = join(CACHE_DIR, safeName(`${key}.zip`));
    await fetchTo(s.url, zip);
    const member = s.member.replace('%d', String(arg)).replace('%s', String(arg));
    raw = unzipMember(zip, member, join(CACHE_DIR, key));
  } else {
    const url = s.indexed ? s.url.replace('%d', String(arg)) : s.url;
    raw = join(CACHE_DIR, safeName(`${key}_${url.split('/').pop()}`));
    await fetchTo(url, raw);
  }

  // `.f32` in the name so a cache left over from the 16-bit decode is ignored
  // rather than silently reused at the old resolution.
  const wavPath = `${raw}.mono.f32.wav`;
  decode(raw, wavPath);
  const samples = readWav(wavPath);
  cache.set(id, samples);
  return samples;
}

/* ═══════════════════════════════ WAV I/O ═══════════════════════════════ */

/** Read a mono RIFF/WAVE file — 16-bit PCM or 32-bit IEEE float — as floats. */
function readWav(path) {
  const file = readFileSync(path);
  const ab = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const view = new DataView(ab);
  const tag = (o) => String.fromCharCode(...new Uint8Array(ab, o, 4));
  let format = 1;
  let bits = 16;
  let dataAt = -1;
  let dataSize = 0;
  let off = 12;
  while (off + 8 <= file.byteLength) {
    const id = tag(off);
    const size = view.getUint32(off + 4, true);
    if (id === 'fmt ') {
      format = view.getUint16(off + 8, true);
      bits = view.getUint16(off + 22, true);
      // WAVE_FORMAT_EXTENSIBLE — which is what ffmpeg writes for float — puts
      // the real format code in the first two bytes of the SubFormat GUID.
      if (format === 0xfffe && size >= 40) format = view.getUint16(off + 32, true);
    } else if (id === 'data') {
      dataAt = off + 8;
      dataSize = Math.min(size, file.byteLength - dataAt);
      break;
    }
    off += 8 + size + (size % 2);
  }
  if (dataAt < 0) throw new Error(`no data chunk in ${path}`);
  // The data chunk is not guaranteed to start on a 4-byte boundary (an odd
  // extension chunk ahead of it is enough), so read through the DataView
  // rather than aliasing a typed array onto the buffer.
  if (format === 3 && bits === 32) {
    const n = Math.floor(dataSize / 4);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = view.getFloat32(dataAt + i * 4, true);
    return out;
  }
  if (format === 1 && bits === 16) {
    const n = Math.floor(dataSize / 2);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = view.getInt16(dataAt + i * 2, true) / 32768;
    return out;
  }
  throw new Error(`unsupported WAV format ${format}/${bits}-bit in ${path}`);
}

/** Minimal RIFF/WAVE writer: 44.1 kHz, 16-bit, mono PCM, with TPDF dither. */
function writeWav(path, x, rng) {
  const n = x.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const dither = (rng() + rng() - 1) * 0.5; // TPDF, ±0.5 LSB
    let v = Math.round(Math.max(-1, Math.min(1, x[i])) * 32767 + dither);
    if (v > 32767) v = 32767;
    if (v < -32768) v = -32768;
    b.writeInt16LE(v, 44 + i * 2);
  }
  writeFileSync(path, b);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ══════════════════════════════ RBJ biquads ══════════════════════════════ */

function lowpassCoeffs(f0, q = 0.707) {
  const w0 = (TWO_PI * Math.min(f0, SR * 0.45)) / SR;
  const cw = Math.cos(w0), alpha = Math.sin(w0) / (2 * q), a0 = 1 + alpha;
  return { b0: (1 - cw) / 2 / a0, b1: (1 - cw) / a0, b2: (1 - cw) / 2 / a0, a1: (-2 * cw) / a0, a2: (1 - alpha) / a0 };
}
function highpassCoeffs(f0, q = 0.707) {
  const w0 = (TWO_PI * f0) / SR;
  const cw = Math.cos(w0), alpha = Math.sin(w0) / (2 * q), a0 = 1 + alpha;
  return { b0: (1 + cw) / 2 / a0, b1: -(1 + cw) / a0, b2: (1 + cw) / 2 / a0, a1: (-2 * cw) / a0, a2: (1 - alpha) / a0 };
}
function highshelfCoeffs(f0, gainDb, slope = 1) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (TWO_PI * f0) / SR, cw = Math.cos(w0), sw = Math.sin(w0);
  const alpha = (sw / 2) * Math.sqrt((A + 1 / A) * (1 / slope - 1) + 2);
  const s2 = 2 * Math.sqrt(A) * alpha;
  const a0 = A + 1 - (A - 1) * cw + s2;
  return {
    b0: (A * (A + 1 + (A - 1) * cw + s2)) / a0,
    b1: (-2 * A * (A - 1 + (A + 1) * cw)) / a0,
    b2: (A * (A + 1 + (A - 1) * cw - s2)) / a0,
    a1: (2 * (A - 1 - (A + 1) * cw)) / a0,
    a2: (A + 1 - (A - 1) * cw - s2) / a0,
  };
}
function peakingCoeffs(f0, gainDb, q = 1) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (TWO_PI * f0) / SR, cw = Math.cos(w0), alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha / A;
  return {
    b0: (1 + alpha * A) / a0, b1: (-2 * cw) / a0, b2: (1 - alpha * A) / a0,
    a1: (-2 * cw) / a0, a2: (1 - alpha / A) / a0,
  };
}

function biquad(x, c) {
  const out = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

/**
 * Zero-phase filtering: forward, then backward. Costs double and squares the
 * magnitude response, but it introduces no group delay, so a page turn's
 * attack stays exactly where the microphone found it. A one-way filter smears
 * transients forward, which on short percussive cues reads as softness.
 */
function filtfilt(x, c) {
  const fwd = biquad(x, c);
  const rev = biquad(Float64Array.from(fwd).reverse(), c);
  return Float64Array.from(rev).reverse();
}

/* ═══════════════════════════════ measurement ═══════════════════════════════ */

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/**
 * Spectral centroid (Hz) and the share of energy above 4 kHz.
 *
 * The two are weighted differently and the difference matters when reading
 * the report: the centroid is amplitude-weighted, the high share is
 * energy-weighted. A recording can therefore carry plenty of audible air
 * (lifting the centroid) while almost none of its energy sits up there.
 */
function spectrum(x) {
  const N = 2048;
  let num = 0, den = 0, high = 0, total = 0;
  for (let start = 0; start + N <= x.length; start += N / 2) {
    const re = new Float64Array(N), im = new Float64Array(N);
    let energy = 0;
    for (let i = 0; i < N; i++) {
      const win = 0.5 - 0.5 * Math.cos((TWO_PI * i) / N);
      const v = x[start + i] * win;
      re[i] = v; energy += v * v;
    }
    if (energy < 1e-10) continue;
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const mag = Math.hypot(re[k], im[k]);
      const f = (k * SR) / N;
      num += f * mag; den += mag; total += mag * mag;
      if (f > 4000) high += mag * mag;
    }
  }
  return { centroid: den > 0 ? num / den : 0, highShare: total > 0 ? high / total : 0 };
}

function peakOf(x) {
  let p = 0;
  for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > p) p = v; }
  return p;
}

function rmsDb(x, from, to) {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return 20 * Math.log10(Math.max(Math.sqrt(s / Math.max(1, to - from)), 1e-9));
}

/** Largest adjacent-sample jump as a share of peak — a click's signature. */
function maxStepShare(x) {
  const peak = peakOf(x);
  let max = 0;
  for (let i = 1; i < x.length; i++) {
    const d = Math.abs(Math.round(x[i] * 32767) - Math.round(x[i - 1] * 32767));
    if (d > max) max = d;
  }
  return max / Math.max(peak * 32768, 1);
}

/* ═══════════════════════════════ shaping ═══════════════════════════════ */

function normalizeTo(x, targetDb) {
  const p = peakOf(x);
  if (!(p > 0)) return x;
  const g = Math.pow(10, targetDb / 20) / p;
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] * g;
  return out;
}

/** Raised-cosine fades to exact zero at both ends — the anti-click primitive. */
function fadeEdges(x, inMs, outMs) {
  const out = Float64Array.from(x);
  const fi = Math.min(out.length, Math.max(1, Math.round((inMs / 1000) * SR)));
  const fo = Math.min(out.length, Math.max(1, Math.round((outMs / 1000) * SR)));
  for (let i = 0; i < fi; i++) out[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi);
  for (let i = 0; i < fo; i++) out[out.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fo);
  return out;
}

function dcBlock(x) {
  const R = 1 - (TWO_PI * 12) / SR;
  const out = new Float64Array(x.length);
  let px = 0, py = 0;
  for (let i = 0; i < x.length; i++) {
    const y = x[i] - px + R * py;
    px = x[i]; py = y; out[i] = y;
  }
  let m = 0;
  for (let i = 0; i < out.length; i++) m += out[i];
  m /= out.length || 1;
  for (let i = 0; i < out.length; i++) out[i] -= m;
  return out;
}

/** Smoothed short-window RMS envelope, for onset snapping. */
function envelopeOf(x, winMs = 8) {
  const w = Math.max(1, Math.round((winMs / 1000) * SR));
  const out = new Float64Array(x.length);
  let acc = 0;
  for (let i = 0; i < x.length; i++) {
    acc += x[i] * x[i];
    if (i >= w) acc -= x[i - w] * x[i - w];
    out[i] = Math.sqrt(acc / Math.min(i + 1, w));
  }
  return out;
}

/**
 * Snap a hand-noted timestamp to the actual attack near it.
 * The timings in CUES were read off an onset analysis, so they land within a
 * few tens of milliseconds; this walks to the real energy rise so a cue never
 * starts mid-transient, which is what produces a click no fade can hide.
 */
function snapOnset(x, atSample, searchMs = 90) {
  const w = Math.round((searchMs / 1000) * SR);
  const from = Math.max(0, atSample - w);
  const to = Math.min(x.length - 1, atSample + w);
  if (to <= from) return Math.max(0, Math.min(atSample, x.length - 1));
  const env = envelopeOf(x.slice(from, to), 4);
  let peak = 0;
  for (let i = 0; i < env.length; i++) peak = Math.max(peak, env[i]);
  const thr = peak * 0.16;
  let i = 0;
  while (i < env.length && env[i] < thr) i++;
  // Back off a few ms so the very start of the attack is inside the window.
  return Math.max(0, from + i - Math.round(0.004 * SR));
}

/**
 * Solve for the mildest high shelf that brings `x` under `targetHz`.
 *
 * Bisects the shelf gain rather than applying a fixed curve, because the
 * sources differ by 4 kHz of centroid between the darkest book thump and the
 * brightest riffle: one fixed setting either fails to tame the riffle or
 * buries the thump.
 */
function fitWarmth(x, targetHz, { cornerHz = 1800, lidHz = 7000, maxCutDb = -34 } = {}) {
  const lidded = filtfilt(x, lowpassCoeffs(lidHz, 0.7));
  if (spectrum(lidded).centroid <= targetHz) return lidded;
  let lo = maxCutDb; // most cut
  let hi = 0;        // no cut
  let best = filtfilt(lidded, highshelfCoeffs(cornerHz, lo));
  for (let iter = 0; iter < 16; iter++) {
    const mid = (lo + hi) / 2;
    const cand = filtfilt(lidded, highshelfCoeffs(cornerHz, mid));
    if (spectrum(cand).centroid <= targetHz) { lo = mid; best = cand; } else { hi = mid; }
  }
  return best;
}

/** Equal-power crossfade of a buffer's tail into its head, for seamless loops. */
function seamlessLoop(x, lengthSamples, fadeSamples) {
  const need = lengthSamples + fadeSamples;
  if (x.length < need) throw new Error(`loop source too short: ${x.length} < ${need}`);
  const out = Float64Array.from(x.subarray(0, lengthSamples));
  for (let i = 0; i < fadeSamples; i++) {
    const u = (i + 1) / (fadeSamples + 1);
    out[i] = out[i] * Math.sin((u * Math.PI) / 2) + x[lengthSamples + i] * Math.cos((u * Math.PI) / 2);
  }
  return out;
}

/**
 * Candidate lowpass lids, brightest first. fitVoicing walks these down.
 */
const LIDS = [9000, 8000, 7000, 6000, 5000, 4200, 3500, 3000, 2500, 2000, 1600];

/**
 * Choose the brightest voicing a recording can carry.
 *
 * Two things go wrong when you keep a real recording's top end, and both are
 * measurable. Energy above 4 kHz is what reads as hiss on a cue heard all day.
 * And the largest adjacent-sample jump — which for a sinusoid is 2πfA/SR, i.e.
 * proportional to frequency — is what reads as a click: a transient whose peak
 * IS its high-frequency content jumps most of full scale between samples.
 *
 * Both fall as the lid comes down, so rather than picking one lid for
 * everything (which is how the synthesized set became a pillow) this walks the
 * lid down from 9 kHz and stops at the FIRST one where the cue is clean. Bright
 * material gets filtered hard; a book thump that was never bright keeps its
 * 9 kHz lid and is left alone.
 *
 * `centroidMin` guards the other direction — a page turn that lands under
 * ~900 Hz has stopped sounding like paper — and is reported rather than
 * silently accepted, because that means no lid satisfies the cue.
 */
function fitVoicing(x, {
  centroidMax, centroidMin = 0, peakDb,
  // 22% and 2.5% leave real headroom under the 25% / 3% acceptance gates
  // without spending brightness the cue could have kept.
  maxStep = 0.22, maxHighShare = 0.025, cornerHz = 1800, name = '',
}) {
  let last = null;
  for (const lid of LIDS) {
    const y = fitWarmth(x, centroidMax, { cornerHz, lidHz: lid });
    const { centroid, highShare } = spectrum(y);
    // Measure the slew at the level this cue actually ships at: the metric is
    // a ratio to peak, and 16-bit rounding makes it level-dependent at the
    // very quiet end (a hover tick sits 27 dB down).
    const step = maxStepShare(normalizeTo(y, peakDb));
    last = y;
    if (step <= maxStep && highShare <= maxHighShare) {
      if (centroid < centroidMin) {
        console.warn(`  ! ${name}: clean at ${lid} Hz but centroid ${Math.round(centroid)} Hz `
          + `is under the ${centroidMin} Hz floor — source is too dull for this cue`);
      }
      return y;
    }
  }
  console.warn(`  ! ${name}: no lid satisfied the slew/hiss gates`);
  return last;
}

/**
 * Turn a raw slice into a shipped cue.
 *
 * Order matters: trim the rumble first so it cannot bias the voicing fit, fit
 * the voicing, then fade and level. Levelling last means the peak target is
 * exact, which is what keeps the loudness hierarchy (a hover tick 17 dB under
 * a book pull) intact no matter what the source happened to be recorded at.
 */
function condition(x, {
  name,
  centroidMax,
  centroidMin = 0,
  peakDb,
  fadeInMs = 10,
  fadeOutMs = 60,
  highpassHz = 95,
  cornerHz = 1800,
  presence = -3,
}) {
  let y = filtfilt(x, highpassCoeffs(highpassHz, 0.7));
  // A gentle scoop where handling noise turns into harshness. Real foley has
  // plenty of 3 kHz; on a cue you hear a hundred times a day it fatigues.
  y = filtfilt(y, peakingCoeffs(3000, presence, 1.1));
  y = fitVoicing(y, { centroidMax, centroidMin, peakDb, cornerHz, name });
  y = dcBlock(y);
  y = fadeEdges(y, fadeInMs, fadeOutMs);
  return normalizeTo(y, peakDb);
}

/* ═══════════════════════════════ the cues ═══════════════════════════════════ */

/*
 * Timings are seconds into the decoded source, read off an onset analysis of
 * each recording; snapOnset() then walks each one to the exact attack. Where a
 * family draws on two different recordings that is deliberate — variant
 * rotation is only worth having if the takes differ in body, not just in seed.
 *
 * `centroidMax` is the warmth ceiling the cue is fitted to and the main
 * expressive dial in this file: page turns keep the most air because paper is
 * the app's signature sound, hover ticks the least because they fire
 * constantly. `peakDb` sets the loudness hierarchy directly.
 *
 * The plain/full split has to agree with VARIANT_WEIGHTS in src/sound/engine.ts,
 * where `full` means the longer, more textured take — so within each family
 * the `full` entries are cut longer.
 */
const CUES = [
  /* ── page turns: the signature cue, so these keep the most air ── */
  // Take 8 of the StarNinjas set, not the Old-book slice that used to be here:
  // that slice measured a 1317 Hz centroid against 1846-1860 for the rest of
  // the family, i.e. it was audibly the thud among five sheets of paper, and
  // it is the one cue in the family review singled out. Every take in that set
  // is a separate physical flip, so the family keeps its variety.
  { name: 'page-flip-1', src: ['flips', 8], at: 0.0, dur: 0.34, centroidMax: 1850, centroidMin: 950, peakDb: -12 },
  { name: 'page-flip-2', src: ['flips', 5], at: 0.02, dur: 0.42, centroidMax: 1850, centroidMin: 950, peakDb: -12 },
  { name: 'page-flip-3', src: ['bookPaper'], at: 0.20, dur: 0.30, centroidMax: 1850, centroidMin: 950, peakDb: -12 },
  { name: 'page-flip-4', src: ['flips', 10], at: 0.02, dur: 0.40, centroidMax: 1850, centroidMin: 950, peakDb: -12 },
  { name: 'page-flip-5', src: ['bookPaper'], at: 13.03, dur: 0.31, centroidMax: 1850, centroidMin: 950, peakDb: -12 },
  { name: 'page-flip-6', src: ['flips', 4], at: 0.02, dur: 0.43, centroidMax: 1850, centroidMin: 950, peakDb: -12 },

  /* ── pulling a book out: pages riffling past each other ── */
  { name: 'book-pull', src: ['oldBook'], at: 4.70, dur: 0.64, centroidMax: 1500, peakDb: -10 },
  { name: 'book-pull-2', src: ['oldBook'], at: 7.31, dur: 0.78, centroidMax: 1500, peakDb: -10 },
  { name: 'book-pull-3', src: ['oldBook'], at: 6.30, dur: 0.65, centroidMax: 1500, peakDb: -10 },
  { name: 'book-pull-4', src: ['bookPaper'], at: 2.23, dur: 0.76, centroidMax: 1500, peakDb: -10 },

  /* ── putting one back ── */
  { name: 'book-return', src: ['oldBook'], at: 68.10, dur: 0.64, centroidMax: 1400, peakDb: -10 },
  { name: 'book-return-2', src: ['oldBook'], at: 69.14, dur: 0.79, centroidMax: 1400, peakDb: -10 },
  { name: 'book-return-3', src: ['oldBook'], at: 62.80, dur: 0.66, centroidMax: 1400, peakDb: -10 },
  { name: 'book-return-4', src: ['bookPaper'], at: 25.30, dur: 0.77, centroidMax: 1400, peakDb: -10 },

  /* ── camera moves: a long riffle, warmed hard and kept well down ── */
  { name: 'shelf-whoosh', src: ['bookPaper'], at: 8.34, dur: 0.60, centroidMax: 1100, peakDb: -21 },
  { name: 'shelf-whoosh-2', src: ['bookPaper'], at: 19.10, dur: 0.80, centroidMax: 1100, peakDb: -21 },
  { name: 'shelf-whoosh-3', src: ['bookPaper'], at: 10.54, dur: 0.62, centroidMax: 1100, peakDb: -21 },

  /* ── menus and panels ── */
  { name: 'pop-soft', src: ['kenney', 'maximize_006'], at: 0.0, dur: 0.30, centroidMax: 1600, peakDb: -14, snap: false },
  { name: 'pop-soft-2', src: ['kenney', 'question_001'], at: 0.0, dur: 0.38, centroidMax: 1600, peakDb: -14, snap: false },
  { name: 'pop-soft-3', src: ['kenney', 'minimize_006'], at: 0.0, dur: 0.30, centroidMax: 1600, peakDb: -14, snap: false },
  { name: 'pop-soft-4', src: ['kenney', 'confirmation_004'], at: 0.0, dur: 0.40, centroidMax: 1600, peakDb: -14, snap: false },
  { name: 'pop-soft-5', src: ['kenney', 'question_004'], at: 0.0, dur: 0.29, centroidMax: 1600, peakDb: -14, snap: false },

  /* ── buttons: a fingertip landing on a board cover ──
   * Every button in the app fires this, so it has to be the least eventful
   * thing in the set that is still unmistakably a response: ~140 ms, no ring,
   * and 5 dB under `pop-soft` so opening a panel still reads as the bigger
   * gesture. These four are real taps from the Old-book recording — the same
   * physical object the shelf cues come from — rather than a synthesized blip,
   * which is why they can sit this quiet and still register. */
  { name: 'click-soft', src: ['oldBook'], at: 5.679, dur: 0.14, centroidMax: 1300, peakDb: -19, fadeOutMs: 70 },
  { name: 'click-soft-2', src: ['oldBook'], at: 6.789, dur: 0.17, centroidMax: 1300, peakDb: -19, fadeOutMs: 80 },
  { name: 'click-soft-3', src: ['oldBook'], at: 7.512, dur: 0.13, centroidMax: 1300, peakDb: -19, fadeOutMs: 70 },
  { name: 'click-soft-4', src: ['oldBook'], at: 11.306, dur: 0.16, centroidMax: 1300, peakDb: -19, fadeOutMs: 80 },

  /* ── hover: graphite on paper, by far the quietest thing here ── */
  { name: 'tick-hover', src: ['pencil'], at: 6.10, dur: 0.14, centroidMax: 1500, peakDb: -27, snap: false },
  { name: 'tick-hover-2', src: ['pencil'], at: 12.40, dur: 0.17, centroidMax: 1500, peakDb: -27, snap: false },
  { name: 'tick-hover-3', src: ['pencil'], at: 20.70, dur: 0.13, centroidMax: 1500, peakDb: -27, snap: false },
  { name: 'tick-hover-4', src: ['pencil'], at: 31.20, dur: 0.18, centroidMax: 1500, peakDb: -27, snap: false },
  { name: 'tick-hover-5', src: ['pencil'], at: 44.60, dur: 0.13, centroidMax: 1500, peakDb: -27, snap: false },

  /* ── ticking a box: a small bell allowed to ring out ── */
  { name: 'check-done', src: ['bell', 3], at: 0.0, dur: 0.90, centroidMax: 1500, peakDb: -10, fadeOutMs: 220 },
  { name: 'check-done-2', src: ['bell', 4], at: 0.0, dur: 1.02, centroidMax: 1500, peakDb: -10, fadeOutMs: 240 },
  { name: 'check-done-3', src: ['bell', 2], at: 0.0, dur: 0.92, centroidMax: 1500, peakDb: -10, fadeOutMs: 220 },
  { name: 'check-done-4', src: ['bell', 1], at: 0.0, dur: 1.04, centroidMax: 1500, peakDb: -10, fadeOutMs: 240 },

  /* ── deleting: paper being crushed ── */
  { name: 'crumple-delete', src: ['bookPaper'], at: 5.10, dur: 0.70, centroidMax: 1500, peakDb: -12 },
  { name: 'crumple-delete-2', src: ['bookPaper'], at: 15.04, dur: 0.88, centroidMax: 1500, peakDb: -12 },
  { name: 'crumple-delete-3', src: ['bookPaper'], at: 6.97, dur: 0.72, centroidMax: 1500, peakDb: -12 },
  { name: 'crumple-delete-4', src: ['bookPaper'], at: 17.72, dur: 0.86, centroidMax: 1500, peakDb: -12 },

  /* ── landing: the book meeting a surface ── */
  { name: 'drop-thump', src: ['oldBook'], at: 71.10, dur: 0.52, centroidMax: 900, peakDb: -10, fadeOutMs: 140 },
  { name: 'drop-thump-2', src: ['oldBook'], at: 58.16, dur: 0.62, centroidMax: 900, peakDb: -10, fadeOutMs: 160 },
  { name: 'drop-thump-3', src: ['bookPaper'], at: 27.40, dur: 0.50, centroidMax: 900, peakDb: -10, fadeOutMs: 140 },
  { name: 'drop-thump-4', src: ['bookPaper'], at: 34.10, dur: 0.60, centroidMax: 900, peakDb: -10, fadeOutMs: 160 },

  /* ── celebration: one strike sounded a few times, not a jingle ── */
  { name: 'confetti', src: ['bell', 4], at: 0.0, dur: 0.95, centroidMax: 1900, centroidMin: 900, peakDb: -11, shimmer: [0, 0.09, 0.19] },
  { name: 'confetti-2', src: ['bell', 3], at: 0.0, dur: 1.05, centroidMax: 1900, centroidMin: 900, peakDb: -11, shimmer: [0, 0.07, 0.16, 0.26] },
  { name: 'confetti-3', src: ['bell', 2], at: 0.0, dur: 0.92, centroidMax: 1900, centroidMin: 900, peakDb: -11, shimmer: [0, 0.11, 0.21] },
];

/** Keystrokes, all off the one pencil recording. */
const TYPING = [
  { name: 'typing-tick-1', at: 8.30, dur: 0.14 },
  { name: 'typing-tick-2', at: 15.60, dur: 0.13 },
  { name: 'typing-tick-3', at: 24.10, dur: 0.18 },
  { name: 'typing-tick-4', at: 36.80, dur: 0.14 },
  { name: 'typing-tick-5', at: 51.40, dur: 0.17 },
  { name: 'typing-tick-6', at: 63.90, dur: 0.13 },
];

/**
 * Seamless loops. `fade` is the crossfade length in seconds.
 *
 * Every `at` was chosen by measurement, not by ear-guessing: a candidate
 * window is scored on the spread of its 250 ms RMS (a bed has to be steady or
 * the loop point announces itself) and the head/tail level ratio (the
 * crossfade hides a small mismatch, not a big one). The winners run 5-17%
 * coefficient of variation. `shore` is the exception at ~39% and gets a 12 s
 * window instead of 8, because waves ARE the variation — squeeze them into
 * eight seconds and the swell turns into a pulse you can set a metronome to.
 *
 * A `layers` bed is mixed from more than one recording before conditioning;
 * its credits list every source.
 */
const LOOPS = [
  { name: 'pencil-scratch', src: ['pencil'], at: 30.0, ms: 210, centroidMax: 1700, centroidMin: 800, peakDb: -19, fade: 0.05 },
  { name: 'ambient-rain', src: ['rain'], at: 0.6, ms: 8000, centroidMax: 1300, peakDb: -20, fade: 1.2 },
  { name: 'ambient-fireplace', src: ['fire'], at: 2.0, ms: 8000, centroidMax: 1250, peakDb: -20, fade: 1.2 },
  { name: 'ambient-crickets', src: ['crickets'], at: 1.5, ms: 8000, centroidMax: 1300, peakDb: -22, fade: 1.2 },
  { name: 'ambient-storm', src: ['storm'], at: 56.0, ms: 8000, centroidMax: 1400, peakDb: -20, fade: 1.2 },
  // 104 s, not the steadiest window at 34 s: that one holds a 921 Hz resonance
  // 17 dB above its neighbours — a building whistling — and a whistle that
  // survives an 8 s loop is a kettle, not weather. Every window's strongest
  // narrow peak was measured; the ones that score ~10 dB put it up at 5.4 kHz
  // instead, where the 950 Hz centroid fit buries it anyway.
  { name: 'ambient-wind', src: ['wind'], at: 104.0, ms: 8000, centroidMax: 950, peakDb: -21, fade: 1.2 },
  { name: 'ambient-stream', src: ['stream'], at: 2.0, ms: 8000, centroidMax: 1500, peakDb: -20, fade: 1.2 },
  { name: 'ambient-forest', src: ['forest'], at: 128.0, ms: 8000, centroidMax: 1600, peakDb: -23, fade: 1.2 },
  { name: 'ambient-cafe', src: ['cafe'], at: 36.0, ms: 8000, centroidMax: 1400, peakDb: -23, fade: 1.2 },
  { name: 'ambient-shore', src: ['shore'], at: 16.0, ms: 12000, centroidMax: 1300, peakDb: -20, fade: 1.6 },
  {
    // Crickets alone is already a bed; night is the same field with weather in
    // it — the wind sits 9 dB under and is warmed to nothing but movement, so
    // the loop breathes on a period that has no common factor with the
    // crickets' own. Twelve seconds because two layers repeat more audibly
    // than one.
    name: 'ambient-night',
    layers: [
      { src: ['crickets'], at: 8.0, gain: 1 },
      { src: ['wind'], at: 52.0, gain: 0.35 },
    ],
    ms: 12000, centroidMax: 1200, peakDb: -22, fade: 1.6,
  },
];

/**
 * The hour chime is a sequence, not a sample: a real hour bell strikes several
 * times. Three or four strikes of one recording at falling level, spaced so the
 * tails overlap, reaches the ~6 s the cue wants without stretching or looping a
 * single hit — both of which are audible on a bell.
 */
const CHIMES = [
  // A different bell each — two variants built from the same strike would be
  // near-identical for their first two seconds, which is neither useful
  // variation nor distinguishable to a listener.
  { name: 'chime-hour', bell: 3, strikes: [0, 1.55, 3.1], total: 6.0 },
  { name: 'chime-hour-2', bell: 4, strikes: [0, 1.45, 2.9], total: 5.6 },
  { name: 'chime-hour-3', bell: 1, strikes: [0, 1.5, 3.0, 4.4], total: 6.3 },
];

/* ═══════════════════════════════ the build ═══════════════════════════════ */

function slice(x, at, dur, snap = true) {
  const want = Math.round(dur * SR);
  const asked = Math.round(at * SR);
  let from = snap ? snapOnset(x, asked) : asked;
  // Never run off the end: back the window up rather than return a short cue.
  from = Math.max(0, Math.min(from, x.length - want));
  return x.slice(from, from + want);
}

function mixInto(dest, src, at, gain) {
  const start = Math.max(0, Math.round(at));
  for (let i = 0; i < src.length; i++) {
    const j = start + i;
    if (j >= dest.length) break;
    dest[j] += src[i] * gain;
  }
  return dest;
}

async function build() {
  mkdirSync(OUT_DIR, { recursive: true });
  const rng = mulberry32(0x50f7);
  const rows = [];
  const credits = {};

  const creditFor = (key) => {
    const s = SOURCES[key];
    return {
      title: s.title,
      author: s.author,
      licence: s.licence,
      licenceUrl: s.licenceUrl,
      sourcePage: s.page,
      sourceFile: s.url,
      ...(s.origin ? { originallyFrom: s.origin } : {}),
      ...(s.attribution ? { attributionRequired: true, attributionText: s.attributionNote } : {}),
    };
  };

  /**
   * `keys` is a list because a layered bed is built from more than one
   * recording. Single-source cues get a one-entry list rather than a special
   * case, so the credits panel has exactly one shape to render.
   */
  const emit = (name, y, keys) => {
    writeWav(join(OUT_DIR, `${name}.wav`), y, rng);
    const { centroid, highShare } = spectrum(y);
    rows.push({
      name,
      ms: +((y.length / SR) * 1000).toFixed(1),
      peakDb: +(20 * Math.log10(Math.max(peakOf(y), 1e-9))).toFixed(2),
      centroid: Math.round(centroid),
      highPct: +(highShare * 100).toFixed(2),
      stepPct: +(maxStepShare(y) * 100).toFixed(1),
    });
    credits[name] = (Array.isArray(keys) ? keys : [keys]).map(creditFor);
  };

  /* one-shots */
  for (const cue of CUES) {
    const [key, arg] = cue.src;
    const raw = await load(key, arg);
    let dry = slice(raw, cue.at, cue.dur, cue.snap !== false);
    // A shimmer cue is the same strike sounded a few times in quick succession,
    // which turns one bell into a sparkle without adding a synth layer.
    if (cue.shimmer) {
      const bed = new Float64Array(Math.round(cue.dur * SR));
      cue.shimmer.forEach((t, i) => mixInto(bed, dry, t * SR, Math.pow(0.62, i)));
      dry = bed;
    }
    emit(cue.name, condition(dry, { ...cue, name: cue.name }), [key]);
  }

  /* keystrokes */
  for (const t of TYPING) {
    const raw = await load('pencil');
    // −18 dB, not the −21 these shipped at, and the engine's velocity floor
    // came up from 0.45 to 0.6 alongside — review reported the ticks as
    // inaudible. Peak was the wrong dial to read them by: at −21 a 140 ms tick
    // measured −33.7 dB RMS against a page turn's −31.2, and the velocity
    // scaling put the quiet strokes another 7 dB down from there. The two
    // changes together are +3.9 dB at mean velocity, which lands the tick just
    // under a page turn — audible as a keystroke, not as a typewriter.
    emit(t.name, condition(slice(raw, t.at, t.dur, false), {
      name: t.name, centroidMax: 1600, peakDb: -18, fadeInMs: 8, fadeOutMs: 55,
    }), ['pencil']);
  }

  /* seamless loops */
  for (const l of LOOPS) {
    const n = Math.round((l.ms / 1000) * SR);
    const fade = Math.round(l.fade * SR);
    /** Read `spec.ms + fade` worth of samples starting at spec.at. */
    const window = async ([key, arg], at) => {
      const raw = await load(key, arg);
      const from = Math.min(Math.round(at * SR), Math.max(0, raw.length - n - fade));
      return raw.slice(from, from + n + fade);
    };
    let src;
    let keys;
    if (l.layers) {
      keys = l.layers.map((layer) => layer.src[0]);
      src = new Float64Array(n + fade);
      for (const layer of l.layers) {
        mixInto(src, await window(layer.src, layer.at), 0, layer.gain);
      }
    } else {
      keys = [l.src[0]];
      src = await window(l.src, l.at);
    }
    let y = seamlessLoop(src, n, fade);
    y = filtfilt(y, highpassCoeffs(70, 0.7));
    y = fitVoicing(y, {
      centroidMax: l.centroidMax, centroidMin: l.centroidMin ?? 0,
      peakDb: l.peakDb, cornerHz: 1400, name: l.name,
    });
    y = dcBlock(y);
    // Loops still have to start and end at zero — nothing may click when Howler
    // restarts them — but the fade has to be short enough not to punch an
    // audible hole in the seam. 5 ms is the balance: a steady bed like the
    // rain is still at only ~2% of its own level half a millisecond in (a
    // 1.5 ms fade left it at 14%, which reads as a soft thud on every loop
    // restart), while 10 ms of duck per 8 s cycle is well under what anyone
    // hears in a background texture.
    y = fadeEdges(y, 5, 5);
    emit(l.name, normalizeTo(y, l.peakDb), keys);
  }

  /* the hour chime, assembled from repeated strikes */
  for (const c of CHIMES) {
    const raw = await load('bell', c.bell);
    const strike = slice(raw, 0, Math.min(2.4, raw.length / SR), false);
    const n = Math.round(c.total * SR);
    const bed = new Float64Array(n);
    c.strikes.forEach((t, i) => mixInto(bed, strike, t * SR, Math.pow(0.72, i)));
    let y = filtfilt(bed, highpassCoeffs(90, 0.7));
    y = fitVoicing(y, { centroidMax: 1500, peakDb: -14, cornerHz: 1500, name: c.name });
    y = dcBlock(y);
    y = fadeEdges(y, 12, 900);
    emit(c.name, normalizeTo(y, -14), ['bell']);
  }

  /* manifest + report */
  const manifest = {
    note: 'Provenance for every shipped cue. Rebuild with: node scripts/gen-sounds.mjs',
    generated: new Date().toISOString().slice(0, 10),
    attributionsRequired: [...new Set(
      Object.values(credits).flat().filter((c) => c.attributionRequired).map((c) => c.attributionText),
    )],
    sounds: credits,
  };
  writeFileSync(join(OUT_DIR, 'CREDITS.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const pad = (s, n) => String(s).padStart(n);
  const lines = [
    'public/sounds — built by scripts/gen-sounds.mjs from real recordings.',
    'Provenance and licences: CREDITS.json and docs/design/sound.md.',
    '',
    'name                      ms    peakDb  centroid   >4kHz%  maxStep%',
  ];
  for (const r of rows) {
    lines.push(r.name.padEnd(20) + pad(r.ms, 8) + pad(r.peakDb, 10) + pad(r.centroid, 10)
      + pad(r.highPct, 9) + pad(r.stepPct, 10));
  }
  writeFileSync(join(OUT_DIR, 'report.txt'), `${lines.join('\n')}\n`);

  console.log(lines.join('\n'));
  console.log(`\n${rows.length} files written to public/sounds/`);
  return rows;
}

await build();
