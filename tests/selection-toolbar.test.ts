// @vitest-environment node
/**
 * tests/selection-toolbar.test.ts — the card that follows a text selection.
 *
 * The card itself is a ProseMirror PLUGIN VIEW that lives on `document.body`
 * (src/editor/toolbar/extension.ts, and the header there says why it must not
 * be a node view); its placement and visibility are driven in the running app.
 * What is pinned here is everything decidable without a document, and every
 * one of these is a bug the app would not raise a single error about:
 *
 *   1. A BUTTON THAT NAMES A MARK THE SCHEMA DOES NOT HAVE. `editor.isActive`
 *      and `toggleX` both fail quietly for a mark that was renamed, so the
 *      button would light up never and do nothing forever. The names are
 *      checked against the real schema.
 *   2. A PIGMENT THE STYLESHEET HAS NO RULE FOR. The right-click menu and this
 *      toolbar must agree about what a wash is, which is why both read
 *      `HIGHLIGHT_WASHES`; a second hand-written list is how the two drift.
 *   3. A LINK THAT IS NOT A LINK. `normalizeLinkHref` is the sanitizer, and
 *      `javascript:` in a notes app is a script host, not a typo to be fixed
 *      up into something merely broken.
 */
import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';

import type { Editor } from '@tiptap/core';
import {
  HIGHLIGHT_STYLES,
  HIGHLIGHT_WASHES,
  NO_ACTIVE_MARKS,
  SELECTION_ACTIONS,
  normalizeLinkHref,
  toggleSelectionMark,
  type SelectionActionId,
} from '../src/editor/toolbar/actions';
import { HIGHLIGHT_WASHES as MENU_WASHES } from '../src/editor/menu/registry';
import { HIGHLIGHT_STYLES as MARK_STYLES } from '../src/editor/highlightStyles';
import {
  faceFloorPx,
  faceGroups,
  faceShortlist,
  faceStyleAttr,
  isFaceId,
} from '../src/editor/marks/face';
import { HANDS } from '../src/features/settings/appearance';

/** Same DOM shim as tests/editor-depth.test.ts — node views register roots. */
const globals = globalThis as Record<string, unknown>;
if (typeof globals.window === 'undefined') {
  globals.window = globals;
  globals.document = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
}

const { createEditorExtensions } = await import('../src/editor/extensions');
const schema = getSchema(createEditorExtensions());

/**
 * Enough of an editor for `toggleSelectionMark` to get as far as its switch.
 *
 * The three tray ids must fall through to `return false` BEFORE any command is
 * reached, so a stub whose chain answers nothing is exactly the right shape:
 * if one of them ever started toggling something, this would throw rather than
 * quietly pass.
 */
const NO_EDITOR = { chain: () => ({ focus: () => ({}) }) } as unknown as Editor;

// ---------------------------------------------------------------------------
// The row of buttons
// ---------------------------------------------------------------------------

describe('the seven inline marks', () => {
  it('is seven buttons, each named once', () => {
    expect(SELECTION_ACTIONS).toHaveLength(7);
    const ids = SELECTION_ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'bold',
      'italic',
      'strike',
      'code',
      'face',
      'highlight',
      'link',
    ]);
  });

  it('names only marks the schema really has', () => {
    for (const action of SELECTION_ACTIONS) {
      expect(
        Object.keys(schema.marks),
        `the toolbar offers "${action.title}" as the mark "${action.mark}"`,
      ).toContain(action.mark);
    }
  });

  it('gives every button either a glyph or a drawn icon, never neither', () => {
    for (const action of SELECTION_ACTIONS) {
      const drawn = action.id === 'highlight' || action.id === 'link';
      if (drawn) expect(action.glyph).toBeNull();
      else expect(action.glyph).not.toBe('');
    }
  });

  it('names a real hand for every face the toolbar offers', () => {
    // The chips are drawn from `appearance.ts`, not typed out beside it, and
    // `setFace` refuses an id the table does not have — so an offered chip
    // whose id had drifted would be a button that does nothing forever.
    for (const spec of faceShortlist(null)) expect(isFaceId(spec.id)).toBe(true);
    for (const group of faceGroups()) {
      for (const spec of group.faces) expect(isFaceId(spec.id)).toBe(true);
    }
  });

  it('never offers a face at a size CLAUDE.md forbids', () => {
    // 13px for any handwriting face; Caveat's own floor is 20. The chip and
    // the rendered run both size themselves from this one number.
    for (const spec of HANDS) {
      expect(faceFloorPx(spec.id)).toBeGreaterThanOrEqual(13);
      if (spec.floorPx !== undefined) {
        expect(faceFloorPx(spec.id)).toBeGreaterThanOrEqual(spec.floorPx);
      }
    }
    expect(faceFloorPx('Caveat')).toBe(20);
    // An id the table does not have paints nothing at all, rather than
    // resolving to the house hand and lying about which face it is.
    expect(faceStyleAttr('Not A Hand')).toBeNull();
    expect(isFaceId('Not A Hand')).toBe(false);
    // …and the floor still answers, because a total function is what keeps a
    // stylesheet from having to ask.
    expect(faceFloorPx('Not A Hand')).toBe(13);
  });

  it('opens a tray from exactly the three buttons that are not toggles', () => {
    const trays = SELECTION_ACTIONS.filter((action) => action.tray !== null);
    expect(trays.map((action) => action.id)).toEqual(['face', 'highlight', 'link']);
    expect(trays.map((action) => action.tray)).toEqual(['faces', 'washes', 'link']);
    // `toggleSelectionMark` refuses all three — a press on them opens a row of
    // choices, and silently toggling "some hand" would make the button mean
    // two different things depending on which row was open.
    for (const action of trays) {
      expect(toggleSelectionMark(NO_EDITOR, action.id)).toBe(false);
    }
  });

  it('keeps the tray buttons together at the end of the row', () => {
    // The card draws one ruled gap where `tray` starts being non-null, so a
    // tray button in the middle would put the gap in the wrong place.
    const firstTray = SELECTION_ACTIONS.findIndex((a) => a.tray !== null);
    expect(SELECTION_ACTIONS.slice(firstTray).every((a) => a.tray !== null)).toBe(true);
  });

  it('has a lit-state entry for every button and no strays', () => {
    const ids = SELECTION_ACTIONS.map((action) => action.id).sort();
    expect(Object.keys(NO_ACTIVE_MARKS).sort()).toEqual(ids);
    expect(Object.values(NO_ACTIVE_MARKS).every((on) => on === false)).toBe(true);
  });

  it('spells shortcuts the way the tooltip key caps read them', () => {
    for (const action of SELECTION_ACTIONS) {
      if (action.shortcut === null) continue;
      expect(action.shortcut).toMatch(/^Ctrl( ⇧)? .+$/);
    }
  });
});

