/**
 * features/bookshelf/env.ts — environment detection: reduced motion and the
 * software-rasterizer degrade probe.
 */

/** True when the OS asks for reduced motion. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/** Subscribe to reduced-motion changes; returns an unsubscribe. */
export function watchReducedMotion(cb: (reduced: boolean) => void): () => void {
  if (typeof matchMedia !== 'function') return () => undefined;
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  const handler = (e: MediaQueryListEvent): void => cb(e.matches);
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}

/**
 * QA override for the degrade probe, read from the URL query string:
 *   ?fx=force   — treat the renderer as hardware even on SwiftShader. Used by
 *                 the headless Playwright screenshot harness (scratchpad qa/),
 *                 which always runs on software WebGL and would otherwise
 *                 never show hi-res titled spines.
 *   ?fx=degrade — force the degrade path on real GPUs (for testing it).
 * Keep this: future visual QA depends on ?fx=force.
 */
export function fxOverride(): 'force' | 'degrade' | null {
  try {
    const v = new URLSearchParams(window.location.search).get('fx');
    return v === 'force' || v === 'degrade' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Degrade probe per the design doc: create a WebGL context and inspect the
 * unmasked renderer string for software rasterizers (SwiftShader/llvmpipe/
 * "software"). No context at all also means degrade. The ?fx= query param
 * (see fxOverride) short-circuits the probe for QA.
 */
export function detectSoftwareRenderer(): boolean {
  const override = fxOverride();
  if (override === 'force') return false;
  if (override === 'degrade') return true;
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ??
      (canvas.getContext('webgl') as WebGLRenderingContext | null);
    if (gl === null) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(
      ext !== null
        ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
    );
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|software/i.test(renderer);
  } catch {
    return true;
  }
}
