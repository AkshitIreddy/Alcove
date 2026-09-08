/**
 * The book studio's complete active binder-tool artwork.
 *
 * Each persisted ornament index owns one authored SVG master. The masters use
 * the physical logic of a brass finishing tool: one compact silhouette, one
 * impression colour, open negative space and only the details that survive a
 * narrow shelf spine. Covers and spines deliberately share these exact paths,
 * so a book keeps its visual identity when it is opened.
 *
 * This module stays below `spines.ts` and `covers.ts`: it imports no catalogue
 * or renderer code and is therefore safe in the off-thread spine painter.
 */
import type { FlatCtx } from './flat';
import { paintBookRasterArtwork } from './bookRasterArtwork';

import svg00 from '../../assets/book-art/emblems/00-diamond.svg?raw';
import svg01 from '../../assets/book-art/emblems/01-broad-laurel-branch.svg?raw';
import svg02 from '../../assets/book-art/emblems/02-foliate-starflower.svg?raw';
import svg05 from '../../assets/book-art/emblems/05-rising-sun.svg?raw';
import svg12 from '../../assets/book-art/emblems/12-fleuron.svg?raw';
import svg13 from '../../assets/book-art/emblems/13-oak-and-acorn-spray.svg?raw';
import svg14 from '../../assets/book-art/emblems/14-thistle-bloom.svg?raw';
import svg20 from '../../assets/book-art/emblems/20-crown.svg?raw';
import svg23 from '../../assets/book-art/emblems/23-stemmed-rosette.svg?raw';
import svg26 from '../../assets/book-art/emblems/26-fleur-de-lis.svg?raw';
import svg28 from '../../assets/book-art/emblems/28-acanthus-volutes.svg?raw';
import svg29 from '../../assets/book-art/emblems/29-wheat-sheaf.svg?raw';
import svg30 from '../../assets/book-art/emblems/30-split-pomegranate.svg?raw';
import svg31 from '../../assets/book-art/emblems/31-open-tulip.svg?raw';
import svg43 from '../../assets/book-art/emblems/43-five-leaf-anthemion.svg?raw';
import svg56 from '../../assets/book-art/emblems/56-split-fern-palmette.svg?raw';
import svg66 from '../../assets/book-art/emblems/66-acanthus-spear.svg?raw';
import svg67 from '../../assets/book-art/emblems/67-carnation-bloom.svg?raw';
import svg68 from '../../assets/book-art/emblems/68-iris-fan.svg?raw';
import svg70 from '../../assets/book-art/emblems/70-poppy-seedhead.svg?raw';
import svg71 from '../../assets/book-art/emblems/71-olive-spray.svg?raw';
import svg74 from '../../assets/book-art/emblems/74-honeysuckle-scroll.svg?raw';
import svg75 from '../../assets/book-art/emblems/75-lotus-palmette.svg?raw';
import svg78 from '../../assets/book-art/emblems/78-rowan-spray.svg?raw';
import svg80 from '../../assets/book-art/emblems/80-primrose-stem.svg?raw';
import svg81 from '../../assets/book-art/emblems/81-dog-rose-branch.svg?raw';
import svg83 from '../../assets/book-art/emblems/83-reed-bundle.svg?raw';
import svg84 from '../../assets/book-art/emblems/84-moresque-knot.svg?raw';
import svg85 from '../../assets/book-art/emblems/85-tudor-rose-standard.svg?raw';
import svg86 from '../../assets/book-art/emblems/86-laced-escutcheon.svg?raw';
import svg87 from '../../assets/book-art/emblems/87-heralds-helm.svg?raw';
import svg88 from '../../assets/book-art/emblems/88-crossed-sceptres.svg?raw';
import svg89 from '../../assets/book-art/emblems/89-royal-orb.svg?raw';
import svg90 from '../../assets/book-art/emblems/90-imperial-eagle.svg?raw';
import svg91 from '../../assets/book-art/emblems/91-baroque-shell.svg?raw';
import svg92 from '../../assets/book-art/emblems/92-rising-phoenix.svg?raw';
import svg93 from '../../assets/book-art/emblems/93-winged-crown.svg?raw';
import svg94 from '../../assets/book-art/emblems/94-scarab-seal.svg?raw';
import svg95 from '../../assets/book-art/emblems/95-amphora-and-vine.svg?raw';
import svg96 from '../../assets/book-art/emblems/96-labyrinth-seal.svg?raw';
import svg97 from '../../assets/book-art/emblems/97-winged-hourglass.svg?raw';
import svg98 from '../../assets/book-art/emblems/98-flight-of-the-dragon.svg?raw';
import svg99 from '../../assets/book-art/emblems/99-fairytale-unicorn.svg?raw';
import svg100 from '../../assets/book-art/emblems/100-moonlit-tower.svg?raw';
import svg101 from '../../assets/book-art/emblems/101-storybook-swan.svg?raw';
import svg102 from '../../assets/book-art/emblems/102-fern-fiddlehead.svg?raw';
import svg103 from '../../assets/book-art/emblems/103-magnolia-branch.svg?raw';
import svg104 from '../../assets/book-art/emblems/104-eucalyptus-spray.svg?raw';
import svg105 from '../../assets/book-art/emblems/105-foxglove-spire.svg?raw';
import svg106 from '../../assets/book-art/emblems/106-steaming-teacup.svg?raw';
import svg107 from '../../assets/book-art/emblems/107-candle-and-holly.svg?raw';
import svg108 from '../../assets/book-art/emblems/108-woollen-mitten.svg?raw';
import svg109 from '../../assets/book-art/emblems/109-cottage-hearth.svg?raw';
import svg110 from '../../assets/book-art/emblems/110-blackberry-cane.svg?raw';
import svg111 from '../../assets/book-art/emblems/111-field-mouse.svg?raw';
import svg112 from '../../assets/book-art/emblems/112-highland-ram.svg?raw';
import svg113 from '../../assets/book-art/emblems/113-trowel-and-sprig.svg?raw';
import svg114 from '../../assets/book-art/emblems/114-single-ginkgo.svg?raw';
import svg115 from '../../assets/book-art/emblems/115-sleeping-moth.svg?raw';
import svg116 from '../../assets/book-art/emblems/116-rain-and-reed.svg?raw';
import svg117 from '../../assets/book-art/emblems/117-folded-crane.svg?raw';

