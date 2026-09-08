/**
 * Remastered front-cover title furniture.
 *
 * Each active persisted title-treatment ID owns one SVG master. The drawings
 * are deliberately literal bookbinding constructions: paper and vellum pieces,
 * morocco labels, crossbands, blind compartments, a lozenge, a lobed cartouche
 * and a quadrilobe. Keeping one master per ID prevents the studio catalogue
 * from collapsing back into a handful of parameterised rectangles.
 *
 * SVG paths use absolute M/L/Q/C/Z commands only. This lets the same compiled
 * geometry paint in a DOM canvas, an OffscreenCanvas worker and recording test
 * contexts without image loading or Path2D.
 */
import type { FlatCtx } from './flat';
import { paintBookRasterArtwork } from './bookRasterArtwork';
import type { TitlePlateStyle } from './spines';

import noneSvg from '../../assets/book-art/titles/none.svg?raw';
import directBlindTitleSvg from '../../assets/book-art/titles/direct-blind-title.svg?raw';
import directGiltTitleSvg from '../../assets/book-art/titles/direct-gilt-title.svg?raw';
import directInkTitleSvg from '../../assets/book-art/titles/direct-ink-title.svg?raw';
import pressSmallCapsSvg from '../../assets/book-art/titles/press-small-caps.svg?raw';
import printerFloretImprintSvg from '../../assets/book-art/titles/printer-floret-imprint.svg?raw';
import laidPaperTicketSvg from '../../assets/book-art/titles/laid-paper-ticket.svg?raw';
import deckledPaperTicketSvg from '../../assets/book-art/titles/deckled-paper-ticket.svg?raw';
import vellumRuleTicketSvg from '../../assets/book-art/titles/vellum-rule-ticket.svg?raw';
import parchmentSlipSvg from '../../assets/book-art/titles/parchment-slip.svg?raw';
import moroccoSingleRuleSvg from '../../assets/book-art/titles/morocco-single-rule.svg?raw';
import moroccoDoubleRuleSvg from '../../assets/book-art/titles/morocco-double-rule.svg?raw';
import moroccoClippedRuleSvg from '../../assets/book-art/titles/morocco-clipped-rule.svg?raw';
import calfBlindLabelSvg from '../../assets/book-art/titles/calf-blind-label.svg?raw';
import twoToneLeatherLabelSvg from '../../assets/book-art/titles/two-tone-leather-label.svg?raw';
import libraryBuckramLabelSvg from '../../assets/book-art/titles/library-buckram-label.svg?raw';
import dyedLeatherCrossbandSvg from '../../assets/book-art/titles/dyed-leather-crossband.svg?raw';
import giltRuledCrossbandSvg from '../../assets/book-art/titles/gilt-ruled-crossband.svg?raw';
import clothInlayCrossbandSvg from '../../assets/book-art/titles/cloth-inlay-crossband.svg?raw';
import splitLeatherCrossbandSvg from '../../assets/book-art/titles/split-leather-crossband.svg?raw';
import oxfordBlindCompartmentSvg from '../../assets/book-art/titles/oxford-blind-compartment.svg?raw';
import cambridgeCalfCompartmentSvg from '../../assets/book-art/titles/cambridge-calf-compartment.svg?raw';
import frenchTripleFilletSvg from '../../assets/book-art/titles/french-triple-fillet.svg?raw';
import ledgerOpenFieldSvg from '../../assets/book-art/titles/ledger-open-field.svg?raw';
import inscriptionShouldersSvg from '../../assets/book-art/titles/inscription-shoulders.svg?raw';
import renaissanceTitleWindowSvg from '../../assets/book-art/titles/renaissance-title-window.svg?raw';
import whisperRulesSvg from '../../assets/book-art/titles/whisper-rules.svg?raw';
import fieldNoteCornerTicketSvg from '../../assets/book-art/titles/field-note-corner-ticket.svg?raw';
import sewnLinenLabelSvg from '../../assets/book-art/titles/sewn-linen-label.svg?raw';
import herbariumCaptionSvg from '../../assets/book-art/titles/herbarium-caption.svg?raw';
import foliateShoulderFieldSvg from '../../assets/book-art/titles/foliate-shoulder-field.svg?raw';
import storybookScallopCartoucheSvg from '../../assets/book-art/titles/storybook-scallop-cartouche.svg?raw';
import ribbonTailCartoucheSvg from '../../assets/book-art/titles/ribbon-tail-cartouche.svg?raw';
import celestialOrbitRoundelSvg from '../../assets/book-art/titles/celestial-orbit-roundel.svg?raw';
import navigatorCompassLabelSvg from '../../assets/book-art/titles/navigator-compass-label.svg?raw';
import artisanNotchedLabelSvg from '../../assets/book-art/titles/artisan-notched-label.svg?raw';
import archivistIndexTabSvg from '../../assets/book-art/titles/archivist-index-tab.svg?raw';
import gothicPointedPanelSvg from '../../assets/book-art/titles/gothic-pointed-panel.svg?raw';
import cameoWreathLabelSvg from '../../assets/book-art/titles/cameo-wreath-label.svg?raw';
import fanfarePedimentSvg from '../../assets/book-art/titles/fanfare-pediment.svg?raw';
import crownQuatrefoilSvg from '../../assets/book-art/titles/crown-quatrefoil.svg?raw';
import imperialFanPanelSvg from '../../assets/book-art/titles/imperial-fan-panel.svg?raw';

