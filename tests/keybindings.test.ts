// @vitest-environment node
/**
 * tests/keybindings.test.ts — the shortcut registry, and the one listener.
 *
 * The reader asked for more shortcuts. Twenty-one of them only stay honest if
 * four things keep holding, and each of them has already been broken once in
 * this tree:
 *
 *   1. THE LIST AND THE HANDLERS ARE ONE TABLE. `export-script` advertised
 *      mod+shift+e in the settings sheet while App.tsx used that combo for the
 *      library export; F9 and '?' fired for a year and appeared in no list at
 *      all. Everything is derived from `SHORTCUT_ACTIONS` now, so this file
 *      checks the derivations rather than a second copy of the table.
 *   2. NOTHING SHADOWS TYPING. The rebinding UI refuses a bare letter because
 *      it "would just type into the page" — the dispatcher has to refuse the
 *      same thing from the other side, since a stored blob can be hand-edited.
 *   3. THE APP NEVER SHIPS A COMBO ITS OWN PICKER WOULD TURN DOWN. A default
 *      that `bindingRefusal` rejects is a row the reader cannot reset.
 *   4. A KEY WITH NO LIVE COMMAND IS LEFT ALONE. The shelf's own bare +/−/0
 *      and every letter in the editor still have to work with this listener
 *      installed.
 *
 * The dispatcher is exercised against a hand-rolled `window`: jsdom is not
 * installed (see vitest.config.ts), and the listener only needs
 * add/removeEventListener plus a KeyboardEvent-shaped object, so faking those
 * three is cheaper and more legible than a DOM.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_KEYBINDINGS,
  FIXED_BINDING_REASONS,
  LISTED_ACTION_IDS,
  SHORTCUT_ACTIONS,
  SHORTCUT_GROUPS,
  UNHANDLED_ACTION_IDS,
  actionsInGroup,
  bindingActionLabel,
  bindingFor,
  commandIsLive,
  installShortcuts,
  registerCommands,
  runCommand,
  shortcutAction,
  survivesTyping,
} from '../src/data/keybindings';
import {
  bindingRefusal,
  canonicalBinding,
  listedBindingActions,
  listedBindingGroups,
} from '../src/data/settings';

const SRC = join(import.meta.dirname, '..', 'src');

/* ----------------------------- the registry -------------------------------- */

describe('SHORTCUT_ACTIONS', () => {
  it('gives every action a label, a known group and a unique id', () => {
    const ids = SHORTCUT_ACTIONS.map((action) => action.id);
    expect(new Set(ids).size, 'two actions share an id').toBe(ids.length);
    const groups = new Set(SHORTCUT_GROUPS.map((group) => group.id));
    for (const action of SHORTCUT_ACTIONS) {
      expect(action.label.trim().length, `${action.id} has no label`).toBeGreaterThan(0);
      expect(groups.has(action.group), `${action.id} is in group "${action.group}"`).toBe(
        true,
      );
    }
  });

  it('derives DEFAULT_KEYBINDINGS from the rebindable + fixed rows only', () => {
    const keyed = SHORTCUT_ACTIONS.filter((action) => action.kind !== 'house');
    expect(Object.keys(DEFAULT_KEYBINDINGS).sort()).toEqual(
      keyed.map((action) => action.id).sort(),
    );
    for (const action of keyed) {
      if (action.kind === 'house') continue;
      expect(DEFAULT_KEYBINDINGS[action.id]).toBe(action.binding);
    }
  });

  // A gesture is not a combination. "drag a page edge" must never end up in
  // the stored map, where `matchesBinding` would compare it to `event.key`.
  it('keeps house keys and gestures out of the stored map', () => {
    for (const action of SHORTCUT_ACTIONS) {
      if (action.kind !== 'house') continue;
      expect(DEFAULT_KEYBINDINGS[action.id]).toBeUndefined();
      expect(action.keys.trim().length).toBeGreaterThan(0);
    }
  });

  it('gives every action a distinct combination, spelled one way', () => {
    const combos = Object.values(DEFAULT_KEYBINDINGS).map(canonicalBinding);
    expect(new Set(combos).size).toBe(combos.length);
    // And the shipped spelling is already canonical, so a reader pressing the
    // exact key the sheet prints is a no-op rather than a "rebind".
    for (const [action, combo] of Object.entries(DEFAULT_KEYBINDINGS)) {
      expect(canonicalBinding(combo), `${action} ships un-canonically`).toBe(combo);
    }
  });

  it('ships every action a handler looks up', () => {
    for (const action of [
      'command-palette',
      'search-text',
      'open-settings',
      'keyboard-help',
      'new-book',
      'library-studio',
      'add-floor',
      'open-trash',
      'new-page',
      'toggle-bookmark',
      'toggle-focus',
      'table-of-contents',
      'catalogue',
      'page-style',
      'customize-book',
      'thumbnails',
      'insert-script',
      'export-script',
      'export-library',
      'import-library',
    ]) {
      expect(DEFAULT_KEYBINDINGS[action], `${action} has no combo`).toBeTruthy();
    }
  });

  it('names every fixed row a reason it cannot move', () => {
    for (const action of SHORTCUT_ACTIONS) {
      if (action.kind !== 'fixed') continue;
      expect(FIXED_BINDING_REASONS[action.id]).toBe(action.reason);
      expect(action.reason.length).toBeGreaterThan(20);
    }
  });
});