export const REMASTERED_EMBLEM_INDICES = [
  0, 1, 2, 5, 12, 13, 14, 20,
  23, 26, 28, 29, 30, 31, 43, 56,
  66, 67, 68, 70, 71, 74, 75, 78,
  80, 81, 83, 84, 85,
  86, 87, 88, 89, 90, 91, 92, 93,
  94, 95, 96, 97, 98, 99, 100, 101,
  102, 103, 104, 105, 106, 107, 108, 109,
  110, 111, 112, 113, 114, 115, 116, 117,
] as const;

export type RemasteredEmblemIndex = (typeof REMASTERED_EMBLEM_INDICES)[number];

interface PathSegment {
  readonly command: 'M' | 'L' | 'Q' | 'C' | 'Z';
  readonly values: readonly number[];
}

interface ArtworkLayer {
  readonly path: readonly PathSegment[];
  readonly fill: boolean;
  readonly stroke: boolean;
  readonly weight: number;
}

interface CompiledArtwork {
  readonly width: number;
  readonly height: number;
  readonly layers: readonly ArtworkLayer[];
}

export interface BookEmblemMaster {
  /** Stable asset id; never use this as the persisted value. */
  readonly id: string;
  /** Stable persisted ornament index. */
  readonly index: RemasteredEmblemIndex;
  /** Existing reader-facing catalogue name, preserved verbatim. */
  readonly label: string;
  /** Vite-resolved SVG master, retained for artwork QA and export tooling. */
  readonly source: string;
  readonly artwork: CompiledArtwork;
}

const SVG_BY_INDEX: Readonly<Record<RemasteredEmblemIndex, string>> = {
  0: svg00, 1: svg01, 2: svg02, 5: svg05,
  12: svg12, 13: svg13, 14: svg14, 20: svg20,
  23: svg23, 26: svg26, 28: svg28, 29: svg29,
  30: svg30, 31: svg31, 43: svg43, 56: svg56,
  66: svg66, 67: svg67, 68: svg68, 70: svg70,
  71: svg71, 74: svg74, 75: svg75, 78: svg78,
  80: svg80, 81: svg81, 83: svg83, 84: svg84, 85: svg85,
  86: svg86, 87: svg87, 88: svg88, 89: svg89,
  90: svg90, 91: svg91, 92: svg92, 93: svg93,
  94: svg94, 95: svg95, 96: svg96, 97: svg97,
  98: svg98, 99: svg99, 100: svg100, 101: svg101,
  102: svg102, 103: svg103, 104: svg104, 105: svg105,
  106: svg106, 107: svg107, 108: svg108, 109: svg109,
  110: svg110, 111: svg111, 112: svg112, 113: svg113,
  114: svg114, 115: svg115, 116: svg116, 117: svg117,
};

