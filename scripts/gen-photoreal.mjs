/**
 * scripts/gen-photoreal.mjs — photoreal material + element library.
 *
 * See docs/design/photoreal-assets.md. Two things learned from the reference:
 * the "enchanted" quality is LIGHTING (the shader's job, so these generate
 * flat-lit), and every real surface carries WEAR — scuffs, nicks, fading,
 * uneven varnish. Uniformity is the tell of computer-generated art, so wear
 * language is baked into every prompt.
 *
 * Stack: Juggernaut XL v9 (photoreal standard) + Detail Tweaker XL LoRA.
 * Per Juggernaut's guidance the negative prompt is minimal — heavy negatives
 * measurably reduce quality on this checkpoint, unlike base SDXL.
 *
 * Usage: node scripts/gen-photoreal.mjs [--set materials|nature] [--variants N]
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'photoreal');
const HOST = process.env.COMFY_HOST ?? 'http://127.0.0.1:8188';
const CKPT = 'juggernautXL.safetensors';
const LORA = 'add-detail-xl.safetensors';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

/** Photography language, not art language — this is what photoreal models parse. */
const CAM = 'shot on Canon EOS R5, 100mm macro lens, soft diffuse studio light, flat even illumination, no directional shadows, ultra detailed, 8k, sharp focus';
/** Wear is not optional; it is what separates real from rendered. */
const WEAR = 'worn, aged, scuffed, subtle imperfections, uneven patina, fine surface detail';
/** Deliberately short — Juggernaut degrades with heavy negatives. */
const NEG = 'blurry, watermark, text, cartoon, illustration, flat, plastic';

const SETS = {
  materials: {
    size: 1024, tile: true,
    items: [
      ['oak-quartersawn', 'seamless tileable texture of quartersawn white oak board, open grain and ray fleck, satin varnish worn thin in places, small nicks and scratches'],
      ['walnut-figured', 'seamless tileable texture of figured black walnut, rippled flowing grain, oiled finish, faint scuffs'],
      ['pine-old', 'seamless tileable texture of old pine board, knots and resin streaks, dented and dinged, faded wax finish'],
      ['wood-painted-chipped', 'seamless tileable texture of painted wood, sage green paint chipped and flaking to bare wood beneath, worn edges'],
      ['leather-oxblood', 'seamless tileable texture of oxblood goatskin bookbinding leather, fine pebbled grain, rubbed and darkened with age'],
      ['leather-tan-cracked', 'seamless tileable texture of tan calfskin book leather, fine craquelure, worn corners, aged patina'],
      ['bookcloth-navy', 'seamless tileable texture of navy blue bookbinding cloth, visible woven texture, faded and slightly stained'],
      ['bookcloth-forest', 'seamless tileable texture of dark green library book cloth, coarse weave, sun-faded and rubbed'],
      ['vellum-aged', 'seamless tileable texture of aged vellum parchment, mottled and foxed, soft translucency'],
      ['paper-marbled', 'seamless tileable texture of antique marbled endpaper, combed swirl pattern in deep red teal and cream'],
      ['plaster-limewash', 'seamless tileable texture of limewashed plaster wall, soft trowel marks, hairline cracks, gently mottled'],
      ['wallpaper-plain-linen', 'seamless tileable texture of plain linen-weave wallcovering, subtle warm neutral, very low contrast'],
    ],
    suffix: `${WEAR}, top-down flat lay, ${CAM}`,
  },
  nature: {
    size: 1024, tile: false, cutout: true,
    items: [
      ['ivy-sprig', 'a single ivy sprig with three leaves on a woody stem'],
      ['ivy-leaf-large', 'one large english ivy leaf, deep green with pale veins'],
      ['pothos-leaf', 'one heart-shaped pothos leaf, glossy green with variegation'],
      ['fern-frond', 'one fern frond'],
      ['jasmine-flowers', 'a small spray of white jasmine flowers with green leaves'],
      ['bougainvillea', 'a cluster of vivid magenta bougainvillea flowers with leaves'],
      ['rose-pink', 'one pink garden rose bloom with leaves'],
      ['wildflower-purple', 'a sprig of small purple wildflowers'],
      ['moss-clump', 'a clump of bright green cushion moss'],
      ['trailing-vine', 'a long trailing vine with small round leaves'],
    ],
    suffix: `some leaves curled yellowing or nibbled, natural imperfections, isolated on plain white background, centred, ${CAM}`,
  },
};

function graph({ prompt, negative, seed, size, steps, cfg, tile, loraStrength = 0.6 }) {
  const g = {
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: CKPT } },
    // Detail Tweaker sharpens micro-texture — the pores, weave and grit that
    // read as "real" at shelf scale.
    12: {
      class_type: 'LoraLoader',
      inputs: { model: ['4', 0], clip: ['4', 1], lora_name: LORA, strength_model: loraStrength, strength_clip: loraStrength },
    },
    6: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['12', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['12', 1] } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: size, height: size, batch_size: 1 } },
    3: {
      class_type: 'KSampler',
      inputs: {
        seed, steps, cfg, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1,
        model: [tile ? '20' : '12', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
      },
    },
    8: {
      class_type: tile ? 'CircularVAEDecode' : 'VAEDecode',
      inputs: tile ? { samples: ['3', 0], vae: ['4', 2], tiling: 'enable' } : { samples: ['3', 0], vae: ['4', 2] },
    },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'pr', images: ['8', 0] } },
  };
  if (tile) g[20] = { class_type: 'SeamlessTile', inputs: { model: ['12', 0], copy_model: 'Make a copy', tiling: 'enable' } };
  return g;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(g, outPath) {
  const res = await fetch(`${HOST}/prompt`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: g, client_id: 'photoreal' }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 220)}`);
  const { prompt_id } = await res.json();
  for (let i = 0; i < 500; i++) {
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
      throw new Error('completed with no image');
    }
    await sleep(800);
  }
  throw new Error('timeout');
}

const setName = opt('set', 'materials');
const variants = Math.max(1, Number(opt('variants', 1)));
const set = SETS[setName];
if (!set) {
  process.stdout.write(`unknown set: ${setName}\n`);
  process.exit(1);
}

const dir = join(OUT, setName);
await mkdir(dir, { recursive: true });
process.stdout.write(`${setName}: ${set.items.length} x ${variants} @ ${set.size}px — Juggernaut XL + Detail Tweaker\n`);

for (const [baseSlug, subject] of set.items) {
  for (let v = 0; v < variants; v++) {
    const slug = variants > 1 ? `${baseSlug}-v${v + 1}` : baseSlug;
    const outPath = join(dir, `${slug}.png`);
    try {
      await access(outPath);
      process.stdout.write(`  ${slug} — exists\n`);
      continue;
    } catch {}
    const seed = [...slug].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 17);
    const t0 = Date.now();
    try {
      const ok = await run(graph({
        prompt: `${subject}, ${set.suffix}`,
        negative: NEG, seed, size: set.size,
        steps: Number(opt('steps', 30)), cfg: Number(opt('cfg', 6.5)),
        tile: set.tile === true,
      }), outPath);
      process.stdout.write(`  ${slug} ${ok ? 'ok' : 'NO IMAGE'} (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
    } catch (err) {
      process.stdout.write(`  ${slug} FAILED: ${err.message}\n`);
    }
  }
}
process.stdout.write('\ndone -> assets/photoreal — LOOK before generating more\n');
