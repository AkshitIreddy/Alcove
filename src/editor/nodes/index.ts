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
  Column,
  Columns,
  Polaroid,
  QuoteCard,
  StickyNote,
  WashiBox,
} from './containers';
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
  Column,
  Columns,
  Polaroid,
  QuoteCard,
  StickyNote,
  WashiBox,
  COLUMN_GAPS,
  isWashColor,
  seededTilt,
  type ColumnGap,
} from './containers';
export { Spoiler } from './spoiler';
export {
  BlockEffects,
  BLOCK_EFFECT_TYPES,
  SQUIGGLE_DATA_URI,
} from '../effects/blockEffects';