const ID_BY_INDEX: Readonly<Record<RemasteredEmblemIndex, string>> = {
  0: 'diamond',
  1: 'broad-laurel-branch',
  2: 'foliate-starflower',
  5: 'rising-sun',
  12: 'fleuron',
  13: 'oak-and-acorn-spray',
  14: 'thistle-bloom',
  20: 'crown',
  23: 'stemmed-rosette',
  26: 'fleur-de-lis',
  28: 'acanthus-volutes',
  29: 'wheat-sheaf',
  30: 'split-pomegranate',
  31: 'open-tulip',
  43: 'five-leaf-anthemion',
  56: 'split-fern-palmette',
  66: 'acanthus-spear',
  67: 'carnation-bloom',
  68: 'iris-fan',
  70: 'poppy-seedhead',
  71: 'olive-spray',
  74: 'honeysuckle-scroll',
  75: 'lotus-palmette',
  78: 'rowan-spray',
  80: 'primrose-stem',
  81: 'dog-rose-branch',
  83: 'reed-bundle',
  84: 'moresque-knot',
  85: 'tudor-rose-standard',
  86: 'laced-escutcheon',
  87: 'heralds-helm',
  88: 'crossed-sceptres',
  89: 'royal-orb',
  90: 'imperial-eagle',
  91: 'baroque-shell',
  92: 'rising-phoenix',
  93: 'winged-crown',
  94: 'scarab-seal',
  95: 'amphora-and-vine',
  96: 'labyrinth-seal',
  97: 'winged-hourglass',
  98: 'flight-of-the-dragon',
  99: 'fairytale-unicorn',
  100: 'moonlit-tower',
  101: 'storybook-swan',
  102: 'fern-fiddlehead',
  103: 'magnolia-branch',
  104: 'eucalyptus-spray',
  105: 'foxglove-spire',
  106: 'steaming-teacup',
  107: 'candle-and-holly',
  108: 'woollen-mitten',
  109: 'cottage-hearth',
  110: 'blackberry-cane',
  111: 'field-mouse',
  112: 'highland-ram',
  113: 'trowel-and-sprig',
  114: 'single-ginkgo',
  115: 'sleeping-moth',
  116: 'rain-and-reed',
  117: 'folded-crane',
};

const LABEL_BY_INDEX: Readonly<Record<RemasteredEmblemIndex, string>> = {
  0: 'Diamond',
  1: 'Broad laurel branch',
  2: 'Foliate starflower',
  5: 'Rising sun',
  12: 'Fleuron',
  13: 'Oak and acorn spray',
  14: 'Thistle bloom',
  20: 'Crown',
  23: 'Stemmed rosette',
  26: 'Fleur-de-lis',
  28: 'Acanthus volutes',
  29: 'Wheat sheaf',
  30: 'Split pomegranate',
  31: 'Open tulip',
  43: 'Five-leaf anthemion',
  56: 'Split fern palmette',
  66: 'Acanthus spear',
  67: 'Carnation bloom',
  68: 'Iris fan',
  70: 'Poppy seedhead',
  71: 'Olive spray',
  74: 'Honeysuckle scroll',
  75: 'Lotus palmette',
  78: 'Rowan spray',
  80: 'Primrose stem',
  81: 'Dog-rose branch',
  83: 'Reed bundle',
  84: 'Moresque knot',
  85: 'Tudor rose standard',
  86: 'Laced escutcheon',
  87: "Herald's helm",
  88: 'Crossed sceptres',
  89: 'Royal orb',
  90: 'Imperial eagle',
  91: 'Baroque shell',
  92: 'Rising phoenix',
  93: 'Winged crown',
  94: 'Scarab seal',
  95: 'Amphora and vine',
  96: 'Labyrinth seal',
  97: 'Winged hourglass',
  98: 'Flight of the dragon',
  99: 'Fairytale unicorn',
  100: 'Moonlit tower',
  101: 'Storybook swan',
  102: 'Fern fiddlehead',
  103: 'Magnolia branch',
  104: 'Eucalyptus spray',
  105: 'Foxglove spire',
  106: 'Steaming teacup',
  107: 'Candle and holly',
  108: 'Woollen mitten',
  109: 'Cottage hearth',
  110: 'Blackberry cane',
  111: 'Field mouse',
  112: 'Highland ram',
  113: 'Trowel and sprig',
  114: 'Single ginkgo',
  115: 'Sleeping moth',
  116: 'Rain and reed',
  117: 'Folded crane',
};

