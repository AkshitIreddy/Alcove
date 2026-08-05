// @vitest-environment node
/**
 * tests/panel-keys.test.ts — a guard with one caller is not a guard.
 *
 * `ShelfWorld` binds arrows / Home / Enter on `document` and stands down while
 * a panel is out, by reading `data-nb-panel="open"` off <html>. That flag used
 * to be written in exactly one place — `claimPanelPush`, the call that reserves
 * LAYOUT room — and `claimPanelPush` had exactly one caller, `RailPanel`. So
 * the guard covered the sheets that slide the world sideways and nothing else,
 * while the comment above it claimed it covered "the trash, the TOC and
 * everything added later".
 *
 * It did not. `scripts/probe-panel-keys.mjs` opened seven surfaces against the
 * running app, pressed ArrowDown at each and read the shelf's own selection
 * back off the live world: the trash drawer, the templates gallery, the
 * settings sheet and the cheat sheet all walked the selection halo down the
 * case behind them.
 *
 * So this file gates the rule instead of the instance:
 *
 *   **every `role="dialog"` root in `src/` claims the panel keyboard.**
 *
 * The one exemption is written into the markup rather than into a list here:
 * `aria-modal="false"` is a dialog SAYING it does not own the app while it is
 * up, and the tour card means it — it points at live UI and the reader is
 * supposed to keep using the app underneath. A dialog that wants out of this
 * rule has to make that claim to screen readers too.
 *
 * WHAT IT CAN AND CANNOT SEE. It reads JSX source line by line and pairs a
 * `role="dialog"` with the tag it sits in by walking back to the `<` and
 * forward to the `>`. It cannot see a role applied through a spread or by
 * `setAttribute`; neither appears in this tree, and if one does the fix is to
 * widen this file, not to work around it. `role="menu"` is deliberately not
 * covered: the menus in this app are transient popovers that stop their own
 * keys in the capture phase (`ShelfMenu`), and most of them are nested inside a
 * panel that has already claimed.
 *
 * AND THE HALF THAT WAS ITSELF ASLEEP. `claimsTheKeyboard` used to be
 * `/\busePanelKeys\s*\(/` over the raw file — a token grep, which proves the
 * wiring was once WRITTEN and not that it still runs. Comment out the one call
 * in `CheatSheet.tsx`:
 *
 *     // usePanelKeys();
 *     void 0;
 *
 * and the card that lists the keyboard shortcuts goes back to letting arrows
 * walk the shelf behind it — while this file, and the other 2,744 tests, stay
 * green, because the commented-out line still contains the token. So the source
 * is comment-stripped and the claim has to be a CALL AT STATEMENT POSITION:
 * indented, first thing on its line, i.e. a hook invoked in a body rather than
 * a name mentioned in prose, in a keyword array or in an import. The detector
 * has its own gate below — `the detector needs the call, not the word` re-applies
 * that exact mutation in memory and fails if it is not caught, because a
 * detector nobody has watched go red is the same defect with more lines.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoot } from 'solid-js';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(full));
    else if (extname(entry.name) === '.tsx') out.push(full);
  }
  return out;
}

/**
 * Every opening tag in `source` that carries `role="dialog"`, as source text.
 *
 * The whole tag, not the matching line: an `aria-modal="false"` two elements
 * further down must never be read as this element's own disclaimer.
 */
function dialogTags(source: string): string[] {
  const lines = source.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/\brole="dialog"/.test(lines[i] as string)) continue;
    let start = i;
    while (start > 0 && !/<[A-Za-z]/.test(lines[start] as string)) start -= 1;
    let end = i;
    while (end < lines.length - 1 && !/>\s*$/.test(lines[end] as string)) end += 1;
    out.push(lines.slice(start, end + 1).join('\n'));
  }
  return out;
}

/**
 * Comments blanked, LINE BY LINE so nothing else moves.
 *
 * Whitespace rather than deletion, and the block form keeps its newlines, so a
 * position in the stripped text is the same position in the file — which is
 * what lets `claimsTheKeyboard` below insist on a line-leading call.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^([ \t]*)\/\/[^\n]*$/gm, (_m, indent: string) => indent);
}

/**
 * A panel says the keys are its own with the hook, or via RailPanel's push —
 * and it has to SAY it, in code that runs.
 *
 * The claim must be a call at statement position: comments gone, indented (so
 * it is inside a body rather than at module scope), and the first thing on its
 * line. That last part is the whole difference between this and the token grep
 * it replaces — `usePanelKeys` appearing in an import, in a docblock, in a
 * `keywords: [...]` array or halfway along a line of prose is a mention, and a
 * mention has never stopped a single arrow key.
 *
 * All eleven claiming dialogs match on one line each today, at brace depth 1
 * (RailPanel's is 3, inside its mount effect), every one of them above its own
 * markup. `void ` is allowed in front because it is how this codebase spells
 * "yes, deliberately ignoring the return".
 */
