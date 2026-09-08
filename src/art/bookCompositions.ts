/** Authored editions: composition, palette, lettering and finishing travel together.
 * These are internal recipes, not new Studio catalogue choices. */
export const BOOK_COMPOSITION_IDS = [
  'botanical-study', 'storybook-device', 'quiet-title', 'archive-label',
  'formal-title', 'grand-frame', 'split-title',
] as const;
export type BookCompositionId = typeof BOOK_COMPOSITION_IDS[number];
export const BOOK_SPINE_CHARACTERS = ['formal', 'grand', 'antique', 'storybook', 'botanical', 'cosy', 'rustic', 'quiet'] as const;
export type BookSpineCharacter = typeof BOOK_SPINE_CHARACTERS[number];
export function isBookSpineCharacter(value: unknown): value is BookSpineCharacter {
  return typeof value === 'string' && (BOOK_SPINE_CHARACTERS as readonly string[]).includes(value);
}
export function isBookCompositionId(value: unknown): value is BookCompositionId {
  return typeof value === 'string' && (BOOK_COMPOSITION_IDS as readonly string[]).includes(value);
}

export interface BookEdition {
  readonly id: string;
  readonly composition: BookCompositionId;
  readonly cloth: string;
  readonly joint: string;
  readonly ink: string;
  readonly frame: number;
  readonly title: 'direct-ink-title' | 'direct-gilt-title' | 'laid-paper-ticket' | 'library-buckram-label';
  readonly lettering: number;
  readonly edge: 'plain' | 'gilt' | 'sepia-edge';
}
function edition(id: string, composition: BookCompositionId, cloth: string, joint: string,
  ink: string, frame: number, title: BookEdition['title'], lettering: number,
  edge: BookEdition['edge'] = 'plain'): BookEdition {
  return Object.freeze({id, composition, cloth, joint, ink, frame, title, lettering, edge});
}

/** Each row is a complete visual decision; none is crossed with another row. */
export const BOOK_EDITIONS = {
  formal: [
    edition('oxford-ink', 'formal-title', '#354f59', '#293c43', '#e8d6a5', 2, 'direct-gilt-title', 0),
    edition('red-library', 'formal-title', '#6d343b', '#4d2831', '#ead7b4', 0, 'direct-gilt-title', 3),
    edition('ivory-folio', 'formal-title', '#e5dac0', '#867054', '#4e4237', 2, 'direct-ink-title', 0),
  ],
  grand: [
    edition('midnight-dentelle', 'grand-frame', '#283f50', '#223440', '#d9bd78', 51, 'direct-gilt-title', 0, 'gilt'),
    edition('oxblood-renaissance', 'grand-frame', '#602d38', '#482632', '#e1c385', 48, 'direct-gilt-title', 0, 'gilt'),
    edition('forest-fleurons', 'grand-frame', '#35493c', '#283a31', '#dbc281', 54, 'direct-gilt-title', 3, 'gilt'),
    edition('aubergine-lozenge', 'grand-frame', '#51394e', '#392d3b', '#e2c58a', 52, 'direct-gilt-title', 0, 'gilt'),
    edition('blue-acanthus', 'grand-frame', '#3a4a62', '#2c3649', '#dfc689', 55, 'direct-gilt-title', 0, 'gilt'),
    edition('umber-fleurons', 'grand-frame', '#694a35', '#483326', '#e8ce96', 43, 'direct-gilt-title', 0, 'gilt'),
  ],
  antique: [
    edition('histories-in-calf', 'split-title', '#875c39', '#54352b', '#edddbb', 0, 'direct-gilt-title', 0, 'sepia-edge'),
    edition('antiquarian-ticket', 'archive-label', '#645044', '#46382f', '#e6d7b7', 0, 'laid-paper-ticket', 0, 'sepia-edge'),
    edition('vellum-history', 'formal-title', '#dfd0ad', '#8b6041', '#614833', 0, 'direct-ink-title', 0, 'sepia-edge'),
  ],
  storybook: [
    edition('lantern-blue', 'storybook-device', '#315e72', '#264857', '#edc878', 0, 'direct-gilt-title', 0),
    edition('orchard-red', 'storybook-device', '#9a4c42', '#733930', '#f2deac', 0, 'direct-ink-title', 2),
    edition('moonlit-plum', 'storybook-device', '#58445f', '#3e3348', '#ead8a7', 0, 'direct-gilt-title', 0),
  ],
  botanical: [
    edition('field-notes', 'botanical-study', '#4d5d3c', '#354329', '#e5d6a4', 0, 'direct-ink-title', 0),
    edition('herbarium-paper', 'botanical-study', '#e3ddc3', '#6e7854', '#42513a', 0, 'direct-ink-title', 0),
    edition('pressed-leaves', 'botanical-study', '#587667', '#3c5549', '#efdfb2', 0, 'direct-ink-title', 2),
  ],
  cosy: [
    edition('everyday-journal', 'archive-label', '#a56a53', '#7d4c3e', '#f3e2c3', 0, 'laid-paper-ticket', 0),
    edition('hearth-notes', 'quiet-title', '#8d6371', '#674851', '#f0dfc2', 0, 'direct-ink-title', 2),
    edition('linen-commonplace', 'archive-label', '#8a9176', '#646d53', '#eaddbe', 0, 'library-buckram-label', 0),
  ],
  rustic: [
    edition('workshop-ledger', 'archive-label', '#846944', '#5b472f', '#ebd6ad', 0, 'laid-paper-ticket', 2, 'sepia-edge'),
    edition('travellers-notes', 'split-title', '#a17b47', '#66462c', '#f2e2bf', 0, 'direct-ink-title', 0),
    edition('olive-pocketbook', 'split-title', '#677047', '#41492e', '#eadbb5', 0, 'direct-ink-title', 2),
  ],
  quiet: [
    edition('slate-thoughts', 'quiet-title', '#62716f', '#495856', '#f0e5cd', 0, 'direct-ink-title', 0),
    edition('chalk-notebook', 'quiet-title', '#ded6c5', '#aaa18c', '#514e43', 0, 'direct-ink-title', 2),
    edition('dusk-journal', 'quiet-title', '#766974', '#574d57', '#eee1ce', 0, 'direct-ink-title', 0),
  ],
} as const satisfies Record<string, readonly BookEdition[]>;