function compile(svg: string): CompiledArtwork {
  const view = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!view) throw new Error('Book emblem master requires a positive 0 0 viewBox');

  const layers = [...svg.matchAll(/<path\s+([^>]+)\/>/g)].map((match): ArtworkLayer => {
    const attrs = Object.fromEntries(
      [...match[1]!.matchAll(/([\w-]+)="([^"]*)"/g)].map((attr) => [attr[1], attr[2]]),
    );
    if (!attrs.d) throw new Error('Book emblem master path requires d');
    const path = [...attrs.d.matchAll(/([MLQCZ])([^MLQCZ]*)/g)].map((part): PathSegment => ({
      command: part[1] as PathSegment['command'],
      values: (part[2]!.match(/-?\d*\.?\d+/g) ?? []).map(Number),
    }));
    return {
      path,
      fill: attrs.fill !== 'none',
      stroke: attrs.stroke !== 'none',
      weight: Math.max(0, Number(attrs['stroke-width']) || 0),
    };
  });

  return { width: Number(view[1]), height: Number(view[2]), layers };
}

function isRemasteredEmblemIndex(index: number): index is RemasteredEmblemIndex {
  return (REMASTERED_EMBLEM_INDICES as readonly number[]).includes(index);
}

/** Exact-index manifest for studio cards, tests and renderers. */
export const BOOK_EMBLEM_MASTERS: Readonly<Record<number, BookEmblemMaster>> =
  Object.fromEntries(REMASTERED_EMBLEM_INDICES.map((index) => {
    const source = SVG_BY_INDEX[index];
    return [index, {
      id: ID_BY_INDEX[index],
      index,
      label: LABEL_BY_INDEX[index],
      source,
      artwork: compile(source),
    } satisfies BookEmblemMaster];
  })) as Readonly<Record<number, BookEmblemMaster>>;

/**
 * Paint one active master centred in a square of radius `radius`.
 *
 * The one-colour result is faithful to a blind or foil tool impression. A
 * small absolute line floor keeps the design legible on the narrowest active
 * spine without thickening the same master when it is used on a cover.
 * Returns false for none, retired or unknown indices so callers can retain a
 * compatibility fallback while the persisted-value normalizer does its job.
 */
export function paintRemasteredEmblem(
  ctx: FlatCtx,
  index: number,
  cx: number,
  cy: number,
  radius: number,
  colour: string,
): boolean {
  if (!isRemasteredEmblemIndex(index) || !Number.isFinite(radius) || radius <= 0) return false;
  const master = BOOK_EMBLEM_MASTERS[index];
  if (paintBookRasterArtwork(ctx, `emblems/${master.id}`, colour,
    cx - radius, cy - radius, radius * 2, radius * 2)) return true;
  const art = master.artwork;
  const diameter = radius * 2;
  const scale = diameter / Math.max(art.width, art.height);
  const offsetX = cx - (art.width * scale) / 2;
  const offsetY = cy - (art.height * scale) / 2;

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const layer of art.layers) {
    ctx.beginPath();
    for (const segment of layer.path) {
      const v = segment.values;
      switch (segment.command) {
        case 'M': ctx.moveTo(v[0]!, v[1]!); break;
        case 'L': ctx.lineTo(v[0]!, v[1]!); break;
        case 'Q': ctx.quadraticCurveTo(v[0]!, v[1]!, v[2]!, v[3]!); break;
        case 'C': ctx.bezierCurveTo(v[0]!, v[1]!, v[2]!, v[3]!, v[4]!, v[5]!); break;
        case 'Z': ctx.closePath(); break;
      }
    }
    if (layer.fill) {
      ctx.fillStyle = colour;
      ctx.fill();
    }
    if (layer.stroke) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = Math.max(layer.weight, 0.9 / scale);
      ctx.stroke();
    }
  }
  ctx.restore();
  return true;
}
