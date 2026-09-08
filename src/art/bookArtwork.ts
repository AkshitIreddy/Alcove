/** Initial 16-master design studies, retained only for the comparison harness.
 * Production uses bookTitleArtwork, bookFrameArtwork and bookEmblemArtwork. No DOM, images,
 * async loading or Path2D dependency: the small absolute-path vocabulary also
 * renders in the off-thread spine painter and recording test contexts. */
import type { FlatCtx } from './flat';
import asset0 from '../../assets/book-art/laid-label.svg?raw';
import asset1 from '../../assets/book-art/vellum-label.svg?raw';
import asset2 from '../../assets/book-art/morocco-label.svg?raw';
import asset3 from '../../assets/book-art/cloth-label.svg?raw';
import asset4 from '../../assets/book-art/inscription-label.svg?raw';
import asset5 from '../../assets/book-art/ledger-label.svg?raw';
import asset6 from '../../assets/book-art/library-frame.svg?raw';
import asset7 from '../../assets/book-art/oxford-frame.svg?raw';
import asset8 from '../../assets/book-art/botanical-frame.svg?raw';
import asset9 from '../../assets/book-art/renaissance-frame.svg?raw';
import asset10 from '../../assets/book-art/laurel.svg?raw';
import asset11 from '../../assets/book-art/tulip.svg?raw';
import asset12 from '../../assets/book-art/crown.svg?raw';
import asset13 from '../../assets/book-art/fleuron.svg?raw';
import asset14 from '../../assets/book-art/compass.svg?raw';
import asset15 from '../../assets/book-art/pomegranate.svg?raw';
export const BOOK_ART = {
  'laid-label': compile(asset0),
  'vellum-label': compile(asset1),
  'morocco-label': compile(asset2),
  'cloth-label': compile(asset3),
  'inscription-label': compile(asset4),
  'ledger-label': compile(asset5),
  'library-frame': compile(asset6),
  'oxford-frame': compile(asset7),
  'botanical-frame': compile(asset8),
  'renaissance-frame': compile(asset9),
  'laurel': compile(asset10),
  'tulip': compile(asset11),
  'crown': compile(asset12),
  'fleuron': compile(asset13),
  'compass': compile(asset14),
  'pomegranate': compile(asset15),
} as const;
type Segment = { command: string; values: number[] };
type Layer = { path: Segment[]; fill: string; stroke: string; weight: number };
type Artwork = { width: number; height: number; layers: Layer[] };
function compile(svg: string): Artwork {
  const view = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!;
  const layers = [...svg.matchAll(/<path\s+([^>]+)\/>/g)].map((match): Layer => {
    const attrs = Object.fromEntries([...match[1]!.matchAll(/([\w-]+)="([^"]*)"/g)]
      .map((attr) => [attr[1], attr[2]]));
    const path = [...attrs.d!.matchAll(/([MLQCZ])([^MLQCZ]*)/g)].map((part) => ({
      command: part[1]!, values: (part[2]!.match(/-?\d*\.?\d+/g) ?? []).map(Number),
    }));
    return { path, fill: attrs.fill!, stroke: attrs.stroke!, weight: Number(attrs['stroke-width']) };
  });
  return { width: Number(view[1]), height: Number(view[2]), layers };
}
export function paintBookArt(
  ctx: FlatCtx, name: keyof typeof BOOK_ART,
  x: number, y: number, w: number, h: number,
  colours: { ground: string; ink: string; tooling: string },
): void {
  const art = BOOK_ART[name];
  const colour = (value: string): string => value === '#f2e6ce' ? colours.ground
    : value === '#432934' ? colours.ink : colours.tooling;
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
    if (layer.fill !== 'none') { ctx.fillStyle = colour(layer.fill); ctx.fill(); }
    if (layer.stroke !== 'none') {
      ctx.strokeStyle = colour(layer.stroke); ctx.lineWidth = layer.weight; ctx.stroke();
    }
  }
  ctx.restore();
}
/** Exact identities: a spine and its cover use the same master drawing. */
export const BOOK_EMBLEM_ART: Readonly<Partial<Record<number, keyof typeof BOOK_ART>>> = {
  1: 'laurel', 2: 'compass', 20: 'crown', 26: 'fleuron', 30: 'pomegranate', 31: 'tulip',
};
