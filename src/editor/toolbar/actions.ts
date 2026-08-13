/**
 * The selection toolbar's vocabulary — pure, DOM-free, Solid-free, so the
 * whole surface can be pinned in a Node test (tests/selection-toolbar.test.ts).
 *
 * The toolbar itself is a ProseMirror PLUGIN VIEW (src/editor/toolbar/
 * extension.ts). This file holds the two things that are decidable without a
 * document: what buttons exist, and what a typed link string turns into.
 *
 * WHY THE MARKS ARE A LIST AND NOT SIX HAND-WIRED BUTTONS. The right-click
 * menu already carries block-level ink and highlight (src/editor/menu/
 * registry.ts) and the two have to agree about what a "wash" is; both now read
 * `HIGHLIGHT_WASHES` and `HIGHLIGHT_STYLES`. A second hand-written list of
 * pigments is how the app ends up with a toolbar that offers a colour the
 * stylesheet has no rule for — the mistake the ctx menu's comment already
 * warns about, one layer up.
 */
import type { Editor } from '@tiptap/core';
import {
  HIGHLIGHT_STYLES,
  HIGHLIGHT_STYLE_LABELS,
  highlightAttrs,
  type HighlightStyle,
} from '../highlightStyles';
import { isFaceId } from '../marks/face';
import { HIGHLIGHT_WASHES, type HighlightWash } from '../menu/registry';

export type SelectionActionId =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'face'
  | 'highlight'
  | 'link';

/** A tray is a second row the button opens instead of toggling straight away. */
export type SelectionTray = 'faces' | 'washes' | 'link' | 'ai';

export interface SelectionAction {
  readonly id: SelectionActionId;
  /** Schema mark whose presence lights the button up. */
  readonly mark: string;
  /** Tooltip words (the button's accessible name too). */
  readonly title: string;
  /** Kalam glyph, or `null` when the button draws an SVG instead. */
  readonly glyph: string | null;
  /** Drawn on the tooltip's little key cap; null when there is no binding. */
  readonly shortcut: string | null;
  readonly tray: SelectionTray | null;
}

/**
 * Seven inline marks, in the order a hand reaches for them.
 *
 * `code` sits after `strike` rather than beside the three tray buttons because
 * it is a MARK — it toggles like the three before it, and grouping by what a
 * press does beats grouping by how ornamental the result is.
 *
 * `face` opens the tray group rather than closing it: it is the newest thing
 * on the card and the one the reader went looking for and could not find
 * ("i don't see an option … to change the text font style"), so it gets the
 * first press after the ruled gap. Its chip is the only one that redraws
 * itself — it shows "Aa" in whatever hand the selection is already wearing,
 * which is a label and a state readout in the same 30px.
 */
export const SELECTION_ACTIONS: readonly SelectionAction[] = [
  {
    id: 'bold',
    mark: 'bold',
    title: 'Bold',
    glyph: 'B',
    shortcut: 'Ctrl B',
    tray: null,
  },
  {
    id: 'italic',
    mark: 'italic',
    title: 'Italic',
    glyph: 'I',
    shortcut: 'Ctrl I',
    tray: null,
  },
  {
    id: 'strike',
    mark: 'strike',
    title: 'Strikethrough',
    glyph: 'S',
    shortcut: 'Ctrl ⇧ X',
    tray: null,
  },
  {
    id: 'code',
    mark: 'code',
    title: 'Code',
    glyph: '{ }',
    shortcut: 'Ctrl E',
    tray: null,
  },
  {
    id: 'face',
    mark: 'face',
    title: 'Handwriting',
    glyph: 'Aa',
    shortcut: null,
    tray: 'faces',
  },
  {
    id: 'highlight',
    mark: 'highlight',
    title: 'Highlight',
    glyph: null,
    shortcut: null,
    tray: 'washes',
  },
  {
    id: 'link',
    mark: 'link',
    title: 'Link',
    glyph: null,
    shortcut: 'Ctrl K',
    tray: 'link',
  },
];

/** Which buttons are lit for the current selection. */
export type SelectionActiveMap = Record<SelectionActionId, boolean>;

export const NO_ACTIVE_MARKS: SelectionActiveMap = {
  bold: false,
  italic: false,
  strike: false,
  code: false,
  face: false,
  highlight: false,
  link: false,
};

