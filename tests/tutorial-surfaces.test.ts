// @vitest-environment node
/**
 * tests/tutorial-surfaces.test.ts — the guided tour against a document.
 *
 * `tests/tutorial.test.ts` covers the tour's pure surfaces, and it asserts of
 * both modules below only that they are INERT without a DOM. That is a real
 * contract and worth keeping, but it is also how two reported defects walked
 * through a green suite:
 *
 *  - the taste questionnaire outlived its step. `dismiss.ts` has had the
 *    general mechanism since the first report ("close everything the incoming
 *    step does not point inside"), but `DISMISSIBLE` named five surfaces and
 *    the questionnaire was not one of them — so the tour walked on to the shelf
 *    with all five questions still up, its card over the tour's own next and
 *    skip buttons.
 *  - and BECAUSE it was up, `.nbq-scrim` — which takes pointer events, unlike
 *    the tour's own — swallowed the shelf drag the next steps ask for. The
 *    first-book step's nudge ("the shelf can wait — press write my first one")
 *    is wired correctly and could never fire, because the gesture it watches
 *    for never reached the shelf. One missing list entry, two silent steps.
 *
 * Both questions are about a document, so this file gets one:
 * `tests/support/fakeDom.ts`, which is a selector matcher and a listener list
 * rather than a DOM. Its docblock says what it is not.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  installFakeDom,
  uninstallFakeDom,
  type FakeSpec,
} from './support/fakeDom';
import { DISMISSIBLE, dismissStale, openSurfaceIds } from '../src/features/tutorial/dismiss';
import { armProbe, attachProbe, factHolds } from '../src/features/tutorial/probe';
import { TUTORIAL_STEPS, stepTargets } from '../src/features/tutorial/steps';
import { TOUR_STEP_ATTR } from '../src/features/tutorial/tourStep';

const src = (name: string): string =>
  readFileSync(join(process.cwd(), 'src/features/tutorial', name), 'utf8');

/** A step's target list, which is the only thing dismissStale is given. */
const keepFor = (id: string): string[] => {
  const step = TUTORIAL_STEPS.find((s) => s.id === id);
  if (step === undefined) throw new Error(`no step "${id}"`);
  return stepTargets(step).map((t) => t.selector);
};

/**
 * The questionnaire as it is actually rendered: a full-viewport layer, a scrim
 * that takes pointer events, and the sheet's two ways out in the top-left.
 * Class names copied from `tasteQuestionnaire.tsx`; the last test in this file
 * is what keeps that copy honest.
 */
const QUESTIONNAIRE: FakeSpec = {
  class: 'nbq-layer',
  attrs: { 'data-taste-stage': 'ask', 'data-taste-step': 'pitch' },
  rect: { x: 0, y: 0, width: 1440, height: 900 },
  children: [
    { class: 'nbq-scrim', rect: { x: 0, y: 0, width: 1440, height: 900 } },
    {
      class: 'nbq-sheet',
      rect: { x: 288, y: 192, width: 864, height: 516 },
      children: [
        {
          class: 'nbq-exits',
          children: [
            { tag: 'button', class: 'nbq-exit font-ui' },
            { tag: 'button', class: 'nbq-exit nbq-exit--quiet font-ui' },
          ],
        },
        { class: 'nbq-options', children: [{ tag: 'button', class: 'nbq-option' }] },
      ],
    },
  ],
};

/** The shelf underneath it. */
const SHELF: FakeSpec = {
  class: 'shelf-root',
  rect: { x: 0, y: 0, width: 1440, height: 900 },
  children: [
    {
      class: 'shelf-stage',
      children: [
        { tag: 'canvas', class: 'shelf-canvas', rect: { width: 1440, height: 900 } },
        { class: 'shelf-firstrun', children: [{ tag: 'button', class: 'shelf-firstrun__btn' }] },
      ],
    },
  ],
};

/** An open rail sheet, the surface the general rule was first written for. */
const CUSTOMIZE: FakeSpec = {
  class: 'nb-rail-panel',
  attrs: { 'aria-hidden': 'false', 'aria-label': 'Customize this book' },
  children: [
    { tag: 'button', class: 'nb-rail-panel-close' },
    { class: 'nb-strip-tile' },
  ],
};

afterEach(uninstallFakeDom);

/* ------------------------- putting a surface away -------------------------- */

describe('the tour puts away what its own step opened', () => {
  it('sees the questionnaire standing, and names it', () => {
    installFakeDom([SHELF, QUESTIONNAIRE]);
    // THE BUG, stated as a question about the running app: what is up?
    expect(openSurfaceIds()).toContain('taste');
  });

  it('closes it by its own way out when the next step is not about it', () => {
    const dom = installFakeDom([SHELF, QUESTIONNAIRE]);
    const quiet = dom.find('.nbq-exit--quiet');
    expect(quiet).not.toBeNull();

    // `first-book` is the step the tour walks on to, and it points at the
    // empty-case invite — nothing inside the questionnaire.
    const closed = dismissStale(keepFor('first-book'));

    expect(closed).toContain('taste');
    // Pressed, not hidden: "I'll pick later" is what keeps the answers, so the
    // step the reader walks back to offers them where they left off.
    expect(quiet!.clicks).toBe(1);
  });

  it('closes it on every step of the tour that is not the taste step itself', () => {
    for (const step of TUTORIAL_STEPS) {
      if (step.id === 'taste') continue;
      installFakeDom([SHELF, QUESTIONNAIRE]);
      const closed = dismissStale(stepTargets(step).map((t) => t.selector));
      expect(closed, `step "${step.id}" left the questionnaire up`).toContain('taste');
      uninstallFakeDom();
    }
  });

  it('still keeps a sheet the incoming step points inside', () => {
    installFakeDom([CUSTOMIZE]);
    // The whole point of the general rule: `customize-do` is ABOUT the sheet
    // `customize-open` asked for, and says so through its targets.
    expect(dismissStale(keepFor('customize-do'))).toEqual([]);
    expect(openSurfaceIds()).toEqual(['rail-panel']);
    // ...and the step after it is not, so the same sheet goes away.
    expect(dismissStale(keepFor('rail-actions'))).toEqual(['rail-panel']);
  });

  it('leaves a surface alone while it is not visible', () => {
    installFakeDom([{ ...QUESTIONNAIRE, visible: false }]);
    expect(openSurfaceIds()).toEqual([]);
    expect(dismissStale([])).toEqual([]);
  });
});

