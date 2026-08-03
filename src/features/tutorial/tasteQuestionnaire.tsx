/**
 * src/features/tutorial/tasteQuestionnaire.tsx — four questions, asked once,
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
 * ## Mounting
 *
 * Self-contained and inert until opened. Render it once, anywhere:
 *
 *     import TasteQuestionnaire from './features/tutorial/tasteQuestionnaire';
 *     <TasteQuestionnaire />
 *
 * It opens itself when the guided tour reaches a step whose id is `taste`
 * (`openOnStep`), which it reads from the `data-tutorial-step` attribute the
 * overlay already puts on its own layer — the same outside-in contract
 * `./probe.ts` uses to watch the app. No import in either direction, so the
 * tour's step list and this panel can be changed without touching each other.
 * `openTaste()` / `replayTaste()` open it directly for every other caller (the
 * settings sheet's "choose my look again" row is one).
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
import { getTheme } from '../../art/themes';
import { WELCOME_BINDING, WELCOME_SPINE_SEED } from '../../data/seed';
import { play, setSoundSet } from '../../sound/engine';
import { cancelSoundSetPreview, previewSoundSet } from '../../sound/preview';
import { snapshotSoundSetId } from '../../sound/soundSetPrefs';
import { SOUND_SET_GROUPS, type SoundSetGroupId } from '../../sound/soundSets';
import { motionScale } from '../../styles/motion';
import { DesignCanvas, drawInScheme } from '../../views/rail/designArt';
import { drawBindingCard, drawRoomCard } from '../../views/rail/designOptions';
import {
  loadLibraryPrefs,
  libraryPrefs,
  resolveLibrary,
} from '../bookshelf/libraryPrefs';
import { loadDesignPrefs } from '../../data/designPrefs';
import { applyTaste, type TasteReport } from './tasteApply';
import {
  TASTE_AXES,
  TASTE_QUESTIONS,
  describeTaste,
  isTasteComplete,
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

/** The room on the last panel, drawn big enough to be a decision. */
const FINAL_W = 340;
const FINAL_H = 214;

/** The welcome book beside it. Narrow, so the spine is most of its card. */
const BOOK_W = 96;
const BOOK_H = 214;

/**
 * The tour's own layer carries its current step id. Read rather than imported:
 * the step list belongs to another module and this panel must not pin its shape.
 */
const TOUR_STEP_SELECTOR = '.nbt-layer[data-tutorial-step]';

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
   * Open when the tour reaches its taste step.
   *
   * A 300ms poll rather than a rAF loop: this is a "has the tour got here yet"
   * question, it is alive for the whole session, and four reads a second of one
   * attribute is already more than the answer can change.
   */
  onMount(() => {
    const stepId = (): string => props.openOnStep ?? 'taste';
    if (stepId() === '') return;
    /**
     * Opened for THIS visit to the step already.
     *
     * Without it, "I'll pick later" is not a way out: the tour is still parked
     * on the taste step (its task is outstanding, because the reader just
     * declined it), so the very next poll reopened the panel over the top of
     * them. Cleared when the tour moves to a different step, so walking back to
     * it offers the questions again.
     */
    let openedForStep = false;
    const timer = setInterval(() => {
      const layer = document.querySelector(TOUR_STEP_SELECTOR);
      const here = layer?.getAttribute('data-tutorial-step') ?? '';
      if (here !== stepId()) {
        openedForStep = false;
        return;
      }
      if (openedForStep || untrack(tasteOpen) || hasChosenTaste()) return;
      openedForStep = true;
      // The stored record decides, not the signal's opening default: a reader
      // who finished this last week must not be asked again because the tour
      // was replayed before `loadTaste()` landed.
      void loadTaste().then(() => {
        if (!hasChosenTaste() && !untrack(tasteOpen)) openTaste();
      });
    }, 300);
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
                      <dd>{getTheme(finalRoom().theme).name}</dd>
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
                        'is-done': chosen(q.axis) !== undefined,
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
                    disabled={chosen(question().axis) === undefined}
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
