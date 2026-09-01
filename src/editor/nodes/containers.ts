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

/** A `data-title` string attribute — a caption CSS sets above the block. */
function titleAttribute(): {
  default: string;
  parseHTML: (element: HTMLElement) => string;
  renderHTML: (attributes: Record<string, unknown>) => Record<string, unknown>;
} {
  return {
    default: '',
    parseHTML: (element) => element.getAttribute('data-title') ?? '',
    renderHTML: (attributes) =>
      typeof attributes.title === 'string' && attributes.title !== ''
        ? { 'data-title': attributes.title }
        : {},
  };
}

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
    return { title: titleAttribute() };
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
// The stationery drawer — five more things a page can have stuck to it
//
// Same shape as everything above: a block container, CSS-only, named exactly
// as the script vocabulary names it so the bridge wires it without a table.
// What each one is FOR matters as much as what it looks like — a page full of
// boxes that differ only in border radius is not five insertables, it is one.
// ---------------------------------------------------------------------------

/** Ruled index card: a red header rule, a squared corner, a small tilt. */
export const IndexCard = Node.create({
  name: 'index-card',
  group: 'block',
  content: 'block+',
  defining: true,
  draggable: true,

  addAttributes() {
    return { title: titleAttribute() };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="index-card"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs: Record<string, unknown> = {
      'data-type': 'index-card',
      'data-nb-ruling-surface': '',
    };
    if (!hasExplicitRotate(node)) {
      const seed = `${String(node.attrs.id ?? '')}|${String(node.attrs.title ?? '')}`;
      attrs.style = `--nb-rotate: ${seededTilt(seed, 1.4)}deg`;
    }
    return ['div', mergeAttributes(HTMLAttributes, attrs), 0];
  },
});

/** An envelope with its flap open — for a letter, a keepsake, a long aside. */
export const Envelope = Node.create({
  name: 'envelope',
  group: 'block',
  content: 'block+',
  defining: true,
  draggable: true,

  addAttributes() {
    return { color: washColorAttribute('amber') };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="envelope"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'envelope' }), 0];
  },
});

/** A postage stamp: perforated edge, a postmark ring, one line of text. */
export const Stamp = Node.create({
  name: 'stamp',
  group: 'block',
  content: 'block+',
  defining: true,
  draggable: true,

  addAttributes() {
    return { color: washColorAttribute('terracotta') };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="stamp"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs: Record<string, unknown> = { 'data-type': 'stamp' };
    if (!hasExplicitRotate(node)) {
      const seed = `${String(node.attrs.id ?? '')}|stamp|${node.childCount}`;
      attrs.style = `--nb-rotate: ${seededTilt(seed, 3.4)}deg`;
    }
    return ['div', mergeAttributes(HTMLAttributes, attrs), 0];
  },
});

/** A luggage tag on a string. A short label for whatever comes next. */
export const Tag = Node.create({
  name: 'tag',
  group: 'block',
  content: 'block+',
  defining: true,
  draggable: true,

  addAttributes() {
    return { color: washColorAttribute('moss') };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="tag"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs: Record<string, unknown> = { 'data-type': 'tag' };
    if (!hasExplicitRotate(node)) {
      const seed = `${String(node.attrs.id ?? '')}|tag`;
      attrs.style = `--nb-rotate: ${seededTilt(seed, 2)}deg`;
    }
    return ['div', mergeAttributes(HTMLAttributes, attrs), 0];
  },
});

/** A side note in a ruled margin, set smaller — an afterthought. */
export const Marginalia = Node.create({
  name: 'marginalia',
  group: 'block',
  content: 'block+',
  defining: true,
  draggable: true,

  parseHTML() {
    return [{ tag: 'div[data-type="marginalia"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'marginalia',
        'data-nb-ruling-surface': '',
      }),
      0,
    ];
  },
});

// ---------------------------------------------------------------------------
// The keepsake drawer — five things a notebook has stuck INTO it
//
// Everything above is something you WRITE ON. These five are things you KEEP:
// a flower off a walk, the stub of a ticket, a card someone posted you, the
// week's spending, a photograph. Each carries BOTH `color` (its pigment) and
// `title` (the hand-written label the object really has — a species name, a
// stub legend, a postmark, an account, a pencil caption), because in every
// case the label is the half that makes it a keepsake rather than a box.
//
// Same plumbing as everything above: block containers, CSS-only, named
// exactly as src/script/vocab.ts names them so the script bridge wires them
// with no mapping table.
// ---------------------------------------------------------------------------

/** `color` + `title` together — the shape every keepsake below wants. */
function keepsakeAttributes(fallback: WashColor): {
  color: ReturnType<typeof washColorAttribute>;
  title: ReturnType<typeof titleAttribute>;
} {
  return { color: washColorAttribute(fallback), title: titleAttribute() };
}

