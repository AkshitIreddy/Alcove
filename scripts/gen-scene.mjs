/**
 * scripts/gen-scene.mjs — author the shelf as a finished image, not a recipe.
 *
 * Proof-of-concept for docs/design/RESET-render-architecture.md. Instead of
 * painting a bookcase from a thousand CPU brush passes at startup, generate
 * the whole thing once at high resolution, with the light already in it, and
 * blit it at runtime.
 *
 * Runs at 1536x1024 (SDXL handles this aspect natively) so there is real
 * resolution to draw from, and asks for the reference's specific light:
 * warm raking key from upper right, backlit foliage, deep warm shadow.
 *
 * Usage: node scripts/gen-scene.mjs [--variants 4] [--ckpt juggernautXL.safetensors]
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'scenes');
const HOST = process.env.COMFY_HOST ?? 'http://127.0.0.1:8188';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const CKPT = opt('ckpt', 'juggernautXL.safetensors');
const LORA = 'add-detail-xl.safetensors';
const VARIANTS = Math.max(1, Number(opt('variants', 4)));

/**
 * The light IS the subject. Everything after the comma about lighting is doing
 * more work than the nouns — see docs/design/ART-BIBLE.md.
 */
const LIGHT = 'warm golden afternoon sunlight raking in from the upper right, visible light rays, backlit translucent leaves glowing, soft bloom around highlights, deep warm shadows that are never pure black, high dynamic range, cinematic';
const CRAFT = 'aged oak shelves with visible grain and worn scuffed edges, antique leather and cloth bound books of many different heights thicknesses and colours, gold foil lettering catching the light, trailing ivy and climbing vines, clusters of pink and white flowers, natural imperfections, nothing repeating';
/**
 * Framing matters as much as the light. "35mm f2.8 shallow depth" produced
 * beautiful MACRO close-ups of two books — the model reads shallow depth and
 * a normal lens as an intimate detail shot. We need an architectural
 * elevation: the whole case, square on, everything in focus.
 */
const CAM = 'straight-on front view of the entire bookcase, eye level, symmetrical elevation, full shelving unit visible edge to edge, wide angle 24mm, f11 deep focus everything sharp, shot on Canon EOS R5, ultra detailed, 8k, photorealistic';

const SCENES = [
  ['grove', `an enchanted old library bookshelf overgrown with lush greenery, ${CRAFT}, ${LIGHT}, ${CAM}`],
  ['athenaeum', `a grand old library bookcase of dark quartersawn oak, densely packed antique leather books with gilt spines, brass fittings, a few trailing ivy strands, ${LIGHT}, ${CAM}`],
  ['cottage', `a cosy cottage bookshelf of honey pine with knots, worn painted edges, colourful cloth-bound books, jars of dried flowers, gingham bunting, ${LIGHT}, ${CAM}`],
];

function graph({ prompt, seed, w, h, steps, cfg }) {
  return {
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: CKPT } },
    12: {
      class_type: 'LoraLoader',
      inputs: { model: ['4', 0], clip: ['4', 1], lora_name: LORA, strength_model: 0.5, strength_clip: 0.5 },
    },
    6: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['12', 1] } },
    // Juggernaut degrades with heavy negatives; keep it to real failure modes.
    7: { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, low resolution, cartoon, flat lighting, watermark, text overlay, deformed', clip: ['12', 1] } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: w, height: h, batch_size: 1 } },
    3: {
      class_type: 'KSampler',
      inputs: {
        seed, steps, cfg, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1,
        model: ['12', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
      },
    },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'scene', images: ['8', 0] } },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(g, outPath) {
  const res = await fetch(`${HOST}/prompt`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: g, client_id: 'scene' }),
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
          return true;
        }
      }
      throw new Error('finished with no image');
    }
    await sleep(900);
  }
  throw new Error('timeout');
}

await mkdir(OUT, { recursive: true });
process.stdout.write(`scenes: ${SCENES.length} x ${VARIANTS} @ 1536x1024\n`);
for (const [slug, prompt] of SCENES) {
  for (let v = 0; v < VARIANTS; v++) {
    const name = `${slug}-v${v + 1}`;
    const outPath = join(OUT, `${name}.png`);
    try {
      await access(outPath);
      process.stdout.write(`  ${name} — exists\n`);
      continue;
    } catch {}
    const seed = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 23);
    const t0 = Date.now();
    try {
      await run(graph({ prompt, seed, w: 1536, h: 1024, steps: 32, cfg: 6.0 }), outPath);
      process.stdout.write(`  ${name} ok (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
    } catch (err) {
      process.stdout.write(`  ${name} FAILED: ${err.message}\n`);
    }
  }
}
process.stdout.write('\ndone -> assets/scenes — compare against the reference before building on this\n');