export const REMASTERED_TITLE_IDS = [
  'none',
  'direct-blind-title',
  'direct-gilt-title',
  'direct-ink-title',
  'press-small-caps',
  'printer-floret-imprint',
  'laid-paper-ticket',
  'deckled-paper-ticket',
  'vellum-rule-ticket',
  'parchment-slip',
  'morocco-single-rule',
  'morocco-double-rule',
  'morocco-clipped-rule',
  'calf-blind-label',
  'two-tone-leather-label',
  'library-buckram-label',
  'dyed-leather-crossband',
  'gilt-ruled-crossband',
  'cloth-inlay-crossband',
  'split-leather-crossband',
  'oxford-blind-compartment',
  'cambridge-calf-compartment',
  'french-triple-fillet',
  'ledger-open-field',
  'inscription-shoulders',
  'renaissance-title-window',
  'whisper-rules',
  'field-note-corner-ticket',
  'sewn-linen-label',
  'herbarium-caption',
  'foliate-shoulder-field',
  'storybook-scallop-cartouche',
  'ribbon-tail-cartouche',
  'celestial-orbit-roundel',
  'navigator-compass-label',
  'artisan-notched-label',
  'archivist-index-tab',
  'gothic-pointed-panel',
  'cameo-wreath-label',
  'fanfare-pediment',
  'crown-quatrefoil',
  'imperial-fan-panel',
] as const satisfies readonly TitlePlateStyle[];

export type RemasteredTitleStyle = (typeof REMASTERED_TITLE_IDS)[number];

/** Original active catalogue names. These are persisted product vocabulary. */
export const REMASTERED_TITLE_LABELS: Readonly<Record<RemasteredTitleStyle, string>> = {
  none: 'None',
  'direct-blind-title': 'Blind title',
  'direct-gilt-title': 'Gilt title',
  'direct-ink-title': 'Inked title',
  'press-small-caps': 'Dentelle title field',
  'printer-floret-imprint': 'Grolier nested field',
  'laid-paper-ticket': 'Laid paper ticket',
  'deckled-paper-ticket': 'Vertical paper slip',
  'vellum-rule-ticket': 'Vellum shoulder band',
  'parchment-slip': 'Vertical parchment slip',
  'morocco-single-rule': 'Morocco single rule',
  'morocco-double-rule': 'Morocco double rule',
  'morocco-clipped-rule': 'Grolier lozenge',
  'calf-blind-label': 'Oval calf compartment',
  'two-tone-leather-label': 'Inset leather centre',
  'library-buckram-label': 'Library buckram label',
  'dyed-leather-crossband': 'Half-leather title field',
  'gilt-ruled-crossband': 'Gilt ruled crossband',
  'cloth-inlay-crossband': 'Vertical cloth inlay',
  'split-leather-crossband': 'Split-board title field',
  'oxford-blind-compartment': 'Oxford blind compartment',
  'cambridge-calf-compartment': 'Arts & Crafts blind title',
  'french-triple-fillet': 'Perimeter title bridge',
  'ledger-open-field': 'Armorial inscription field',
  'inscription-shoulders': 'Lobed Islamic cartouche',
  'renaissance-title-window': 'Renaissance quadrilobe',
  'whisper-rules': 'Whispered rules',
  'field-note-corner-ticket': 'Field-note corner ticket',
  'sewn-linen-label': 'Sewn linen label',
  'herbarium-caption': 'Herbarium caption',
  'foliate-shoulder-field': 'Foliate shoulder field',
  'storybook-scallop-cartouche': 'Storybook scallop cartouche',
  'ribbon-tail-cartouche': 'Ribbon-tail cartouche',
  'celestial-orbit-roundel': 'Celestial orbit roundel',
  'navigator-compass-label': 'Navigator compass label',
  'artisan-notched-label': 'Artisan notched label',
  'archivist-index-tab': 'Archivist index tab',
  'gothic-pointed-panel': 'Gothic pointed panel',
  'cameo-wreath-label': 'Cameo wreath label',
  'fanfare-pediment': 'Fanfare pediment',
  'crown-quatrefoil': 'Crowned quatrefoil',
  'imperial-fan-panel': 'Imperial fan panel',
};