describe('the toolbar and the right-click menu agree about pigment', () => {
  it('offers the same washes, from the same list', () => {
    expect(HIGHLIGHT_WASHES).toBe(MENU_WASHES);
    expect(HIGHLIGHT_WASHES.length).toBeGreaterThanOrEqual(6);
  });

  it('offers the same hand styles the mark itself understands', () => {
    expect(HIGHLIGHT_STYLES).toBe(MARK_STYLES);
    expect(HIGHLIGHT_STYLES).toContain('marker');
  });
});

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

describe('what the reader typed becomes an href', () => {
  it('puts https:// in front of a bare host, because nobody types it', () => {
    expect(normalizeLinkHref('alcove.app')).toBe('https://alcove.app/');
    expect(normalizeLinkHref('alcove.app/notes')).toBe('https://alcove.app/notes');
    expect(normalizeLinkHref('  alcove.app/notes  ')).toBe('https://alcove.app/notes');
  });

  it('keeps a scheme the reader supplied', () => {
    expect(normalizeLinkHref('https://alcove.app/a?b=1')).toBe(
      'https://alcove.app/a?b=1',
    );
    expect(normalizeLinkHref('http://alcove.app/')).toBe('http://alcove.app/');
    expect(normalizeLinkHref('mailto:someone@alcove.app')).toBe(
      'mailto:someone@alcove.app',
    );
  });

  it('reads an address as an address', () => {
    expect(normalizeLinkHref('someone@alcove.app')).toBe('mailto:someone@alcove.app');
  });

  it('REFUSES the two schemes that turn a note into a script host', () => {
    expect(normalizeLinkHref('javascript:alert(1)')).toBeNull();
    expect(normalizeLinkHref('JavaScript:alert(1)')).toBeNull();
    expect(normalizeLinkHref('data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
    expect(normalizeLinkHref('vbscript:msgbox(1)')).toBeNull();
    expect(normalizeLinkHref('file:///C:/Windows/System32')).toBeNull();
  });

  it('refuses rather than "fixing" a scheme it does not allow', () => {
    // The failure that matters: https://javascript:alert(1) would be stored,
    // merely broken, instead of telling the reader no.
    for (const bad of ['javascript:alert(1)', 'data:x', 'file:///c']) {
      const out = normalizeLinkHref(bad);
      expect(out, `"${bad}" must be refused, not repaired`).toBeNull();
      expect(out ?? '').not.toContain('https://');
    }
  });

  it('refuses what is plainly not an address', () => {
    expect(normalizeLinkHref('')).toBeNull();
    expect(normalizeLinkHref('   ')).toBeNull();
    expect(normalizeLinkHref('not a link at all')).toBeNull();
    // A word with no dot is a word, not a host.
    expect(normalizeLinkHref('localhostish')).toBeNull();
    expect(normalizeLinkHref('someone@nowhere')).toBeNull();
  });

  it('never returns something that is not a usable href', () => {
    const typed = [
      'alcove.app',
      'https://alcove.app',
      'mailto:a@b.co',
      'javascript:alert(1)',
      '',
      'a b c',
      '://',
      'http://',
    ];
    for (const raw of typed) {
      const href = normalizeLinkHref(raw);
      if (href === null) continue;
      expect(() => new URL(href)).not.toThrow();
      expect(['http:', 'https:', 'mailto:']).toContain(new URL(href).protocol);
    }
  });
});

// ---------------------------------------------------------------------------
// The type surface, so a seventh mark cannot be half-added
// ---------------------------------------------------------------------------

describe('adding a mark is one edit, not three', () => {
  it('types the action ids so a new one must appear everywhere at once', () => {
    // If this stops compiling, an id was added to SELECTION_ACTIONS without
    // being added to SelectionActionId / NO_ACTIVE_MARKS — which would ship a
    // button with no lit state and no branch in toggleSelectionMark.
    const ids: SelectionActionId[] = SELECTION_ACTIONS.map((action) => action.id);
    expect(ids.every((id) => id in NO_ACTIVE_MARKS)).toBe(true);
  });
});