const CLAIM = /^[ \t]+(?:void\s+)?(?:usePanelKeys|claimPanelPush)\s*\(/m;

function claimsTheKeyboard(source: string): boolean {
  return CLAIM.test(stripComments(source));
}

describe('every dialog claims the keyboard', () => {
  const files = tsxFiles(SRC);

  it('finds the dialogs at all (the scan is not silently matching nothing)', () => {
    const withDialogs = files.filter((f) => dialogTags(readFileSync(f, 'utf8')).length > 0);
    // Twelve on the day this was written. The floor is what matters: a regex
    // that stopped matching would otherwise pass this whole file green.
    expect(withDialogs.length).toBeGreaterThanOrEqual(10);
  });

  it('no dialog drives the shelf behind it', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const tags = dialogTags(source);
      if (tags.length === 0) continue;
      // A dialog that tells screen readers it is not modal is telling the
      // keyboard the same thing — the tour card is pinned over live UI.
      const owning = tags.filter((tag) => !/aria-modal="false"/.test(tag));
      if (owning.length === 0) continue;
      if (claimsTheKeyboard(source)) continue;
      offenders.push(relative(ROOT, file).replaceAll('\\', '/'));
    }
    expect(
      offenders,
      'these render role="dialog" but never claim the panel keyboard — ' +
        'add usePanelKeys() from src/state/panelKeys.ts, or mark the dialog ' +
        'aria-modal="false" if it really means to leave the app driveable',
    ).toEqual([]);
  });

  /**
   * GATE ALIVE, in the sense CLAUDE.md means it: break the thing on purpose and
   * watch the check go red.
   *
   * Everything above this point is a scan that reports an empty list, and an
   * empty list is what a scan matching nothing also reports. The test two above
   * guards the FIND half (twelve dialogs are located); this guards the JUDGE
   * half, by taking a real claiming file and applying the two mutations that
   * actually happen to one — the call commented out while somebody debugs, and
   * the call deleted with the import left behind — and requiring both to be
   * seen as what they are.
   *
   * The old detector passed the first of these. That is not hypothetical: it is
   * the mutation this file was rewritten for.
   */
  it('the detector needs the call, not the word', () => {
    // Any real claiming dialog will do, chosen by shape rather than by name so
    // that renaming or re-shaping one panel cannot quietly retire this gate.
    const CALL_LINE = /^([ \t]*)((?:usePanelKeys|claimPanelPush)\([^\n]*)$/m;
    const subject = files
      .map((file) => [file, readFileSync(file, 'utf8')] as const)
      .find(
        ([, source]) =>
          dialogTags(source).length > 0 &&
          // Exactly one, or commenting it out would leave a second claim behind
          // and the mutation below would prove nothing.
          (source.match(new RegExp(CALL_LINE.source, 'gm')) ?? []).length === 1,
      );
    expect(subject, 'no dialog claims on a line of its own any more').toBeDefined();
    const [file, source] = subject as readonly [string, string];
    const name = relative(ROOT, file).replaceAll('\\', '/');
    expect(claimsTheKeyboard(source), `${name} has stopped claiming at all`).toBe(true);

    // 1. The call commented out — a debugging line somebody forgot to put back.
    //    This is the one the old token grep passed.
    const commentedOut = source.replace(CALL_LINE, '$1// $2');
    expect(commentedOut, 'the mutation did not apply').not.toBe(source);
    expect(
      claimsTheKeyboard(commentedOut),
      `a commented-out claim in ${name} counts as a claim — the detector is a token grep again`,
    ).toBe(false);

    // 2. The call deleted. The import stays behind, and must not vouch for it.
    const deleted = source.replace(CALL_LINE, '$1void 0;');
    expect(deleted).toMatch(/import \{[^}]*(?:usePanelKeys|claimPanelPush)/);
    expect(
      claimsTheKeyboard(deleted),
      `the import alone counts as a claim in ${name}`,
    ).toBe(false);
  });

  it('the tour card is the exemption, and it is the only one', () => {
    const exempt = files
      .filter((file) => {
        const tags = dialogTags(readFileSync(file, 'utf8'));
        return tags.length > 0 && tags.every((tag) => /aria-modal="false"/.test(tag));
      })
      .map((file) => relative(ROOT, file).replaceAll('\\', '/'));
    expect(exempt).toEqual(['src/features/tutorial/TutorialOverlay.tsx']);
  });
});