export type TitleTextOrientation = 'horizontal' | 'vertical-clockwise' | 'vertical-counterclockwise';
export type TitleFurnitureFamily =
  | 'none'
  | 'direct'
  | 'ticket'
  | 'vertical-slip'
  | 'label'
  | 'crossband'
  | 'compartment'
  | 'cartouche';

export interface RelativeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RemasteredTitleLayout {
  family: TitleFurnitureFamily;
  /** Recommended artwork box within the front board, all values 0..1. */
  coverBox: RelativeRect;
  /** Collision-free live-title box within the artwork SVG, all values 0..1. */
  textRect: RelativeRect;
  orientation: TitleTextOrientation;
  maxLines: 1 | 2 | 3;
  /** Handwriting never renders below 13px; narrow vertical labels use print at 10px. */
  minFontPx: 10 | 13;
  /** Optical size multiplier for the title fit pass. */
  typeScale: number;
  /** Suggested focal-tool placement below or beside the title programme. */
  emblemCenter: { x: number; y: number; scale: number };
}

const horizontal = (
  family: TitleFurnitureFamily,
  coverBox: RelativeRect,
  textRect: RelativeRect,
  maxLines: 1 | 2 | 3,
  typeScale: number,
  emblemCenter: RemasteredTitleLayout['emblemCenter'],
): RemasteredTitleLayout => ({
  family, coverBox, textRect, orientation: 'horizontal', maxLines, minFontPx: 13, typeScale, emblemCenter,
});

/**
 * Individually fitted title spaces. The narrow safe boxes on shaped furniture
 * are intentional: text must clear the lozenge shoulders, oval arcs, lobes and
 * quadrilobe waist rather than treating their bounding boxes as rectangles.
 */
