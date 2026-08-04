/**
 * src/features/tutorial/TutorialOverlay.tsx — the guided tour surface.
 *
 * One full-viewport SVG does the heavy lifting: a single evenodd path paints
 * the dim scrim *with the spotlight hole punched out*, so the highlighted
 * control stays fully lit. A second pass draws the ring and the pencil arrow.
 *
 * NOTHING IN THIS LAYER TAKES A CLICK except the card. The tour asks the
 * reader to do a real thing on almost every step — drag the shelf, type on a
 * page, right-click a block — and a scrim that swallows pointer events turns
 * every one of those into "I clicked and nothing happened". The dim is
 * emphasis, not a gate.
 *
 * COMPLETION: each step names a fact in ./probe.ts. The rAF loop asks whether
 * that fact holds; the moment it does the card goes green, the ring goes
 * green, the step's dot goes green, and after a short beat the tour moves on
 * by itself. Completed steps stay green when you walk back through them.
 *
 * All geometry comes from ./engine (pure, unit-tested). This file only wires
 * it to the DOM: resolve the target, measure, tween with GSAP, and handle
 * keyboard. Every duration is multiplied by --motion-scale, so "animation:
 * off" in Settings makes the whole tour snap instantly.
 *
 * Robustness: a step whose target has vanished renders as a centred,
 * anchorless card (the lesson still lands) unless it opted into
 * `skipIfMissing`, in which case the engine walks straight past it. There is
 * no state in which the tour can trap the reader — Esc always leaves.
 */

import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  untrack,
  type JSX,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { gsap } from 'gsap';
import { play } from '../../sound/engine';
import {
  arrowHeadPath,
  arrowPoints,
  applyInset,
  celebrateDelay,
  centerCard,
  clipRectToViewport,
  edgePointToward,
  firstStepIndex,
  holePath,
  inflateBox,
  inflateRect,
  isTypingTarget,
  keyAction,
  placeCard,
  rectCenter,
  seedFrom,
  smoothPath,
  solidScrimPath,
  spotlightPath,
  stepIndexAfter,
  type Rect,
  type Size,
} from './engine';
import {
  TUTORIAL_STEPS,
  stepTargets,
  tourSteps,
  type StepTarget,
  type TourLength,
  type TutorialStep,
} from './steps';
import { armProbe, attachProbe, factHolds, inBookView, isVisible } from './probe';
import { dismissStale, isDismissing, openSurfaceIds } from './dismiss';
import {
  readCompleted,
  replayTutorial,
  resetTutorial,
  setTutorialLength,
  startTutorial,
  stopTutorial,
  tutorialLength,
  tutorialLengthChosen,
  tutorialRunToken,
  tutorialRunning,
} from './state';
import { motionScale } from '../../styles/motion';
import '../../styles/tutorial.css';

/* ------------------------------- helpers ---------------------------------- */

/**
 * The tour's beats (spotlight travel, pencil draw-on, card entrance) are
 * authored choreography rather than UI travel, so they keep their own seconds
 * instead of taking DUR from styles/motion.ts — but they scale through the
 * shared `motionScale()`, which is the one place that decides how much motion
 * to play.
 */
function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

/** Is this element actually on screen and big enough to point at? */
function isUsableTarget(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return false;
  if (rect.bottom < 0 || rect.right < 0) return false;
  if (rect.top > window.innerHeight || rect.left > window.innerWidth) return false;
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.display === 'none') return false;
  return Number.parseFloat(cs.opacity || '1') > 0.05;
}

/** First visible match among a step's candidate targets, with its padding. */
function findTarget(step: TutorialStep): { el: Element; target: StepTarget } | null {
  for (const target of stepTargets(step)) {
    let matches: NodeListOf<Element>;
    try {
      matches = document.querySelectorAll(target.selector);
    } catch {
      continue; // a malformed selector must never break the tour
    }
    for (const el of Array.from(matches)) {
      if (isUsableTarget(el)) return { el, target };
    }
  }
  return null;
}

