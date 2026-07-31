/**
 * scripts/compare-configs.mjs — decide model + technique by looking, not guessing.
 *
 * Renders the same subjects across several (checkpoint x technique) configs and
 * writes one labelled contact sheet per subject. Per `state-of-the-art-first`:
 * base models and single-pass generation are the weakest options available, so
 * prove which combination actually wins before committing a whole library to it.
 *
 * Usage: node scripts/compare-configs.mjs
 * Requires ComfyUI on 127.0.0.1:8188 with both checkpoints present.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'qa', 'compare');
const HOST = 'http://127.0.0.1:8188';

const STYLE = 'hand-painted illustration, gouache and coloured pencil, soft painterly edges, subtle tonal variation, natural colour, high detail';
const NEG = 'photograph, 3d render, dramatic lighting, harsh shadows, strong highlights, rim light, vignette, border, frame, watermark, text, signature, blurry, low quality';

const SUBJECTS = [
  { slug: 'leather', tile: true, prompt: 'seamless tileable texture of cracked aged book-binding leather, fine grain, top-down, flat even lighting, no shadows' },
  { slug: 'walnut', tile: true, prompt: 'seamless tileable texture of walnut wood grain, flowing figure, top-down, flat even lighting, no shadows' },
  { slug: 'ivy', tile: false, prompt: 'a single ivy leaf, botanical illustration, centred, isolated on plain flat white background, flat even lighting, no shadow' },
];

/**
 * DreamShaper XL *Turbo* is distilled: it wants very few steps and low CFG.
 * Feeding it 28 steps at CFG 6.5 produces burnt, oversaturated mush — the
 * settings must travel with the checkpoint, not be global.
 */
const CONFIGS = [
  { name: 'base', ckpt: 'sd_xl_base_1.0.safetensors', steps: 28, cfg: 6.5, hires: 0 },
  { name: 'base+hires', ckpt: 'sd_xl_base_1.0.safetensors', steps: 28, cfg: 6.5, hires: 2 },
  { name: 'dshaper', ckpt: 'dreamshaperXL.safetensors', steps: 8, cfg: 2.0, hires: 0 },
  { name: 'dshaper+hires', ckpt: 'dreamshaperXL.safetensors', steps: 8, cfg: 2.0, hires: 2 },
];

const SIZE = 1024;

function graph({ ckpt, prompt, negative, seed, size, steps, cfg, tile, hires }) {
  const first = hires > 1 ? Math.round(size / hires / 8) * 8 : size;
  const g = {
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['4', 1] } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: first, height: first, batch_size: 1 } },
    3: {
      class_type: 'KSampler',
      inputs: {
        seed, steps, cfg, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1,
        model: [tile ? '20' : '4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
      },
    },
    8: {
      class_type: tile ? 'CircularVAEDecode' : 'VAEDecode',
      inputs: tile
        ? { samples: [hires > 1 ? '31' : '3', 0], vae: ['4', 2], tiling: 'enable' }
        : { samples: [hires > 1 ? '31' : '3', 0], vae: ['4', 2] },
    },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'cmp', images: ['8', 0] } },
  };
  if (tile) g[20] = { class_type: 'SeamlessTile', inputs: { model: ['4', 0], copy_model: 'Make a copy', tiling: 'enable' } };
  if (hires > 1) {
    g[30] = { class_type: 'LatentUpscale', inputs: { samples: ['3', 0], upscale_method: 'nearest-exact', width: size, height: size, crop: 'disabled' } };
    g[31] = {
      class_type: 'KSampler',
      inputs: {
        seed, steps: Math.max(6, Math.round(steps * 0.6)), cfg,
        sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 0.45,
        model: [tile ? '20' : '4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['30', 0],
      },
    };
  }
  return g;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(g, outPath) {
  const res = await fetch(`${HOST}/prompt`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: g, client_id: 'cmp' }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { prompt_id } = await res.json();
  for (let i = 0; i < 400; i++) {
    const hist = await (await fetch(`${HOST}/history/${prompt_id}`)).json();
    const e = hist[prompt_id];
    if (e?.outputs) {
      for (const node of Object.values(e.outputs)) {
        for (const img of node.images ?? []) {
          const url = `${HOST}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder ?? '')}&type=${img.type ?? 'output'}`;
          await writeFile(outPath, Buffer.from(await (await fetch(url)).arrayBuffer()));
          return true;
        }
      }
      return false;
    }
    await sleep(800);
  }
  throw new Error('timeout');
}

await mkdir(OUT, { recursive: true });
for (const s of SUBJECTS) {
  for (const c of CONFIGS) {
    const outPath = join(OUT, `${s.slug}__${c.name}.png`);
    const seed = 12345;
    const t0 = Date.now();
    try {
      await run(graph({
        ckpt: c.ckpt, prompt: `${s.prompt}, ${STYLE}`, negative: NEG,
        seed, size: SIZE, steps: c.steps, cfg: c.cfg, tile: s.tile, hires: c.hires,
      }), outPath);
      process.stdout.write(`  ${s.slug} / ${c.name}: ok (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
    } catch (err) {
      process.stdout.write(`  ${s.slug} / ${c.name}: FAILED ${err.message}\n`);
    }
  }
}
process.stdout.write('\ndone -> qa/compare\n');
