/**
 * src/features/tutorial/tasteQuestionnaire.tsx — five questions, asked once,
 * that dress the reader's whole library.
 *
 * ## The rule this panel is built on: no adjectives about the reader
 *
 * Every option is the REAL DRAWING it would produce. The room cards are painted
 * by `drawRoomCard` — the same routine the library studio previews a room with,
 * in the room's own colours — so choosing here is choosing by looking, not by
 * agreeing with a word. The sound options are the one axis with nothing to draw,
 * so they play instead: pressing one auditions that family through the engine
 * without persisting anything.
 *
 * Each question isolates ONE variable. A card in question two is drawn from the
 * answers given BEFORE it and nothing after, so four pitch cards differ in their
 * colour and in nothing else — the same discipline `designOptions.ts` states for
 * its fixed card seeds, and for the same reason: the eye reads the wrong
 * difference first.
 *
 * ## The palette grid, and why the steer survives it
 *
 * Question three is all sixty palettes as drawn cards, because four buckets that
 * INFER a palette are a steer and the reader asked to be able to point at their
 * favourite. It is the only list in this panel longer than a screenful, so it is
 * the only one capped — twenty and an "N more", through `Capped` from
 * `DesignStrip`, the same control every other long list in the app uses.
 *
 * Two things keep it from being a wall of sixty:
 *
 *  - the order comes from the two answers already given (`paletteOrder`), so the
 *    palettes that answer them are the ones on screen before anything is
 *    expanded;
 *  - the steer's own pick is FIRST and shown as chosen, without being written
 *    down. `answers.palette === undefined` genuinely means "whatever the steer
 *    worked out", so pressing "next" here is not skipping a question — and
 *    because nothing was stored, going back and changing the steer moves the
 *    preselection with it. A pressed card overrides all of that, permanently,
 *    which is the point of pressing it.
 *
 * ## Mounting
 *
 * Self-contained and inert until opened. Render it once, anywhere:
 *
 *     import TasteQuestionnaire from './features/tutorial/tasteQuestionnaire';
 *     <TasteQuestionnaire />
 *
 * It RIDES the guided tour's step whose id is `taste` (`openOnStep`), read off
 * the `data-tutorial-step` attribute the overlay already puts on its own layer
 * — the same outside-in contract `./probe.ts` uses to watch the app. No import
 * in either direction, so the tour's step list and this panel can be changed
 * without touching each other.
 *
 * Riding it means BOTH directions. The watcher used to open the panel and never
 * close it, so a reader who answered one question and pressed next walked on
 * with all five questions still standing: the card covered the tour's own next
 * and skip, and `.nbq-scrim` swallowed the shelf gesture the new step was
 * asking for. `./tourStep.ts` holds the open/close verdict and the reasoning;
 * `./dismiss.ts` does the same job from the tour's side, on the frame the step
 * changes.
 *
 * `openTaste()` / `replayTaste()` open it directly for every other caller (the
 * settings sheet's "choose my look again" row is one), and a panel opened that
 * way is never taken away by the tour.
 *
 * ## Nothing here is a lock
 *
 * The last panel says so out loud, and it is true mechanically: `applyTaste`
 * makes the same five calls the studio and the settings sheet make, so every
 * choice on this screen is editable in the panel that owns it the moment the
 * tour ends. See the docblock in `tasteApply.ts`.
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

import { resolveBookDesign } from '../../art/bookDesign';
import type { FlatCtx, FlatScheme } from '../../art/flat';
import { clothForPalette } from '../../art/spines';
import { BUILDS, PATTERNS } from '../../art/shelfDesign';
import { getWallpaper } from '../../art/wallpaperDesign';
import { getTheme, type ThemeId } from '../../art/themes';
import { WELCOME_BINDING, WELCOME_SPINE_SEED } from '../../data/seed';
import { play, setSoundSet } from '../../sound/engine';
import { cancelSoundSetPreview, previewSoundSet } from '../../sound/preview';
import { snapshotSoundSetId } from '../../sound/soundSetPrefs';
import { SOUND_SET_GROUPS, type SoundSetGroupId } from '../../sound/soundSets';
import { motionScale } from '../../styles/motion';
import { usePanelKeys } from '../../state/panelKeys';
import { DesignCanvas, drawInScheme } from '../../views/rail/designArt';
import { drawBindingCard, drawRoomCard } from '../../views/rail/designOptions';
// The app's one "there is more behind this" control. Borrowed rather than
// re-written: DesignStrip's header states the rule ("anything in the app with
// more rows than a reader wants at once should reach for those three"), and a
// fourth copy of a capped list is how the count on the control starts lying.
// (`PALETTE_HEAD` is this panel's limit and is pinned against `CAP` by
// tests/taste-onboarding.test.ts — tasteProfile.ts stays DOM-free, so it cannot
// import the constant from a component module.)
import { Capped } from '../../views/rail/DesignStrip';
import {
  loadLibraryPrefs,
  libraryPrefs,
  resolveLibrary,
} from '../bookshelf/libraryPrefs';
import { loadDesignPrefs } from '../../data/designPrefs';
import { applyTaste, type TasteReport } from './tasteApply';
import { TOUR_LAYER_SELECTOR, TOUR_STEP_ATTR, stepWatchVerdict } from './tourStep';
import {
  PALETTE_HEAD,
  TASTE_AXES,
  TASTE_QUESTIONS,
  describeTaste,
  isTasteComplete,
  paletteOrder,
  repaintedAs,
  resolveRoom,
  resolveSoundSet,
  resolveTaste,
  tasteRoomKey as roomKey,
  type TasteAnswers,
  type TasteAxis,
  type TasteOption,
  type TasteQuestion,
  type TasteRoom,
} from './tasteProfile';
import {
  closeTaste,
  hasChosenTaste,
  loadTaste,
  openTaste,
  setTasteAnswer,
  tasteAnswers,
  tasteOpen,
  tasteOpenToken,
} from './tasteStore';
import './taste.css';

/* -------------------------------- constants ------------------------------- */

