/**
 * scripts/gen-spinewall.mjs — generate walls of book spines to be cut into sprites.
 *
 * Lesson from assets/scenes: the model produces *reference-grade materials*
 * (leather grain, gold foil catching light, cloth weave) but will not produce
 * clean *architecture* — asked for a bookcase elevation it returns drunken,
 * non-orthogonal shelves. So we stop asking it for structure. It generates
 * matter; code composes geometry.
 *
 * A dense straight-on row of spines is the single highest-value thing it can
 * make for us: one image yields 12-16 finished book sprites. Generate many
 * rows across styles, then scripts/cut-spines.py slices them at the gutters.
 *
 * Lighting is deliberately FLAT. The runtime applies the shelf's own light;
 * a spine that arrives with a baked highlight from the upper right cannot be
 * relit and will fight every other sprite on the shelf.
 *
 * Usage: node scripts/gen-spinewall.mjs [--variants 3] [--only leather]
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'spinewalls');
const HOST = process.env.COMFY_HOST ?? 'http://127.0.0.1:8188';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const CKPT = opt('ckpt', 'juggernautXL.safetensors');
const LORA = 'add-detail-xl.safetensors';
const VARIANTS = Math.max(1, Number(opt('variants', 3)));
const ONLY = opt('only', null);

/**
 * Straight on, flat light, whole spine in frame — and, above all, FAR ENOUGH
 * AWAY.
 *
 * The first attempt asked for "100mm macro" in a portrait frame and got what
 * it deserved: four rope-bound books filling the canvas, and in the cloth
 * pass a stack of books lying flat. Both failures are distance failures. The
 * model has no idea how far back to stand unless the prompt says so, and a
 * tall frame invites it to fill the height with a few large objects.
 *
 * So: state the camera distance, state the count, insist the books are
 * UPRIGHT and each one NARROW, and shoot landscape (below) — a row of books
 * across is a wide picture, and the aspect ratio does half the work of the
 * words.
 */
/**
 * The landscape frame fixed the pose; this fixes exposure and framing slack.
 *
 * Round two came back correctly upright and narrow but nearly black, cropped
 * through the head and tail of every book. Two additions handle both — and
 * the second one turns a defect into the whole cutting strategy.
 *
 * The model likes to float these rows on a black studio backdrop. Rather than
 * fight it, ask for it explicitly: a pure black background keys straight to
 * alpha, so `cut-spines.py` can separate books by connected components on the
 * lit mask instead of guessing at gutters. That handles books of different
 * heights for free, which no vertical-cut heuristic does well.
 *
 * The corollary is that the books must be BRIGHT — a dark book on a dark
 * ground has no mask — and must sit fully inside the frame with air above and
 * below, or the component runs off the edge and the sprite is beheaded.
 */
const FRAME =
  'a long row of twelve upright books standing vertically side by side and touching, '
  + 'spines facing the camera, photographed straight on from two metres away, '
  + 'each individual spine a narrow vertical strip, '
  + 'every book complete and entirely inside the frame with empty space above and below the row, '
  + 'the head and tail edges of every book clearly visible, '
  + 'orthographic front elevation, no perspective, '
  + 'brightly and evenly lit, well exposed, bright diffuse frontal studio light, no cast shadows, '
  + 'isolated on a pure black background, product photography cutout, '
  + 'shot on Canon EOS R5 50mm, f11 deep focus, every spine equally sharp, '
  + 'ultra detailed, 8k, photorealistic';

const WEAR =
  'genuinely antique, worn corners, scuffed edges, faded patches, small nicks, '
  + 'uneven fading, foxing, each book a different height and thickness';

const WALLS = [
  ['leather', `${FRAME}, antique leather bound books, deep oxblood burgundy tan and dark brown leather, raised cord bands across the spines, ornate gold foil tooling and gilt lettering, ${WEAR}`],
  ['cloth', `${FRAME}, early 20th century cloth bound books, faded linen and buckram in sage green dusty blue mustard ochre and rose, visible woven cloth texture, simple stamped titles, ${WEAR}`],
  ['vivid', `${FRAME}, beautifully bound books in saturated jewel colours, emerald green sapphire blue crimson amethyst and gold, silk bookcloth and morocco leather, bright gilt decoration, ${WEAR}`],
  ['paper', `${FRAME}, old paper wrapped and marbled paper covered books, hand marbled endpaper patterns in amber and teal, vellum spines, handwritten ink labels, ${WEAR}`],
  ['slim', `${FRAME}, thin slender volumes and pamphlets, narrow spines, pale card and vellum bindings in cream ivory and pale grey, small printed labels, ${WEAR}`],
];

/**
 * The failure modes are specific and worth naming individually: the model's
 * two favourite readings of "row of books" are a close-up of a few, and a
 * horizontal stack seen from the side. Both are named here.
 */
const NEG =
  'stacked, lying down, horizontal books, pile of books, close-up, macro, extreme close up, '
  + 'few books, large books, rope, string, twine, cropped, cut off, '
  + 'dark, underexposed, dim, murky, moody lighting, black shadows, '
  + 'shelf, wooden shelf, bookcase, leaves, plants, flowers, angled, perspective, tilted, '
  + 'blurry, depth of field, bokeh, low resolution, cartoon, illustration, watermark, deformed';

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
        seed, steps: 34, cfg: 6.5, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1,
        model: ['12', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
      },
    },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'spinewall', images: ['8', 0] } },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(g, outPath) {
  const res = await fetch(`${HOST}/prompt`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: g, client_id: 'spinewall' }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { prompt_id } = await res.json();
  for (let i = 0; i < 900; i++) {
    const hist = await (await fetch(`${HOST}/history/${prompt_id}`)).json();
    const e = hist[prompt_id];
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
const walls = ONLY ? WALLS.filter(([s]) => s === ONLY) : WALLS;
/**
 * 1536x1024 landscape. The aspect ratio is not a detail — it is the strongest
 * single instruction in the whole generator. A wide frame *is* a row; a tall
 * one is a portrait of two or three books, which is exactly what the portrait
 * attempt produced. 1024px of height still leaves a cut spine more resolution
 * than the shelf will ever draw at.
 */
process.stdout.write(`spine walls: ${walls.length} x ${VARIANTS} @ 1536x1024\n`);
for (const [slug, prompt] of walls) {
  for (let v = 0; v < VARIANTS; v++) {
    const name = `${slug}-v${v + 1}`;
    const outPath = join(OUT, `${name}.png`);
    try {
      await access(outPath);
      process.stdout.write(`  ${name} — exists\n`);
      continue;
    } catch {}
    const seed = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 91);
    const t0 = Date.now();
    try {
      await run(graph({ prompt, seed, w: 1536, h: 1024 }), outPath);
      process.stdout.write(`  ${name} ok (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
    } catch (err) {
      process.stdout.write(`  ${name} FAILED: ${err.message}\n`);
    }
  }
}
process.stdout.write('\ndone -> assets/spinewalls — then: python scripts/cut-spines.py\n');
