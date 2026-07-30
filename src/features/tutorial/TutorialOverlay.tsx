/**
 * src/features/tutorial/TutorialOverlay.tsx — the guided tour surface.
 *
 * One full-viewport SVG does the heavy lifting: a single evenodd path paints
 * the dim scrim *with the spotlight hole punched out*, so the highlighted
 * control stays fully lit and still clickable (the unpainted hole does not
 * receive pointer events — you can genuinely try the thing being explained).
 * A second pass draws the hand-wobbled ring and the pencil arrow.
 *
 * All geometry comes from ./engine (pure, unit-tested). This file only wires
 * it to the DOM: resolve the target, measure, tween with GSAP, and handle
 * keyboard. Every duration is multiplied by --motion-scale, so "animation:
 * off" in Settings makes the whole tour snap instantly.
 *
 * Robustness: a step whose target has vanished renders as a centred,
 * anchorless card (the lesson still lands) unless it opted into
 * `skipIfMissing`, in which case the engine walks straight past it. There is
 * no state in which the tour can trap the user — Esc always leaves.
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
  centerCard,
  edgePointToward,
  firstStepIndex,
  holePath,
  inflateRect,
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
import { TUTORIAL_STEPS, type TutorialStep } from './steps';
import {
  readCompleted,
  replayTutorial,
  resetTutorial,
  startTutorial,
  stopTutorial,
  tutorialRunToken,
  tutorialRunning,
} from './state';
import { appState } from '../../state/app';
import '../../styles/tutorial.css';

/* ------------------------------- helpers ---------------------------------- */

/** Current --motion-scale as a number (0 when motion is off). */
function motionScale(): number {
  if (typeof document === 'undefined') return 1;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--motion-scale')
    .trim();
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : 1;
}

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

/** First visible match among a step's candidate selectors. */
function findTarget(step: TutorialStep): Element | null {
  for (const selector of step.targets ?? []) {
    let matches: NodeListOf<Element>;
    try {
      matches = document.querySelectorAll(selector);
    } catch {
      continue; // a malformed selector must never break the tour
    }
    for (const el of Array.from(matches)) {
      if (isUsableTarget(el)) return el;
    }
  }
  return null;
}

/** Spotlight rect for a step, or null when it has no live target. */
function resolveAnchor(step: TutorialStep): Rect | null {
  const el = findTarget(step);
  if (el === null) return null;
  const r = el.getBoundingClientRect();
  const base: Rect = { x: r.x, y: r.y, width: r.width, height: r.height };
  return inflateRect(applyInset(base, step.inset), step.pad ?? 4);
}

