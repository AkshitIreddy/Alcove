/**
 * src/data/keybindings.ts — the app's whole keyboard, in one place.
 *
 * Three things live here and they are deliberately one module:
 *
 *   1. THE GRAMMAR — `matchesBinding` / `formatBinding` / `ariaKeyshortcuts`.
 *      '+'-joined, modifiers in any order, key last; 'mod' is Ctrl on
 *      Windows/Linux and Cmd on macOS.
 *   2. THE REGISTRY — `SHORTCUT_ACTIONS`: every key this app answers to, what
 *      it does, and which room of the app it belongs to. `DEFAULT_KEYBINDINGS`,
 *      the settings sheet's row order, the cheat sheet's columns and the
 *      "which of these cannot move" list are all DERIVED from it, so a new
 *      shortcut is one entry rather than four edits that drift apart.
 *   3. THE DISPATCHER — one `keydown` listener (`installShortcuts`) over a
 *      command bus (`registerCommands`). A feature says what a command DOES;
 *      it never says which key runs it.
 *
 * Why the three are together: the settings sheet renders the registry as the
 * app's shortcut list, so every combo in it is a promise to the reader, and
 * the only way to keep that promise is for the same table to decide what the
 * list says AND what a KeyboardEvent runs. (They had already drifted twice:
 * `export-script` advertised mod+shift+e while App.tsx used that combo for the
 * library export, and F9 / '?' / the shelf's +,−,0 fired for a year without
 * ever appearing in the list.)
 *
 * WHAT THIS MODULE MUST NOT IMPORT. Nothing. It is loaded by node tests and by
 * `data/settings.ts` (which it must not import back), so it touches no store,
 * no DOM at module scope, and reaches the stored map only through the reader
 * function `installShortcuts` is handed.
 *
 * THE HOUSE KEY IS Ctrl+Alt. Every command this app added for itself sits on
 * mod+alt, which is the one modifier pair neither the editor nor the webview
 * has claimed: TipTap owns mod+letter (bold, italic, code, the link tray) and
 * mod+shift+letter, and takes only mod+alt+1…6 and mod+alt+c for itself. The
 * two combos that were already here — mod+alt+i / mod+alt+e for the script
 * pair — set that precedent; everything below follows it rather than inventing
 * a second convention beside it.
 */

/** True when `event` is exactly the combo `binding` describes. */
export function matchesBinding(event: KeyboardEvent, binding: string): boolean {
  const parts = binding.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  if (event.key.toLowerCase() !== key) return false;
  const wantMod = parts.includes('mod');
  const wantShift = parts.includes('shift');
  const wantAlt = parts.includes('alt');
  // Exact match on every modifier: Ctrl+Shift+E must not fire on Ctrl+E.
  if (wantMod !== (event.ctrlKey || event.metaKey)) return false;
  if (wantShift !== event.shiftKey) return false;
  if (wantAlt !== event.altKey) return false;
  return true;
}

/**
 * A binding as the user's platform names it ("Ctrl+Shift+E"), for kbd chips
 * and `aria-keyshortcuts`. `aria-keyshortcuts` wants "Control", not "Ctrl",
 * so that spelling is a separate function rather than a find-and-replace at
 * the call site.
 */
export function formatBinding(binding: string): string {
  return binding
    .split('+')
    .map((part) => (part === 'mod' ? modLabel() : capitalize(part)))
    .join('+');
}

/** The same combo in the spelling `aria-keyshortcuts` requires. */
export function ariaKeyshortcuts(binding: string): string {
  return binding
    .split('+')
    .map((part) => (part === 'mod' ? (isApple() ? 'Meta' : 'Control') : capitalize(part)))
    .join('+');
}

function capitalize(part: string): string {
  return part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1);
}

function isApple(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /mac|iphone|ipad/i.test(navigator.userAgent);
}

function modLabel(): string {
  return isApple() ? 'Cmd' : 'Ctrl';
}

