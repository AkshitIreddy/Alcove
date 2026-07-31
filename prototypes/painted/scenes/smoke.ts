/** A one-minute smoke scene: proves bundle → page → screenshot works. */
import type { Scene } from './index';

export const smokeScene: Scene = {
  name: 'smoke',
  width: 400,
  height: 200,
  draw(ctx, w, h) {
    ctx.fillStyle = '#2a2016';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d9a441';
    ctx.fillRect(40, 40, w - 80, h - 80);
    ctx.fillStyle = '#2a2016';
    ctx.font = '24px sans-serif';
    ctx.fillText('harness ok', 60, h / 2 + 8);
  },
};
