/**
 * src/editor/marks/face.ts — the hand a RUN of words is written in.
 *
 * The app already had two answers to "what face is this?" and neither one
 * could answer this question:
 *
 *   - `settings.handwritingFont` → `--font-body` (features/settings/apply.ts)
 *     is the hand the WHOLE APP is written in. One choice, every page.
 *   - `{font=marker}` (editor/effects/vocabulary.ts) is a BLOCK treatment —
 *     nine named looks hung on a paragraph, not a family a reader picked.
 *
 * A reader who wants three words in a different hand had nothing. This mark is
 * that third answer, and it is a MARK rather than a block attr for exactly that
 * reason: marks are what let two runs inside one paragraph disagree.
 *
 * ## What is stored
 *
 * The document JSON carries `{ type: 'face', attrs: { hand: 'Caveat' } }` — a
 * HAND ID out of `features/settings/appearance.ts`, never a CSS stack. That
 * matters twice over:
 *
 *   1. ONE LIST. The 27 faces are authored in `appearance.ts` and the settings
 *      sheet already offers them; storing the id means the toolbar and the
 *      sheet cannot come to disagree about what "quick note" is. Storing a
 *      stack would be a second copy of the table, frozen at the moment the
 *      reader clicked.
 *   2. A STACK RE-SOLVES, A COPY DOES NOT. Fifteen of the hands are faces
 *      Windows supplies, and their stacks name a bundled fallback behind them.
 *      A page written on a machine that has Gabriola, opened on one that does
 *      not, falls back to Caveat because the id is re-resolved on render.
 *
 * ## Why TipTap's own FontFamily is switched off
 *
 * `TextStyleKit` bundles `FontFamily`, which writes `style="font-family: …"`
 * onto a `textStyle` mark — a raw stack, from anywhere, at any size. Two ways
 * to set a family is the drift CLAUDE.md warns about, and the raw one is the
 * worse of the two: a paste out of a word processor would carry a face the app
 * never offered onto a page, and nothing would stop it landing at a size
 * nothing can read. `extensions.ts` passes `fontFamily: false` and this mark is
 * the only way in. Nothing in the app ever called `setFontFamily`, so no stored
 * document loses anything.
 *
 * ## The floor, which is the rule and not a nicety
 *
 * CLAUDE.md: a handwriting face is NEVER set below 13px. A face is chosen for a
 * SELECTION, and a selection can sit in small print — a footnote entry is 15px,
 * a marginalia smaller still — so "the reader picked it" is not an argument
 * that it is legible. Every face therefore renders at `max(floor, 1em)`:
 * `1em` inside the span is the size of the context it was dropped into, so a
 * face never SHRINKS anything and never draws below its own floor. The floor is
 * the face's own `floorPx` where it has one (Caveat is 20, the light hands 16)
 * and the house 13 otherwise.
 *
 * ## What this mark does NOT do
 *
 * It sets a family and a minimum size. It does not set a colour (that is the
 * `textStyle` colour the ink rows write), a weight, or an alignment. A mark
 * that could do all four would be a style sheet with a toolbar, and every one
 * of those axes already has an owner.
 */
import { Mark, mergeAttributes } from '@tiptap/core';
import {
  HANDS,
  HAND_FAMILIES,
  HAND_FAMILY_LABELS,
  HAND_SHORTLIST,
  type HandFamily,
  type HandSpec,
} from '../../features/settings/appearance';

/**
 * The house floor for any face, in px (CLAUDE.md).
 *
 * `styles/tokens.css` states the same number as `--text-chip`; this is the one
 * the MARK enforces, because a mark can land anywhere and a token cannot follow
 * it there.
 */
export const FACE_FLOOR_PX = 13;

/** The class every face span carries, and the hook `editor.css` styles. */
export const FACE_CLASS = 'nb-face';

const HAND_BY_ID = new Map(HANDS.map((spec) => [spec.id, spec] as const));

/**
 * The spec for a stored id, or `null` when the id is not one this app knows.
 *
 * Deliberately NOT `resolveHand`, which is total and answers "Patrick Hand" for
 * junk. That is the right answer for a SETTING — the app has to be written in
 * something — and the wrong one for a run inside a page: a mark that resolved
 * an unknown id to the house hand would paint three words in a face the reader
 * never chose and give them no way to tell it from a face they did. An unknown
 * id degrades to the page's own hand instead, which is what the words looked
 * like before anybody touched them.
 */
export function faceSpec(id: unknown): HandSpec | null {
  return typeof id === 'string' ? (HAND_BY_ID.get(id) ?? null) : null;
}

/** True for an id `faceSpec` will answer for. */
export function isFaceId(value: unknown): value is string {
  return faceSpec(value) !== null;
}

/** The smallest size this face may be drawn at, in px. */
export function faceFloorPx(id: unknown): number {
  return Math.max(FACE_FLOOR_PX, faceSpec(id)?.floorPx ?? FACE_FLOOR_PX);
}