export const REMASTERED_TITLE_LAYOUTS: Readonly<Record<RemasteredTitleStyle, RemasteredTitleLayout>> = {
  none: horizontal('none', { x: 0.10, y: 0.18, width: 0.80, height: 0.34 }, { x: 0.08, y: 0.16, width: 0.84, height: 0.68 }, 3, 1.04, { x: 0.5, y: 0.68, scale: 0.09 }),
  'direct-blind-title': horizontal('direct', { x: 0.07, y: 0.12, width: 0.86, height: 0.34 }, { x: 0.15, y: 0.23, width: 0.70, height: 0.54 }, 3, 1, { x: 0.5, y: 0.66, scale: 0.084 }),
  'direct-gilt-title': horizontal('direct', { x: 0.03, y: 0.07, width: 0.94, height: 0.42 }, { x: 0.10, y: 0.25, width: 0.80, height: 0.50 }, 3, 1.04, { x: 0.5, y: 0.67, scale: 0.084 }),
  'direct-ink-title': horizontal('direct', { x: 0.10, y: 0.20, width: 0.80, height: 0.36 }, { x: 0.13, y: 0.26, width: 0.74, height: 0.48 }, 3, 1.05, { x: 0.5, y: 0.74, scale: 0.072 }),
  'press-small-caps': horizontal('compartment', { x: 0.05, y: 0.11, width: 0.90, height: 0.36 }, { x: 0.17, y: 0.22, width: 0.66, height: 0.56 }, 3, 1, { x: 0.5, y: 0.69, scale: 0.076 }),
  'printer-floret-imprint': horizontal('compartment', { x: 0.07, y: 0.11, width: 0.86, height: 0.41 }, { x: 0.14, y: 0.31, width: 0.72, height: 0.48 }, 3, 0.98, { x: 0.5, y: 0.75, scale: 0.066 }),
  'laid-paper-ticket': horizontal('ticket', { x: 0.09, y: 0.12, width: 0.82, height: 0.34 }, { x: 0.11, y: 0.23, width: 0.78, height: 0.54 }, 3, 1, { x: 0.5, y: 0.67, scale: 0.082 }),
  'deckled-paper-ticket': { family: 'vertical-slip', coverBox: { x: 0.68, y: 0.09, width: 0.19, height: 0.64 }, textRect: { x: 0.20, y: 0.16, width: 0.60, height: 0.68 }, orientation: 'vertical-clockwise', maxLines: 2, minFontPx: 10, typeScale: 0.96, emblemCenter: { x: 0.43, y: 0.81, scale: 0.062 } },
  'vellum-rule-ticket': horizontal('crossband', { x: 0.02, y: 0.09, width: 0.96, height: 0.33 }, { x: 0.10, y: 0.22, width: 0.80, height: 0.56 }, 3, 1, { x: 0.5, y: 0.66, scale: 0.08 }),
  'parchment-slip': { family: 'vertical-slip', coverBox: { x: 0.11, y: 0.10, width: 0.18, height: 0.67 }, textRect: { x: 0.18, y: 0.15, width: 0.64, height: 0.70 }, orientation: 'vertical-counterclockwise', maxLines: 2, minFontPx: 10, typeScale: 0.96, emblemCenter: { x: 0.60, y: 0.75, scale: 0.07 } },
  'morocco-single-rule': horizontal('label', { x: 0.08, y: 0.15, width: 0.84, height: 0.35 }, { x: 0.12, y: 0.22, width: 0.76, height: 0.56 }, 3, 1, { x: 0.5, y: 0.77, scale: 0.062 }),
  'morocco-double-rule': horizontal('label', { x: 0.08, y: 0.15, width: 0.84, height: 0.36 }, { x: 0.13, y: 0.22, width: 0.74, height: 0.56 }, 3, 0.98, { x: 0.5, y: 0.73, scale: 0.074 }),
  'morocco-clipped-rule': horizontal('cartouche', { x: 0.09, y: 0.14, width: 0.82, height: 0.39 }, { x: 0.27, y: 0.27, width: 0.46, height: 0.46 }, 3, 0.94, { x: 0.5, y: 0.77, scale: 0.062 }),
  'calf-blind-label': horizontal('compartment', { x: 0.06, y: 0.13, width: 0.88, height: 0.40 }, { x: 0.24, y: 0.27, width: 0.52, height: 0.46 }, 3, 0.96, { x: 0.5, y: 0.77, scale: 0.062 }),
  'two-tone-leather-label': horizontal('label', { x: 0.06, y: 0.12, width: 0.88, height: 0.41 }, { x: 0.23, y: 0.27, width: 0.54, height: 0.46 }, 3, 0.96, { x: 0.5, y: 0.79, scale: 0.058 }),
  'library-buckram-label': horizontal('label', { x: 0.11, y: 0.11, width: 0.78, height: 0.34 }, { x: 0.15, y: 0.22, width: 0.70, height: 0.56 }, 3, 0.98, { x: 0.5, y: 0.65, scale: 0.08 }),
  'dyed-leather-crossband': horizontal('crossband', { x: 0.01, y: 0.12, width: 0.98, height: 0.35 }, { x: 0.14, y: 0.22, width: 0.72, height: 0.56 }, 3, 1.02, { x: 0.5, y: 0.72, scale: 0.072 }),
  'gilt-ruled-crossband': horizontal('crossband', { x: 0.01, y: 0.15, width: 0.98, height: 0.35 }, { x: 0.15, y: 0.23, width: 0.70, height: 0.54 }, 3, 1, { x: 0.5, y: 0.71, scale: 0.076 }),
  'cloth-inlay-crossband': { family: 'vertical-slip', coverBox: { x: 0.69, y: 0.05, width: 0.18, height: 0.76 }, textRect: { x: 0.25, y: 0.13, width: 0.50, height: 0.74 }, orientation: 'vertical-clockwise', maxLines: 2, minFontPx: 10, typeScale: 0.92, emblemCenter: { x: 0.43, y: 0.84, scale: 0.056 } },
  'split-leather-crossband': horizontal('crossband', { x: 0.01, y: 0.14, width: 0.98, height: 0.39 }, { x: 0.13, y: 0.26, width: 0.74, height: 0.48 }, 3, 1.04, { x: 0.5, y: 0.76, scale: 0.066 }),
  'oxford-blind-compartment': horizontal('compartment', { x: 0.06, y: 0.11, width: 0.88, height: 0.42 }, { x: 0.16, y: 0.25, width: 0.68, height: 0.50 }, 3, 1, { x: 0.5, y: 0.71, scale: 0.076 }),
  'cambridge-calf-compartment': horizontal('compartment', { x: 0.05, y: 0.11, width: 0.90, height: 0.42 }, { x: 0.24, y: 0.28, width: 0.52, height: 0.44 }, 3, 0.98, { x: 0.5, y: 0.74, scale: 0.07 }),
  'french-triple-fillet': horizontal('compartment', { x: 0.01, y: 0.11, width: 0.98, height: 0.38 }, { x: 0.24, y: 0.24, width: 0.52, height: 0.52 }, 3, 0.96, { x: 0.5, y: 0.75, scale: 0.066 }),
  'ledger-open-field': horizontal('compartment', { x: 0.08, y: 0.10, width: 0.84, height: 0.45 }, { x: 0.17, y: 0.27, width: 0.66, height: 0.48 }, 3, 1, { x: 0.5, y: 0.79, scale: 0.056 }),
  'inscription-shoulders': horizontal('cartouche', { x: 0.06, y: 0.11, width: 0.88, height: 0.44 }, { x: 0.22, y: 0.29, width: 0.56, height: 0.42 }, 3, 0.96, { x: 0.5, y: 0.80, scale: 0.054 }),
  'renaissance-title-window': horizontal('cartouche', { x: 0.05, y: 0.08, width: 0.90, height: 0.52 }, { x: 0.23, y: 0.32, width: 0.54, height: 0.36 }, 3, 0.98, { x: 0.5, y: 0.82, scale: 0.05 }),
  'whisper-rules': horizontal('direct', { x: 0.08, y: 0.17, width: 0.84, height: 0.31 }, { x: 0.12, y: 0.18, width: 0.76, height: 0.64 }, 3, 1.04, { x: 0.5, y: 0.71, scale: 0.065 }),
  'field-note-corner-ticket': horizontal('ticket', { x: 0.10, y: 0.13, width: 0.72, height: 0.35 }, { x: 0.11, y: 0.22, width: 0.75, height: 0.57 }, 3, 1.02, { x: 0.57, y: 0.72, scale: 0.066 }),
  'sewn-linen-label': horizontal('label', { x: 0.04, y: 0.14, width: 0.92, height: 0.36 }, { x: 0.14, y: 0.22, width: 0.72, height: 0.56 }, 3, 1.01, { x: 0.5, y: 0.72, scale: 0.07 }),
  'herbarium-caption': horizontal('ticket', { x: 0.09, y: 0.13, width: 0.82, height: 0.38 }, { x: 0.17, y: 0.23, width: 0.66, height: 0.55 }, 3, 0.99, { x: 0.5, y: 0.75, scale: 0.068 }),
  'foliate-shoulder-field': horizontal('compartment', { x: 0.02, y: 0.12, width: 0.96, height: 0.41 }, { x: 0.20, y: 0.24, width: 0.60, height: 0.52 }, 3, 1.06, { x: 0.5, y: 0.76, scale: 0.065 }),
  'storybook-scallop-cartouche': horizontal('cartouche', { x: 0.07, y: 0.11, width: 0.86, height: 0.45 }, { x: 0.18, y: 0.28, width: 0.64, height: 0.47 }, 3, 1, { x: 0.5, y: 0.79, scale: 0.058 }),
  'ribbon-tail-cartouche': horizontal('crossband', { x: 0.01, y: 0.12, width: 0.98, height: 0.45 }, { x: 0.20, y: 0.19, width: 0.60, height: 0.62 }, 3, 1.04, { x: 0.5, y: 0.79, scale: 0.059 }),
  'celestial-orbit-roundel': horizontal('cartouche', { x: 0.03, y: 0.09, width: 0.94, height: 0.49 }, { x: 0.18, y: 0.28, width: 0.64, height: 0.44 }, 3, 1.04, { x: 0.5, y: 0.81, scale: 0.053 }),
  'navigator-compass-label': horizontal('label', { x: 0.06, y: 0.12, width: 0.88, height: 0.41 }, { x: 0.18, y: 0.25, width: 0.64, height: 0.50 }, 3, 0.99, { x: 0.5, y: 0.77, scale: 0.063 }),
  'artisan-notched-label': horizontal('label', { x: 0.07, y: 0.14, width: 0.86, height: 0.39 }, { x: 0.16, y: 0.24, width: 0.68, height: 0.52 }, 3, 1, { x: 0.5, y: 0.77, scale: 0.063 }),
  'archivist-index-tab': horizontal('ticket', { x: 0.15, y: 0.13, width: 0.83, height: 0.37 }, { x: 0.10, y: 0.23, width: 0.66, height: 0.54 }, 3, 1.03, { x: 0.44, y: 0.72, scale: 0.068 }),
  'gothic-pointed-panel': horizontal('compartment', { x: 0.03, y: 0.06, width: 0.94, height: 0.57 }, { x: 0.15, y: 0.30, width: 0.70, height: 0.39 }, 3, 1.02, { x: 0.5, y: 0.84, scale: 0.048 }),
  'cameo-wreath-label': horizontal('cartouche', { x: 0.02, y: 0.10, width: 0.96, height: 0.49 }, { x: 0.17, y: 0.27, width: 0.66, height: 0.46 }, 3, 1.05, { x: 0.5, y: 0.82, scale: 0.05 }),
  'fanfare-pediment': horizontal('compartment', { x: 0.02, y: 0.06, width: 0.96, height: 0.56 }, { x: 0.15, y: 0.35, width: 0.70, height: 0.42 }, 3, 1.04, { x: 0.5, y: 0.84, scale: 0.048 }),
  'crown-quatrefoil': horizontal('cartouche', { x: 0.01, y: 0.07, width: 0.98, height: 0.55 }, { x: 0.17, y: 0.31, width: 0.66, height: 0.44 }, 3, 1.06, { x: 0.5, y: 0.85, scale: 0.046 }),
  'imperial-fan-panel': horizontal('compartment', { x: 0.01, y: 0.05, width: 0.98, height: 0.59 }, { x: 0.14, y: 0.36, width: 0.72, height: 0.40 }, 3, 1.04, { x: 0.5, y: 0.85, scale: 0.046 }),
};