/** Read every button's lit state off a live editor in one pass. */
export function readActiveMarks(editor: Editor): SelectionActiveMap {
  const out = { ...NO_ACTIVE_MARKS };
  for (const action of SELECTION_ACTIONS) {
    out[action.id] = editor.isActive(action.mark);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Running an action
// ---------------------------------------------------------------------------

/**
 * Toggle one of the four plain marks. The three tray buttons (face, highlight,
 * link) are not toggles and are refused here on purpose — a press on them opens
 * a row of choices, and silently toggling "some hand" instead would make the
 * button mean two different things depending on which row was open.
 */
export function toggleSelectionMark(editor: Editor, id: SelectionActionId): boolean {
  const chain = editor.chain().focus();
  switch (id) {
    case 'bold':
      return chain.toggleBold().run();
    case 'italic':
      return chain.toggleItalic().run();
    case 'strike':
      return chain.toggleStrike().run();
    case 'code':
      return chain.toggleCode().run();
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Faces — the hand a run is written in (marks/face.ts)
// ---------------------------------------------------------------------------

/**
 * Write the selection in `hand`.
 *
 * `extendMarkRange` deliberately NOT used, unlike the link: a link is one
 * indivisible thing whose whole run you are editing, but a face is a property
 * of the words you actually highlighted. Extending would silently repaint the
 * rest of a run somebody set earlier.
 */
export function applySelectionFace(editor: Editor, hand: string): boolean {
  if (!isFaceId(hand)) return false;
  return editor.chain().focus().setFace(hand).run();
}

/** Give the selection back to the page's own hand. */
export function clearSelectionFace(editor: Editor): boolean {
  return editor.chain().focus().unsetFace().run();
}

/** The hand under the selection, or `null` when it is the page's own. */
export function selectionFace(editor: Editor): string | null {
  const hand: unknown = editor.getAttributes('face').hand;
  return isFaceId(hand) ? hand : null;
}

/** Paint the selection with a wash, in the currently chosen hand style. */
export function applySelectionHighlight(
  editor: Editor,
  wash: HighlightWash,
  style: HighlightStyle = 'marker',
): boolean {
  return editor.chain().focus().setHighlight(highlightAttrs(wash, style)).run();
}

/** Wipe any highlight off the selection. */
export function clearSelectionHighlight(editor: Editor): boolean {
  return editor.chain().focus().unsetHighlight().run();
}

/** The wash under the selection, or amber when there is none. */
export function selectionWash(editor: Editor): HighlightWash {
  const color: unknown = editor.getAttributes('highlight').color;
  return typeof color === 'string' &&
    (HIGHLIGHT_WASHES as readonly string[]).includes(color)
    ? (color as HighlightWash)
    : 'amber';
}

/** The hand style under the selection, or the plain marker sweep. */
export function selectionHighlightStyle(editor: Editor): HighlightStyle {
  const style: unknown = editor.getAttributes('highlight').hlStyle;
  return typeof style === 'string' &&
    (HIGHLIGHT_STYLES as readonly string[]).includes(style)
    ? (style as HighlightStyle)
    : 'marker';
}

/** The href under the selection, or '' when the selection carries no link. */
export function selectionHref(editor: Editor): string {
  const href: unknown = editor.getAttributes('link').href;
  return typeof href === 'string' ? href : '';
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/**
 * Schemes a link may carry. `javascript:` and `data:` are the two that turn a
 * note into a script host, and TipTap's Link extension will happily store
 * either — the sanitizer is ours to write.
 *
 * `mailto:` is here because a notebook full of people is a real use, and the
 * webview hands it to the OS mail client rather than executing anything.
 */
const ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:'];

/**
 * What the reader typed → the href to store, or null when it cannot be one.
 *
 * A bare `alcove.app/notes` is the common case and gets `https://` in front of
 * it, because typing the scheme is not something anyone does. Anything with a
 * scheme we do not allow is refused outright rather than "fixed" — silently
 * rewriting `javascript:alert(1)` into `https://javascript:alert(1)` would
 * store a link that is merely broken instead of telling the reader no.
 */
export function normalizeLinkHref(raw: string): string | null {
  const text = raw.trim();
  if (text === '') return null;
  if (/\s/.test(text)) return null;

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text);
  if (scheme !== null) {
    if (!ALLOWED_SCHEMES.includes(`${scheme[1]!.toLowerCase()}:`)) return null;
    try {
      return new URL(text).toString();
    } catch {
      return null;
    }
  }

  // No scheme. An @ with no slash before it reads as an address, everything
  // else as a host — both are what the reader plainly meant.
  const at = text.indexOf('@');
  if (at > 0 && !text.includes('/') && text.indexOf('.', at) > at + 1) {
    return `mailto:${text}`;
  }
  try {
    const url = new URL(`https://${text}`);
    return url.hostname.includes('.') ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Put a link on the selection (whole mark range, so editing one is one act). */
export function applySelectionLink(editor: Editor, raw: string): boolean {
  const href = normalizeLinkHref(raw);
  if (href === null) return false;
  return editor
    .chain()
    .focus()
    .extendMarkRange('link')
    .setLink({ href })
    .run();
}

/** Take the link off the selection. */
export function clearSelectionLink(editor: Editor): boolean {
  return editor.chain().focus().extendMarkRange('link').unsetLink().run();
}

export { HIGHLIGHT_WASHES, HIGHLIGHT_STYLES, HIGHLIGHT_STYLE_LABELS };
export type { HighlightWash, HighlightStyle };
