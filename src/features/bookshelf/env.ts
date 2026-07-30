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
 * Degrade probe per the design doc: create a WebGL context and inspect the
 * unmasked renderer string for software rasterizers (SwiftShader/llvmpipe/
 * "software"). No context at all also means degrade.
 */
export function detectSoftwareRenderer(): boolean {
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