/* ------------------------- never shadow typing ----------------------------- */

describe('shipped combos never shadow the page', () => {
  it('gives every rebindable combo a modifier or an F key', () => {
    for (const action of SHORTCUT_ACTIONS) {
      if (action.kind !== 'binding' || action.handled === false) continue;
      expect(
        survivesTyping(action.binding),
        `${action.id} ships on "${action.binding}", which would just type`,
      ).toBe(true);
    }
  });

  it('survivesTyping only lets mod / alt / F keys through', () => {
    expect(survivesTyping('mod+alt+t')).toBe(true);
    expect(survivesTyping('alt+t')).toBe(true);
    expect(survivesTyping('f9')).toBe(true);
    expect(survivesTyping('f12')).toBe(true);
    expect(survivesTyping('shift+t')).toBe(false);
    expect(survivesTyping('t')).toBe(false);
    expect(survivesTyping('f13')).toBe(false);
  });

  // The picker and the shipped table have to agree, or a reader who resets a
  // row lands on a combination the same sheet would have refused to accept.
  it('ships nothing the rebinding UI would turn down', () => {
    for (const action of SHORTCUT_ACTIONS) {
      if (action.kind !== 'binding' || action.handled === false) continue;
      expect(
        bindingRefusal(action.id, action.binding, DEFAULT_KEYBINDINGS),
        `${action.id} ships on a combination the picker refuses`,
      ).toBeNull();
    }
  });
});

/* --------------------------- what the surfaces see -------------------------- */

describe('the settings sheet and the cheat sheet read the same table', () => {
  it('lists every handled action, and no unhandled one', () => {
    expect(LISTED_ACTION_IDS).not.toContain('toggle-handwriting');
    for (const id of UNHANDLED_ACTION_IDS) {
      expect(LISTED_ACTION_IDS).not.toContain(id);
    }
    for (const action of SHORTCUT_ACTIONS) {
      if (action.kind === 'house' || action.handled === false) continue;
      expect(LISTED_ACTION_IDS, `${action.id} is missing from the list`).toContain(
        action.id,
      );
    }
  });

  it('groups the settings rows without losing or duplicating one', () => {
    const groups = listedBindingGroups(DEFAULT_KEYBINDINGS);
    const flat = groups.flatMap((group) => group.actions);
    expect(flat.sort()).toEqual(listedBindingActions(DEFAULT_KEYBINDINGS).sort());
    expect(new Set(flat).size).toBe(flat.length);
    // Room order, not alphabetical: the first heading is the one that works
    // everywhere, so the reader meets it before the scene-specific ones.
    expect(groups[0]?.id).toBe('around');
    for (const group of groups) expect(group.title.length).toBeGreaterThan(0);
  });

  it('shows the stray ids in a stored blob rather than hiding them', () => {
    const withStray = { ...DEFAULT_KEYBINDINGS, 'from-an-older-build': 'mod+alt+9' };
    const listed = listedBindingActions(withStray);
    expect(listed).toContain('from-an-older-build');
    // …and it lands under a heading, so it cannot be listed and undrawable.
    const groups = listedBindingGroups(withStray);
    expect(groups.flatMap((group) => group.actions)).toContain('from-an-older-build');
    expect(bindingActionLabel('from-an-older-build')).toBe('from an older build');
  });

  it('puts every cheat-sheet row in exactly one column', () => {
    const drawn = SHORTCUT_GROUPS.flatMap((group) => actionsInGroup(group.id));
    expect(drawn.length).toBe(SHORTCUT_ACTIONS.length);
    expect(new Set(drawn.map((action) => action.id)).size).toBe(SHORTCUT_ACTIONS.length);
  });

  /*
   * The brief's own words: "appear in the cheat sheet (which reads the map, so
   * this should be automatic — verify it is)". It was NOT automatic: the card
   * held a hand-written two-column table that had drifted off the real keys.
   * A source sweep is the only thing that can tell the difference between a
   * generated card and a hard-coded one that happens to agree today.
   */
  it('generates the cheat sheet instead of typing it out', () => {
    const src = readFileSync(join(SRC, 'views', 'CheatSheet.tsx'), 'utf8');
    expect(src).toMatch(/from '\.\.\/data\/keybindings'/);
    expect(src).toMatch(/SHORTCUT_GROUPS/);
    expect(src).toMatch(/actionsInGroup/);
    // The shape the hand-written table had. If one comes back, this is the
    // line that says so.
    expect(src).not.toMatch(/const\s+COLUMNS\s*:/);
    expect(src).not.toMatch(/\bkeys:\s*'(Ctrl|F9|\?)/);
  });

  it('spells a binding from the stored map, falling back to the shipped one', () => {
    expect(bindingFor('catalogue', {})).toBe(DEFAULT_KEYBINDINGS['catalogue']);
    expect(bindingFor('catalogue', { catalogue: 'mod+alt+9' })).toBe('mod+alt+9');
    expect(bindingFor('nothing-like-this', {})).toBe('');
  });
});

/* ------------------------------ the dispatcher ------------------------------ */

interface FakeKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat: boolean;
  defaultPrevented: boolean;
  target: unknown;
  preventDefault(): void;
}

