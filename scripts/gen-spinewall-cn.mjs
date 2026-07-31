/**
 * scripts/gen-spinewall-cn.mjs — spine walls under ControlNet, not luck.
 *
 * The prompt-only generator (`gen-spinewall.mjs`, kept for reference) proved
 * across three rounds that SDXL will give us reference-grade leather, cloth
 * and gilt, and will not give us a composition: books came back cropped
 * through the head, stacked flat, floating at random heights, or arranged as
 * an aerial jumble. Framing is not a semantic property, so no adjective
 * reaches it.
 *
 * Here the composition is a *drawing* — `make-spine-layout.py` emits the row
 * as white rectangles on black, feet on a common baseline — and ControlNet
 * Union (xinsir promax, canny branch) holds the generator to it. Every book
 * lands in its box at its own height, complete, with air above and below.
 * SDXL is left with the one job it is extraordinary at: surface.
 *
 * Strength 0.85 rather than 1.0, ending at 90%: the last stretch of sampling
 * unconstrained lets edges soften into real board and leather instead of the
 * ruler-straight boundaries a full-strength canny hint bakes in.
 *
 * Usage: node scripts/gen-spinewall-cn.mjs [--layouts 6] [--only leather]
 */
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LAYOUTS = join(ROOT, 'assets', 'spinelayouts');
const OUT = join(ROOT, 'assets', 'spinewalls');
const HOST = process.env.COMFY_HOST ?? 'http://127.0.0.1:8188';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const CKPT = opt('ckpt', 'juggernautXL.safetensors');
const LORA = 'add-detail-xl.safetensors';
const CONTROLNET = opt('controlnet', 'controlnet-union-sdxl-promax.safetensors');
const N_LAYOUTS = Math.max(1, Number(opt('layouts', 6)));
const ONLY = opt('only', null);

/**
 * With composition handed to ControlNet the prompt shrinks to material and
 * light. Everything about pose, count, crop and arrangement is gone — it is
 * in the control image, where it belongs.
 *
 * Light stays deliberately flat. The runtime applies the shelf's own key; a
 * spine that arrives pre-lit from the upper right cannot be relit and fights
 * every neighbour on the shelf.
 */
const LIGHT =
  'bright even diffuse frontal light, well exposed, no cast shadows, no directional shadows, '
  + 'shot straight on, f11 deep focus, ultra detailed, 8k, photorealistic macro texture detail';

const WEAR =
  'genuinely antique, worn corners, scuffed edges, faded patches, small nicks, uneven fading, foxing';

const WALLS = [
  ['leather', `a row of antique leather bound book spines, deep oxblood burgundy tan and dark brown leather, raised cord bands, ornate gold foil tooling and gilt lettering, ${WEAR}, ${LIGHT}`],
  ['cloth', `a row of early 20th century cloth bound book spines, faded linen and buckram in sage green dusty blue mustard ochre and rose, visible woven cloth texture, simple stamped titles, ${WEAR}, ${LIGHT}`],
  ['vivid', `a row of book spines in saturated jewel colours, emerald green sapphire blue crimson amethyst, silk bookcloth and morocco leather, bright gilt decoration, ${WEAR}, ${LIGHT}`],
  ['paper', `a row of old paper wrapped and marbled paper covered book spines, hand marbled patterns in amber and teal, vellum, handwritten ink labels, ${WEAR}, ${LIGHT}`],
  ['pale', `a row of pale book spines, cream ivory vellum and pale grey card bindings, faint printed labels, soft neutral tones, ${WEAR}, ${LIGHT}`],
];

/**
 * The metal clauses earn their place: the first ControlNet pass turned the
 * layout's band lines into a gold cap on the head of every single book, and
 * fourteen identical caps in a row is exactly the visible repetition
 * ART-BIBLE.md forbids. The layout now draws far fewer bands, and these say
 * what the remaining ones are not.
 */
