/**
 * prototypes/painted/main.ts — harness entry point.
 *
 * Registers every scene and exposes `window.__harness` so shoot.mjs (or a
 * human clicking the buttons) can render one by name and grab a PNG.
 *
 * A "scene" is just: given a 2D context and its size, paint something. The
 * canvas is resized to the scene's requested dimensions before it runs.
 */

import { SCENES, type Scene } from './scenes';
import { loadAtoms } from './scenes/atoms';

declare global {
  interface Window {
    __harness: {
      list(): string[];
      render(name: string): string;
    };
  }
}

const canvas = document.getElementById('cv') as HTMLCanvasElement;
const bar = document.getElementById('bar') as HTMLDivElement;
const status = document.getElementById('status') as HTMLSpanElement;

function runScene(scene: Scene): string {
  canvas.width = scene.width;
  canvas.height = scene.height;
  canvas.style.width = `${Math.min(scene.width, 1360)}px`;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  ctx.save();
  const t0 = performance.now();
  scene.draw(ctx, scene.width, scene.height);
  const ms = Math.round(performance.now() - t0);
  ctx.restore();
  status.textContent = `${scene.name} — ${scene.width}×${scene.height} — ${ms}ms`;
  return canvas.toDataURL('image/png');
}

for (const scene of SCENES) {
  const b = document.createElement('button');
  b.textContent = scene.name;
  b.onclick = () => runScene(scene);
  bar.insertBefore(b, status);
}

// The generated cut-outs are decoded before the harness declares itself
// ready, so any scene can composite them without an async hop.
void loadAtoms().then(() => {
  window.__harness = {
    list: () => SCENES.map((s) => s.name),
    render: (name: string) => {
      const scene = SCENES.find((s) => s.name === name);
      if (!scene) throw new Error(`no scene "${name}"`);
      return runScene(scene);
    },
  };
  status.textContent = `${SCENES.length} scenes ready — pick one`;
});

// No auto-render. Painting a board goes through the brush engine now and can
// take seconds; rendering on load blocked the `load` event *and* every poll
// the shooter makes, so the harness looked dead when it was merely working.
status.textContent = `${SCENES.length} scenes ready — pick one`;
