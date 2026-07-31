/**
 * scripts/gen-room.mjs — the wall and the wood, authored once at real size.
 *
 * Two reported problems share one cause. The wall shows pale horizontal
 * banding when you pan, worst in the corners, because it is a small tile
 * repeated across the viewport and the seam is visible. The case looks muddy
 * because its wood is a 512px material stretched over a whole bookcase. Both
 * are resolution problems dressed up as art problems.
 *
 * So: one wall panel big enough that no repeat is ever on screen, and wood at
 * a size the case can actually be drawn from.
 *
 * The wall is deliberately PLAIN. Asked for a plain wall the app can then
 * overlay an optional pattern, rather than baking a pattern in that cannot be
 * removed — "should be usable with no pattern" is a requirement, not a
 * default. It is also deliberately unlit and low-contrast: the shelf casts its
 * own shadow onto it, and a wall arriving with baked lighting fights that.
 *
 * Usage: node scripts/gen-room.mjs [--only wall]
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'room');
const HOST = process.env.COMFY_HOST ?? 'http://127.0.0.1:8188';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const CKPT = opt('ckpt', 'juggernautXL.safetensors');
const LORA = 'add-detail-xl.safetensors';
const ONLY = opt('only', null);

const FLAT =
  'photographed perfectly flat on, orthographic, filling the whole frame, '
  + 'completely even diffuse lighting, no shadows, no vignette, no highlights, no light falloff, '
  + 'uniform exposure corner to corner, f11, ultra detailed, 8k, photorealistic';

const NEG =
  'vignette, shadow, gradient, spotlight, uneven lighting, dark corners, '
  + 'rough, splintered, cracked, weathered, barnwood, driftwood, bark, rotten, peeling, '
  + 'objects, furniture, plants, flowers, leaves, text, watermark, people, '
  + 'perspective, angled, blurry, low resolution, cartoon, illustration';

/**
 * 1536x1536 for the wall: at the app's zoom range that is wider than the
 * viewport, so the repeat never lands on screen at all.
 */
const PIECES = [
  ['wall-plaster', 1536, 1536,
    `a large expanse of plain painted plaster wall, soft warm off-white with a faint sage undertone, `
    + `very subtle hand-troweled surface texture, fine grain, gentle tonal variation, no pattern, `
    + `${FLAT}`],
  /*
   * The first pass asked for "aged, worn, scuffed patina" and got exactly
   * that: splintered reclaimed barnwood, cracked and shedding. A bookcase is
   * furniture, not a fence — the words that matter are planed, cabinetmaker,
   * satin varnish. Wear belongs on the EDGES, which the case art draws, not
   * milled into the face of every board.
   */
  ['wood-oak-horizontal', 1536, 768,
    `the flat front face of a smooth planed white oak board, cabinetmaker quality furniture timber, `
    + `seen straight on, fine straight grain running left to right, warm honey brown, `
    + `subtle medullary ray fleck, satin varnish sheen, perfectly smooth sanded surface, `
    + `${FLAT}`],
  ['wood-oak-vertical', 768, 1536,
    `the flat front face of a smooth planed white oak post, cabinetmaker quality furniture timber, `
    + `seen straight on, fine straight grain running top to bottom, warm honey brown, `
    + `subtle medullary ray fleck, satin varnish sheen, perfectly smooth sanded surface, `
    + `${FLAT}`],
  ['wood-oak-dark', 1536, 768,
    `the flat front face of a smooth planed quartersawn walnut board, fine cabinetmaking timber, `
    + `seen straight on, tight figured grain running left to right, deep chocolate brown, `
    + `french polished satin sheen, perfectly smooth sanded surface, `
    + `${FLAT}`],
];

function graph({ prompt, seed, w, h }) {
  return {
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: CKPT } },
    12: {
      class_type: 'LoraLoader',
      inputs: { model: ['4', 0], clip: ['4', 1], lora_name: LORA, strength_model: 0.6, strength_clip: 0.6 },
    },
    6: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['12', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: NEG, clip: ['12', 1] } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: w, height: h, batch_size: 1 } },
    3: {
      class_type: 'KSampler',
      inputs: {
        seed, steps: 34, cfg: 6.0, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1,
        model: ['12', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
      },
    },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'room', images: ['8', 0] } },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(g, outPath) {
  const res = await fetch(`${HOST}/prompt`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: g, client_id: 'room' }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
  const { prompt_id } = await res.json();
  for (let i = 0; i < 900; i++) {
    const hist = await (await fetch(`${HOST}/history/${prompt_id}`)).json();
    const e = hist[prompt_id];
    if (e?.status?.status_str === 'error') throw new Error(JSON.stringify(e.status).slice(0, 300));
    if (e?.outputs) {
      for (const node of Object.values(e.outputs)) {
        for (const img of node.images ?? []) {
          const url = `${HOST}/view?filename=${encodeURIComponent(img.filename)}`
            + `&subfolder=${encodeURIComponent(img.subfolder ?? '')}&type=${img.type ?? 'output'}`;
          await writeFile(outPath, Buffer.from(await (await fetch(url)).arrayBuffer()));
          return;
        }
      }
      throw new Error('finished with no image');
    }
    await sleep(900);
  }
  throw new Error('timeout');
}

await mkdir(OUT, { recursive: true });
const pieces = ONLY ? PIECES.filter(([s]) => s.includes(ONLY)) : PIECES;
process.stdout.write(`room pieces: ${pieces.length}\n`);
for (const [slug, w, h, prompt] of pieces) {
  const outPath = join(OUT, `${slug}.png`);
  try {
    await access(outPath);
    process.stdout.write(`  ${slug} — exists\n`);
    continue;
  } catch {}
  const seed = [...slug].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 77);
  const t0 = Date.now();
  try {
    await run(graph({ prompt, seed, w, h }), outPath);
    process.stdout.write(`  ${slug} ok ${w}x${h} (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
  } catch (err) {
    process.stdout.write(`  ${slug} FAILED: ${err.message}\n`);
  }
}
process.stdout.write('\ndone -> assets/room\n');
