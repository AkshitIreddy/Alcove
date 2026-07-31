/**
 * scripts/gen-cutouts.mjs — foliage sprites with a TRUE alpha channel.
 *
 * LayerDiffuse (huchenlei/ComfyUI-layerdiffuse) makes the model generate
 * transparency natively rather than us keying a background out afterwards.
 * That matters for foliage: keyed cut-outs lose soft edges, pick up a halo of
 * the old backdrop, and cannot represent a translucent petal edge at all.
 *
 * Known caveat from the project's issue tracker: the SDXL LayerDiffuse weights
 * are trained against base SDXL and can misbehave on re-trained checkpoints,
 * so this defaults to base SDXL even though DreamShaper wins elsewhere.
 * Compare before assuming.
 *
 * Usage: node scripts/gen-cutouts.mjs [--ckpt X] [--variants N]
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'cutouts');
const HOST = process.env.COMFY_HOST ?? 'http://127.0.0.1:8188';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const CKPT = opt('ckpt', 'sd_xl_base_1.0.safetensors');
const VARIANTS = Math.max(1, Number(opt('variants', 2)));
const SIZE = Number(opt('size', 1024));

const STYLE = 'hand-painted botanical illustration, gouache and coloured pencil, soft painterly edges, rich saturated colour, luminous, high detail';
const NEG = 'photograph, 3d render, dull, desaturated, muddy, harsh shadows, watermark, text, blurry, low quality, frame, border';

const SUBJECTS = [
  ['ivy-leaf', 'a single ivy leaf'],
  ['pothos-leaf', 'a single heart-shaped pothos leaf'],
  ['fern-frond', 'a single fern frond'],
  ['blossom', 'a single pink cherry blossom flower with five petals'],
  ['daisy', 'a single white daisy flower with a yellow centre'],
  ['rose-leaf', 'a single serrated rose leaf'],
  ['berry-sprig', 'a small sprig with three red berries'],
  ['moss-tuft', 'a small tuft of green moss'],
  ['wildflower', 'a single small purple wildflower'],
  ['grass-tuft', 'a small tuft of grass blades'],
];

function graph({ prompt, negative, seed, size, steps, cfg }) {
  return {
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: CKPT } },
    // Attention Injection is the recommended SDXL config — it produces cleaner
    // alpha on thin structures (stems, petal edges) than Conv Injection.
    10: {
      class_type: 'LayeredDiffusionApply',
      inputs: { model: ['4', 0], config: 'SDXL, Attention Injection', weight: 1.0 },
    },
    6: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['4', 1] } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: size, height: size, batch_size: 1 } },
    3: {
      class_type: 'KSampler',
      inputs: {
        seed, steps, cfg, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1,
        model: ['10', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
      },
    },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    // Recovers the alpha the model encoded into the latent.
    11: {
      class_type: 'LayeredDiffusionDecodeRGBA',
      inputs: { samples: ['3', 0], images: ['8', 0], sd_version: 'SDXL', sub_batch_size: 16 },
    },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'cut', images: ['11', 0] } },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(g, outPath) {
  const res = await fetch(`${HOST}/prompt`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: g, client_id: 'cutouts' }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 240)}`);
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
      return false;
    }
    await sleep(800);
  }
  throw new Error('timeout');
}

const settings = CKPT.includes('dreamshaper') ? { steps: 8, cfg: 2.0 } : { steps: 28, cfg: 6.5 };

await mkdir(OUT, { recursive: true });
process.stdout.write(`LayerDiffuse cutouts — ${CKPT}, ${VARIANTS} variant(s)\n`);
for (const [slug, subject] of SUBJECTS) {
  for (let v = 0; v < VARIANTS; v++) {
    const name = VARIANTS > 1 ? `${slug}-v${v + 1}` : slug;
    const outPath = join(OUT, `${name}.png`);
    try {
      await access(outPath);
      process.stdout.write(`  ${name} — exists\n`);
      continue;
    } catch {}
    const seed = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 11);
    const t0 = Date.now();
    try {
      await run(graph({
        prompt: `${subject}, ${STYLE}, isolated, centred, transparent background`,
        negative: NEG, seed, size: SIZE, ...settings,
      }), outPath);
      process.stdout.write(`  ${name} ok (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
    } catch (err) {
      process.stdout.write(`  ${name} FAILED: ${err.message}\n`);
    }
  }
}
process.stdout.write('\ndone -> assets/cutouts (LOOK at the alpha before trusting it)\n');