function press(
  key: string,
  mods: {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    repeat?: boolean;
    prevented?: boolean;
    target?: unknown;
  } = {},
): FakeKeyEvent {
  const event: FakeKeyEvent = {
    key,
    ctrlKey: mods.ctrl === true,
    metaKey: false,
    shiftKey: mods.shift === true,
    altKey: mods.alt === true,
    repeat: mods.repeat === true,
    defaultPrevented: mods.prevented === true,
    target: mods.target ?? null,
    preventDefault(): void {
      event.defaultPrevented = true;
    },
  };
  return event;
}

/** The two DOM shapes `isTypingTarget` reads, and nothing else. */
class FakeElement {
  constructor(
    readonly tagName: string,
    private readonly prose: boolean,
  ) {}
  closest(selector: string): unknown {
    return selector === '.nb-prose' && this.prose ? this : null;
  }
}

const teardown: Array<() => void> = [];

afterEach(() => {
  while (teardown.length > 0) teardown.pop()?.();
  delete (globalThis as Record<string, unknown>)['window'];
  delete (globalThis as Record<string, unknown>)['Element'];
});

/** Install the dispatcher over a fake window; returns a `fire` function. */
function dispatcher(
  stored: Record<string, string> = { ...DEFAULT_KEYBINDINGS },
): (event: FakeKeyEvent) => void {
  const handlers: Array<(event: unknown) => void> = [];
  (globalThis as Record<string, unknown>)['window'] = {
    addEventListener: (type: string, fn: (event: unknown) => void): void => {
      if (type === 'keydown') handlers.push(fn);
    },
    removeEventListener: (type: string, fn: (event: unknown) => void): void => {
      const at = handlers.indexOf(fn);
      if (at >= 0) handlers.splice(at, 1);
    },
  };
  (globalThis as Record<string, unknown>)['Element'] = FakeElement;
  teardown.push(installShortcuts(() => stored));
  return (event) => {
    for (const handler of [...handlers]) handler(event);
  };
}

