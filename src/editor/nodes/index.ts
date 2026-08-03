/**
 * Custom node registry.
 *
 * Later block types (diagram, linkCard, media embeds…) plug in by calling
 * `registerCustomNode` before the editor mounts — extensions.ts pulls the
 * whole registry, so new blocks need no edits there.
 */
import type { AnyExtension } from '@tiptap/core';
import { Callout } from './callout';
import { ImageRow } from './imageRow';
import { Sticker } from './sticker';
import { Diagram } from './diagram';
import { LinkCard } from '../media';
import {
  Banner,
  Card,
  Envelope,
  IndexCard,
  Ledger,
  MapPin,
  Marginalia,
  PhotoCorner,
  Polaroid,
  Postcard,
  PressedFlower,
  QuoteCard,
  Stamp,
  StickyNote,
  Tag,
  TicketStub,
  WashiBox,
  WaxSeal,
} from './containers';
import { Column, Columns } from './columns';
import { Footnote } from './footnote';
import { PageLink } from './pageLink';
import { MathBlock, MathInline } from './math';
import { Spoiler } from './spoiler';
import { BlockEffects } from '../effects/blockEffects';

export interface CustomNodeRegistration {
  /** Node name as it appears in document JSON (`node.type`). */
  readonly name: string;
  readonly extension: AnyExtension;
}

const registry: CustomNodeRegistration[] = [
  { name: Callout.name, extension: Callout },
  { name: ImageRow.name, extension: ImageRow },
  { name: Sticker.name, extension: Sticker },
  { name: Diagram.name, extension: Diagram },
  { name: LinkCard.name, extension: LinkCard },
  // Script-vocabulary containers (names match vocab.ts canonical names).
  { name: StickyNote.name, extension: StickyNote },
  { name: Polaroid.name, extension: Polaroid },
  { name: WashiBox.name, extension: WashiBox },
  { name: Card.name, extension: Card },
  { name: QuoteCard.name, extension: QuoteCard },
  { name: Banner.name, extension: Banner },
  { name: Spoiler.name, extension: Spoiler },
  { name: Columns.name, extension: Columns },
  { name: Column.name, extension: Column },
  { name: Footnote.name, extension: Footnote },
  // A reference to another page. Inline, so it is not in BLOCK_EFFECT_TYPES —
  // tests/block-effect-coverage.test.ts holds the stated reason.
  { name: PageLink.name, extension: PageLink },
  { name: MathBlock.name, extension: MathBlock },
  { name: MathInline.name, extension: MathInline },
  { name: IndexCard.name, extension: IndexCard },
  { name: Envelope.name, extension: Envelope },
  { name: Stamp.name, extension: Stamp },
  { name: Tag.name, extension: Tag },
  { name: Marginalia.name, extension: Marginalia },
  // The keepsake drawer.
  { name: PressedFlower.name, extension: PressedFlower },
  { name: TicketStub.name, extension: TicketStub },
  { name: Postcard.name, extension: Postcard },
  { name: Ledger.name, extension: Ledger },
  { name: PhotoCorner.name, extension: PhotoCorner },
  // The two fastenings.
  { name: WaxSeal.name, extension: WaxSeal },
  { name: MapPin.name, extension: MapPin },
  // Universal decorative attrs (rotate/tape/washi/shadow/frame/paper/underline).
  { name: BlockEffects.name, extension: BlockEffects },
];

/**
 * Register an additional custom node (idempotent by name — re-registering
 * replaces, so hot-reload does not duplicate extensions).
 */
export function registerCustomNode(registration: CustomNodeRegistration): void {
  const index = registry.findIndex((entry) => entry.name === registration.name);
  if (index >= 0) {
    registry[index] = registration;
  } else {
    registry.push(registration);
  }
}

/** All registered custom node extensions, in registration order. */
export function customNodeExtensions(): AnyExtension[] {
  return registry.map((entry) => entry.extension);
}

export { Callout, CALLOUT_TINTS, type CalloutTint } from './callout';
export { ImageRow } from './imageRow';
export { Sticker } from './sticker';
export {
  STICKER_IDS,
  isStickerId,
  stickerSvg,
  type StickerId,
} from './stickers';
export {
  Banner,
  Card,
  Envelope,
  IndexCard,
  Ledger,
  MapPin,
  Marginalia,
  PhotoCorner,
  Polaroid,
  Postcard,
  PressedFlower,
  QuoteCard,
  Stamp,
  StickyNote,
  Tag,
  TicketStub,
  WashiBox,
  WaxSeal,
  isWashColor,
  seededTilt,
} from './containers';
export {
  Column,
  Columns,
  COLUMN_GAPS,
  MAX_COLUMNS,
  MIN_COLUMNS,
  MIN_COLUMN_SHARE,
  columnIndexAt,
  columnsAround,
  evenColumnWeights,
  recountColumns,
  resizeColumnWeights,
  type ColumnGap,
} from './columns';
export {
  Footnote,
  EMPTY_FOOTNOTE_HINT,
  collectFootnotes,
  type FootnoteRef,
} from './footnote';
export { MathBlock, MathInline } from './math';
export { PageLink, type PageLinkAttributes } from './pageLink';
export {
  KNOWN_MACROS,
  atomHeight,
  mathToHtml,
  parseMath,
  type Atom,
  type MathRenderOptions,
} from './mathTex';
export { Spoiler } from './spoiler';
export {
  BlockEffects,
  BLOCK_EFFECT_TYPES,
  SQUIGGLE_DATA_URI,
} from '../effects/blockEffects';
