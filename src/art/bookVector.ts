import type { FlatCtx } from './flat';

export interface BookVectorLayer {
  readonly path: readonly { command: string; values: readonly number[] }[];
  readonly fill: string;
  readonly stroke: string;
  readonly weight: number;
}
export interface BookVector {
  readonly width: number;
  readonly height: number;
  readonly layers: readonly BookVectorLayer[];
}
/** Compile shipped SVG path masters once. Absolute paths only, deliberately
 * no DOM or Path2D so the same source runs in the spine worker and QA recorder. */
export function compileBookVector(svg: string): BookVector {
  const view = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!view) throw new Error('Book artwork needs a zero-origin viewBox');
  const layers = [...svg.matchAll(/<path\s+([^>]+)\/>/g)].map((match): BookVectorLayer => {
    const a = Object.fromEntries([...match[1]!.matchAll(/([\w-]+)="([^"]*)"/g)]
      .map((v) => [v[1], v[2]]));
    if (!a.d || /[a-zAHVST]/.test(a.d)) throw new Error('Book artwork requires absolute M/L/Q/C/Z paths');
    const path = [...a.d.matchAll(/([MLQCZ])([^MLQCZ]*)/g)].map((part) => {
      const values = (part[2]!.match(/-?\d*\.?\d+/g) ?? []).map(Number);
      const arity: Record<string, number> = { M: 2, L: 2, Q: 4, C: 6, Z: 0 };
      if (values.length !== arity[part[1]!]) throw new Error(`Invalid book artwork ${part[1]} segment`);
      return { command: part[1]!, values };
    });
    return { path, fill: a.fill ?? 'none', stroke: a.stroke ?? 'none', weight: Number(a['stroke-width'] ?? 1) };
  });
  if (!layers.length) throw new Error('Book artwork must contain paths');
  return { width: Number(view[1]), height: Number(view[2]), layers };
}
export function paintBookVector(
  ctx: FlatCtx, art: BookVector, x: number, y: number, w: number, h: number,
  colours: Readonly<Record<string, string>> = {},
): void {
  if (w <= 0 || h <= 0) return;
  ctx.save(); ctx.translate(x, y); ctx.scale(w / art.width, h / art.height);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const layer of art.layers) {
    ctx.beginPath();
    for (const { command, values: v } of layer.path) {
      switch (command) {
        case 'M': ctx.moveTo(v[0]!, v[1]!); break;
        case 'L': ctx.lineTo(v[0]!, v[1]!); break;
        case 'Q': ctx.quadraticCurveTo(v[0]!, v[1]!, v[2]!, v[3]!); break;
        case 'C': ctx.bezierCurveTo(v[0]!, v[1]!, v[2]!, v[3]!, v[4]!, v[5]!); break;
        case 'Z': ctx.closePath(); break;
      }
    }
    if (layer.fill !== 'none') { ctx.fillStyle = colours[layer.fill] ?? layer.fill; ctx.fill(); }
    if (layer.stroke !== 'none') {
      ctx.strokeStyle = colours[layer.stroke] ?? layer.stroke; ctx.lineWidth = layer.weight; ctx.stroke();
    }
  }
  ctx.restore();
}
