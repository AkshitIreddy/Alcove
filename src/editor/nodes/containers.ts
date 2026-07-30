/**
 * Script-vocabulary container nodes — the real editor blocks behind the
 * Notebook Script containers (see src/script/vocab.ts CONTAINER_NAMES).
 *
 * Node names match the script's canonical container names VERBATIM
 * ('sticky-note', 'polaroid', …) so the script bridge's hasNode() lookup
 * wires them automatically — no per-name mapping table needed for new nodes.
 *
 * All of these render through pure CSS (styles/effects.css) keyed off
 * data-attributes; none needs a Solid node view (spoiler, which is
 * interactive, lives in spoiler.tsx). The universal block effects (rotate,
 * tape, …) attach via the BlockEffects global-attribute extension.
 */
import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { WASH_COLORS, type WashColor } from '../../script/vocab';

export function isWashColor(value: unknown): value is WashColor {
  return (
    typeof value === 'string' && (WASH_COLORS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Seeded tilt (deterministic, no dependency on src/art — matches stickers.ts)
// ---------------------------------------------------------------------------

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic tilt in [-maxDeg, maxDeg], rounded to 0.1°. */
export function seededTilt(seedText: string, maxDeg: number): number {
  const unit = (fnv1a(seedText) % 1000) / 999;
  return Math.round((unit * 2 - 1) * maxDeg * 10) / 10;
}

/** True when the BlockEffects `rotate` attr carries an explicit tilt. */
function hasExplicitRotate(node: ProseMirrorNode): boolean {
  const value: unknown = node.attrs.rotate;
  return typeof value === 'number' && Number.isFinite(value) && value !== 0;
}

function washColorAttribute(fallback: WashColor): {
  default: WashColor;
  parseHTML: (element: HTMLElement) => WashColor;
  renderHTML: (attributes: Record<string, unknown>) => Record<string, unknown>;
} {
  return {
    default: fallback,
    parseHTML: (element) => {
      const raw = element.getAttribute('data-color');
      return isWashColor(raw) ? raw : fallback;
    },
    renderHTML: (attributes) => ({ 'data-color': String(attributes.color) }),
  };
}

// ---------------------------------------------------------------------------
// sticky-note — a post-it with a folded corner and a slight seeded tilt
// ---------------------------------------------------------------------------

export const StickyNote = Node.create({
  name: 'sticky-note',

  group: 'block',

  content: 'block+',

  defining: true,

  draggable: true,

  addAttributes() {
    return { color: washColorAttribute('lemon') };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="sticky-note"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs: Record<string, unknown> = { 'data-type': 'sticky-note' };
    if (!hasExplicitRotate(node)) {
      const seed = `${String(node.attrs.id ?? '')}|${String(node.attrs.color)}|${node.childCount}`;
      attrs.style = `--nb-rotate: ${seededTilt(seed, 2.2)}deg`;
    }
    return ['div', mergeAttributes(HTMLAttributes, attrs), 0];
  },
});

// ---------------------------------------------------------------------------
// polaroid — white-framed photo with a Kalam caption, seeded tilt
// ---------------------------------------------------------------------------

export const Polaroid = Node.create({
  name: 'polaroid',

  group: 'block',

  content: 'image? paragraph+',

  defining: true,

  isolating: true,

  draggable: true,

  parseHTML() {
    return [{ tag: 'div[data-type="polaroid"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs: Record<string, unknown> = { 'data-type': 'polaroid' };
    if (!hasExplicitRotate(node)) {
      let src = '';
      node.forEach((child) => {
        if (src === '' && child.type.name === 'image') {
          src = String(child.attrs.src ?? '');
        }
      });
      const seed = `${String(node.attrs.id ?? '')}|${src}`;
      attrs.style = `--nb-rotate: ${seededTilt(seed, 2.6)}deg`;
    }
    return ['div', mergeAttributes(HTMLAttributes, attrs), 0];
  },
});

// ---------------------------------------------------------------------------
// washi-box — a box held to the page by two washi-tape strips
// ---------------------------------------------------------------------------

export const WashiBox = Node.create({
  name: 'washi-box',

  group: 'block',

  content: 'block+',

  defining: true,

  draggable: true,

  addAttributes() {
    return { color: washColorAttribute('sky') };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="washi-box"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'washi-box' }),
      0,
    ];
  },
});

// ---------------------------------------------------------------------------
// card — clean aged-paper card with an optional pencil title
// ---------------------------------------------------------------------------

export const Card = Node.create({
  name: 'card',

  group: 'block',

  content: 'block+',

  defining: true,

  draggable: true,

  addAttributes() {
    return {
      title: {
        default: '',
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-title') ?? '',
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes.title === 'string' && attributes.title !== ''
            ? { 'data-title': attributes.title }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="card"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'card' }), 0];
  },
});

// ---------------------------------------------------------------------------
// quote-card — decorated pull-quote (Caveat, wash tint, giant quotes)
// ---------------------------------------------------------------------------

export const QuoteCard = Node.create({
  name: 'quote-card',

  group: 'block',

  content: 'block+',

  defining: true,

  draggable: true,

  addAttributes() {
    return { color: washColorAttribute('blush') };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="quote-card"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'quote-card' }),
      0,
    ];
  },
});

// ---------------------------------------------------------------------------
// banner — full-width ribbon with chevron ends (clip-path)
// ---------------------------------------------------------------------------

export const Banner = Node.create({
  name: 'banner',

  group: 'block',

  content: 'block+',

  defining: true,

  draggable: true,

  addAttributes() {
    return { color: washColorAttribute('amber') };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="banner"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'banner' }),
      0,
    ];
  },
});

// ---------------------------------------------------------------------------
// columns / col — 2-4 side-by-side columns, equal or weighted widths
// ---------------------------------------------------------------------------

export const COLUMN_GAPS = ['sm', 'md', 'lg'] as const;
export type ColumnGap = (typeof COLUMN_GAPS)[number];

export const Columns = Node.create({
  name: 'columns',

  group: 'block',

  content: 'col{2,4}',

  defining: true,

  isolating: true,

  draggable: true,

  addAttributes() {
    return {
      gap: {
        default: null as ColumnGap | null,
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute('data-gap');
          return raw !== null && (COLUMN_GAPS as readonly string[]).includes(raw)
            ? (raw as ColumnGap)
            : null;
        },
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes.gap === 'string' &&
          (COLUMN_GAPS as readonly string[]).includes(attributes.gap)
            ? { 'data-gap': attributes.gap }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="columns"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'columns' }),
      0,
    ];
  },
});

export const Column = Node.create({
  name: 'col',

  // No group on purpose: a col may only live inside a columns node.
  content: 'block+',

  defining: true,

  isolating: true,

  addAttributes() {
    return {
      width: {
        default: null as number | null,
        parseHTML: (element: HTMLElement) => {
          const parsed = Number(element.getAttribute('data-width'));
          return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          const value = attributes.width;
          if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
            return {};
          }
          return { 'data-width': String(value), style: `flex-grow: ${value}` };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="col"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'col' }), 0];
  },
});
