/**
 * Remastered cover-frame artwork.
 *
 * Every reader-facing frame has an individual SVG master. The masters use a
 * small absolute-path vocabulary so the same painter works on the main thread,
 * in an OffscreenCanvas worker, and in recording contexts used by tests.
 */
import type { FlatCtx } from './flat';
import { paintBookRasterArtwork } from './bookRasterArtwork';

import plainRuleSvg from '../../assets/book-art/frames/plain-rule.svg?raw';
import doubleRuleSvg from '../../assets/book-art/frames/double-rule.svg?raw';
import bracketedFilletSvg from '../../assets/book-art/frames/bracketed-fillet.svg?raw';
import openAcanthusReturnSvg from '../../assets/book-art/frames/open-acanthus-return.svg?raw';
import cornerLozengesSvg from '../../assets/book-art/frames/corner-lozenges.svg?raw';
import doubleBracketSvg from '../../assets/book-art/frames/double-bracket.svg?raw';
import shoulderedOgeePanelSvg from '../../assets/book-art/frames/shouldered-ogee-panel.svg?raw';
import broadFilletSvg from '../../assets/book-art/frames/broad-fillet.svg?raw';
import fleuronFilletSvg from '../../assets/book-art/frames/fleuron-fillet.svg?raw';
import bandedFilletSvg from '../../assets/book-art/frames/banded-fillet.svg?raw';
import bandedFleuronsSvg from '../../assets/book-art/frames/banded-fleurons.svg?raw';
import renaissancePanelSvg from '../../assets/book-art/frames/renaissance-panel.svg?raw';
import mitredCalfPanelSvg from '../../assets/book-art/frames/mitred-calf-panel.svg?raw';
import openDentelleSvg from '../../assets/book-art/frames/open-dentelle.svg?raw';
import grolierLozengePanelSvg from '../../assets/book-art/frames/grolier-lozenge-panel.svg?raw';
import libraryTripleMitreSvg from '../../assets/book-art/frames/library-triple-mitre.svg?raw';
import renaissanceOpenPanelSvg from '../../assets/book-art/frames/renaissance-open-panel.svg?raw';
import blindAcanthusPanelSvg from '../../assets/book-art/frames/blind-acanthus-panel.svg?raw';
import cambridgeMitreSvg from '../../assets/book-art/frames/cambridge-mitre.svg?raw';
import chancellorBracketsSvg from '../../assets/book-art/frames/chancellor-brackets.svg?raw';
import laureateKeylineSvg from '../../assets/book-art/frames/laureate-keyline.svg?raw';
import imperialFanCornersSvg from '../../assets/book-art/frames/imperial-fan-corners.svg?raw';
import fanfareStrapworkSvg from '../../assets/book-art/frames/fanfare-strapwork.svg?raw';
import royalCanopySvg from '../../assets/book-art/frames/royal-canopy.svg?raw';
import antiquarianBlindRollSvg from '../../assets/book-art/frames/antiquarian-blind-roll.svg?raw';
import aldineCornerpieceSvg from '../../assets/book-art/frames/aldine-cornerpiece.svg?raw';
import foundryOgeeSvg from '../../assets/book-art/frames/foundry-ogee.svg?raw';
import woodlandBoughSvg from '../../assets/book-art/frames/woodland-bough.svg?raw';
import starlitScallopSvg from '../../assets/book-art/frames/starlit-scallop.svg?raw';
import storygateArchSvg from '../../assets/book-art/frames/storygate-arch.svg?raw';
import herbariumVineSvg from '../../assets/book-art/frames/herbarium-vine.svg?raw';
import fernFrondSvg from '../../assets/book-art/frames/fern-frond.svg?raw';
import wildflowerTrellisSvg from '../../assets/book-art/frames/wildflower-trellis.svg?raw';
import hearthsideRibbonSvg from '../../assets/book-art/frames/hearthside-ribbon.svg?raw';
import cottageScallopSvg from '../../assets/book-art/frames/cottage-scallop.svg?raw';
import teaRoseBorderSvg from '../../assets/book-art/frames/tea-rose-border.svg?raw';
import hewnStrapSvg from '../../assets/book-art/frames/hewn-strap.svg?raw';
import saddleCornerSvg from '../../assets/book-art/frames/saddle-corner.svg?raw';
import forgeCornerSvg from '../../assets/book-art/frames/forge-corner.svg?raw';
import whisperedRuleSvg from '../../assets/book-art/frames/whispered-rule.svg?raw';
import librarianHairlinesSvg from '../../assets/book-art/frames/librarian-hairlines.svg?raw';
import softMitreSvg from '../../assets/book-art/frames/soft-mitre.svg?raw';