// ---------------------------------------------------------------------------
// The registry
//
// Groups first, because the order of THIS array is the order the cheat sheet
// draws its columns and the settings sheet draws its headings. A longer list
// only stays readable if it is sorted by where the reader is standing when
// they want it, not alphabetically by the name we happened to give it.
// ---------------------------------------------------------------------------

export type ShortcutGroupId = 'around' | 'shelf' | 'book' | 'writing' | 'library';

export interface ShortcutGroup {
  readonly id: ShortcutGroupId;
  readonly title: string;
  /** Where these work, said in the app's voice. */
  readonly blurb: string;
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  { id: 'around', title: 'Finding your way', blurb: 'anywhere in the app' },
  { id: 'shelf', title: 'On the shelf', blurb: 'while the bookcase is in front of you' },
  { id: 'book', title: 'In a book', blurb: 'while a book is open' },
  { id: 'writing', title: 'While writing', blurb: 'with the pen on the page' },
  { id: 'library', title: 'The whole library', blurb: 'scripts, bundles, files' },
];

interface ShortcutCommon {
  /** Stable id: the key in `settings.keybindings` and on the command bus. */
  readonly id: string;
  /** What it does, in the app's voice — this is the row text everywhere. */
  readonly label: string;
  readonly group: ShortcutGroupId;
}

/**
 * A key the reader may move. Lives in `settings.keybindings`, gets a row in
 * the settings sheet that captures a new combination, and runs through the
 * command bus below.
 */
interface BindingAction extends ShortcutCommon {
  readonly kind: 'binding';
  /** The shipped combination, in the storage grammar. */
  readonly binding: string;
  /**
   * Extra literal `event.key` values the same command also answers to, which
   * the reader canNOT move — '?' for the cheat sheet is the only one so far.
   * They never enter the stored map (nothing there could describe "the key
   * that types a question mark" without also claiming shift+7 on a German
   * keyboard), so they are drawn beside the combo and honoured only when the
   * reader is not typing.
   */
  readonly also?: readonly string[];
  /** An id the map carries that NO handler performs — see UNHANDLED below. */
  readonly handled?: false;
}

/**
 * A key that is listed and explained but stays where it is, with the reason
 * in words. The row still answers when pressed — saying "this one is fixed"
 * out loud beats a dead button.
 */
interface FixedAction extends ShortcutCommon {
  readonly kind: 'fixed';
  readonly binding: string;
  /** Why it cannot move. TypeScript refuses a fixed row without one. */
  readonly reason: string;
}

/**
 * A key or gesture the app has always honoured somewhere deep in a view, and
 * which is not a rebindable command: the shelf's bare +,−,0, the arrows that
 * walk the case, dragging a page edge. These appear in the CHEAT SHEET only —
 * they are not rows in the picker, because a picker row that cannot be picked
 * is furniture. `keys` is a phrase to draw, not a combo to parse.
 */
interface HouseAction extends ShortcutCommon {
  readonly kind: 'house';
  readonly keys: string;
}

export type ShortcutAction = BindingAction | FixedAction | HouseAction;

/**
 * Every key the app answers to.
 *
 * Read it as five rooms. Adding a shortcut means adding one line here and
 * registering a command for its id wherever the thing actually happens —
 * nothing else, and in particular nothing in the cheat sheet or the settings
 * sheet, both of which are generated from this array.
 */
