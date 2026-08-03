/**
 * shots-now/_depth-check.mjs — what does this GPU report for DEPTH_BITS on a
 * context asked for exactly the way src/flip/gl.ts asks?
 *
 * Scratch helper. gl.ts requests `depth: true` and enables DEPTH_TEST, and the
 * whole reason it does is the reader's artefact: without a depth attachment
 * the turning sheet's lifted tail is painted over by the flat strip beneath
 * it, once per mesh row, below the canvas centre. `depth: true` is a REQUEST,
 * so before making a missing depth buffer fall back to the CSS fold, check
 * that a healthy context does not report 0 here and take the fallback with it.
 */
import { chromium } from 'playwright';

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage();
await p.goto('about:blank');
console.log(
  JSON.stringify(
    await p.evaluate(() => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2', {
        alpha: true,
        premultipliedAlpha: true,
        antialias: true,
        depth: true,
        stencil: false,
        preserveDrawingBuffer: false,
      });
      if (!gl) return { webgl2: false };
      const before = gl.getParameter(gl.DEPTH_BITS);
      canvas.width = 800;
      canvas.height = 600;
      gl.viewport(0, 0, 800, 600);
      return {
        webgl2: true,
        depthBitsAtCreation: before,
        depthBitsAfterResize: gl.getParameter(gl.DEPTH_BITS),
        attribDepth: gl.getContextAttributes()?.depth ?? null,
        renderer: gl.getParameter(gl.RENDERER),
      };
    }),
    null,
    2,
  ),
);
await b.close();