export interface RemasteredFrameColours {
  /** The flat colour used for broad leather or cloth fillets. */
  readonly ground: string;
  /** The darker blind-tooling colour. */
  readonly ink: string;
  /** The foil or pale tooling colour. */
  readonly tooling: string;
}

export interface RemasteredFrameMaster {
  readonly index: number;
  readonly id: string;
  readonly label: string;
  /** Normalized central area guaranteed clear of the frame's structural tools. */
  readonly titleAperture: RemasteredFrameAperture;
  readonly svg: string;
}

export interface RemasteredFrameAperture {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Stable saved-data indices and reader-facing identities from covers.ts. */
export const REMASTERED_FRAME_MASTERS: readonly RemasteredFrameMaster[] = [
  { index: 0, id: 'plain-rule', label: 'Plain Rule', titleAperture: { x: .18, y: .2, width: .64, height: .6 }, svg: plainRuleSvg },
  { index: 2, id: 'double-rule', label: 'Double Rule', titleAperture: { x: .19, y: .21, width: .62, height: .58 }, svg: doubleRuleSvg },
  { index: 5, id: 'bracketed', label: 'Bracketed Fillet', titleAperture: { x: .21, y: .2, width: .58, height: .6 }, svg: bracketedFilletSvg },
  { index: 6, id: 'acanthus-return', label: 'Open Acanthus Return', titleAperture: { x: .22, y: .22, width: .56, height: .56 }, svg: openAcanthusReturnSvg },
  { index: 8, id: 'lozenge-corners', label: 'Corner Lozenges', titleAperture: { x: .2, y: .21, width: .6, height: .58 }, svg: cornerLozengesSvg },
  { index: 17, id: 'double-brackets', label: 'Double Bracket', titleAperture: { x: .23, y: .2, width: .54, height: .6 }, svg: doubleBracketSvg },
  { index: 20, id: 'restrained-ogee', label: 'Shouldered Ogee Panel', titleAperture: { x: .23, y: .24, width: .54, height: .52 }, svg: shoulderedOgeePanelSvg },
  { index: 24, id: 'fillet', label: 'Broad Fillet', titleAperture: { x: .2, y: .21, width: .6, height: .58 }, svg: broadFilletSvg },
  { index: 26, id: 'fillet-fleuron', label: 'Fleuron Fillet', titleAperture: { x: .15, y: .22, width: .70, height: .56 }, svg: fleuronFilletSvg },
  { index: 36, id: 'banded', label: 'Banded Fillet', titleAperture: { x: .21, y: .22, width: .58, height: .56 }, svg: bandedFilletSvg },
  { index: 43, id: 'banded-fleuron', label: 'Banded Fleurons', titleAperture: { x: .23, y: .23, width: .54, height: .54 }, svg: bandedFleuronsSvg },
  { index: 48, id: 'renaissance-panel', label: 'Renaissance Panel', titleAperture: { x: .25, y: .26, width: .5, height: .48 }, svg: renaissancePanelSvg },
  { index: 50, id: 'mitred-calf-panel', label: 'Mitred Calf Panel', titleAperture: { x: .23, y: .22, width: .54, height: .56 }, svg: mitredCalfPanelSvg },
  { index: 51, id: 'open-dentelle', label: 'Open Dentelle', titleAperture: { x: .25, y: .24, width: .5, height: .52 }, svg: openDentelleSvg },
  { index: 52, id: 'grolier-lozenge-panel', label: 'Grolier Lozenge Panel', titleAperture: { x: .32, y: .27, width: .36, height: .46 }, svg: grolierLozengePanelSvg },
  { index: 53, id: 'library-triple-mitre', label: 'Library Triple Mitre', titleAperture: { x: .24, y: .23, width: .52, height: .54 }, svg: libraryTripleMitreSvg },
  { index: 54, id: 'renaissance-open-panel', label: 'Renaissance Open Panel', titleAperture: { x: .26, y: .27, width: .48, height: .46 }, svg: renaissanceOpenPanelSvg },
  { index: 55, id: 'blind-acanthus-panel', label: 'Blind Acanthus Panel', titleAperture: { x: .25, y: .24, width: .5, height: .52 }, svg: blindAcanthusPanelSvg },
  /* Formal — measured mitres, brackets and classical corner leaves. */
  { index: 56, id: 'cambridge-mitre', label: 'Cambridge Mitre', titleAperture: { x: .12, y: .18, width: .76, height: .64 }, svg: cambridgeMitreSvg },
  { index: 57, id: 'chancellor-brackets', label: 'Chancellor Brackets', titleAperture: { x: .14, y: .2, width: .72, height: .6 }, svg: chancellorBracketsSvg },
  { index: 58, id: 'laureate-keyline', label: 'Laureate Keyline', titleAperture: { x: .12, y: .17, width: .76, height: .66 }, svg: laureateKeylineSvg },
  /* Grand — perimeter architecture whose detail remains at the corners. */
  { index: 59, id: 'imperial-fan-corners', label: 'Imperial Fan Corners', titleAperture: { x: .14, y: .19, width: .72, height: .62 }, svg: imperialFanCornersSvg },
  { index: 60, id: 'fanfare-strapwork', label: 'Fanfare Strapwork', titleAperture: { x: .13, y: .2, width: .74, height: .6 }, svg: fanfareStrapworkSvg },
  { index: 61, id: 'royal-canopy', label: 'Royal Canopy', titleAperture: { x: .14, y: .2, width: .72, height: .6 }, svg: royalCanopySvg },
  /* Antique — blind rolls and historical cornerpiece construction. */
  { index: 62, id: 'antiquarian-blind-roll', label: 'Antiquarian Blind Roll', titleAperture: { x: .12, y: .16, width: .76, height: .68 }, svg: antiquarianBlindRollSvg },
  { index: 63, id: 'aldine-cornerpiece', label: 'Aldine Cornerpiece', titleAperture: { x: .14, y: .19, width: .72, height: .62 }, svg: aldineCornerpieceSvg },
  { index: 64, id: 'foundry-ogee', label: 'Foundry Ogee', titleAperture: { x: .14, y: .2, width: .72, height: .6 }, svg: foundryOgeeSvg },
  /* Storybook — pictorial silhouettes built into a continuous case. */
  { index: 65, id: 'woodland-bough', label: 'Woodland Bough', titleAperture: { x: .13, y: .18, width: .74, height: .64 }, svg: woodlandBoughSvg },
  { index: 66, id: 'starlit-scallop', label: 'Starlit Scallop', titleAperture: { x: .14, y: .19, width: .72, height: .62 }, svg: starlitScallopSvg },
  { index: 67, id: 'storygate-arch', label: 'Storygate Arch', titleAperture: { x: .14, y: .22, width: .72, height: .58 }, svg: storygateArchSvg },
  /* Botanical — four large plant gestures, never a repeated surface pattern. */
  { index: 68, id: 'herbarium-vine', label: 'Herbarium Vine', titleAperture: { x: .13, y: .19, width: .74, height: .62 }, svg: herbariumVineSvg },
  { index: 69, id: 'fern-frond', label: 'Fern Frond', titleAperture: { x: .14, y: .19, width: .72, height: .62 }, svg: fernFrondSvg },
  { index: 70, id: 'wildflower-trellis', label: 'Wildflower Trellis', titleAperture: { x: .14, y: .2, width: .72, height: .6 }, svg: wildflowerTrellisSvg },
  /* Cosy — soft cloth ribbons, cottage scallops and large rose corners. */
  { index: 71, id: 'hearthside-ribbon', label: 'Hearthside Ribbon', titleAperture: { x: .13, y: .18, width: .74, height: .64 }, svg: hearthsideRibbonSvg },
  { index: 72, id: 'cottage-scallop', label: 'Cottage Scallop', titleAperture: { x: .13, y: .18, width: .74, height: .64 }, svg: cottageScallopSvg },
  { index: 73, id: 'tea-rose-border', label: 'Tea Rose Border', titleAperture: { x: .14, y: .2, width: .72, height: .6 }, svg: teaRoseBorderSvg },
  /* Rustic — visibly joined straps and weighty angular corner furniture. */
  { index: 74, id: 'hewn-strap', label: 'Hewn Strap', titleAperture: { x: .15, y: .2, width: .7, height: .6 }, svg: hewnStrapSvg },
  { index: 75, id: 'saddle-corner', label: 'Saddle Corner', titleAperture: { x: .13, y: .18, width: .74, height: .64 }, svg: saddleCornerSvg },
  { index: 76, id: 'forge-corner', label: 'Forge Corner', titleAperture: { x: .15, y: .2, width: .7, height: .6 }, svg: forgeCornerSvg },
  /* Quiet — generous open fields, a single gesture and fine mitred rules. */
  { index: 77, id: 'whispered-rule', label: 'Whispered Rule', titleAperture: { x: .1, y: .13, width: .8, height: .74 }, svg: whisperedRuleSvg },
  { index: 78, id: 'librarian-hairlines', label: 'Librarian Hairlines', titleAperture: { x: .12, y: .15, width: .76, height: .7 }, svg: librarianHairlinesSvg },
  { index: 79, id: 'soft-mitre', label: 'Soft Mitre', titleAperture: { x: .11, y: .14, width: .78, height: .72 }, svg: softMitreSvg },
] as const;

const MASTER_BY_INDEX = new Map<number, RemasteredFrameMaster>(
  REMASTERED_FRAME_MASTERS.map((master) => [master.index, master]),
);

/** Read the authored safe title zone for a live frame index. */
export function remasteredFrameTitleAperture(index: number): RemasteredFrameAperture | undefined {
  return MASTER_BY_INDEX.get(index)?.titleAperture;
}

type Segment = { readonly command: string; readonly values: readonly number[] };
type Layer = {
  readonly path: readonly Segment[];
  readonly fill: string;
  readonly stroke: string;
  readonly weight: number;
  readonly opacity: number;
  readonly fine: boolean;
};
type Artwork = { readonly width: number; readonly height: number; readonly layers: readonly Layer[] };

function compile(svg: string): Artwork {
  const view = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!view) throw new Error('Book frame master needs a 0 0 width height viewBox');