/** Spotlight rect for a step, or null when it has no live target. */
function resolveAnchor(step: TutorialStep): Rect | null {
  const found = findTarget(step);
  if (found === null) return null;
  const r = found.el.getBoundingClientRect();
  const base: Rect = { x: r.x, y: r.y, width: r.width, height: r.height };
  const inset = applyInset(base, found.target.inset);
  const padded = inflateBox(inflateRect(inset, found.target.pad ?? 4), found.target.padBox);
  return clipRectToViewport(padded, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
}

const stepPresent = (step: TutorialStep): boolean => findTarget(step) !== null;

/**
 * A modal question standing over the tour, whose keys are its own.
 *
 * The one that ships is the taste questionnaire (`./tasteQuestionnaire.tsx`),
 * which the `taste` step puts on screen: a sheet with its own scrim, its own
 * Escape ("leave without dressing anything") and its own ← →.
 *
 * IT CANNOT DEFEND THOSE KEYS BY ITSELF, and that is the whole reason this
 * exists. Both it and this overlay hold a capture-phase `keydown` on `window`,
 * and `stopPropagation()` does not stop other listeners on the SAME target — so
 * however carefully the two are ordered, both handlers run. Observed: Escape in
 * the questionnaire closed the question AND ended the tour underneath it, and
 * ← → in the questionnaire moved both. The tour is the thing behind, so the tour
 * is the thing that stands down.
 *
 * A selector, treated as a hint in the usual way (see ./probe.ts): a panel that
 * renames its layer gets the old behaviour back rather than a crash.
 */
const MODAL_OVER_TOUR = '.nbq-layer';

function modalOverTour(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    return Array.from(document.querySelectorAll(MODAL_OVER_TOUR)).some(isVisible);
  } catch {
    return false;
  }
}

/* --------------------------------- view ----------------------------------- */