describe('installShortcuts', () => {
  it('runs the command a combination is on, once', () => {
    const fire = dispatcher();
    let ran = 0;
    teardown.push(registerCommands({ catalogue: () => (ran += 1) }));
    const event = press('a', { ctrl: true, alt: true });
    fire(event);
    expect(ran).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves a key with no live command completely alone', () => {
    const fire = dispatcher();
    // The shelf's own bare zoom keys, and a plain letter in the editor.
    for (const event of [press('+'), press('0'), press('a'), press('n', { ctrl: true })]) {
      fire(event);
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it('does not fire a command whose view has been unmounted', () => {
    const fire = dispatcher();
    let ran = 0;
    const release = registerCommands({ catalogue: () => (ran += 1) });
    fire(press('a', { ctrl: true, alt: true }));
    expect(ran).toBe(1);
    release();
    expect(commandIsLive('catalogue')).toBe(false);
    const after = press('a', { ctrl: true, alt: true });
    fire(after);
    expect(ran).toBe(1);
    expect(after.defaultPrevented).toBe(false);
  });

  it('follows the stored map, not the shipped combo', () => {
    const fire = dispatcher({ ...DEFAULT_KEYBINDINGS, catalogue: 'mod+alt+9' });
    let ran = 0;
    teardown.push(registerCommands({ catalogue: () => (ran += 1) }));
    fire(press('a', { ctrl: true, alt: true }));
    expect(ran).toBe(0);
    fire(press('9', { ctrl: true, alt: true }));
    expect(ran).toBe(1);
  });

  it('answers the extra key an action also carries, but only outside a field', () => {
    const fire = dispatcher();
    let ran = 0;
    teardown.push(registerCommands({ 'keyboard-help': () => (ran += 1) }));
    fire(press('?', { shift: true }));
    expect(ran).toBe(1);
    // Inside a page, '?' is a question mark and nothing else.
    fire(press('?', { shift: true, target: new FakeElement('DIV', true) }));
    expect(ran).toBe(1);
    // The rebindable half still works from inside the page.
    fire(press('/', { ctrl: true, target: new FakeElement('DIV', true) }));
    expect(ran).toBe(2);
  });

  it('refuses an unmodified stored combo while the reader is typing', () => {
    // A hand-edited blob, or one written by a build with a laxer rule.
    const fire = dispatcher({ ...DEFAULT_KEYBINDINGS, catalogue: 'j' });
    let ran = 0;
    teardown.push(registerCommands({ catalogue: () => (ran += 1) }));
    for (const target of [
      new FakeElement('INPUT', false),
      new FakeElement('TEXTAREA', false),
      new FakeElement('DIV', true), // inside .nb-prose
    ]) {
      const event = press('j', { target });
      fire(event);
      expect(ran).toBe(0);
      expect(event.defaultPrevented).toBe(false);
    }
    // …and still fires where there is nothing to type into.
    fire(press('j', { target: new FakeElement('DIV', false) }));
    expect(ran).toBe(1);
  });

  it('stands aside once something else has claimed the press', () => {
    const fire = dispatcher();
    let ran = 0;
    teardown.push(registerCommands({ catalogue: () => (ran += 1) }));
    fire(press('a', { ctrl: true, alt: true, prevented: true }));
    expect(ran).toBe(0);
  });

  it('ignores the auto-repeat of a held key', () => {
    const fire = dispatcher();
    let ran = 0;
    teardown.push(registerCommands({ catalogue: () => (ran += 1) }));
    fire(press('a', { ctrl: true, alt: true, repeat: true }));
    expect(ran).toBe(0);
  });

  it('runs at most one command per press', () => {
    // Two rows, one key: only possible from a stored blob, and the dispatcher
    // has to pick one rather than firing both.
    const fire = dispatcher({
      ...DEFAULT_KEYBINDINGS,
      catalogue: 'mod+alt+9',
      thumbnails: 'mod+alt+9',
    });
    const ran: string[] = [];
    teardown.push(
      registerCommands({
        catalogue: () => ran.push('catalogue'),
        thumbnails: () => ran.push('thumbnails'),
      }),
    );
    fire(press('9', { ctrl: true, alt: true }));
    expect(ran.length).toBe(1);
  });

  it('stops answering once uninstalled', () => {
    const fire = dispatcher();
    let ran = 0;
    teardown.push(registerCommands({ catalogue: () => (ran += 1) }));
    while (teardown.length > 0) teardown.pop()?.();
    fire(press('a', { ctrl: true, alt: true }));
    expect(ran).toBe(0);
  });
});

describe('registerCommands', () => {
  it('lets a remount claim an id without the old view tearing it out', () => {
    const first = registerCommands({ catalogue: () => undefined });
    let ran = 0;
    const second = registerCommands({ catalogue: () => (ran += 1) });
    first(); // the outgoing view cleans up AFTER the new one mounted
    expect(commandIsLive('catalogue')).toBe(true);
    expect(runCommand('catalogue')).toBe(true);
    expect(ran).toBe(1);
    second();
    expect(commandIsLive('catalogue')).toBe(false);
    expect(runCommand('catalogue')).toBe(false);
  });
});

/* ------------------------------ the words ---------------------------------- */

describe('bindingActionLabel', () => {
  it('says what an action does, not what its id looks like', () => {
    expect(bindingActionLabel('catalogue')).toBe(shortcutAction('catalogue')?.label);
    expect(bindingActionLabel('catalogue')).not.toBe('catalogue');
    for (const id of LISTED_ACTION_IDS) {
      expect(bindingActionLabel(id).length, `${id} reads as its own id`).toBeGreaterThan(
        id.length - 4,
      );
    }
  });
});