/** A pressed specimen on a mount card, with its herbarium label. */
export const PressedFlower = Node.create({
  name: 'pressed-flower',
  group: 'block',
  content: 'block+',
  defining: true,
  draggable: true,

  addAttributes() {
    return keepsakeAttributes('blush');
  },

  parseHTML() {
    return [{ tag: 'div[data-type="pressed-flower"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs: Record<string, unknown> = { 'data-type': 'pressed-flower' };
    // The bloom sits at a seeded angle on the mount. No two specimens on a
    // page were pressed the same way up, and a column of identical sprigs is
    // the exact "clip art" reading this block has to avoid.
    const seed = `${String(node.attrs.id ?? '')}|${String(node.attrs.title ?? '')}|petal`;
    attrs.style = `--nb-sprig: ${seededTilt(seed, 13)}deg`;
    if (!hasExplicitRotate(node)) {
      attrs.style += `; --nb-rotate: ${seededTilt(`${seed}|card`, 1.2)}deg`;
    }
    return ['div', mergeAttributes(HTMLAttributes, attrs), 0];
  },
});

/** A torn ticket: body, perforation, stub. */
export const TicketStub = Node.create({
  name: 'ticket-stub',
  group: 'block',
  content: 'block+',
  defining: true,
  draggable: true,

  addAttributes() {
    return keepsakeAttributes('terracotta');
  },

  parseHTML() {
    return [{ tag: 'div[data-type="ticket-stub"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs: Record<string, unknown> = { 'data-type': 'ticket-stub' };
    if (!hasExplicitRotate(node)) {
      const seed = `${String(node.attrs.id ?? '')}|ticket|${String(node.attrs.title ?? '')}`;
      attrs.style = `--nb-rotate: ${seededTilt(seed, 1.6)}deg`;
    }
    return ['div', mergeAttributes(HTMLAttributes, attrs), 0];
  },
});

/** A divided-back postcard: message on the left, address rules on the right. */
export const Postcard = Node.create({
  name: 'postcard',
  group: 'block',
  content: 'col col',
  defining: true,
  draggable: true,

  addAttributes() {
    return keepsakeAttributes('sky');
  },

  parseHTML() {
    return [{ tag: 'div[data-type="postcard"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs: Record<string, unknown> = {
      'data-type': 'postcard',
      'data-nb-ruling-surface': '',
    };
    if (!hasExplicitRotate(node)) {
      const seed = `${String(node.attrs.id ?? '')}|post`;
      attrs.style = `--nb-rotate: ${seededTilt(seed, 1)}deg`;
    }
    return ['div', mergeAttributes(HTMLAttributes, attrs), 0];
  },
});

/** A ruled accounts strip with a figures column down the right. */
export const Ledger = Node.create({
  name: 'ledger',
  group: 'block',
  content: 'col col',
  defining: true,
  draggable: true,

  addAttributes() {
    return keepsakeAttributes('moss');
  },

  parseHTML() {
    return [{ tag: 'div[data-type="ledger"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    // Deliberately untilted: ruled account paper is bound in, not stuck on.
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'ledger',
        'data-nb-ruling-surface': '',
      }),
      0,
    ];
  },
});

/** A print held down by four paper corners, with a pencil caption. */
export const PhotoCorner = Node.create({
  name: 'photo-corner',
  group: 'block',
  content: 'block+',
  defining: true,
  draggable: true,

  addAttributes() {
    return keepsakeAttributes('graphite');
  },

  parseHTML() {
    return [{ tag: 'div[data-type="photo-corner"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs: Record<string, unknown> = { 'data-type': 'photo-corner' };
    if (!hasExplicitRotate(node)) {
      const seed = `${String(node.attrs.id ?? '')}|mount|${node.childCount}`;
      attrs.style = `--nb-rotate: ${seededTilt(seed, 1.8)}deg`;
    }
    return ['div', mergeAttributes(HTMLAttributes, attrs), 0];
  },
});

// ---------------------------------------------------------------------------
// Two fastenings — the drawer's odd pair
//
// Everything above is a SURFACE: a thing with an inside, which the reader
// writes on or keeps a keepsake in. These two are not. A wax seal closes
// something and a map pin holds a place down; both arrive ON TOP of writing
// that already exists. That is the whole reason they earn their own names
// rather than being another `frame=` value — the content sits BESIDE the
// object rather than inside it, and the CSS lays them out that way.
// ---------------------------------------------------------------------------

/** A blob of sealing wax over a ribbon, pressed with a monogram. */
export const WaxSeal = Node.create({
  name: 'wax-seal',
  group: 'block',
  content: 'block+',
  defining: true,
  draggable: true,

  addAttributes() {
    return keepsakeAttributes('terracotta');
  },

  parseHTML() {
    return [{ tag: 'div[data-type="wax-seal"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs: Record<string, unknown> = {
      'data-type': 'wax-seal',
      'data-nb-ruling-surface': '',
    };
    if (!hasExplicitRotate(node)) {
      // A wider swing than the papers get: a card is placed, a seal is
      // STRUCK, and a die pressed by hand never lands square.
      const seed = `${String(node.attrs.id ?? '')}|wax|${String(node.attrs.title ?? '')}`;
      attrs.style = `--nb-rotate: ${seededTilt(seed, 3)}deg`;
    }
    return ['div', mergeAttributes(HTMLAttributes, attrs), 0];
  },
});

/** A pin dropped on a place, with the walk in behind it. */
export const MapPin = Node.create({
  name: 'map-pin',
  group: 'block',
  content: 'block+',
  defining: true,
  draggable: true,

  addAttributes() {
    return keepsakeAttributes('terracotta');
  },

  parseHTML() {
    return [{ tag: 'div[data-type="map-pin"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    // Never tilted. A pin that is not upright does not read as pushed in,
    // it reads as fallen out.
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'map-pin',
        'data-nb-ruling-surface': '',
      }),
      0,
    ];
  },
});

// ---------------------------------------------------------------------------
// columns / col live in ./columns.ts
//
// They were declared here, beside the stationery, as a schema and nothing
// else — no flex rule, no way to add or remove a column, no way to move a
// divider. The finish (commands + a resize plugin + the layout CSS) needed a
// file of its own, and two live copies of one node name is exactly the kind
// of thing that keeps working until somebody edits the wrong one.
// ---------------------------------------------------------------------------