  const layers = [...svg.matchAll(/<path\s+([^>]+)\/>/g)].map((match): Layer => {
    const attrs = Object.fromEntries(
      [...match[1]!.matchAll(/([\w-]+)="([^"]*)"/g)].map((attr) => [attr[1], attr[2]]),
    );
    const path = [...(attrs.d ?? '').matchAll(/([MLQCZ])([^MLQCZ]*)/g)].map((part) => ({
      command: part[1]!,
      values: (part[2]!.match(/-?\d*\.?\d+/g) ?? []).map(Number),
    }));
    return {
      path,
      fill: attrs.fill ?? 'none',
      stroke: attrs.stroke ?? 'none',
      weight: Number(attrs['stroke-width'] ?? 1),
      opacity: Number(attrs.opacity ?? 1),
      fine: attrs['data-detail'] === 'fine',
    };
  });

  return { width: Number(view[1]), height: Number(view[2]), layers };
}

const ART_BY_INDEX = new Map<number, Artwork>(
  REMASTERED_FRAME_MASTERS.map((master) => [master.index, compile(master.svg)]),
);

/**
 * Paint one active cover-frame master into the caller's rectangle.
 *
 * `detail=false` omits only the hairline cuts; the frame keeps its silhouette
 * and identity in small studio cards. Unknown historical indices return false
 * so the legacy painter can remain a deliberate fallback during migration.
 */