/** How long a chosen card holds before the panel walks on. */
const ADVANCE_MS = 620;

/**
 * Card art size, in CSS px.
 *
 * Sized so question one's EIGHT cards land in two rows rather than three — at
 * 168px the third row fell under the sticky footer and the panel looked like it
 * had been cut off. Still wide enough that a paper's motif reads, which is the
 * floor the studio's own picker tiles are held to.
 */
const CARD_W = 152;
const CARD_H = 106;

/**
 * A palette swatch, in CSS px.
 *
 * Smaller than a room card because there are twenty of them on screen instead of
 * eight, and because the only thing that differs between them is the COLOUR —
 * the carpentry and the paper are the reader's own and identical across the
 * grid, so a swatch does not have to be big enough to read a motif in. At 124 a
 * row of five fits the 864px sheet with room for the name under each, and the
 * capped twenty is four tidy rows rather than five and a half.
 */
const SWATCH_W = 124;
const SWATCH_H = 82;

/** The room on the last panel, drawn big enough to be a decision. */
const FINAL_W = 340;
const FINAL_H = 214;

/** The welcome book beside it. Narrow, so the spine is most of its card. */
const BOOK_W = 96;
const BOOK_H = 214;

/**
 * How often the tour's layer is looked at.
 *
 * A poll rather than a rAF loop or a MutationObserver: this is a "where has the
 * tour got to" question, it is alive for the whole session, and three reads a
 * second of one attribute is already more than the answer can change. Short
 * enough that the panel is never the thing standing between a reader and the
 * step in front of them for longer than a blink.
 */
const TOUR_POLL_MS = 300;

/**
 * The palette question's options, by id.
 *
 * The grid iterates `paletteOrder()` — ids, ordered by the steer — and still has
 * to say what each one is CALLED, so it looks the name up here rather than
 * reaching into `art/themes.ts` for a second opinion. One copy of the wording,
 * in the module that authors every other option's wording too.
 */
const PALETTE_OPTIONS: ReadonlyMap<string, TasteOption> = new Map(
  (TASTE_QUESTIONS.find((q) => q.shape === 'palettes')?.options ?? []).map((option) => [
    option.id,
    option,
  ]),
);

/* --------------------------------- marks ---------------------------------- */

/**
 * One hand-drawn mark per sound family — the only options in the panel with
 * nothing to draw from the art vocabularies.
 *
 * Pre-distorted paths in the app's own language (see art-pipeline.md: icons are
 * vector, wobbled at authoring time, never filtered at runtime). Stroked in
 * `currentColor` so a card takes the ink of whatever theme is live.
 */