export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  /* ------------------------------ finding your way ---------------------- */
  {
    kind: 'binding',
    id: 'command-palette',
    group: 'around',
    binding: 'mod+k',
    label: 'jump to a book, a heading or a page',
  },
  {
    kind: 'binding',
    id: 'search-text',
    group: 'around',
    binding: 'mod+shift+f',
    label: 'search the words inside every page',
  },
  {
    kind: 'binding',
    id: 'open-settings',
    group: 'around',
    binding: 'mod+,',
    label: 'open the settings sheet',
  },
  {
    kind: 'binding',
    id: 'keyboard-help',
    group: 'around',
    binding: 'mod+/',
    also: ['?'],
    label: 'this list of spells',
  },
  {
    // Lives in "anywhere" rather than in "on the shelf" because BOTH scenes
    // register it: the gallery makes a new book from the shelf and adds its
    // pages to the open book from inside one, and a reader should not have to
    // remember which of the two they are standing in.
    kind: 'binding',
    id: 'templates',
    group: 'around',
    binding: 'mod+alt+g',
    label: 'start from a template — the gallery of five',
  },
  {
    kind: 'fixed',
    id: 'zoom-to-shelf',
    group: 'around',
    binding: 'escape',
    label: 'step back out of a book',
    reason:
      'Escape is how you step back out of a book, and how every panel and dialog here closes. One key doing one thing everywhere is worth more than this row being adjustable, so it stays.',
  },

  /* -------------------------------- on the shelf ------------------------ */
  {
    kind: 'binding',
    id: 'new-book',
    group: 'shelf',
    binding: 'mod+alt+n',
    label: 'put a new book on the shelf',
  },
  {
    kind: 'binding',
    id: 'library-studio',
    group: 'shelf',
    binding: 'mod+alt+s',
    label: 'the studio — room, wall and carpentry',
  },
  {
    kind: 'binding',
    id: 'add-floor',
    group: 'shelf',
    binding: 'mod+alt+f',
    label: 'grow the case downward by a floor',
  },
  {
    kind: 'binding',
    id: 'open-trash',
    group: 'shelf',
    binding: 'mod+alt+x',
    label: 'the crumpled books',
  },
  {
    kind: 'house',
    id: 'shelf-zoom',
    group: 'shelf',
    keys: '+  −  0',
    label: 'zoom in, zoom out, back to 100%',
  },
  {
    kind: 'house',
    id: 'shelf-walk',
    group: 'shelf',
    keys: '← ↑ ↓ →',
    label: 'walk the shelf, book by book',
  },
  {
    kind: 'house',
    id: 'shelf-take',
    group: 'shelf',
    keys: 'Enter',
    label: 'take the lit book off the shelf',
  },
  {
    kind: 'house',
    id: 'shelf-home',
    group: 'shelf',
    keys: 'Home',
    label: 'back to the very first book',
  },

  /* --------------------------------- in a book -------------------------- */
  {
    kind: 'binding',
    id: 'new-page',
    group: 'book',
    binding: 'mod+n',
    label: 'add a page after this one',
  },
  {
    kind: 'binding',
    id: 'toggle-bookmark',
    group: 'book',
    binding: 'mod+alt+b',
    label: 'tuck a ribbon into this page',
  },
  {
    kind: 'binding',
    id: 'toggle-focus',
    group: 'book',
    binding: 'f9',
    label: 'focus mode — just you and the paper',
  },
  {
    kind: 'binding',
    id: 'table-of-contents',
    group: 'book',
    binding: 'mod+alt+t',
    label: 'the table of contents',
  },
  {
    kind: 'binding',
    id: 'catalogue',
    group: 'book',
    binding: 'mod+alt+a',
    label: 'the catalogue — everything you can add',
  },
  {
    kind: 'binding',
    id: 'page-style',
    group: 'book',
    binding: 'mod+alt+l',
    label: 'ruled, grid, dotted or blank',
  },
  {
    kind: 'binding',
    id: 'customize-book',
    group: 'book',
    binding: 'mod+alt+d',
    label: 'dress this book — cover, ribbon, paper',
  },
  {
    kind: 'binding',
    id: 'thumbnails',
    group: 'book',
    binding: 'mod+alt+m',
    label: 'the strip of little pages',
  },
  /*
   * There is no `←  →` row here, and its absence is the decision rather than a
   * gap. The arrows used to turn the page unless the caret sat in the paper —
   * so the honest row would have read "turn the page, except while typing",
   * and a line in the reader's shortcut list that has to be qualified is a
   * promise this module cannot keep. An arrow belongs to the text before it
   * belongs to the book. Turning is `page-curl` and `page-corner` below, which
   * answer in every focus state; `table-of-contents` and `thumbnails` above are
   * the keyboard's way to a page. See src/views/spread.ts for the ruling.
   */
  {
    kind: 'house',
    id: 'focus-range',
    group: 'book',
    keys: '[  ]',
    label: 'step the focus in and out again',
  },
  {
    kind: 'house',
    id: 'focus-zoom',
    group: 'book',
    keys: 'Ctrl +  −  0',
    label: 'zoom the paper while focused',
  },
  {
    kind: 'house',
    id: 'page-curl',
    group: 'book',
    keys: 'drag a page edge',
    label: 'curl a page by hand',
  },
  {
    kind: 'house',
    id: 'page-corner',
    group: 'book',
    keys: 'click the curl',
    label: 'flip forward from the corner',
  },

  /* ------------------------------- while writing ------------------------ */
  {
    kind: 'house',
    id: 'slash-menu',
    group: 'writing',
    keys: '/',
    label: 'the block & sticker menu',
  },
  {
    kind: 'house',
    id: 'today-page',
    group: 'writing',
    keys: '/today',
    label: "today's journal page",
  },
  {
    kind: 'house',
    id: 'ink-weight',
    group: 'writing',
    keys: 'Ctrl+B / Ctrl+I',
    label: 'bold / italic ink',
  },
  {
    kind: 'house',
    id: 'block-menu',
    group: 'writing',
    keys: 'right-click',
    label: 'turn into, washes, colours…',
  },
  {
    kind: 'house',
    id: 'reorder-lines',
    group: 'writing',
    keys: 'drag the dots',
    label: 'reorder lines',
  },
  {
    kind: 'house',
    id: 'fresh-line',
    group: 'writing',
    keys: 'click bare paper',
    label: 'start a fresh line right there',
  },

  /* ----------------------------- the whole library ---------------------- */
  {
    kind: 'binding',
    id: 'insert-script',
    group: 'library',
    binding: 'mod+alt+i',
    label: 'paste Notebook Script into this page',
  },
  {
    kind: 'binding',
    id: 'export-script',
    group: 'library',
    binding: 'mod+alt+e',
    label: 'copy this page out as script',
  },
  {
    kind: 'binding',
    id: 'export-library',
    group: 'library',
    binding: 'mod+shift+e',
    label: 'pack books into one file',
  },
  {
    kind: 'binding',
    id: 'import-library',
    group: 'library',
    binding: 'mod+shift+i',
    label: 'add a bundle to this shelf',
  },
  /*
   * The three page/file flows that shipped with no key and no button at all.
   *
   * `mod+alt+p` is the PDF; the picture is the SAME act in a different wrapper,
   * so it is that combination plus Shift rather than a fourth letter picked
   * because it was still free. Markdown gets `mod+shift+alt+m` for its own
   * initial — `mod+alt+m` is the thumbnail strip and `mod+alt+i` is "insert
   * script", so neither of the obvious two was available.
   *
   * Spelled in canonical order (mod, shift, alt — `canonicalBinding`), or the
   * sheet would read a shipped default as a rebind the moment it loaded.
   */
  {
    kind: 'binding',
    id: 'export-pdf',
    group: 'library',
    binding: 'mod+alt+p',
    label: 'export as PDF — this page or the whole book',
  },
  {
    kind: 'binding',
    id: 'export-png',
    group: 'library',
    binding: 'mod+shift+alt+p',
    label: 'save this page as a picture',
  },
  {
    kind: 'binding',
    id: 'import-markdown',
    group: 'library',
    binding: 'mod+shift+alt+m',
    label: 'turn Markdown files into books',
  },
  /*
   * Still here, still performed by nobody.
   *
   * `handwritingEnabled` — the flag this would flip — is read by no code at
   * all outside the settings merge. It stays in the stored map (churning a
   * reader's blob to delete one dead key buys nothing) and out of both the
   * sheet and the cheat sheet, and it reserves no combination: a key nothing
   * listens for is a free key. Wiring it back is two edits and both are here:
   * register a command for the id, and drop `handled: false`.
   */
  {
    kind: 'binding',
    id: 'toggle-handwriting',
    group: 'writing',
    binding: 'mod+shift+h',
    label: 'handwriting on the page',
    handled: false,
  },
];

