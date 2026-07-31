/**
 * probe-slice.mjs — isolate the under-plank shadow 9-slice.
 * Dumps the raw baked strip and renders it through the exact NineSliceSprite
 * configuration floorView.ts uses, magnified 8x vertically, over flat grey.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL_BASE = 'http://localhost:1420';
const DIR = 'qa/slice';
mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(`${URL_BASE}/?fx=force&bakeprof=1`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { timeout: 300000, polling: 400 });
await page.evaluate(() => {
  void globalThis.__shelfWorld.ready.then(() => { globalThis.__worldReady = true; });
});
await page.waitForFunction(() => globalThis.__worldReady === true, null, { timeout: 300000, polling: 400 }).catch(() => {});
await page.waitForTimeout(6000);

const out = await page.evaluate(async () => {
  const w = globalThis.__shelfWorld;
  const env = w['envTex'];
  const tex = env?.shadow;
  if (!tex) return { error: 'no shadow texture' };
  const app = w['app'];
  const renderer = app.renderer;

  // Harvest Pixi constructors from live objects (bare specifier import fails).
  const Container = app.stage.constructor;
  let NineSliceSprite = null;
  let Sprite = null;
  const scan = (c) => {
    for (const ch of c.children ?? []) {
      const n = ch.constructor.name;
      if (n.includes('NineSlice')) NineSliceSprite = ch.constructor;
      else if (n.includes('Sprite') && !Sprite) Sprite = ch.constructor;
      scan(ch);
    }
  };
  scan(app.stage);
  if (!NineSliceSprite || !Sprite) return { error: 'ctor harvest failed' };
  const Texture = tex.constructor;

  const info = {
    texW: tex.width,
    texH: tex.height,
    srcW: tex.source.width,
    srcH: tex.source.height,
    resolution: tex.source.resolution,
    pixelW: tex.source.pixelWidth,
    pixelH: tex.source.pixelHeight,
    frame: { x: tex.frame.x, y: tex.frame.y, w: tex.frame.width, h: tex.frame.height },
    dpr: globalThis.devicePixelRatio,
  };

  const grey = () => {
    const s = new Sprite(Texture.WHITE);
    s.tint = 0x8899aa;
    s.width = 1200;
    s.height = 26;
    return s;
  };

  const shot = async (build) => {
    const stage = new Container();
    stage.addChild(grey());
    stage.addChild(build());
    stage.scale.set(1, 8);
    const wrap = new Container();
    wrap.addChild(stage);
    const url = await renderer.extract.base64({ target: wrap });
    wrap.destroy({ children: false });
    return url;
  };

  const raw = await renderer.extract.base64({
    target: (() => {
      const s = new Sprite(tex);
      s.scale.set(4, 8);
      return s;
    })(),
  });

  const sliced = await shot(() => {
    const n = new NineSliceSprite({
      texture: tex,
      leftWidth: 16,
      rightWidth: 16,
      topHeight: 10,
      bottomHeight: 8,
    });
    n.width = 1200;
    n.height = 26;
    return n;
  });

  const stretched = await shot(() => {
    const s = new Sprite(tex);
    s.width = 1200;
    s.height = 26;
    return s;
  });

  return { info, raw, sliced, stretched };
});

if (out.error) {
  console.log('ERROR', out.error);
} else {
  console.log(JSON.stringify(out.info, null, 2));
  const save = (name, dataUrl) =>
    writeFileSync(`${DIR}/${name}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
  save('raw-texture', out.raw);
  save('nineslice-1200x26', out.sliced);
  save('stretched-1200x26', out.stretched);
  console.log('wrote', DIR);
}
await browser.close();