/* ------------------------- what the probe can hear ------------------------- */

describe('a shelf gesture the tour has to be able to hear', () => {
  /** One deliberate drag: press, travel well past the 34px threshold, release. */
  function drag(dom: ReturnType<typeof installFakeDom>, target: unknown): void {
    dom.fire('pointerdown', { target, clientX: 720, clientY: 500 });
    dom.fire('pointermove', { target, clientX: 640, clientY: 528, buttons: 1 });
    dom.fire('pointerup', { target });
  }

  it('hears a drag that lands on the shelf', () => {
    const dom = installFakeDom([SHELF]);
    const stop = attachProbe();
    armProbe();
    expect(factHolds('shelf-moved', 0)).toBe(false);
    drag(dom, dom.find('.shelf-canvas'));
    expect(factHolds('shelf-moved', 0)).toBe(true);
    stop();
  });

  /*
   * …and hears NOTHING through a scrim, which is the whole of defect four.
   *
   * The first-book step declares a nudge on `shelf-moved` so a reader who drags
   * the case is told the shelf can wait. It reported null after a real drag,
   * and this is why: the questionnaire was still up, `.nbq-scrim` took the
   * pointerdown, and a press that never touched the shelf is not a shelf
   * gesture by any reading. The fix is not here — it is the entry in
   * DISMISSIBLE above, which means the scrim is gone before the reader can
   * press into it. This test exists so the causal chain is written down: if
   * this ever passes, the probe has started guessing.
   */
  it('hears nothing through a scrim standing over the shelf', () => {
    const dom = installFakeDom([SHELF, QUESTIONNAIRE]);
    const stop = attachProbe();
    armProbe();
    drag(dom, dom.find('.nbq-scrim'));
    expect(factHolds('shelf-moved', 0)).toBe(false);
    stop();
  });

  it('tells a book standing in front of the case from one still in the air', () => {
    const flying: FakeSpec = { class: 'pulled-book is-live' };
    installFakeDom([{ class: 'shelf-root', children: [flying] }]);
    armProbe();
    expect(factHolds('book-pulled', 0)).toBe(false);
    uninstallFakeDom();

    const held: FakeSpec = { class: 'pulled-book is-live is-held' };
    installFakeDom([{ class: 'shelf-root', children: [held] }]);
    armProbe();
    // Out of the case, waiting for the second press — the state the tour now
    // names out loud, because nothing else in the app does.
    expect(factHolds('book-pulled', 0)).toBe(true);
    // And it is still not the book being OPEN.
    expect(factHolds('book-open', 0)).toBe(false);
  });
});

/* --------------------------- the selectors are real ------------------------ */

describe('the surfaces named in DISMISSIBLE are the ones the app renders', () => {
  /*
   * A selector is a hint, not a contract (dismiss.ts says so) — but a hint that
   * matches nothing is indistinguishable from the entry being missing, which is
   * the defect this file is about. The questionnaire is the one surface in the
   * list that this feature owns, so it is the one that can be checked against
   * the markup rather than assumed.
   */
  it('the questionnaire entry names classes tasteQuestionnaire.tsx actually writes', () => {
    const entry = DISMISSIBLE.find((d) => d.id === 'taste');
    expect(entry, 'no DISMISSIBLE entry for the taste questionnaire').toBeDefined();
    if (entry === undefined) return;
    const markup = src('tasteQuestionnaire.tsx');
    for (const selector of [entry.open, entry.close]) {
      for (const name of selector.split('.').filter((s) => s.length > 0)) {
        expect(markup, `${name} is not in the questionnaire's markup`).toContain(name);
      }
    }
  });

  it('the panel stands itself down too, off the same attribute it opens on', () => {
    const markup = src('tasteQuestionnaire.tsx');
    // Both halves of the watcher: it consults the shared verdict, and it takes
    // the reader's own way out rather than a private close.
    expect(markup).toContain('stepWatchVerdict');
    expect(markup).toContain("verdict === 'close'");
    expect(markup).toContain('TOUR_LAYER_SELECTOR');
  });

  /*
   * The other end of that contract. The overlay writes the attribute as a
   * literal in JSX (there is no readable way to spell a dynamic attribute name
   * in a template), so this is where the literal and the constant meet.
   */
  it('the overlay writes the attribute the panel reads', () => {
    expect(src('TutorialOverlay.tsx')).toContain(`${TOUR_STEP_ATTR}={step().id}`);
    expect(src('TutorialOverlay.tsx')).toContain('class="nbt-layer"');
  });
});