/** Everything that owns a row in `settings.keybindings`. */
const KEYED_ACTIONS: readonly (BindingAction | FixedAction)[] = SHORTCUT_ACTIONS.filter(
  (action): action is BindingAction | FixedAction => action.kind !== 'house',
);

/**
 * Every combo the settings sheet advertises, and the only place they are
 * chosen — derived, so the list and the dispatcher cannot disagree.
 */
export const DEFAULT_KEYBINDINGS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(KEYED_ACTIONS.map((action) => [action.id, action.binding])),
);

/** Action ids the map carries that no handler in the app performs. */
export const UNHANDLED_ACTION_IDS: ReadonlySet<string> = new Set(
  KEYED_ACTIONS.filter((action) => action.kind === 'binding' && action.handled === false).map(
    (action) => action.id,
  ),
);

/** Why each fixed row stays where it is, by action id. */
export const FIXED_BINDING_REASONS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    KEYED_ACTIONS.filter((action): action is FixedAction => action.kind === 'fixed').map(
      (action) => [action.id, action.reason],
    ),
  ),
);

/** The row order for both surfaces: registry order, which is room order. */
export const LISTED_ACTION_IDS: readonly string[] = KEYED_ACTIONS.filter(
  (action) => !UNHANDLED_ACTION_IDS.has(action.id),
).map((action) => action.id);