/**
 * The physical surface immediately behind live title lettering. Colour
 * resolution must use `ground` for pasted/inlaid pieces and `board` for open
 * tooling. Split-board rails deliberately leave the central title field open.
 */
export const REMASTERED_TITLE_TEXT_SURFACES: Readonly<Record<RemasteredTitleStyle, 'board' | 'ground'>> = {
  none: 'board',
  'direct-blind-title': 'board',
  'direct-gilt-title': 'board',
  'direct-ink-title': 'board',
  'press-small-caps': 'board',
  'printer-floret-imprint': 'board',
  'laid-paper-ticket': 'ground',
  'deckled-paper-ticket': 'ground',
  'vellum-rule-ticket': 'ground',
  'parchment-slip': 'ground',
  'morocco-single-rule': 'ground',
  'morocco-double-rule': 'ground',
  'morocco-clipped-rule': 'ground',
  'calf-blind-label': 'ground',
  'two-tone-leather-label': 'ground',
  'library-buckram-label': 'ground',
  'dyed-leather-crossband': 'ground',
  'gilt-ruled-crossband': 'ground',
  'cloth-inlay-crossband': 'ground',
  'split-leather-crossband': 'board',
  'oxford-blind-compartment': 'board',
  'cambridge-calf-compartment': 'board',
  'french-triple-fillet': 'board',
  'ledger-open-field': 'board',
  'inscription-shoulders': 'board',
  'renaissance-title-window': 'ground',
  'whisper-rules': 'board',
  'field-note-corner-ticket': 'ground',
  'sewn-linen-label': 'ground',
  'herbarium-caption': 'ground',
  'foliate-shoulder-field': 'board',
  'storybook-scallop-cartouche': 'ground',
  'ribbon-tail-cartouche': 'ground',
  'celestial-orbit-roundel': 'ground',
  'navigator-compass-label': 'ground',
  'artisan-notched-label': 'ground',
  'archivist-index-tab': 'ground',
  'gothic-pointed-panel': 'board',
  'cameo-wreath-label': 'ground',
  'fanfare-pediment': 'board',
  'crown-quatrefoil': 'ground',
  'imperial-fan-panel': 'ground',
};

