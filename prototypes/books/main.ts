/**
 * prototypes/books/main.ts — harness entry for the books-and-case area.
 *
 * Separate from prototypes/painted so two agents can iterate without
 * colliding on one scene registry.
 */

import { SCENES, type Scene } from './scenes';

declare global {
  interface Window {
    __harness: { list(): string[]; render(name: string): string };
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

window.__harness = {
  list: () => SCENES.map((s) => s.name),
  render: (name: string) => {
    const scene = SCENES.find((s) => s.name === name);
    if (!scene) throw new Error(`no scene "${name}"`);
    return runScene(scene);
  },
};

status.textContent = `${SCENES.length} scenes ready`;