const BY_ID: ReadonlyMap<string, ShortcutAction> = new Map(
  SHORTCUT_ACTIONS.map((action) => [action.id, action]),
);

/** The registry entry for an id, or null for an id only a stored blob knows. */
export function shortcutAction(id: string): ShortcutAction | null {
  return BY_ID.get(id) ?? null;
}

/** What an action does, for a row label. Unknown ids fall back to their id. */
export function bindingActionLabel(id: string): string {
  return BY_ID.get(id)?.label ?? id.replace(/-/g, ' ');
}

/** Every action in a group, in registry order. */
export function actionsInGroup(group: ShortcutGroupId): readonly ShortcutAction[] {
  return SHORTCUT_ACTIONS.filter((action) => action.group === group);
}

/** The combo an action is on: what the reader stored, else what ships. */
export function bindingFor(id: string, stored: Readonly<Record<string, string>>): string {
  return stored[id] ?? DEFAULT_KEYBINDINGS[id] ?? '';
}

// ---------------------------------------------------------------------------
// Refusing to shadow typing
//
// The rebinding UI already turns down a bare letter, because it "would just
// type into the page". The DISPATCHER has to hold the same line from the other
// side: a stored blob can be hand-edited, an older build may have written a
// combination a newer rule would refuse, and either way the reader must be
// able to type the alphabet. So a combination with no mod and no alt only ever
// fires when the caret is nowhere that takes text.
// ---------------------------------------------------------------------------

/** F1–F12 are the only keys that carry a shortcut with no modifier at all. */
const FUNCTION_KEY = /^f([1-9]|1[0-2])$/;

/** True when this combo is safe to fire with the caret in a page. */
export function survivesTyping(binding: string): boolean {
  const parts = binding.toLowerCase().split('+');
  const key = parts[parts.length - 1] ?? '';
  return parts.includes('mod') || parts.includes('alt') || FUNCTION_KEY.test(key);
}