export interface TitleArtColours {
  ground: string;
  ink: string;
  tooling: string;
}

export interface AbsoluteTitlePathSegment {
  command: 'M' | 'L' | 'Q' | 'C' | 'Z';
  values: readonly number[];
}

export interface CompiledTitleLayer {
  path: readonly AbsoluteTitlePathSegment[];
  fill: string;
  stroke: string;
  weight: number;
}

export interface CompiledTitleArtwork {
  width: number;
  height: number;
  layers: readonly CompiledTitleLayer[];
}

/** Raw editable masters, useful to asset audits and specimen harnesses. */
export const REMASTERED_TITLE_SVG_SOURCES: Readonly<Record<RemasteredTitleStyle, string>> = {
  none: noneSvg,
  'direct-blind-title': directBlindTitleSvg,
  'direct-gilt-title': directGiltTitleSvg,
  'direct-ink-title': directInkTitleSvg,
  'press-small-caps': pressSmallCapsSvg,
  'printer-floret-imprint': printerFloretImprintSvg,
  'laid-paper-ticket': laidPaperTicketSvg,
  'deckled-paper-ticket': deckledPaperTicketSvg,
  'vellum-rule-ticket': vellumRuleTicketSvg,
  'parchment-slip': parchmentSlipSvg,
  'morocco-single-rule': moroccoSingleRuleSvg,
  'morocco-double-rule': moroccoDoubleRuleSvg,
  'morocco-clipped-rule': moroccoClippedRuleSvg,
  'calf-blind-label': calfBlindLabelSvg,
  'two-tone-leather-label': twoToneLeatherLabelSvg,
  'library-buckram-label': libraryBuckramLabelSvg,
  'dyed-leather-crossband': dyedLeatherCrossbandSvg,
  'gilt-ruled-crossband': giltRuledCrossbandSvg,
  'cloth-inlay-crossband': clothInlayCrossbandSvg,
  'split-leather-crossband': splitLeatherCrossbandSvg,
  'oxford-blind-compartment': oxfordBlindCompartmentSvg,
  'cambridge-calf-compartment': cambridgeCalfCompartmentSvg,
  'french-triple-fillet': frenchTripleFilletSvg,
  'ledger-open-field': ledgerOpenFieldSvg,
  'inscription-shoulders': inscriptionShouldersSvg,
  'renaissance-title-window': renaissanceTitleWindowSvg,
  'whisper-rules': whisperRulesSvg,
  'field-note-corner-ticket': fieldNoteCornerTicketSvg,
  'sewn-linen-label': sewnLinenLabelSvg,
  'herbarium-caption': herbariumCaptionSvg,
  'foliate-shoulder-field': foliateShoulderFieldSvg,
  'storybook-scallop-cartouche': storybookScallopCartoucheSvg,
  'ribbon-tail-cartouche': ribbonTailCartoucheSvg,
  'celestial-orbit-roundel': celestialOrbitRoundelSvg,
  'navigator-compass-label': navigatorCompassLabelSvg,
  'artisan-notched-label': artisanNotchedLabelSvg,
  'archivist-index-tab': archivistIndexTabSvg,
  'gothic-pointed-panel': gothicPointedPanelSvg,
  'cameo-wreath-label': cameoWreathLabelSvg,
  'fanfare-pediment': fanfarePedimentSvg,
  'crown-quatrefoil': crownQuatrefoilSvg,
  'imperial-fan-panel': imperialFanPanelSvg,
};

