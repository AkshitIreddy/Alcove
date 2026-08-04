/**
 * src/features/tutorial/tourStep.ts — the contract between the tour's overlay
 * and a panel that rides on one of its steps.
 *
 * The overlay writes its current step id onto its own layer as
 * `data-tutorial-step`. `./tasteQuestionnaire.tsx` reads that attribute and
 * nothing else: no import in either direction, so the step list and the panel
 * can each be rewritten without touching the other (the same outside-in rule
 * `./probe.ts` watches the app by). The cost of that independence is that the
 * contract lives in a string, which is why it lives HERE — one place, DOM-free,
 * so `tests/tutorial.test.ts` can pin it and both sides can be tested against
 * it rather than against each other.
 *
 * THE REPORTED BUG, and the whole reason this file exists: the panel polled the
 * attribute to OPEN itself and never to close. Reach the taste step, answer one
 * question, press next — and the tour walked on to the shelf while all five
 * questions stayed up, its card over the tour's own next and skip, its scrim
 * eating the shelf drag the following steps ask for. A watcher that can only
 * ever open is half a watcher; `stepWatchVerdict` below is the whole one.
 *
 * `./dismiss.ts` closes the same panel from the tour's side, on the frame the
 * step changes. Both, deliberately: the tour puts away what its own step left
 * standing, and the panel refuses to stand over a step that is not its own.
 * Neither is a special case for the other — each is the general rule of its own
 * side — and either one alone would leave a hole (a panel opened after the step
 * changed; a tour that was closed rather than advanced).
 */

/** The overlay's layer, carrying whichever step is current. */
export const TOUR_LAYER_SELECTOR = '.nbt-layer[data-tutorial-step]';

/** The attribute on it. Named once so a reader can grep for both halves. */
export const TOUR_STEP_ATTR = 'data-tutorial-step';

/** What a panel watching the tour should do about what it just read. */
export type StepWatchVerdict = 'open' | 'close' | 'leave-alone';

/** Everything the verdict depends on. All of it is already known to the panel. */
export interface StepWatch {
  /**
   * The tour's current step id — or `''` for "no tour on screen at all", which
   * is what an absent layer, an absent attribute and a closed tour all read as.
   */
  readonly here: string;
  /** The step id this panel rides on. */
  readonly stepId: string;
  /** Is the panel on screen right now? */
  readonly open: boolean;
  /**
   * Did THIS watcher put it there? A panel opened from the settings sheet's
   * "choose my look again" row has nothing to do with the tour and must not be
   * taken away by it — and that row is pressed while no tour is running, which
   * reads as `here: ''` and would otherwise close instantly.
   */
  readonly mine: boolean;
  /** Has the reader finished the questions before? Then never offer them again. */
  readonly settled: boolean;
  /**
   * Opened for THIS visit to the step already.
   *
   * Without it "I'll pick later" is not a way out: the tour is still parked on
   * the step (its task is outstanding, because the reader just declined it), so
   * the very next poll reopens the panel over the top of them. The caller
   * clears it whenever the verdict is not about its own step, so walking back
   * offers the questions again.
   */
  readonly openedForStep: boolean;
}

/**
 * Open, close, or do nothing.
 *
 * Total by construction — every combination of the five inputs has an answer,
 * and none of them is a throw. A panel that guesses wrong about the tour must
 * degrade to "leave it alone", never to a screen the reader cannot get past.
 */
export function stepWatchVerdict(watch: StepWatch): StepWatchVerdict {
  if (watch.here !== watch.stepId) {
    // The tour is somewhere else, or gone. A panel this watcher put up is now
    // standing over somebody else's step: take it down. Anything else on
    // screen belongs to whoever opened it.
    return watch.open && watch.mine ? 'close' : 'leave-alone';
  }
  if (watch.open || watch.settled || watch.openedForStep) return 'leave-alone';
  return 'open';
}
