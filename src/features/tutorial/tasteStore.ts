/**
 * src/features/tutorial/tasteStore.ts — the questionnaire's own state: is it
 * on screen, what has been answered, and has it ever been finished.
 *
 * PERSISTENCE lives under its own key in the `settings` TABLE, exactly like
 * `./state.ts` keeps the tour's completion marker and `data/designPrefs.ts`
 * keeps the studio's vocabularies. `data/settings.ts` validates its blob field
 * by field, so a key it does not know is silently dropped on the next read, and
 * widening a validator this module does not own — for a record that is not a
 * user preference but a "did this happen" marker — is the wrong trade. The same
 * argument, in the same words, is already written down in `soundSetPrefs.ts`.
 *
 * WHAT IS AND IS NOT REMEMBERED. The answers are kept so the panel can be
 * reopened on them ("choose my look again" in the settings sheet), and so a
 * half-finished questionnaire survives a reload. They are NOT consulted by
 * anything that draws: once `tasteApply` has run, the room, the binding, the
 * sound set and the interface colours are ordinary stored choices that the
 * studio and the settings sheet own outright. Nothing re-derives the library
 * from these answers, ever — which is what makes every one of them changeable
 * afterwards without this record becoming a lie.
 *
 * Every read is failure-tolerant: a dead database must not stop the app
 * starting, and must not make the questionnaire reappear on every launch
 * either.
 */

import { createSignal, type Accessor } from 'solid-js';
import { getDb } from '../../data/db';
import {
  mergeTasteAnswers,
  type TasteAnswers,
  type TasteAxis,
} from './tasteProfile';

/** settings-table key holding `{ answers, done }`. */
export const TASTE_KEY = 'appState:taste';

interface StoredTaste {
  answers: TasteAnswers;
  /** True once the reader pressed "dress my library". Skipping does not set it. */
  done: boolean;
}

const EMPTY: StoredTaste = { answers: {}, done: false };

function parseStored(raw: string | undefined): StoredTaste {
  if (typeof raw !== 'string' || raw.length === 0) return { ...EMPTY };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...EMPTY };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...EMPTY };
  }
  const source = parsed as Record<string, unknown>;
  return {
    answers: mergeTasteAnswers(source.answers),
    done: source.done === true,
  };
}

/* -------------------------------- signals -------------------------------- */

const [answers, setAnswers] = createSignal<TasteAnswers>({});
const [done, setDone] = createSignal(false);
const [open, setOpen] = createSignal(false);
const [openToken, setOpenToken] = createSignal(0);

/** What has been answered so far. Reactive. */
export const tasteAnswers: Accessor<TasteAnswers> = answers;

/** True while the questionnaire is on screen. Reactive. */
export const tasteOpen: Accessor<boolean> = open;

/** Bumped on every `openTaste()`, so reopening restarts a panel already up. */
export const tasteOpenToken: Accessor<number> = openToken;

/* --------------------------------- reads --------------------------------- */

let loadPromise: Promise<StoredTaste> | null = null;

/** Read the record once. Idempotent; safe from any onMount. Never throws. */
export function loadTaste(): Promise<StoredTaste> {
  loadPromise ??= (async () => {
    let stored: StoredTaste = { ...EMPTY };
    try {
      const db = await getDb();
      const rows = await db.select<Array<{ value: string }>>(
        'SELECT value FROM settings WHERE key = $1 LIMIT 1',
        [TASTE_KEY],
      );
      stored = parseStored(rows[0]?.value);
    } catch {
      // No row, no table, no database. An unanswered questionnaire is a fine
      // answer — and the panel's own first-run check will not nag, because a
      // library it cannot read is a library it cannot dress either.
      stored = { ...EMPTY, done: true };
    }
    setAnswers(stored.answers);
    setDone(stored.done);
    return stored;
  })();
  return loadPromise;
}

/** Detached snapshot for non-Solid readers (the tour's probe, QA bridges). */
export function snapshotTasteAnswers(): TasteAnswers {
  return { ...answers() };
}

/**
 * Has the reader finished the questionnaire?
 *
 * Synchronous, so the tour's step probe can ask it on a rAF loop without a
 * promise. Answers `false` until `loadTaste()` has landed, which is the safe
 * direction: a step that has not proved itself done stays outstanding.
 */
export function hasChosenTaste(): boolean {
  return done();
}

/* --------------------------------- writes -------------------------------- */

async function persist(next: StoredTaste): Promise<void> {
  try {
    const db = await getDb();
    await db.execute('INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)', [
      TASTE_KEY,
      JSON.stringify(next),
    ]);
  } catch {
    // Best effort, like every other keyed record in this app. The session still
    // shows the library they chose.
  }
}

/**
 * Record one answer. Optimistic — the panel's previews redraw on the frame the
 * card was pressed and the write lands behind them.
 */
export function setTasteAnswer(axis: TasteAxis, value: string): TasteAnswers {
  const next = mergeTasteAnswers({ ...answers(), [axis]: value });
  setAnswers(next);
  void persist({ answers: next, done: done() });
  return next;
}

/**
 * Mark the questionnaire finished. Called by `tasteApply` after the writes
 * land, never by the panel — "done" means "your library was dressed", and a
 * marker set before the writes would survive a failure that left nothing
 * dressed.
 */
export async function rememberTasteChosen(final: TasteAnswers): Promise<void> {
  const merged = mergeTasteAnswers(final);
  setAnswers(merged);
  setDone(true);
  await persist({ answers: merged, done: true });
}

/**
 * Forget that it was ever finished, so the next launch offers it again.
 * The answers are kept: reopening on the reader's previous choices is what
 * makes "choose my look again" a revision rather than a fresh interrogation.
 */
export async function resetTaste(): Promise<void> {
  setDone(false);
  await persist({ answers: answers(), done: false });
}

/* ------------------------------- open / close ----------------------------- */

/**
 * Put the questionnaire on screen. Safe to call while it is already up — the
 * token bump restarts it at question one, the same contract `startTutorial()`
 * has with the tour overlay.
 */
export function openTaste(): void {
  setOpen(true);
  setOpenToken((t) => t + 1);
}

/** Take it off screen. Does not mark anything as done. */
export function closeTaste(): void {
  setOpen(false);
}

/** Clear the marker and open it again — the settings sheet's row. */
export async function replayTaste(): Promise<void> {
  await loadTaste();
  await resetTaste();
  openTaste();
}

/** Test seam: forget the load so a fresh database is read again. */
export function resetTasteStoreForTests(): void {
  loadPromise = null;
  setAnswers({});
  setDone(false);
  setOpen(false);
}