const REMASTERED_TITLE_ID_SET: ReadonlySet<string> = new Set(REMASTERED_TITLE_IDS);

export function isRemasteredTitleStyle(style: unknown): style is RemasteredTitleStyle {
  return typeof style === 'string' && REMASTERED_TITLE_ID_SET.has(style);
}

function compileTitleArtwork(svg: string): CompiledTitleArtwork {
  const view = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (view === null) throw new Error('Book title artwork is missing a 0 0 width height viewBox.');
  const layers = [...svg.matchAll(/<path\s+([^>]+)\/>/g)].map((match): CompiledTitleLayer => {
    const attrs = Object.fromEntries(
      [...match[1]!.matchAll(/([\w-]+)="([^"]*)"/g)].map((attr) => [attr[1], attr[2]]),
    );
    const d = attrs.d ?? '';
    // Any lowercase command would make the drawing dependent on prior path
    // state. Reject it here so every exported segment remains absolute.
    if (/[a-z]/.test(d) || /[AHVST]/.test(d)) {
      throw new Error('Book title artwork supports absolute M/L/Q/C/Z paths only.');
    }
    const path = [...d.matchAll(/([MLQCZ])([^MLQCZ]*)/g)].map((part): AbsoluteTitlePathSegment => ({
      command: part[1] as AbsoluteTitlePathSegment['command'],
      values: (part[2]!.match(/-?\d*\.?\d+/g) ?? []).map(Number),
    }));
    return {
      path,
      fill: attrs.fill ?? 'none',
      stroke: attrs.stroke ?? 'none',
      weight: Number(attrs['stroke-width'] ?? 0),
    };
  });
  return { width: Number(view[1]), height: Number(view[2]), layers };
}