const NEG =
  'dark, underexposed, dim, murky, moody lighting, '
  + 'metal caps, brass fittings, metal clasps, gold corner pieces, identical books, repeating pattern, '
  + 'shelf, wooden shelf, bookcase, leaves, plants, flowers, rope, '
  + 'blurry, depth of field, bokeh, low resolution, cartoon, illustration, watermark, deformed, text overlay';

/** Push the layout PNG into ComfyUI's input folder and return its name there. */
async function upload(path, name) {
  const body = new FormData();
  body.append('image', new Blob([await readFile(path)], { type: 'image/png' }), name);
  body.append('overwrite', 'true');
  const res = await fetch(`${HOST}/upload/image`, { method: 'POST', body });
  if (!res.ok) throw new Error(`upload ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).name;
}

function graph({ prompt, seed, hint }) {
  return {
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: CKPT } },
    12: {
      class_type: 'LoraLoader',
      inputs: { model: ['4', 0], clip: ['4', 1], lora_name: LORA, strength_model: 0.6, strength_clip: 0.6 },
    },
    6: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['12', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: NEG, clip: ['12', 1] } },
    20: { class_type: 'LoadImage', inputs: { image: hint } },
    21: { class_type: 'ControlNetLoader', inputs: { control_net_name: CONTROLNET } },
    22: {
      // The layout is already clean white-on-black line work, so it feeds the
      // canny branch directly — running an edge detector over it would only
      // double every stroke.
      class_type: 'SetUnionControlNetType',
      inputs: { control_net: ['21', 0], type: 'canny/lineart/anime_lineart/mlsd' },
    },
    23: {
      class_type: 'ControlNetApplyAdvanced',
      inputs: {
        positive: ['6', 0], negative: ['7', 0], control_net: ['22', 0], image: ['20', 0],
        strength: 0.85, start_percent: 0, end_percent: 0.9,
      },
    },
    5: { class_type: 'EmptyLatentImage', inputs: { width: 1536, height: 1024, batch_size: 1 } },
    3: {
      class_type: 'KSampler',
      inputs: {
        seed, steps: 34, cfg: 6.5, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1,
        model: ['12', 0], positive: ['23', 0], negative: ['23', 1], latent_image: ['5', 0],
      },
    },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'spinewall-cn', images: ['8', 0] } },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(g, outPath) {
  const res = await fetch(`${HOST}/prompt`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: g, client_id: 'spinewall-cn' }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 400)}`);
  const { prompt_id } = await res.json();
  for (let i = 0; i < 900; i++) {
    const hist = await (await fetch(`${HOST}/history/${prompt_id}`)).json();
    const e = hist[prompt_id];
    if (e?.status?.status_str === 'error') throw new Error(JSON.stringify(e.status).slice(0, 400));
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

/** Upload each layout once; every style reuses the same hints. */
const hints = [];
for (let i = 1; i <= N_LAYOUTS; i++) {
  const path = join(LAYOUTS, `layout-${i}.png`);
  try {
    await access(path);
  } catch {
    process.stdout.write(`missing ${path} — run: python scripts/make-spine-layout.py --count ${N_LAYOUTS}\n`);
    break;
  }
  hints.push(await upload(path, `nb-spine-layout-${i}.png`));
}
if (!hints.length) process.exit(1);

process.stdout.write(`controlnet spine walls: ${walls.length} styles x ${hints.length} layouts\n`);
for (const [slug, prompt] of walls) {
  for (let i = 0; i < hints.length; i++) {
    const name = `${slug}-L${i + 1}`;
    const outPath = join(OUT, `${name}.png`);
    try {
      await access(outPath);
      process.stdout.write(`  ${name} — exists\n`);
      continue;
    } catch {}
    const seed = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 404);
    const t0 = Date.now();
    try {
      await run(graph({ prompt, seed, hint: hints[i] }), outPath);
      process.stdout.write(`  ${name} ok (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
    } catch (err) {
      process.stdout.write(`  ${name} FAILED: ${err.message}\n`);
    }
  }
}
process.stdout.write('\ndone -> assets/spinewalls — then: python scripts/cut-spines.py\n');