/** The CSS stack a face is drawn with, or `null` for an id we do not know. */
export function faceStack(id: unknown): string | null {
  return faceSpec(id)?.stack ?? null;
}

/**
 * The two custom properties a face span carries.
 *
 * Custom properties rather than a literal `font-family`, so the ONE rule in
 * `editor.css` decides how they are used and a nested `<code>` can still win
 * back the monospace it needs. An inline `font-family` would beat every
 * stylesheet rule in the app, including that one.
 */
export function faceStyleAttr(id: unknown): string | null {
  const spec = faceSpec(id);
  if (spec === null) return null;
  return `--nb-face: ${spec.stack}; --nb-face-floor: ${faceFloorPx(spec.id)}px`;
}

/* ============================== the offering ============================== */

/**
 * Is this face actually on this machine?
 *
 * Nine of the hands ship with the app and are always there; the rest are
 * Windows' own. A chip for a face this machine does not have would draw itself
 * in the next thing down its fallback chain — two chips painting the same
 * letters, one of them lying about which face it is.
 *
 * Guarded rather than assumed, because `toolbar/actions.ts` is pinned in a Node
 * test and `editor/extensions.ts` builds the schema there: this module is
 * imported in an environment with no `document` at all, and only the pickers
 * ever call this.
 *
 * TWIN: `features/settings/SettingsPanel.tsx#handAvailable` asks the same
 * question the same way. That file is not this change's to edit; the two want
 * merging into `appearance.ts` when somebody owns both.
 */
function faceAvailable(spec: HandSpec): boolean {
  if (spec.probe === undefined) return true;
  const fonts = typeof document === 'undefined' ? undefined : document.fonts;
  if (fonts === undefined || typeof fonts.check !== 'function') return false;
  try {
    return fonts.check(`16px "${spec.probe}"`);
  } catch {
    return false;
  }
}

/** Every face this machine can really draw, in `appearance.ts` order. */
function availableFaces(): readonly HandSpec[] {
  return HANDS.filter(faceAvailable);
}

/**
 * The row a tray opens on: the signature hands this machine has, plus whatever
 * the selection is already wearing.
 *
 * Same shape as the settings sheet's `withCurrent` — a reader who has set a run
 * in Gabriola must find Gabriola lit when they come back to it, not have to
 * open "all of them" to discover their own choice.
 */
export function faceShortlist(current: string | null): readonly HandSpec[] {
  const shortlist = HAND_SHORTLIST.filter(faceAvailable);
  if (current === null || shortlist.some((spec) => spec.id === current)) return shortlist;
  const extra = faceSpec(current);
  return extra === null ? shortlist : [...shortlist, extra];
}

export interface FaceGroup {
  readonly family: HandFamily;
  readonly title: string;
  readonly faces: readonly HandSpec[];
}

/** Every available face, under its family heading. Empty families are dropped. */
export function faceGroups(): readonly FaceGroup[] {
  const all = availableFaces();
  return HAND_FAMILIES.map((family) => ({
    family,
    title: HAND_FAMILY_LABELS[family],
    faces: all.filter((spec) => spec.family === family),
  })).filter((group) => group.faces.length > 0);
}

/* ================================ the mark ================================ */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    face: {
      /** Write the selection in `hand` (a `HandSpec` id). */
      setFace: (hand: string) => ReturnType;
      /** Give the selection back to the page's own hand. */
      unsetFace: () => ReturnType;
      /** `hand` if it is not already on, the page's hand if it is. */
      toggleFace: (hand: string) => ReturnType;
    };
  }
}

export const NotebookFace = Mark.create({
  name: 'face',

  /*
   * A face is a property of the WORDS, so it keeps its span across an edit the
   * way bold does. It is not `spanning: false` (which would break the run at
   * every node boundary) and not `inclusive: false` (typing at the end of a run
   * set in a hand should keep writing in that hand — that is the whole point of
   * choosing one).
   */

  addAttributes() {
    return {
      hand: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute('data-hand');
          return isFaceId(raw) ? raw : null;
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          const style = faceStyleAttr(attributes.hand);
          if (style === null) return {};
          return { 'data-hand': attributes.hand as string, style };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-hand]',
        // A span whose id we do not know is not a face — let it parse as
        // ordinary text rather than as a mark that renders nothing.
        getAttrs: (element) =>
          isFaceId((element as HTMLElement).getAttribute('data-hand'))
            ? null
            : false,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ class: FACE_CLASS }, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setFace:
        (hand) =>
        ({ commands }) =>
          isFaceId(hand) ? commands.setMark(this.name, { hand }) : false,
      unsetFace:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
      toggleFace:
        (hand) =>
        ({ editor, commands }) => {
          if (!isFaceId(hand)) return false;
          return editor.isActive(this.name, { hand })
            ? commands.unsetMark(this.name)
            : commands.setMark(this.name, { hand });
        },
    };
  },
});