const stepPresent = (step: TutorialStep): boolean => findTarget(step) !== null;

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

  let cardEl: HTMLDivElement | undefined;
  let arrowEl: SVGPathElement | undefined;
  let ringEl: SVGPathElement | undefined;
  const holeObj: Rect = { x: 0, y: 0, width: 0, height: 0 };
  let lastStepShown = -1;

  const step = (): TutorialStep => TUTORIAL_STEPS[stepIndex()] ?? TUTORIAL_STEPS[0];
  const seed = (): number => seedFrom(step().id);
  const isLast = (): boolean => stepIndex() === TUTORIAL_STEPS.length - 1;

  /* --------------------------- navigation -------------------------------- */

  function goto(direction: 1 | -1): void {
    const next = stepIndexAfter(TUTORIAL_STEPS, untrack(stepIndex), direction, stepPresent);
    if (next === null) {
      if (direction === 1) finish();
      return; // walking back off step one is a no-op, never a dead end
    }
    setReady(false);
    setStepIndex(next);
    void play(direction === 1 ? 'pop-soft' : 'tick-hover', { volume: 0.5 });
  }

  function jumpTo(index: number): void {
    if (index === untrack(stepIndex)) return;
    setReady(false);
    setStepIndex(index);
    void play('tick-hover', { volume: 0.5 });
  }

  function finish(): void {
    void play('check-done', { volume: 0.6 });
    stopTutorial(true);
  }

  function skip(): void {
    stopTutorial(true);
  }

  /* ------------------------ target tracking ------------------------------ */

  // One rAF loop for the whole tour: re-resolve the current step's target so
  // the spotlight follows panels sliding in, the shelf panning, resizes, etc.
  // Cheap (one querySelector + one rect read) and only alive while running.
  onMount(() => {
    let frame = 0;
    const tick = (): void => {
      if (tutorialRunning()) {
        setViewport((prev) =>
          prev.width === window.innerWidth && prev.height === window.innerHeight
            ? prev
            : { width: window.innerWidth, height: window.innerHeight },
        );
        const next = resolveAnchor(step());
        setAnchor((prev) => (sameRect(prev, next) ? prev : next));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    onCleanup(() => cancelAnimationFrame(frame));
  });

  // Restart on every startTutorial() call (including "replay" while open).
  createEffect(
    on(tutorialRunToken, () => {
      if (!untrack(tutorialRunning)) return;
      lastStepShown = -1;
      setHole(null);
      setReady(false);
      setStepIndex(firstStepIndex(TUTORIAL_STEPS, stepPresent) ?? 0);
      setAnchor(resolveAnchor(untrack(step)));
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
  // the user sees. `offsetWidth/Height` (not getBoundingClientRect) because
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
  // mounting, the wide/narrow class flipping, fonts finishing, text reflow.
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
    const placed = placeCard(a, vp, card, { gap: 56, margin: 18, preferred: step().side });
    return { ...placed, anchored: true };
  });

  const scrimPath = createMemo(() => {
    const vp = viewport();
    const h = hole();
    return h === null ? solidScrimPath(vp) : spotlightPath(h, vp, 18, seed());
  });

  const ringPath = createMemo(() => {
    const h = hole();
    return h === null ? '' : holePath(h, 18, seed());
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
    // Too short to read as an arrow — a 20px stub is visual noise, not a
    // pointer. The spotlight ring already says "this thing".
    if (dist < 40) return { stroke: '', head: '' };
    // Back both ends off the boxes so the pencil line breathes.
    const inset = Math.min(14, dist * 0.16);
    const start = { x: from.x + (dx / dist) * inset, y: from.y + (dy / dist) * inset };
    const end = { x: to.x - (dx / dist) * (inset * 0.55), y: to.y - (dy / dist) * (inset * 0.55) };
    const pts = arrowPoints(start, end, seed(), { bow: 0.19, segments: 9, wobble: 1.6 });
    return { stroke: smoothPath(pts), head: arrowHeadPath(pts, seed(), 14) };
  });

  const sceneLabel = createMemo(() => {
    const scene = step().scene ?? 'any';
    if (scene === 'any') return null;
    if (scene === appState.viewState()) return null;
    return scene === 'shelf' ? 'over on the shelf' : 'inside a book';
  });

  /* ---------------------------- keyboard --------------------------------- */

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Tab') return; // let focus cycle naturally inside the card
    const target = event.target as HTMLElement | null;
    const onButton = target?.tagName === 'BUTTON';
    const action = keyAction(event.key);
    if (action === null) return;
    // A focused button owns Enter/Space; don't double-fire.
    if (onButton && (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar')) {
      return;
    }
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

  // Focus the card so Enter/arrows work without the user clicking first.
  createEffect(
    on([tutorialRunning, stepIndex], () => {
      if (!tutorialRunning()) return;
      queueMicrotask(() => cardEl?.focus({ preventScroll: true }));
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
      getState: () => ({
        running: tutorialRunning(),
        stepIndex: stepIndex(),
        stepId: step().id,
        total: TUTORIAL_STEPS.length,
        anchored: anchor() !== null,
        anchor: anchor(),
        /** Live spotlight rect — lags `anchor` while the GSAP tween runs. */
        hole: hole(),
        card: placement().rect,
        side: placement().side,
        arrow: arrow().stroke !== '',
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
        <div class="nbt-layer" data-tutorial-step={step().id}>
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
            classList={{ 'nbt-card--wide': !placement().anchored }}
            data-side={placement().side}
            ref={attachCard}
            role="dialog"
            aria-modal="true"
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
                step {stepIndex() + 1} of {TUTORIAL_STEPS.length}
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

            <div class="nbt-dots" role="tablist" aria-label="Tour progress">
              <For each={TUTORIAL_STEPS}>
                {(s, i) => (
                  <button
                    type="button"
                    class="nbt-dot"
                    classList={{
                      'is-current': i() === stepIndex(),
                      'is-done': i() < stepIndex(),
                    }}
                    role="tab"
                    aria-selected={i() === stepIndex()}
                    aria-label={`Step ${i() + 1}: ${s.title}`}
                    title={s.title}
                    onClick={() => jumpTo(i())}
                  >
                    <svg viewBox="0 0 14 14" aria-hidden="true">
                      <circle cx="7" cy="7" r="4.2" />
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
                onClick={() => (isLast() ? finish() : goto(1))}
              >
                {isLast() ? "I'm ready" : 'next'}
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
      isCompleted: () => Promise<boolean>;
      reset: () => Promise<void>;
      replay: () => Promise<void>;
      getState: () => {
        running: boolean;
        stepIndex: number;
        stepId: string;
        total: number;
        anchored: boolean;
        anchor: Rect | null;
        hole: Rect | null;
        card: Rect;
        side: string;
        arrow: boolean;
      };
    };
  }
}