function soundMark(group: SoundSetGroupId): JSX.Element {
  switch (group) {
    // An even row of bars: the voicing everything else is a departure from.
    case 'house':
      return (
        <path d="M 5.5 21.5 L 5 12.5 M 12 23 L 12.5 9 M 19 22 L 18.5 10 M 25.5 20.5 L 26 13.5" />
      );
    // A leaf and its stem. Nothing in this family rings.
    case 'paper':
      return (
        <>
          <path d="M 15.5 26.5 C 15 18 17 10.5 24.5 6.5 C 26.5 15 23.5 24 15.5 26.5 Z" />
          <path d="M 15.5 26.5 C 14 20 12 15.5 7 12.5" />
        </>
      );
    // Three boards, and something landing on the bottom one.
    case 'library':
      return (
        <>
          <path d="M 4.5 9.5 L 27 9 M 4.5 16.5 L 27.5 16 M 5 23.5 L 26.5 23" />
          <path d="M 15 20 L 18 20 L 18.2 23 L 14.8 23 Z" />
        </>
      );
    // A bell, with the clapper below it.
    case 'chamber':
      return (
        <>
          <path d="M 8.5 21.5 C 8.5 13 11.5 6.5 16 6.5 C 20.5 6.5 23.5 13 23.5 21.5 Z" />
          <path d="M 6.5 21.5 L 25.5 21 M 16 24 L 16 26.5" />
        </>
      );
    // A blip: square, tight, the same every press.
    case 'studio':
      return (
        <path d="M 4 21.5 L 10 21.5 L 10 10.5 L 16 10.5 L 16 21.5 L 22 21.5 L 22 14 L 28 14" />
      );
    // Almost nothing: one dot and a long rest.
    case 'hush':
      return (
        <>
          <path d="M 7 16.5 L 9.5 16.5" />
          <path d="M 14 16.5 L 26 16" />
        </>
      );
    // A spring.
    case 'whimsy':
      return (
        <path d="M 5 22 C 9 22 9 10 13 10 C 17 10 17 22 21 22 C 25 22 25 12 28 12.5" />
      );
    default:
      return <path d="M 6 16.5 L 26 16" />;
  }
}

/* -------------------------------- the panel ------------------------------- */

/**
 * How many panels are live.
 *
 * Read by `./tasteMount.tsx` so a host that renders `<TasteQuestionnaire />`
 * properly and a caller that falls back to the mounter can never produce two
 * of them arguing over one signal. A count rather than a boolean because a
 * hot-reload mounts the new instance before disposing the old one.
 */
let liveCount = 0;

export function isTasteMounted(): boolean {
  return liveCount > 0;
}

export interface TasteQuestionnaireProps {
  /**
   * Tour step id that opens the panel. `''` turns the watcher off entirely, for
   * a host that would rather call `openTaste()` itself.
   */
  openOnStep?: string;
  /** Fired after the library has actually been dressed. */
  onDone?: (report: TasteReport) => void;
  /** Fired when the reader leaves without answering. */
  onSkip?: () => void;
}