/** Compiled absolute geometry, indexed one-to-one with the active IDs. */
export const REMASTERED_TITLE_ART: Readonly<Record<RemasteredTitleStyle, CompiledTitleArtwork>> =
  Object.fromEntries(
    REMASTERED_TITLE_IDS.map((id) => [id, compileTitleArtwork(REMASTERED_TITLE_SVG_SOURCES[id])]),
  ) as unknown as Readonly<Record<RemasteredTitleStyle, CompiledTitleArtwork>>;

/**
 * Paint one remastered title treatment into an already chosen artwork box.
 * Returns false for archived IDs so callers can deliberately use a legacy
 * fallback without silently drawing the wrong active identity.
 */
export function paintRemasteredTitle(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  style: TitlePlateStyle,
  colours: TitleArtColours,
): boolean {
  if (!isRemasteredTitleStyle(style)) return false;
  const direct = REMASTERED_TITLE_LAYOUTS[style].family === 'direct';
  if (style !== 'none' && paintBookRasterArtwork(ctx, `titles/${style}`,
    direct ? colours.tooling : colours,
    direct ? x + w * .28 : x, direct ? y + h * .84 : y,
    direct ? w * .44 : w, direct ? h * .12 : h,
    { fit: direct ? 'contain' : 'stretch' })) return true;
  const art = REMASTERED_TITLE_ART[style];
  if (art.layers.length === 0 || w <= 0 || h <= 0) return true;
  const colour = (value: string): string => {
    if (value === '#f2e6ce') return colours.ground;
    if (value === '#432934') return colours.ink;
    if (value === '#c5a465') return colours.tooling;
    return value;
  };

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(w / art.width, h / art.height);
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
    if (layer.fill !== 'none') {
      ctx.fillStyle = colour(layer.fill);
      ctx.fill();
    }
    if (layer.stroke !== 'none' && layer.weight > 0) {
      ctx.strokeStyle = colour(layer.stroke);
      ctx.lineWidth = layer.weight;
      ctx.stroke();
    }
  }
  ctx.restore();
  return true;
}
