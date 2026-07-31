/**
 * scripts/gen-assets.mjs â€” drive a local ComfyUI to produce the art library.
 *
 * See docs/design/generated-assets.md for what we generate and why. The rule
 * that matters most: everything is generated with FLAT lighting, because the
 * deferred shader owns the light. A baked highlight fights the scene light and
 * reads as pasted-on immediately.
 *
 * Usage:
 *   node scripts/gen-assets.mjs --test                 # small batch, judge before committing
 *   node scripts/gen-assets.mjs --set materials
 *   node scripts/gen-assets.mjs --set foliage --count 3
 *
 * Requires ComfyUI running:  python main.py --listen 127.0.0.1 --port 8188
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'generated');
const HOST = process.env.COMFY_HOST ?? 'http://127.0.0.1:8188';
const CKPT = process.env.COMFY_CKPT ?? 'sd_xl_base_1.0.safetensors';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

/**
 * Held constant across the library so every asset shares one hand.
 *
 * Deliberately says nothing about COLOUR: the first pass carried "warm muted
 * palette" and the model applied it to the material itself â€” linen came out
 * purple-and-olive, morocco leather grew magenta flecks. The material's own
 * natural colour must win; themes tint at runtime anyway.
 */
const STYLE = 'hand-painted illustration, gouache and coloured pencil, soft painterly edges, subtle tonal variation, natural colour, high detail';
/** Flat lighting is non-negotiable â€” the runtime shader lights these. */
const NEG_BASE = 'photograph, 3d render, dramatic lighting, harsh shadows, strong highlights, rim light, vignette, border, frame, watermark, text, signature, blurry, low quality';
/** Cutouts kept coming back as multi-subject compositions instead of one specimen. */
const NEG_SINGLE = `${NEG_BASE}, multiple objects, repeated pattern, collage, grid, tiled, several, group, bouquet, arrangement, scattered`;

const SETS = {
  materials: {
    size: 1024,
    tile: true,
    items: [
      ['leather-cracked', 'seamless tileable texture of cracked aged book-binding leather, fine grain'],
      ['leather-morocco', 'seamless tileable texture of fine morocco goatskin bookbinding leather, pebbled grain'],
      ['cloth-ribbed', 'seamless tileable texture of ribbed book cloth bookbinding fabric, visible weave'],
      ['cloth-linen', 'seamless tileable texture of linen buckram bookbinding cloth, coarse thread'],
      ['vellum', 'seamless tileable texture of aged vellum parchment, faint mottling'],
      ['paper-laid', 'seamless tileable texture of laid writing paper, subtle chain lines, aged'],
      ['paper-marbled', 'seamless tileable texture of marbled endpaper, swirled combed pattern'],
      ['wood-oak', 'seamless tileable texture of quartersawn oak plank grain, ray fleck'],
      ['wood-walnut', 'seamless tileable texture of walnut wood grain, flowing figure'],
      ['wood-painted', 'seamless tileable texture of painted wood, paint chipped showing grain beneath'],
    ],
    suffix: 'top-down, flat even lighting, no shadows, no objects',
  },
  foliage: {
    size: 768,
    tile: false,
    cutout: true,
    items: [
      ['ivy-leaf', 'a single ivy leaf, botanical illustration'],
      ['pothos-leaf', 'a single heart-shaped pothos leaf, botanical illustration'],
      ['fern-frond', 'a single fern frond, botanical illustration'],
      ['blossom-cluster', 'a cluster of pink cherry blossom flowers on a twig, botanical illustration'],
      ['wildflower-cluster', 'a small cluster of white and yellow wildflowers, botanical illustration'],
      ['moss-clump', 'a clump of soft green moss, botanical illustration'],
    ],
    suffix: 'ONE single specimen only, alone, centred, nothing else in frame, isolated on plain empty white background, flat even lighting, no shadow, no pot, no vase',
    negative: NEG_SINGLE,
  },
  wallpaper: {
    size: 1024,
    tile: true,
    items: [
      ['damask', 'seamless wallpaper pattern, damask motif'],
      ['botanical-toile', 'seamless wallpaper pattern, botanical toile motif'],
      ['ditsy-floral', 'seamless wallpaper pattern, tiny ditsy floral motif'],
      ['art-nouveau-vine', 'seamless wallpaper pattern, art nouveau trailing vine motif'],
    ],
    suffix: 'very low contrast, subtle, vintage book endpaper, flat even lighting, no border',
  },
};

/**
 * SDXL txt2img graph in ComfyUI API format.
 *
 * When `tile` is set, both the UNet and the VAE get circular padding
 * (ComfyUI-seamless-tiling). Post-hoc mirroring is NOT an acceptable
 * substitute â€” it produces visibly symmetrical tiles. Verified empirically:
 * without this the edge discontinuity was ~2x the interior variation and the
 * seams were plainly visible in a 2x2 composite.
 */
