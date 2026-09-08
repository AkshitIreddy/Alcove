/**
 * Regression probe for a thumbnail capture that returns null once.
 *
 * Requires the shared Vite server on :1420. Both lanes serve a minimal HTML
 * document from that origin and mount the real ThumbStrip component, so the
 * probe neither boots Alcove nor reads/writes the library database.
 *
 * The negative lane intercepts Vite's compiled ThumbStrip module and reverses
 * only the two ownership/null-guard lines that caused the bug. It must remain
 * stuck after one request. The positive lane loads production unchanged and
 * must retry once and paint the second ImageBitmap.
 */
import { chromium } from 'playwright';

const BASE_URL = process.env.ALCOVE_URL ?? 'http://127.0.0.1:1420';
const PROBE_URL = new URL('/__thumbnail_retry_probe__', BASE_URL).href;
const CURRENT_LINES = [
  '      if (bitmap === null) throw new Error("page thumbnail capture returned no pixels");',
  '      controllers.delete(pageId);',
].join('\n');
const FORMER_LINES = [
  '      controllers.delete(pageId);',
  '      if (bitmap === null) throw new Error("page thumbnail capture returned no pixels");',
].join('\n');

const browser = await chromium.launch({ headless: true });

async function runComponentLane({ former }) {
  const context = await browser.newContext({ viewport: { width: 900, height: 400 } });
  const page = await context.newPage();
  const pageErrors = [];
  let replacements = 0;
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));

  await page.route(PROBE_URL, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body><div id="host"></div></body></html>',
    }),
  );
  if (former) {
    await page.route('**/src/views/ThumbStrip.tsx?probe=former*', async (route) => {
      const response = await route.fetch();
      const compiled = await response.text();
      replacements = compiled.split(CURRENT_LINES).length - 1;
      if (replacements !== 1) {
        await route.fulfill({
          status: 500,
          contentType: 'text/plain',
          body: `thumbnail negative-control rewrite matched ${replacements} times`,
        });
        return;
      }
      await route.fulfill({ response, body: compiled.replace(CURRENT_LINES, FORMER_LINES) });
    });
  }

  try {
    await page.goto(PROBE_URL, { waitUntil: 'domcontentloaded' });
    const component = await page.evaluate(async ({ modulePath, waitMs }) => {
      class ImmediateIntersectionObserver {
        constructor(callback) {
          this.callback = callback;
        }

        observe(target) {
          queueMicrotask(() => this.callback([{ target, isIntersecting: true }]));
        }

        unobserve() {}
        disconnect() {}
      }
      globalThis.IntersectionObserver = ImmediateIntersectionObserver;

      const [{ default: ThumbStrip }, { render }] = await Promise.all([
        import(modulePath),
        import('/node_modules/solid-js/web/dist/web.js'),
      ]);

      let calls = 0;
      const requestPreview = async () => {
        calls += 1;
        if (calls === 1) return null;

        const source = new OffscreenCanvas(104, 132);
        const context = source.getContext('2d');
        if (context === null) throw new Error('2D canvas unavailable');
        context.fillStyle = '#d97855';
        context.fillRect(0, 0, 104, 132);
        context.fillStyle = '#251c22';
        context.fillRect(18, 22, 68, 8);
        context.fillRect(18, 42, 48, 6);
        return source.transferToImageBitmap();
      };

      const host = document.querySelector('#host');
      if (!(host instanceof HTMLElement)) throw new Error('probe host missing');
      const dispose = render(() => ThumbStrip({
        pages: [{
          id: 'page-1',
          doc: {
            type: 'doc',
            content: [{
              type: 'heading',
              attrs: { level: 1 },
              content: [{ type: 'text', text: 'Retry leaf' }],
            }],
          },
        }],
        currentSpread: 0,
        requestPreview,
        onJump: () => {},
      }), host);

      const deadline = performance.now() + waitMs;
      let result = null;
      while (performance.now() < deadline) {
        const paper = document.querySelector('.nb-thumb-paper');
        result = {
          calls,
          state: paper?.getAttribute('data-thumbnail-state') ?? null,
          hasRaster: paper?.classList.contains('has-raster') ?? false,
          busy: paper?.getAttribute('aria-busy') ?? null,
        };
        if (result.state === 'ready') break;
        await new Promise((resolve) => window.setTimeout(resolve, 25));
      }

      const canvas = document.querySelector('.nb-thumb-paper canvas');
      const pixel = canvas instanceof HTMLCanvasElement
        ? Array.from(canvas.getContext('2d')?.getImageData(52, 66, 1, 1).data ?? [])
        : [];
      dispose();
      return { ...result, pixel };
    }, {
      modulePath: `/src/views/ThumbStrip.tsx?probe=${former ? 'former' : 'current'}`,
      // Long enough for the production 250ms retry. The broken component has
      // no scheduled work, so its full wait is still comfortably sub-second.
      waitMs: former ? 450 : 3_000,
    });
    return { component, pageErrors, replacements };
  } finally {
    await context.close();
  }
}

let report;
try {
  const former = await runComponentLane({ former: true });
  const current = await runComponentLane({ former: false });
  const formerFails =
    former.replacements === 1 &&
    former.component.calls === 1 &&
    former.component.state === 'loading' &&
    former.component.hasRaster === false;
  const componentRecovers =
    current.component.calls === 2 &&
    current.component.state === 'ready' &&
    current.component.hasRaster === true &&
    current.component.busy === 'false' &&
    current.component.pixel[3] === 255;
  report = {
    former,
    current,
    formerFails,
    componentRecovers,
    ok:
      formerFails &&
      componentRecovers &&
      former.pageErrors.length === 0 &&
      current.pageErrors.length === 0,
  };
} catch (error) {
  report = {
    ok: false,
    error: error.stack ?? error.message,
  };
} finally {
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;