export function paintRemasteredFrame(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  index: number,
  colours: RemasteredFrameColours,
  detail = true,
): boolean {
  const master = MASTER_BY_INDEX.get(index);
  // Rule-only identities stay precise at every scale. Their authored paths
  // also preserve the intentionally unornamented Quiet programme.
  const ruleOnly = index === 2 || index === 24 || index === 53 || index >= 56;
  if (!ruleOnly && master && paintBookRasterArtwork(ctx, `frames/${master.id}`, colours.tooling,
    x, y, w, h, { fit: 'stretch' })) return true;
  const art = ART_BY_INDEX.get(index);
  if (!art || w <= 0 || h <= 0) return false;

  const resolveColour = (value: string): string => {
    if (value === '#f2e6ce') return colours.ground;
    if (value === '#432934') return colours.ink;
    return colours.tooling;
  };

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(w / art.width, h / art.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const layer of art.layers) {
    if (!detail && layer.fine) continue;
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

    ctx.globalAlpha = layer.opacity;
    if (layer.fill !== 'none') {
      ctx.fillStyle = resolveColour(layer.fill);
      ctx.fill();
    }
    if (layer.stroke !== 'none') {
      ctx.strokeStyle = resolveColour(layer.stroke);
      ctx.lineWidth = layer.weight;
      ctx.stroke();
    }
  }

  ctx.restore();
  return true;
}