export default function TutorialOverlay(): JSX.Element {
  const [stepIndex, setStepIndex] = createSignal(0);
  const [anchor, setAnchor] = createSignal<Rect | null>(null);
  const [hole, setHole] = createSignal<Rect | null>(null);
  const [viewport, setViewport] = createSignal<Size>({
    width: typeof window === 'undefined' ? 1440 : window.innerWidth,
    height: typeof window === 'undefined' ? 900 : window.innerHeight,
  });
  const [cardSize, setCardSize] = createSignal<Size>({ width: 348, height: 232 });
  const [ready, setReady] = createSignal(false);
  /** Ids of steps whose task the reader has satisfied, this run. */
  const [finished, setFinished] = createSignal<readonly string[]>([]);
  /** Live view, so a step can say "you are in the wrong scene for this". */
  const [inBook, setInBook] = createSignal(false);

  let cardEl: HTMLDivElement | undefined;
  let arrowEl: SVGPathElement | undefined;
  let ringEl: SVGPathElement | undefined;
  let tickEl: SVGPathElement | undefined;
  const holeObj: Rect = { x: 0, y: 0, width: 0, height: 0 };
  let lastStepShown = -1;
  /** Pending auto-advance, cancelled by any manual navigation. */
  let advanceTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * The steps of THIS run. Everything below indexes into this list, never into
   * `TUTORIAL_STEPS` — the short tour is a subset of the same script, so the
   * dots, the "step n of m" and the navigation all have to count the tour the
   * reader actually asked for.
   */
  const steps = createMemo<readonly TutorialStep[]>(() => tourSteps(tutorialLength()));

  const step = (): TutorialStep => {
    const list = steps();
    return list[stepIndex()] ?? list[0] ?? TUTORIAL_STEPS[0];
  };
  const seed = (): number => seedFrom(step().id);
  const isLast = (): boolean => stepIndex() >= steps().length - 1;
  const isDone = (id: string): boolean => finished().includes(id);
  const currentDone = (): boolean => isDone(step().id);
  /** The greeting doubles as the "how much of this do you want?" question. */
  const isChooser = (): boolean => stepIndex() === 0;

  /* --------------------------- navigation -------------------------------- */

  function cancelAdvance(): void {
    if (advanceTimer !== undefined) clearTimeout(advanceTimer);
    advanceTimer = undefined;
  }

  function goto(direction: 1 | -1): void {
    cancelAdvance();
    const next = stepIndexAfter(untrack(steps), untrack(stepIndex), direction, stepPresent);
    if (next === null) {
      if (direction === 1) finish();
      return; // walking back off step one is a no-op, never a dead end
    }
    setReady(false);
    setStepIndex(next);
    void play(direction === 1 ? 'pop-soft' : 'tick-hover', { volume: 0.5 });
  }

  function jumpTo(index: number): void {
    cancelAdvance();
    if (index === untrack(stepIndex)) return;
    setReady(false);
    setStepIndex(index);
    void play('tick-hover', { volume: 0.5 });
  }

  function finish(): void {
    cancelAdvance();
    void play('check-done', { volume: 0.6 });
    stopTutorial(true);
  }

  function skip(): void {
    cancelAdvance();
    stopTutorial(true);
  }

  /**
   * Answer the greeting's question and get going. Picking a length IS the
   * answer to "shall we start", so it advances rather than leaving the reader
   * to press next as well.
   */
  function chooseLength(next: TourLength): void {
    setTutorialLength(next);
    void play('pop-soft', { volume: 0.5 });
    // The list has just changed shape underneath us; step on from the
    // greeting, which is index 0 of both tours.
    queueMicrotask(() => {
      if (untrack(tutorialRunning) && untrack(stepIndex) === 0) goto(1);
    });
  }

  /* ------------------------ target + task tracking ----------------------- */

  // One rAF loop for the whole tour: re-resolve the current step's target so
  // the spotlight follows panels sliding in, the shelf panning, resizes — and
  // ask the probe whether this step's task has been satisfied yet. Cheap (one
  // querySelector, one rect read, and a throttled poll inside the probe) and
  // only alive while the tour is running.
  // The probe's listeners only exist while the tour does: a closed tour must
  // not be walking the DOM on every pointerover and keystroke for the rest of
  // the session.
  createEffect(() => {
    if (!tutorialRunning()) return;
    onCleanup(attachProbe());
  });

  onMount(() => {
    let frame = 0;
    const tick = (now: number): void => {
      if (tutorialRunning()) {
        setViewport((prev) =>
          prev.width === window.innerWidth && prev.height === window.innerHeight
            ? prev
            : { width: window.innerWidth, height: window.innerHeight },
        );
        const current = step();
        const next = resolveAnchor(current);
        setAnchor((prev) => (sameRect(prev, next) ? prev : next));
        setInBook(inBookView());
        const task = current.task;
        if (task !== undefined && !isDone(current.id) && factHolds(task.fact, now)) {
          markDone(current);
        }
        // The wrong-turn watch: only ever asked about on a step that declares
        // one, so this is a no-op on nearly every step.
        const nudge = task?.nudge;
        setNudged(nudge !== undefined && factHolds(nudge.when, now));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    onCleanup(() => cancelAnimationFrame(frame));
  });

  /**
   * The reader just did the thing: celebrate, then walk on by ourselves.
   *
   * How long the celebration lasts is the STEP's business, not this file's: a
   * step that asked the reader to open a panel has to leave the panel open long
   * enough to look at, because walking on is what closes it again (dismiss.ts).
   * `celebrateDelay` holds that rule; `steps.ts → PANEL_DWELL_MS` holds the
   * number and the report behind it.
   */
  function markDone(done: TutorialStep): void {
    const id = done.id;
    setFinished((prev) => (prev.includes(id) ? prev : [...prev, id]));
    void play('check-done', { volume: 0.55 });
    if (isLast()) return;
    cancelAdvance();
    const wait = celebrateDelay(done.task?.dwell, motionScale());
    const from = untrack(stepIndex);
    advanceTimer = setTimeout(() => {
      advanceTimer = undefined;
      // A manual nav during the beat wins — never yank the reader sideways.
      if (untrack(stepIndex) === from && untrack(tutorialRunning)) goto(1);
    }, wait);
  }

  onCleanup(cancelAdvance);

  // Restart on every startTutorial() call (including "replay" while open).
  createEffect(
    on(tutorialRunToken, () => {
      if (!untrack(tutorialRunning)) return;
      cancelAdvance();
      lastStepShown = -1;
      setHole(null);
      setReady(false);
      setFinished([]);
      setStepIndex(firstStepIndex(untrack(steps), stepPresent) ?? 0);
      setAnchor(resolveAnchor(untrack(step)));
    }),
  );

  // Switching tours mid-run shortens the list under the cursor. The chooser
  // only appears on step one, so this is belt and braces — but an index past
  // the end would render the fallback step forever.
  createEffect(() => {
    const last = steps().length - 1;
    if (untrack(stepIndex) > last) setStepIndex(Math.max(0, last));
  });

  // Entering a step forgets what happened during the last one, so "you turned
  // a page" cannot be satisfied by a page turned three steps ago — and puts
  // away whatever the previous step left standing (see ./dismiss.ts).
  createEffect(
    on([stepIndex, tutorialRunToken], () => {
      if (!untrack(tutorialRunning)) return;
      const current = untrack(step);
      dismissStale(stepTargets(current).map((t) => t.selector));
      armProbe();
    }),
  );

  /* --------------------------- choreography ------------------------------ */

  // Spotlight: tween the hole between steps, snap while merely tracking.
  createEffect(() => {
    const target = anchor();
    const index = stepIndex();
    const changed = lastStepShown !== index;
    lastStepShown = index;
    gsap.killTweensOf(holeObj);
    if (target === null) {
      setHole(null);
      return;
    }
    const ms = motionScale();
    if (!changed || ms <= 0) {
      Object.assign(holeObj, target);
      setHole({ ...target });
      return;
    }
    const from = untrack(hole);
    const start =
      from ?? {
        x: target.x + target.width / 2 - 8,
        y: target.y + target.height / 2 - 8,
        width: 16,
        height: 16,
      };
    Object.assign(holeObj, start);
    setHole({ ...start });
    gsap.to(holeObj, {
      x: target.x,
      y: target.y,
      width: target.width,
      height: target.height,
      duration: 0.5 * ms,
      ease: 'power3.inOut',
      onUpdate: () => setHole({ ...holeObj }),
    });
  });

  // Card size drives placement, so it has to be right before the first paint
  // the reader sees. `offsetWidth/Height` (not getBoundingClientRect) because
  // the entrance tween scales the card and would inflate a measured rect.
  function measureCard(): void {
    const el = cardEl;
    if (el === undefined) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    if (width < 1 || height < 1) return;
    setCardSize((prev) =>
      Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1
        ? prev
        : { width, height },
    );
  }

  // A ResizeObserver catches every source of size change the effects miss:
  // mounting, the wide/narrow class flipping, fonts finishing, text reflow —
  // and now the task line swapping for a taller green one.
  const cardObserver =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measureCard());
  onCleanup(() => cardObserver?.disconnect());

  function attachCard(el: HTMLDivElement): void {
    // Closing and reopening the tour mounts a fresh card; drop the old
    // observation so the observer never holds a detached node.
    if (cardEl !== undefined && cardEl !== el) cardObserver?.unobserve(cardEl);
    cardEl = el;
    cardObserver?.observe(el);
    measureCard();
  }

  // Card entrance: measure the new copy, then fade/tilt it in.
  createEffect(
    on([stepIndex, tutorialRunning], () => {
      if (!tutorialRunning()) return;
      const el = cardEl;
      if (el === undefined) return;
      const ms = motionScale();
      gsap.killTweensOf(el);
      gsap.set(el, { autoAlpha: 0, scale: 1, rotate: 0, y: 0 });
      measureCard();
      setReady(true);
      if (ms <= 0) {
        gsap.set(el, { autoAlpha: 1 });
        return;
      }
      gsap.fromTo(
        el,
        { autoAlpha: 0, scale: 0.94, rotate: -1.6, y: 10 },
        {
          autoAlpha: 1,
          scale: 1,
          rotate: 0,
          y: 0,
          duration: 0.42 * ms,
          ease: 'back.out(1.7)',
          delay: 0.06 * ms,
        },
      );
    }),
  );

  // Arrow + ring: pencil draw-on, restarted whenever the step changes.
  createEffect(
    on([stepIndex, ready], () => {
      if (!ready()) return;
      const ms = motionScale();
      for (const el of [ringEl, arrowEl]) {
        if (el === undefined) continue;
        gsap.killTweensOf(el);
        let length = 0;
        try {
          length = el.getTotalLength();
        } catch {
          length = 0;
        }
        if (length <= 0 || ms <= 0) {
          gsap.set(el, { strokeDasharray: 'none', strokeDashoffset: 0, opacity: 1 });
          continue;
        }
        gsap.fromTo(
          el,
          { strokeDasharray: length, strokeDashoffset: length, opacity: 1 },
          {
            strokeDashoffset: 0,
            duration: 0.5 * ms,
            ease: 'power2.out',
            delay: (el === ringEl ? 0.1 : 0.24) * ms,
            onComplete: () => gsap.set(el, { strokeDasharray: 'none' }),
          },
        );
      }
    }),
  );

  // The tick draws itself the moment a task lands — the one bit of motion
  // that is pure reward, so it gets its own beat rather than sharing the
  // card's entrance.
  createEffect(
    on(currentDone, (done) => {
      const el = tickEl;
      if (el === undefined || !done) return;
      const ms = motionScale();
      gsap.killTweensOf(el);
      if (ms <= 0) {
        gsap.set(el, { strokeDasharray: 'none', strokeDashoffset: 0 });
        return;
      }
      let length = 0;
      try {
        length = el.getTotalLength();
      } catch {
        length = 0;
      }
      if (length <= 0) return;
      gsap.fromTo(
        el,
        { strokeDasharray: length, strokeDashoffset: length },
        {
          strokeDashoffset: 0,
          duration: 0.34 * ms,
          ease: 'power2.out',
          onComplete: () => gsap.set(el, { strokeDasharray: 'none' }),
        },
      );
    }),
  );

  /* ---------------------------- geometry --------------------------------- */

  const placement = createMemo(() => {
    const vp = viewport();
    const card = cardSize();
    const a = anchor();
    if (a === null) {
      return { rect: centerCard(vp, card), side: 'bottom' as const, anchored: false };
    }
    // A generous gap is what gives the pencil arrow room to read as a
    // gesture rather than a stub between two touching boxes.
    const placed = placeCard(a, vp, card, { gap: 64, margin: 18, preferred: step().side });
    return { ...placed, anchored: true };
  });

  const scrimPath = createMemo(() => {
    const vp = viewport();
    const h = hole();
    return h === null ? solidScrimPath(vp) : spotlightPath(h, vp, 14);
  });

  const ringPath = createMemo(() => {
    const h = hole();
    return h === null ? '' : holePath(h, 14);
  });

  const arrow = createMemo(() => {
    const a = anchor();
    const place = placement();
    if (a === null || !place.anchored) return { stroke: '', head: '' };
    const cardRect = place.rect;
    const targetCenter = rectCenter(a);
    const from = edgePointToward(cardRect, targetCenter);
    const to = edgePointToward(a, rectCenter(cardRect));
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    // Too short to read as an arrow — a stub between two nearly touching
    // boxes is a squiggle, not a pointer, and the ring already says "this
    // thing". Sits just under the 64px placement gap, so a card beside its
    // target still gets its arrow while a clamped, crowded one does not.
    if (dist < 46) return { stroke: '', head: '' };
    // Back both ends off the boxes so the pencil line breathes.
    const inset = Math.min(14, dist * 0.16);
    const start = { x: from.x + (dx / dist) * inset, y: from.y + (dy / dist) * inset };
    const end = { x: to.x - (dx / dist) * (inset * 0.55), y: to.y - (dy / dist) * (inset * 0.55) };
    const pts = arrowPoints(start, end, seed(), { bow: 0.19, segments: 9, wobble: 1.6 });
    return { stroke: smoothPath(pts), head: arrowHeadPath(pts, seed(), 14) };
  });

  /**
   * The wrong-turn line. A step can name a gesture that will NOT satisfy it
   * (steps.ts → StepNudge); when the probe sees that gesture and the step is
   * still outstanding, the card says so out loud. Without it, a gated step
   * looks like a tour that has stopped working.
   *
   * Read off the live signal rather than latched: the moment the real task
   * lands the nudge is gone, replaced by the green line.
   */
  const [nudged, setNudged] = createSignal(false);
  const nudgeLine = createMemo(() => {
    if (currentDone() || !nudged()) return null;
    return step().task?.nudge?.say ?? null;
  });

  /**
   * A nudge when the reader is in the wrong place for the step in front of
   * them — walking back to "write something" from the shelf, say. Only shown
   * while the task is still outstanding; once it is green it does not matter
   * where they wandered off to.
   */
  const sceneLabel = createMemo(() => {
    const scene = step().scene ?? 'any';
    if (scene === 'any' || currentDone()) return null;
    const here = inBook() ? 'book' : 'shelf';
    if (scene === here) return null;
    return scene === 'shelf' ? 'go back to the shelf for this one' : 'open a book for this one';
  });

  /* ---------------------------- keyboard --------------------------------- */

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Tab') return; // let focus cycle naturally inside the card
    // The tour is pressing Escape at a menu it is tidying away — that is not
    // the reader asking to leave (see ./dismiss.ts).
    if (isDismissing()) return;
    // Something modal is in front of the tour and owns every key it uses.
    // TWO tests, because one cannot cover both orders. If the modal's handler
    // has not run yet, its layer is still on screen; if it has, the layer may
    // already be gone but it left `defaultPrevented` behind. Neither is
    // reliable alone and together they do not care who went first.
    if (event.defaultPrevented || modalOverTour()) return;
    const target = event.target as HTMLElement | null;
    // Hands off entirely while the caret is in a page, a search bar or any
    // other field: Enter belongs to whatever the reader is typing into, and
    // several steps ask them to type.
    if (isTypingTarget(target)) return;
    const action = keyAction(event.key);
    if (action === null) return;
    // A focused button owns Enter; don't double-fire.
    if (target?.tagName === 'BUTTON' && event.key === 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    if (action === 'next') goto(1);
    else if (action === 'back') goto(-1);
    else skip();
  }

  onMount(() => {
    const handler = (event: KeyboardEvent): void => {
      if (!tutorialRunning()) return;
      onKeyDown(event);
    };
    window.addEventListener('keydown', handler, true);
    onCleanup(() => window.removeEventListener('keydown', handler, true));
  });

  // Focus the card so Enter works without the reader clicking first — but
  // never steal it back from a page, panel or search bar they have moved into
  // to do what the step asked.
  createEffect(
    on([tutorialRunning, stepIndex], () => {
      if (!tutorialRunning()) return;
      queueMicrotask(() => {
        const active = document.activeElement;
        if (active !== null && active !== document.body && !cardEl?.contains(active)) return;
        cardEl?.focus({ preventScroll: true });
      });
    }),
  );

  /* ------------------------ e2e / debug surface -------------------------- */

  onMount(() => {
    window.__nbTutorial = {
      start: startTutorial,
      stop: () => stopTutorial(false),
      next: () => goto(1),
      back: () => goto(-1),
      jumpTo,
      // Persistence is exposed here rather than left to a dynamic import in
      // the spec: importing the module by URL can hand a test a *second*
      // instance of state.ts (Vite adds ?t= cache-busting on HMR), whose
      // signals the live overlay is not listening to.
      isCompleted: readCompleted,
      reset: resetTutorial,
      replay: replayTutorial,
      /** Freeze the tour on this step — QA drives each task by hand. */
      hold: () => cancelAdvance(),
      /** Answer the greeting's question from a probe, exactly as a click does. */
      chooseLength,
      getState: () => ({
        running: tutorialRunning(),
        stepIndex: stepIndex(),
        stepId: step().id,
        length: tutorialLength(),
        lengthChosen: tutorialLengthChosen(),
        stepIds: steps().map((s) => s.id),
        total: steps().length,
        anchored: anchor() !== null,
        anchor: anchor(),
        /** Live spotlight rect — lags `anchor` while the GSAP tween runs. */
        hole: hole(),
        card: placement().rect,
        side: placement().side,
        arrow: arrow().stroke !== '',
        /** The fact this step is waiting on, or null for a read-only step. */
        fact: step().task?.fact ?? null,
        done: currentDone(),
        /** The wrong-turn line, when one is showing. */
        nudge: nudgeLine(),
        finished: [...finished()],
        /** Panels/sheets/menus still standing — QA asserts this is empty. */
        openSurfaces: openSurfaceIds(),
      }),
    };
    onCleanup(() => {
      delete window.__nbTutorial;
    });
  });

  /* ------------------------------ render --------------------------------- */

  return (
    <Show when={tutorialRunning()}>
      <Portal>
        <div
          class="nbt-layer"
          data-tutorial-step={step().id}
          data-tutorial-done={currentDone() ? 'true' : 'false'}
        >
          <svg
            class="nbt-canvas"
            width={viewport().width}
            height={viewport().height}
            aria-hidden="true"
          >
            <path class="nbt-scrim" d={scrimPath()} fill-rule="evenodd" />
            <Show when={ringPath() !== ''}>
              <>
                {/* Candle-lift inside the hole: on the dark shelf a plain
                    dim scrim is nearly invisible, so the lit patch also
                    gets a faint warm wash. Never catches pointer events. */}
                <path class="nbt-glow" d={ringPath()} />
                <path class="nbt-ring nbt-ring--halo" d={ringPath()} />
                <path class="nbt-ring" d={ringPath()} ref={ringEl} />
              </>
            </Show>
            <Show when={arrow().stroke !== ''}>
              <>
                <path class="nbt-arrow" d={arrow().stroke} ref={arrowEl} />
                <path class="nbt-arrow nbt-arrow--head" d={arrow().head} />
              </>
            </Show>
          </svg>

          <div
            class="nbt-card"
            classList={{
              'nbt-card--wide': !placement().anchored,
              'is-done': currentDone(),
            }}
            data-side={placement().side}
            ref={attachCard}
            role="dialog"
            aria-modal="false"
            aria-labelledby="nbt-title"
            aria-describedby="nbt-body"
            tabindex="-1"
            style={{
              left: `${placement().rect.x}px`,
              top: `${placement().rect.y}px`,
            }}
          >
            <span class="nbt-tape" aria-hidden="true" />
            <p class="nbt-eyebrow font-ui">
              <span>
                step {stepIndex() + 1} of {steps().length}
              </span>
              <Show when={sceneLabel()}>
                {(label) => <span class="nbt-scene">· {label()}</span>}
              </Show>
            </p>
            <h2 class="nbt-title" id="nbt-title">
              {step().title}
            </h2>
            <p class="nbt-body" id="nbt-body">
              {step().body}
            </p>
            <Show when={step().hint}>
              {(hint) => <p class="nbt-hint font-ui">{hint()}</p>}
            </Show>

            {/* HOW MUCH OF THIS DO YOU WANT? Asked once, on the greeting, and
                the answer picks the step list for the whole run. The full
                rundown is the default, so pressing "next" past the question
                gives the reader everything rather than quietly less. */}
            <Show when={isChooser()}>
              <div class="nbt-choice" role="group" aria-label="How long a tour">
                <button
                  type="button"
                  class="nbt-choice-btn font-ui"
                  classList={{
                    'is-picked': tutorialLengthChosen() && tutorialLength() === 'short',
                  }}
                  aria-pressed={tutorialLengthChosen() && tutorialLength() === 'short'}
                  onClick={() => chooseLength('short')}
                >
                  <span class="nbt-choice-name">the short way</span>
                  <span class="nbt-choice-sub">
                    {tourSteps('short').length} steps — open a book, write, find things
                  </span>
                </button>
                <button
                  type="button"
                  class="nbt-choice-btn font-ui"
                  classList={{
                    'is-picked': tutorialLengthChosen() && tutorialLength() === 'full',
                  }}
                  aria-pressed={tutorialLengthChosen() && tutorialLength() === 'full'}
                  onClick={() => chooseLength('full')}
                >
                  <span class="nbt-choice-name">the full rundown</span>
                  <span class="nbt-choice-sub">
                    {tourSteps('full').length} steps — every tool on both rails
                  </span>
                </button>
              </div>
            </Show>

            {/* The task line, and the whole point of it: a box that goes green
                when the tour has actually SEEN the reader do the thing. */}
            <Show
              when={step().task}
              fallback={
                // The greeting HAS something to do — it is the two buttons
                // above — so it must not also say there is nothing to do.
                <Show when={!isChooser()}>
                  <p class="nbt-task nbt-task--none font-ui" aria-live="polite">
                    nothing to do on this one — just read
                  </p>
                </Show>
              }
            >
              {(task) => (
                <p
                  class="nbt-task font-ui"
                  classList={{ 'is-done': currentDone() }}
                  aria-live="polite"
                >
                  <span class="nbt-task-mark" aria-hidden="true">
                    <Show
                      when={currentDone()}
                      fallback={
                        <svg viewBox="0 0 20 20">
                          <path
                            class="nbt-task-box"
                            d="M 4.4 3.6 L 15.8 3.9 L 16.2 15.9 L 4.1 16.2 Z"
                          />
                        </svg>
                      }
                    >
                      <svg viewBox="0 0 20 20">
                        <path
                          class="nbt-task-box"
                          d="M 4.4 3.6 L 15.8 3.9 L 16.2 15.9 L 4.1 16.2 Z"
                        />
                        <path
                          class="nbt-task-tick"
                          d="M 6.4 10.2 L 9.1 13.6 L 14.4 5.6"
                          ref={tickEl}
                        />
                      </svg>
                    </Show>
                  </span>
                  <span class="nbt-task-text">
                    {currentDone() ? task().done : task().ask}
                  </span>
                </p>
              )}
            </Show>

            {/* Did something, but not the thing this step is waiting for. */}
            <Show when={nudgeLine()}>
              {(line) => (
                <p class="nbt-nudge font-ui" aria-live="polite">
                  {line()}
                </p>
              )}
            </Show>

            <div class="nbt-dots" role="tablist" aria-label="Tour progress">
              <For each={steps()}>
                {(s, i) => (
                  <button
                    type="button"
                    class="nbt-dot"
                    classList={{
                      'is-current': i() === stepIndex(),
                      'is-past': i() < stepIndex(),
                      'is-done': isDone(s.id),
                    }}
                    role="tab"
                    aria-selected={i() === stepIndex()}
                    aria-label={
                      `Step ${i() + 1}: ${s.title}` + (isDone(s.id) ? ' (done)' : '')
                    }
                    data-tooltip={s.title + (isDone(s.id) ? ' — done' : '')}
                    data-tooltip-side="top"
                    onClick={() => jumpTo(i())}
                  >
                    <svg viewBox="0 0 14 14" aria-hidden="true">
                      <circle cx="7" cy="7" r="4.2" />
                      <Show when={isDone(s.id)}>
                        <path class="nbt-dot-tick" d="M 4.2 7.1 L 6.2 9.3 L 10 4.5" />
                      </Show>
                    </svg>
                  </button>
                )}
              </For>
            </div>

            <div class="nbt-actions">
              <button type="button" class="nbt-btn nbt-btn--ghost font-ui" onClick={skip}>
                skip the tour
              </button>
              <span class="nbt-spacer" />
              <button
                type="button"
                class="nbt-btn font-ui"
                disabled={stepIndex() === 0}
                onClick={() => goto(-1)}
              >
                back
              </button>
              <button
                type="button"
                class="nbt-btn nbt-btn--primary font-ui"
                classList={{ 'is-done': currentDone() }}
                onClick={() => (isLast() ? finish() : goto(1))}
              >
                {isLast() ? "I'm ready" : currentDone() ? 'on we go' : 'next'}
              </button>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}

declare global {
  interface Window {
    __nbTutorial?: {
      start: () => void;
      stop: () => void;
      next: () => void;
      back: () => void;
      jumpTo: (index: number) => void;
      hold: () => void;
      chooseLength: (length: TourLength) => void;
      isCompleted: () => Promise<boolean>;
      reset: () => Promise<void>;
      replay: () => Promise<void>;
      getState: () => {
        running: boolean;
        stepIndex: number;
        stepId: string;
        length: TourLength;
        lengthChosen: boolean;
        stepIds: string[];
        total: number;
        anchored: boolean;
        anchor: Rect | null;
        hole: Rect | null;
        card: Rect;
        side: string;
        arrow: boolean;
        fact: string | null;
        done: boolean;
        nudge: string | null;
        finished: string[];
        openSurfaces: readonly string[];
      };
    };
  }
}