export default function TasteQuestionnaire(props: TasteQuestionnaireProps): JSX.Element {
  const [index, setIndex] = createSignal(0);
  /** Asking a question, or looking at what the four answers came to. */
  const [stage, setStage] = createSignal<'ask' | 'summary'>('ask');
  const [busy, setBusy] = createSignal(false);

  let sheetEl: HTMLDivElement | undefined;
  let advanceTimer: ReturnType<typeof setTimeout> | undefined;

  /*
   * Modal over whichever scene is behind it — usually the shelf, on first run.
   * The component is mounted for the life of the app and only RENDERS while
   * `tasteOpen()`, so the claim has to follow the same condition its <Show>
   * does or the shelf would never get its arrows back.
   */
  usePanelKeys(tasteOpen);
  /** The set that was persisted when the panel opened, restored on the way out. */
  let setOnOpen: string | null = null;

  const question = (): TasteQuestion => TASTE_QUESTIONS[index()] ?? TASTE_QUESTIONS[0];
  const answers = (): TasteAnswers => tasteAnswers();
  const chosen = (axis: TasteAxis): string | undefined =>
    answers()[axis] as string | undefined;

  /**
   * The answers given BEFORE this question, and nothing after.
   *
   * What makes each card isolate one variable: without it, the four pitch cards
   * would all be redrawn through a paper answer given later and could easily
   * come out identical.
   */
  const answersBefore = (axis: TasteAxis): TasteAnswers => {
    const stop = TASTE_AXES.indexOf(axis);
    const source = answers();
    const out: TasteAnswers = {};
    for (const other of TASTE_AXES.slice(0, Math.max(0, stop))) {
      const value = source[other];
      if (value !== undefined) (out as Record<string, string>)[other] = value;
    }
    return out;
  };

  /** The room every card in this panel is drawn against. Reactive. */
  const scheme = (): FlatScheme => resolveLibrary(libraryPrefs).scheme as FlatScheme;

  /** …and the room the answers have arrived at, for the last panel's book. */
  const roomScheme = (): FlatScheme =>
    getTheme(outcome().room.theme).scheme as FlatScheme;

  const outcome = createMemo(() => resolveTaste(answers()));
  const complete = (): boolean => isTasteComplete(answers());
  const answered = (): number =>
    TASTE_AXES.filter((axis) => answers()[axis] !== undefined).length;

  /**
   * Does this question have an answer the panel can move on from?
   *
   * Not the same as "was a card pressed", and only the palette question makes
   * that distinction. It always has an answer — the steer's, until the reader
   * overrules it — so its dot lights and its "next" is live the moment the two
   * questions it takes its steer from are in. Every other axis needs a press.
   */
  const settled = (axis: TasteAxis): boolean => {
    if (answers()[axis] !== undefined) return true;
    return axis === 'palette' && chosen('room') !== undefined && chosen('pitch') !== undefined;
  };

  /* ------------------------------ lifecycle ------------------------------ */

  onMount(() => {
    liveCount += 1;
    void loadTaste();
    void loadLibraryPrefs();
    void loadDesignPrefs();
  });
  onCleanup(() => {
    liveCount = Math.max(0, liveCount - 1);
  });

  function cancelAdvance(): void {
    if (advanceTimer !== undefined) clearTimeout(advanceTimer);
    advanceTimer = undefined;
  }
  onCleanup(cancelAdvance);

  // Opening (or re-opening) starts at the first unanswered question, so
  // "choose my look again" is a revision rather than a fresh interrogation.
  createEffect(
    on(tasteOpenToken, () => {
      if (!untrack(tasteOpen)) return;
      cancelAdvance();
      setStage('ask');
      setBusy(false);
      setOnOpen = snapshotSoundSetId();
      const source = untrack(answers);
      const first = TASTE_AXES.findIndex((axis) => source[axis] === undefined);
      setIndex(first < 0 ? 0 : first);
    }),
  );

  // The audition is engine-only, never persisted — so leaving the panel any way
  // at all has to put the reader's real set back.
  onCleanup(() => {
    cancelSoundSetPreview();
    if (setOnOpen !== null) setSoundSet(setOnOpen);
  });

  /**
   * Ride the tour's taste step: on screen for it, off screen for anything else.
   *
   * BOTH DIRECTIONS, and the second one is the reported bug. The watcher used
   * to open the panel and never close it, so answering one question and
   * pressing next left all five standing over the next step — card over the
   * tour's own next and skip, scrim over the shelf control the new step was
   * asking for. `./tourStep.ts` holds the verdict and says why it takes five
   * inputs to get right; everything here is the DOM around it.
   *
   * `openedByTour` is what keeps this out of the settings sheet's business: a
   * panel opened from "choose my look again" is not riding the tour and is
   * never taken away by it.
   */
  onMount(() => {
    const stepId = (): string => props.openOnStep ?? 'taste';
    if (stepId() === '') return;
    let openedForStep = false;
    let openedByTour = false;
    const timer = setInterval(() => {
      const layer = document.querySelector(TOUR_LAYER_SELECTOR);
      const here = layer?.getAttribute(TOUR_STEP_ATTR) ?? '';
      const open = untrack(tasteOpen);
      const verdict = stepWatchVerdict({
        here,
        stepId: stepId(),
        open,
        mine: openedByTour,
        settled: hasChosenTaste(),
        openedForStep,
      });
      if (here !== stepId()) openedForStep = false;
      if (verdict === 'leave-alone') return;
      if (verdict === 'close') {
        // The reader's own way out, not a private close: it restores the sound
        // set the audition swapped and keeps every answer they gave, so the
        // step they walk back to offers the questions where they left them.
        openedByTour = false;
        leave();
        return;
      }
      openedForStep = true;
      // The stored record decides, not the signal's opening default: a reader
      // who finished this last week must not be asked again because the tour
      // was replayed before `loadTaste()` landed.
      void loadTaste().then(() => {
        if (!hasChosenTaste() && !untrack(tasteOpen)) {
          openedByTour = true;
          openTaste();
        }
      });
    }, TOUR_POLL_MS);
    onCleanup(() => clearInterval(timer));
  });

  /* ------------------------------ navigation ----------------------------- */

  function goto(next: number): void {
    cancelAdvance();
    const clamped = Math.max(0, Math.min(TASTE_QUESTIONS.length - 1, next));
    if (clamped === untrack(index) && untrack(stage) === 'ask') return;
    setStage('ask');
    setIndex(clamped);
    void play('pop-soft', { volume: 0.5 });
  }

  function forward(): void {
    cancelAdvance();
    if (untrack(index) < TASTE_QUESTIONS.length - 1) {
      goto(untrack(index) + 1);
      return;
    }
    setStage('summary');
    void play('pop-soft', { volume: 0.55 });
  }

  function back(): void {
    cancelAdvance();
    if (untrack(stage) === 'summary') {
      setStage('ask');
      setIndex(TASTE_QUESTIONS.length - 1);
      void play('tick-hover', { volume: 0.5 });
      return;
    }
    if (untrack(index) === 0) {
      leave();
      return;
    }
    goto(untrack(index) - 1);
  }

  /** Leave without dressing anything. The answers stay for next time. */
  function leave(): void {
    cancelAdvance();
    cancelSoundSetPreview();
    if (setOnOpen !== null) setSoundSet(setOnOpen);
    closeTaste();
    props.onSkip?.();
  }

  /* -------------------------------- answering ---------------------------- */

  function pick(axis: TasteAxis, option: TasteOption): void {
    cancelAdvance();
    setTasteAnswer(axis, option.id);

    if (axis === 'sound') {
      // Audition without persisting: the engine is switched, the family's
      // signature plays, and the reader's own set goes back on the way out.
      // No auto-advance here — the whole point is to try more than one.
      setSoundSet(resolveSoundSet({ sound: option.id as SoundSetGroupId }).set);
      previewSoundSet();
      return;
    }

    void play('click-soft', { volume: 0.6 });

    // The palette grid does not walk on either, and for the sound question's
    // reason: it is sixty cards and the reader came here to compare them. Being
    // carried off to the next question 0.6s after pressing the fortieth — losing
    // the scroll position that took to reach — is the panel deciding they were
    // finished. "next" is one press away and never disabled here.
    if (axis === 'palette') return;
    const ms = motionScale();
    if (ms <= 0) {
      forward();
      return;
    }
    const from = untrack(index);
    advanceTimer = setTimeout(() => {
      advanceTimer = undefined;
      // A manual move during the beat wins — never yank the reader sideways.
      if (untrack(index) === from && untrack(stage) === 'ask') forward();
    }, ADVANCE_MS * Math.max(0.5, ms));
  }

  /* --------------------------------- apply ------------------------------- */

  async function dress(): Promise<void> {
    if (busy()) return;
    setBusy(true);
    cancelSoundSetPreview();
    try {
      const report = await applyTaste(untrack(answers));
      // The chosen set is persisted now, so the restore on cleanup must not
      // put the old one back over it.
      setOnOpen = null;
      void play('check-done', { volume: 0.6 });
      closeTaste();
      props.onDone?.(report);
    } finally {
      setBusy(false);
    }
  }

  /* -------------------------------- keyboard ----------------------------- */

  onMount(() => {
    const handler = (event: KeyboardEvent): void => {
      if (!tasteOpen()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        leave();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        back();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        forward();
      }
    };
    window.addEventListener('keydown', handler, true);
    onCleanup(() => window.removeEventListener('keydown', handler, true));
  });

  // Focus the sheet so the keys work without a click first.
  createEffect(
    on([tasteOpen, index, stage], () => {
      if (!tasteOpen()) return;
      queueMicrotask(() => sheetEl?.focus({ preventScroll: true }));
    }),
  );

  // Entrance: the sheet leans in, once per question. Transform and opacity
  // only, and it disappears entirely when motion is off.
  createEffect(
    on([index, stage, tasteOpen], () => {
      if (!tasteOpen()) return;
      const el = sheetEl;
      if (el === undefined) return;
      const ms = motionScale();
      gsap.killTweensOf(el);
      if (ms <= 0) {
        gsap.set(el, { autoAlpha: 1, scale: 1, rotate: 0, y: 0 });
        return;
      }
      gsap.fromTo(
        el,
        { autoAlpha: 0, scale: 0.972, rotate: -0.5, y: 12 },
        {
          autoAlpha: 1,
          scale: 1,
          rotate: 0,
          y: 0,
          duration: 0.4 * ms,
          ease: 'back.out(1.5)',
        },
      );
    }),
  );

  /* --------------------------------- render ------------------------------ */

  /**
   * The room one option would produce.
   *
   * Resolved through a getter rather than once at card-creation time: going
   * back and changing question one has to redraw question two's four cards, and
   * `<For>` will not rebuild them because its array (a module constant per
   * question) has not changed.
   */
  const roomFor = (axis: TasteAxis, option: TasteOption): TasteRoom =>
    resolveRoom({ ...answersBefore(axis), [axis]: option.id } as TasteAnswers);

  /* ------------------------------ the palettes ---------------------------- */

  /**
   * The room as the STEER has it — the reader's carpentry and paper, painted in
   * the palette the two answers before this question worked out.
   *
   * One `resolveRoom` for the whole grid. Every swatch is this room with one
   * field changed (`repaintedAs`), which is both cheap and the panel's own
   * discipline: one variable per question, and here the variable is the colour.
   */
  const steerRoom = createMemo(() => resolveRoom(answersBefore('palette')));

  /** All sixty, best answer to the steer first. Recomputed only when it moves. */
  const palettes = createMemo(() => paletteOrder(answersBefore('palette')));

  /**
   * What the grid opens on when nothing has been pressed.
   *
   * Read off `steerRoom` rather than through `steerTheme`, which would resolve
   * the same room a second time: `answersBefore('palette')` cannot contain a
   * palette answer, so the two are the same value by construction.
   *
   * A MEMO, and it has to be one. This is the grid's `resetKey`, and `Capped`
   * collapses on every notification from it rather than on a change of value —
   * it cannot tell the difference, because a `resetKey` is an opaque `unknown`.
   * `steerRoom` returns a fresh object whenever ANY answer moves, the palette
   * one included, so as a plain derived accessor this fired on every card press
   * and the reader browsing the forty behind "more" had the grid slam shut under
   * the card they had just pressed. Memoised it yields a string, `createMemo`
   * compares strings by value, and the grid now collapses only when the steer
   * genuinely points somewhere else.
   */
  const steerPick = createMemo<ThemeId>(() => steerRoom().theme);

  /**
   * The lit card: the reader's pick, or the steer's if they have not pressed one.
   *
   * The fallback is why `answers.palette` can stay `undefined` and still show a
   * chosen card. It is not a white lie — `resolveRoom` resolves an absent
   * palette to exactly this theme, so the lit card is genuinely the room they
   * will get if they press on.
   */
  const litPalette = createMemo<ThemeId>(
    () => (chosen('palette') as ThemeId | undefined) ?? steerPick(),
  );

  /** The room one palette would give, drawn by the studio's own routine. */
  const paletteCard = (id: ThemeId): JSX.Element => {
    const room = (): TasteRoom => repaintedAs(steerRoom(), id);
    return (
      <DesignCanvas
        class="nbq-art nbq-art--swatch"
        key={`taste-pal|${roomKey(room())}`}
        w={SWATCH_W}
        h={SWATCH_H}
        scheme={scheme()}
        draw={(ctx: FlatCtx, w: number, h: number) => drawRoomCard(ctx, w, h, room())}
      />
    );
  };

  /** The room one option would produce, as a card. */
  const roomCard = (axis: TasteAxis, option: TasteOption): JSX.Element => (
    <DesignCanvas
      class="nbq-art"
      // Every axis the drawing varies on, spelled out rather than named: the
      // room may have been repainted or rehung, so two cards can share a preset
      // and be two different pictures. The colours have to be in the key at all
      // because the card paints itself in a scheme the tile cache knows nothing
      // about (see `drawInScheme`).
      key={`taste|${roomKey(roomFor(axis, option))}`}
      w={CARD_W}
      h={CARD_H}
      scheme={scheme()}
      draw={(ctx: FlatCtx, w: number, h: number) =>
        drawRoomCard(ctx, w, h, roomFor(axis, option))
      }
    />
  );

  const finalRoom = () => outcome().room;

  /** The welcome book, rebound the way the answers would rebind it. */
  const bookDesign = () =>
    resolveBookDesign({
      seed: WELCOME_SPINE_SEED,
      // The welcome book's own claret, folded exactly as the shelf folds it —
      // `pigment` in `WELCOME_BINDING` is an index into the pigment names, not
      // into the cloths (see the long note in data/seed.ts).
      cloth: clothForPalette(Number(WELCOME_BINDING.pigment ?? 20)),
      gilt: true,
      preset: outcome().binding.id,
    });

  return (
    <Show when={tasteOpen()}>
      <Portal>
        <div class="nbq-layer" data-taste-stage={stage()} data-taste-step={question().axis}>
          <div class="nbq-scrim" aria-hidden="true" />
          <div
            class="nbq-sheet"
            ref={(el) => (sheetEl = el)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="nbq-title"
            tabindex="-1"
          >
            <span class="nbq-tape" aria-hidden="true" />

            {/* Every way out lives in the top-left. */}
            <div class="nbq-exits">
              <Show when={index() > 0 || stage() === 'summary'}>
                <button type="button" class="nbq-exit font-ui" onClick={back}>
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M 10.4 2.6 L 4.6 8.1 L 10.2 13.5" />
                  </svg>
                  back
                </button>
              </Show>
              <button type="button" class="nbq-exit nbq-exit--quiet font-ui" onClick={leave}>
                I'll pick later
              </button>
            </div>

            <Show
              when={stage() === 'ask'}
              fallback={
                <div class="nbq-final">
                  <p class="nbq-eyebrow font-ui">your library</p>
                  <h2 class="nbq-title" id="nbq-title">
                    {finalRoom().from.name}
                  </h2>
                  <p class="nbq-body">
                    {finalRoom().from.blurb}
                    <Show when={finalRoom().note}>
                      {(note) => <span class="nbq-note-inline"> — {note()}.</span>}
                    </Show>
                  </p>

                  <div class="nbq-final-art">
                    <DesignCanvas
                      class="nbq-art nbq-art--big"
                      key={`taste-final|${roomKey(finalRoom())}`}
                      w={FINAL_W}
                      h={FINAL_H}
                      scheme={scheme()}
                      draw={(ctx: FlatCtx, w: number, h: number) =>
                        drawRoomCard(ctx, w, h, finalRoom())
                      }
                    />
                    <DesignCanvas
                      class="nbq-art nbq-art--book"
                      // The room is in the key because the card is drawn in it:
                      // `drawBindingCard` takes the recess it stands against and
                      // the board it stands on from the LIVE scheme, and the
                      // room the reader is standing in is not the one they are
                      // about to get. Without the swap the summary showed a
                      // claret book on a teal plank beside a bone-white room.
                      key={`taste-book|${outcome().binding.id}|${finalRoom().theme}`}
                      w={BOOK_W}
                      h={BOOK_H}
                      scheme={roomScheme()}
                      draw={(ctx: FlatCtx, w: number, h: number) =>
                        drawInScheme(roomScheme(), () =>
                          drawBindingCard(ctx, w, h, bookDesign()),
                        )
                      }
                    />
                  </div>

                  <dl class="nbq-ledger font-ui">
                    <div>
                      <dt>colours</dt>
                      <dd>
                        {getTheme(finalRoom().theme).name}
                        {/* Which of the two happened is the one thing the reader
                            came to this row to check, and the name alone cannot
                            say it: the steer's pick and their own pick print
                            identically. */}
                        <Show when={finalRoom().picked}>
                          <span class="nbq-ledger-by"> · your pick</span>
                        </Show>
                      </dd>
                    </div>
                    <div>
                      <dt>carpentry</dt>
                      <dd>
                        {BUILDS[finalRoom().build].name} ·{' '}
                        {PATTERNS[finalRoom().pattern].name}
                      </dd>
                    </div>
                    <div>
                      <dt>the wall</dt>
                      <dd>{getWallpaper(finalRoom().paper).name}</dd>
                    </div>
                    <div>
                      <dt>welcome book</dt>
                      <dd>{outcome().binding.label}</dd>
                    </div>
                    <div>
                      <dt>sound</dt>
                      <dd>{SOUND_SET_GROUPS[outcome().soundGroup].name}</dd>
                    </div>
                    <div>
                      <dt>interface</dt>
                      <dd>
                        {outcome().uiTheme} · {outcome().ink.replace('-', ' ')} ink
                      </dd>
                    </div>
                  </dl>

                  <p class="nbq-note font-ui">
                    None of this is settled. The studio in the left rail repaints
                    the room, rebuilds the case and rehangs the wall; the book
                    studio rebinds any book; settings holds the sound and the ink.
                  </p>
                </div>
              }
            >
              <div class="nbq-ask">
                <p class="nbq-eyebrow font-ui">
                  question {index() + 1} of {TASTE_QUESTIONS.length}
                </p>
                <h2 class="nbq-title" id="nbq-title">
                  {question().title}
                </h2>
                <p class="nbq-body">{question().body}</p>

                <Show when={question().shape === 'palettes'}>
                  <div
                    class="nbq-palette"
                    role="radiogroup"
                    aria-label={question().title}
                  >
                    {/* Twenty, then "40 more" — the app's own cap, and the app's
                        own control. `isActive` keeps the lit card in the head
                        when the grid is collapsed again, so a palette chosen
                        from the bottom of the sixty does not vanish and read as
                        forgotten. */}
                    <Capped
                      each={palettes()}
                      limit={PALETTE_HEAD}
                      isActive={(id) => id === litPalette()}
                      label="palettes"
                      moreClass="nbq-swatch-more"
                      resetKey={steerPick()}
                    >
                      {(id) => {
                        const option = (): TasteOption =>
                          PALETTE_OPTIONS.get(id()) ?? {
                            id: id(),
                            label: id(),
                            line: '',
                          };
                        const picked = (): boolean => litPalette() === id();
                        /* Lit without having been pressed — the steer's own
                           pick. Said out loud rather than left as a colour
                           difference, because "already chosen" is exactly the
                           thing a reader has to know to be able to press on. */
                        const bySteer = (): boolean =>
                          picked() && chosen('palette') === undefined;
                        return (
                          <button
                            type="button"
                            class="nbq-swatch"
                            classList={{
                              'is-picked': picked(),
                              'is-steer': bySteer(),
                            }}
                            role="radio"
                            aria-checked={picked()}
                            aria-label={`${option().label} — ${option().line}${
                              bySteer() ? ' — chosen for you by your answers' : ''
                            }`}
                            data-tooltip={`${option().label} — ${option().line}`}
                            onClick={() => pick('palette', option())}
                          >
                            {paletteCard(id())}
                            <span class="nbq-swatch-name font-ui">{option().label}</span>
                            <Show when={picked()}>
                              <span class="nbq-picked nbq-picked--small" aria-hidden="true">
                                <svg viewBox="0 0 20 20">
                                  <path d="M 4.4 10.4 L 8.2 14.6 L 15.6 5.2" />
                                </svg>
                              </span>
                            </Show>
                          </button>
                        );
                      }}
                    </Capped>
                  </div>
                  <p class="nbq-steer-note font-ui">
                    <Show
                      when={chosen('palette') !== undefined}
                      fallback={
                        <>
                          {getTheme(steerPick()).name} is what your answers came to,
                          and it is already chosen — press next and you keep it.
                        </>
                      }
                    >
                      {getTheme(litPalette()).name} it is. Your answers pointed at{' '}
                      {getTheme(steerPick()).name}; yours wins.
                    </Show>
                  </p>
                </Show>

                {/* A sibling `Show` rather than `hidden` on the grid below:
                    `<For>` builds its rows whatever the CSS says, so a hidden
                    options grid would draw sixty room cards for the one
                    question that has already drawn its own. */}
                <Show when={question().shape !== 'palettes'}>
                <div
                  class="nbq-options"
                  classList={{ 'nbq-options--sounds': question().shape === 'sounds' }}
                  role="radiogroup"
                  aria-label={question().title}
                >
                  <For each={question().options}>
                    {(option) => {
                      const picked = (): boolean => chosen(question().axis) === option.id;
                      return (
                        <button
                          type="button"
                          class="nbq-option"
                          classList={{ 'is-picked': picked() }}
                          role="radio"
                          aria-checked={picked()}
                          onClick={() => pick(question().axis, option)}
                        >
                          <Show
                            when={question().shape === 'rooms'}
                            fallback={
                              <span class="nbq-mark" aria-hidden="true">
                                <svg viewBox="0 0 32 32">
                                  {soundMark(option.id as SoundSetGroupId)}
                                </svg>
                              </span>
                            }
                          >
                            {roomCard(question().axis, option)}
                          </Show>
                          <span class="nbq-option-text">
                            <span class="nbq-option-name">{option.label}</span>
                            <span class="nbq-option-line font-ui">{option.line}</span>
                          </span>
                          <Show when={picked()}>
                            <span class="nbq-picked" aria-hidden="true">
                              <svg viewBox="0 0 20 20">
                                <path d="M 4.4 10.4 L 8.2 14.6 L 15.6 5.2" />
                              </svg>
                            </span>
                          </Show>
                        </button>
                      );
                    }}
                  </For>
                </div>
                </Show>
              </div>
            </Show>

            <div class="nbq-foot">
              <div class="nbq-dots" role="tablist" aria-label="Questions">
                <For each={TASTE_QUESTIONS}>
                  {(q, i) => (
                    <button
                      type="button"
                      class="nbq-dot"
                      classList={{
                        'is-current': stage() === 'ask' && i() === index(),
                        'is-done': settled(q.axis),
                      }}
                      role="tab"
                      aria-selected={stage() === 'ask' && i() === index()}
                      aria-label={q.title}
                      onClick={() => goto(i())}
                    >
                      <svg viewBox="0 0 14 14" aria-hidden="true">
                        <circle cx="7" cy="7" r="4.2" />
                      </svg>
                    </button>
                  )}
                </For>
              </div>
              <span class="nbq-spacer" />
              <Show
                when={stage() === 'summary'}
                fallback={
                  <button
                    type="button"
                    class="nbq-btn nbq-btn--primary font-ui"
                    disabled={!settled(question().axis)}
                    onClick={forward}
                  >
                    {index() === TASTE_QUESTIONS.length - 1 ? 'see it' : 'next'}
                  </button>
                }
              >
                <button
                  type="button"
                  class="nbq-btn nbq-btn--primary font-ui"
                  disabled={busy() || !complete()}
                  onClick={() => void dress()}
                >
                  {busy() ? 'dressing…' : 'dress my library'}
                </button>
              </Show>
            </div>

            {/* The library converging, one answer at a time. Hidden until
                there is an answer, because before that it would be describing
                a room nobody has asked for. */}
            <Show when={stage() === 'ask' && answered() > 0}>
              <p class="nbq-summary-line font-ui" aria-live="polite">
                so far · {describeTaste(outcome())}
              </p>
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
