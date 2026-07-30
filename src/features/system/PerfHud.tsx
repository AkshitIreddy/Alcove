/**
 * src/features/system/PerfHud.tsx — dev performance overlay (wave-2 item 33).
 *
 * A small parchment chip (top-left, pointer-transparent) showing FPS,
 * frame time, and PIXI texture stats. Gated by `settings.perfHud`; when the
 * setting is off nothing renders and no rAF loop runs.
 *
 * FPS is measured with the component's own requestAnimationFrame counter
 * (rolling one-second window, refreshed ~2×/s). Texture stats are read
 * best-effort from whichever PIXI renderer can be discovered:
 *   - `globalThis.__NB_PIXI_APPS` (opt-in registry, if a view exposes one)
 *   - `globalThis.__PIXI_APP__`   (PIXI devtools convention)
 *   - `globalThis.__shelfWorld`   (the shelf's QA hook, active with ?fx=)
 * When no renderer is discoverable the HUD still shows FPS and marks
 * texture stats as "–".
 */

import { Show, createEffect, createSignal, onCleanup, type JSX } from 'solid-js';
import { settings } from '../../data/settings';

/* ---------------------------- pure, testable ------------------------------- */

/** Structural slice of a PIXI v8 TextureSource the HUD reads. */
export interface TextureSourceLike {
  pixelWidth?: number;
  pixelHeight?: number;
}

/** Estimated GPU bytes for a set of texture sources (RGBA8 assumption). */
export function estimateTextureBytes(
  sources: ReadonlyArray<TextureSourceLike>,
): number {
  let bytes = 0;
  for (const src of sources) {
    const w = typeof src.pixelWidth === 'number' ? src.pixelWidth : 0;
    const h = typeof src.pixelHeight === 'number' ? src.pixelHeight : 0;
    bytes += w * h * 4;
  }
  return bytes;
}

interface RendererLike {
  name?: string;
  texture?: { managedTextures?: TextureSourceLike[] };
}

function asRenderer(candidate: unknown): RendererLike | null {
  if (candidate !== null && typeof candidate === 'object') {
    const app = candidate as { renderer?: unknown };
    const renderer = app.renderer ?? candidate;
    if (renderer !== null && typeof renderer === 'object') {
      return renderer as RendererLike;
    }
  }
  return null;
}

/** Discover a PIXI renderer from the known global hooks, or null. */
export function findPixiRenderer(g: Record<string, unknown>): RendererLike | null {
  const registry = g['__NB_PIXI_APPS'];
  if (Array.isArray(registry) && registry.length > 0) {
    const found = asRenderer(registry[registry.length - 1]);
    if (found !== null) return found;
  }
  const devtools = asRenderer(g['__PIXI_APP__']);
  if (devtools !== null) return devtools;
  const world = g['__shelfWorld'];
  if (world !== null && typeof world === 'object') {
    // `app` is private in TS; at runtime it is a plain property.
    return asRenderer((world as Record<string, unknown>)['app']);
  }
  return null;
}

export interface PixiStats {
  textures: number;
  textureBytes: number;
  rendererName: string | null;
}

/** Read texture stats from a discovered renderer (null when none found). */
export function collectPixiStats(g: Record<string, unknown>): PixiStats | null {
  const renderer = findPixiRenderer(g);
  if (renderer === null) return null;
  const managed = renderer.texture?.managedTextures;
  const sources = Array.isArray(managed) ? managed : [];
  return {
    textures: sources.length,
    textureBytes: estimateTextureBytes(sources),
    rendererName: typeof renderer.name === 'string' ? renderer.name : null,
  };
}

/** "1.5 MB" / "820 KB" style display for the HUD. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/* -------------------------------- component -------------------------------- */

const REFRESH_MS = 500;

export default function PerfHud(): JSX.Element {
  const [fps, setFps] = createSignal(0);
  const [frameMs, setFrameMs] = createSignal(0);
  const [stats, setStats] = createSignal<PixiStats | null>(null);

  createEffect(() => {
    if (!settings.perfHud) return;

    let raf = 0;
    let frames = 0;
    let windowStart = performance.now();
    let stopped = false;

    const frame = (now: number): void => {
      if (stopped) return;
      frames += 1;
      const elapsed = now - windowStart;
      if (elapsed >= REFRESH_MS) {
        setFps(Math.round((frames * 1000) / elapsed));
        setFrameMs(frames > 0 ? Math.round((elapsed / frames) * 10) / 10 : 0);
        setStats(collectPixiStats(globalThis as Record<string, unknown>));
        frames = 0;
        windowStart = now;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    onCleanup(() => {
      stopped = true;
      cancelAnimationFrame(raf);
    });
  });

  return (
    <Show when={settings.perfHud}>
      <div class="nb-perfhud font-ui" aria-hidden="true">
        <span class="nb-perfhud-title">perf</span>
        <span class="nb-perfhud-line">
          {fps()} fps · {frameMs()} ms
        </span>
        <span class="nb-perfhud-line">
          <Show when={stats()} fallback={<>tex – (no renderer)</>}>
            {(s) => (
              <>
                tex {s().textures} · ~{formatBytes(s().textureBytes)}
                {s().rendererName !== null ? ` · ${s().rendererName}` : ''}
              </>
            )}
          </Show>
        </span>
      </div>
    </Show>
  );
}