describe('the wiring the rule rests on', () => {
  it('the shelf asks panelKeys rather than reading the attribute itself', () => {
    const world = readFileSync(join(SRC, 'features/bookshelf/world.ts'), 'utf8');
    expect(world).toMatch(/panelOwnsKeyboard\(\)/);
    // The raw read is what made the flag look like panelPush's private
    // business. One reader, so there is one place to widen.
    expect(world).not.toMatch(/dataset\[?'?nbPanel/);
  });

  it('claiming push also claims the keyboard, so RailPanel needs no second call', () => {
    const push = readFileSync(join(SRC, 'views/rail/panelPush.ts'), 'utf8');
    expect(push).toMatch(/claimPanelKeys\(key\)/);
    expect(push).toMatch(/releasePanelKeys\(key\)/);
    // Displacing the world and owning the keyboard are different questions;
    // the flag must not go back to being a side effect of the layout tween.
    expect(push).not.toMatch(/dataset\.nbPanel/);
  });
});

/* -------------------------------------------------------------------------- */
/* The store itself. `document` is stubbed rather than jsdom'd — the module    */
/* touches exactly one thing, `documentElement.dataset`, and jsdom is not      */
/* installed (see vitest.config.ts).                                          */
/* -------------------------------------------------------------------------- */

interface FakeDoc {
  documentElement: { dataset: Record<string, string> };
}

function withFakeDocument<T>(run: (doc: FakeDoc) => T): T {
  const globals = globalThis as { document?: unknown };
  const had = 'document' in globals;
  const previous = globals.document;
  const doc: FakeDoc = { documentElement: { dataset: {} } };
  globals.document = doc;
  try {
    return run(doc);
  } finally {
    if (had) globals.document = previous;
    else delete globals.document;
  }
}

describe('state/panelKeys', () => {
  afterEach(async () => {
    const mod = await import('../src/state/panelKeys');
    withFakeDocument(() => mod.__resetPanelKeys());
  });

  it('flags <html> while a panel is out and clears it after the last one', async () => {
    const { claimPanelKeys, releasePanelKeys, panelOwnsKeyboard } = await import(
      '../src/state/panelKeys'
    );
    withFakeDocument((doc) => {
      expect(panelOwnsKeyboard()).toBe(false);
      claimPanelKeys('trash');
      expect(doc.documentElement.dataset['nbPanel']).toBe('open');
      expect(panelOwnsKeyboard()).toBe(true);
      releasePanelKeys('trash');
      expect(doc.documentElement.dataset['nbPanel']).toBeUndefined();
      expect(panelOwnsKeyboard()).toBe(false);
    });
  });

  it('survives an overlap — swapping sheets claims before it releases', async () => {
    const { claimPanelKeys, releasePanelKeys, panelOwnsKeyboard } = await import(
      '../src/state/panelKeys'
    );
    withFakeDocument(() => {
      claimPanelKeys('studio');
      // The incoming sheet claims while the outgoing one is still sliding.
      claimPanelKeys('trash');
      releasePanelKeys('studio');
      // A boolean would have gone false here and handed the shelf a frame of
      // arrows it had no business answering.
      expect(panelOwnsKeyboard()).toBe(true);
      releasePanelKeys('trash');
      expect(panelOwnsKeyboard()).toBe(false);
    });
  });

  it('ignores a release for a key that never claimed', async () => {
    const { claimPanelKeys, releasePanelKeys, panelOwnsKeyboard } = await import(
      '../src/state/panelKeys'
    );
    withFakeDocument(() => {
      claimPanelKeys('trash');
      releasePanelKeys('never-opened');
      expect(panelOwnsKeyboard()).toBe(true);
    });
  });

  it('usePanelKeys holds from mount to unmount', async () => {
    const { usePanelKeys, panelOwnsKeyboard } = await import('../src/state/panelKeys');
    withFakeDocument(() => {
      const dispose = createRoot((d) => {
        usePanelKeys();
        return d;
      });
      expect(panelOwnsKeyboard()).toBe(true);
      // Leaving a scene unmounts a panel without ever closing it — the trash
      // drawer goes with the shelf the moment a book opens.
      dispose();
      expect(panelOwnsKeyboard()).toBe(false);
    });
  });

  it('usePanelKeys(open) follows a sheet that stays mounted while closed', async () => {
    const { usePanelKeys, panelOwnsKeyboard } = await import('../src/state/panelKeys');
    const { createSignal } = await import('solid-js');
    withFakeDocument(() => {
      const [open, setOpen] = createSignal(false);
      const dispose = createRoot((d) => {
        usePanelKeys(open);
        return d;
      });
      // The settings sheet latches: mounted from the first visit to the gear
      // and parked off screen after that. A bare claim would have silenced the
      // shelf's arrows for the rest of the session.
      expect(panelOwnsKeyboard()).toBe(false);
      setOpen(true);
      expect(panelOwnsKeyboard()).toBe(true);
      setOpen(false);
      expect(panelOwnsKeyboard()).toBe(false);
      dispose();
    });
  });
});