/**
 * True when the keyboard is currently pointed at something that takes text.
 *
 * `.nb-prose` is checked as an ancestor because ProseMirror moves focus onto
 * inner nodes (a table cell, a code block) whose own `isContentEditable` is
 * the only other thing that would have caught it.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  if (target.closest('.nb-prose') !== null) return true;
  if (typeof HTMLElement !== 'undefined' && target instanceof HTMLElement) {
    if (target.isContentEditable) return true;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

// ---------------------------------------------------------------------------
// The command bus
//
// A feature says what a command DOES and never which key runs it. That is the
// whole reason a shortcut can be rebound at all — and it is also what keeps a
// shortcut from firing into a room the reader is not in: BookView registers
// its commands on mount and drops them on cleanup, so "table of contents" is
// simply not a live command while the shelf is on screen, and the key falls
// through to whatever else wanted it.
// ---------------------------------------------------------------------------

type Command = () => void;

const commands = new Map<string, Command>();

/**
 * Claim a batch of command ids. Returns the release function — call it from
 * `onCleanup`, always: a command left registered by an unmounted view runs
 * closures over dead signals.
 *
 * Releasing only removes entries that are still the ones this call put there,
 * so a view remounting before its predecessor cleans up (Solid does this on
 * HMR) cannot tear out the live registration.
 */
export function registerCommands(map: Readonly<Record<string, Command>>): () => void {
  const claimed = Object.entries(map);
  for (const [id, run] of claimed) commands.set(id, run);
  return () => {
    for (const [id, run] of claimed) {
      if (commands.get(id) === run) commands.delete(id);
    }
  };
}

/** Run a command by id. False when nothing on screen performs it. */
export function runCommand(id: string): boolean {
  const run = commands.get(id);
  if (run === undefined) return false;
  run();
  return true;
}

/** Is anything on screen performing this id right now? */
export function commandIsLive(id: string): boolean {
  return commands.has(id);
}

/** Every id with a live command — QA probes assert on this. */
export function liveCommandIds(): string[] {
  return [...commands.keys()].sort();
}

/**
 * True when `event` is one of the unrebindable extra keys for an action —
 * '?' for the cheat sheet. Shift is allowed (it is how '?' is produced at
 * all); Ctrl, Cmd and Alt are not, so Ctrl+? stays free for anything else.
 */
function matchesAlso(event: KeyboardEvent, also: readonly string[]): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return also.includes(event.key);
}

/**
 * Install THE keyboard listener.
 *
 * One listener for the whole app, on `window`, in the bubble phase — after
 * the editor, so a combination ProseMirror wanted (and consumed) never
 * reaches a command, and after every panel's own Escape. `readBindings`
 * supplies the reader's stored map; this module cannot import the settings
 * store without a cycle, and being handed the map is also what lets a test
 * drive the dispatcher with no store at all.
 *
 * A key with no live command is left completely alone — no preventDefault, no
 * swallow. That matters more than it looks: it is why the shelf's own bare
 * +/−/0 and the editor's letters still work with this listener installed.
 */
export function installShortcuts(
  readBindings: () => Readonly<Record<string, string>>,
): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    // `repeat` guard: half of these are toggles, and a held key that opens and
    // closes the catalogue thirty times a second is not a feature.
    if (event.defaultPrevented || event.repeat || commands.size === 0) return;
    const typing = isTypingTarget(event.target);
    const stored = readBindings();
    for (const action of KEYED_ACTIONS) {
      if (!commands.has(action.id)) continue;
      const combo = stored[action.id] ?? action.binding;
      const hit =
        (matchesBinding(event, combo) && (!typing || survivesTyping(combo))) ||
        (!typing && action.kind === 'binding' && action.also !== undefined
          ? matchesAlso(event, action.also)
          : false);
      if (!hit) continue;
      event.preventDefault();
      runCommand(action.id);
      return;
    }
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