function workflow({ prompt, negative, seed, size, steps = 28, cfg = 6.5, tile = false }) {
  const graph = {
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: CKPT } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['4', 1] } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: size, height: size, batch_size: 1 } },
    3: {
      class_type: 'KSampler',
      inputs: {
        seed, steps, cfg,
        sampler_name: 'dpmpp_2m',
        scheduler: 'karras',
        denoise: 1,
        model: [tile ? '20' : '4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
      },
    },
    8: {
      class_type: tile ? 'CircularVAEDecode' : 'VAEDecode',
      inputs: tile
        ? { samples: ['3', 0], vae: ['4', 2], tiling: 'enable' }
        : { samples: ['3', 0], vae: ['4', 2] },
    },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'nb', images: ['8', 0] } },
  };
  if (tile) {
    graph[20] = {
      class_type: 'SeamlessTile',
      inputs: { model: ['4', 0], copy_model: 'Make a copy', tiling: 'enable' },
    };
  }
  return graph;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function queue(graph, clientId) {
  const res = await fetch(`${HOST}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: clientId }),
  });
  if (!res.ok) throw new Error(`queue failed ${res.status}: ${await res.text()}`);
  return (await res.json()).prompt_id;
}

async function waitFor(promptId, timeoutMs = 300000) {
  const started = Date.now();
  for (;;) {
    const hist = await (await fetch(`${HOST}/history/${promptId}`)).json();
    const entry = hist[promptId];
    if (entry?.outputs) return entry;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${promptId}`);
    await sleep(800);
  }
}

async function saveOutputs(entry, outPath) {
  for (const node of Object.values(entry.outputs)) {
    for (const img of node.images ?? []) {
      const url = `${HOST}/view?filename=${encodeURIComponent(img.filename)}`
        + `&subfolder=${encodeURIComponent(img.subfolder ?? '')}&type=${img.type ?? 'output'}`;
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      await writeFile(outPath, buf);
      return true;
    }
  }
  return false;
}

async function alive() {
  try {
    const r = await fetch(`${HOST}/system_stats`, { signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await alive())) {
    process.stdout.write(
      `ComfyUI is not answering at ${HOST}.\nStart it first:\n`
      + `  cd C:\\Users\\akshi\\ComfyUI && .\\venv\\Scripts\\python.exe main.py --listen 127.0.0.1 --port 8188\n`,
    );
    process.exit(1);
  }

  const testMode = flag('test');
  const setNames = testMode ? ['materials', 'foliage'] : [opt('set', 'materials')];
  const perSet = Number(opt('count', testMode ? 3 : 99));
  const clientId = `nb-assets-${Date.now()}`;

  for (const setName of setNames) {
    const set = SETS[setName];
    if (!set) {
      process.stdout.write(`unknown set: ${setName}\n`);
      continue;
    }
    const dir = join(OUT, setName);
    await mkdir(dir, { recursive: true });

    const items = set.items.slice(0, perSet);
    process.stdout.write(`\n== ${setName}: ${items.length} assets @ ${set.size}px ==\n`);

    for (const [slug, subject] of items) {
      const outPath = join(dir, `${slug}.png`);
      try {
        await access(outPath);
        process.stdout.write(`  ${slug} â€” exists, skipping\n`);
        continue;
      } catch {}

      const prompt = `${subject}, ${STYLE}, ${set.suffix}`;
      // Deterministic per slug so re-runs reproduce, but varied across the set.
      const seed = [...slug].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
      const t0 = Date.now();
      try {
        const id = await queue(
          workflow({
            prompt,
            negative: set.negative ?? NEG_BASE,
            // `--reroll` shifts the seed so a rejected asset gets a genuinely
            // different draw rather than the same one again.
            seed: flag('reroll') ? (seed + 0x9e37) >>> 0 : seed,
            size: set.size,
            tile: set.tile === true,
          }),
          clientId,
        );
        const entry = await waitFor(id);
        const ok = await saveOutputs(entry, outPath);
        process.stdout.write(`  ${slug} ${ok ? 'ok' : 'NO IMAGE'} (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
      } catch (err) {
        process.stdout.write(`  ${slug} FAILED: ${err.message}\n`);
      }
    }
  }

  // Keep prompts alongside output so any asset can be reproduced or re-rolled.
  await writeFile(
    join(OUT, 'prompts.json'),
    JSON.stringify({ style: STYLE, negative: NEG_BASE, checkpoint: CKPT, sets: SETS }, null, 2),
    'utf8',
  );
  process.stdout.write(`\nwrote assets/generated/ â€” LOOK at them before generating more.\n`);
}

await main();
