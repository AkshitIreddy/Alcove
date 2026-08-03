/**
 * src/features/tutorial/tasteApply.ts — the one write path out of the taste
 * questionnaire.
 *
 * ## It makes the same calls the panels make, and nothing else
 *
 * Six things get dressed — the room's colours, its carpentry, its paper, the
 * welcome book's binding, the sound set, and the interface's own colour scheme
 * and ink — and every one of them goes through the module that already owns
 * that choice:
 *
 *   colours .......... `saveLibraryPrefs`  (features/bookshelf/libraryPrefs)
 *   carpentry+paper .. `saveRoomDesign`    (data/designPrefs)
 *   the binding ...... `saveBookBinding`   (data/designPrefs)
 *   the sound set .... `saveSoundSet`      (sound/soundSetPrefs)
 *   the interface .... `save`              (data/settings)
 *
 * That is the whole reason this is a starting point rather than a lock. There
 * is no "taste" layer underneath the studio reinterpreting these values, no
 * second source of truth, and nothing that re-runs when the answers change:
 * after this function returns, every one of the six is an ordinary stored
 * choice, indistinguishable from one the reader made by hand — and the library
 * studio, the book studio and the settings sheet each own theirs outright.
 *
 * The room writes are the same PAIR `LibraryStudio.applyPreset` makes, borrowed
 * deliberately including its clearing of the borrowed part colours: leaving a
 * `timberHex` from a previous session behind would hand the reader a room that
 * does not look like the card they just pressed, with no way to tell why.
 *
 * ## Injectable
 *
 * The writers arrive as a `TasteSink` so a node test can drive the whole
 * decision — which room, which binding, which set, which theme — without a
 * database, in the same shape `features/settings/apply.ts` uses for the DOM and
 * the sound engine. `liveTasteSink` is the real one.
 */

import {
  saveBookBinding,
  saveRoomDesign,
  type RoomDesign,
} from '../../data/designPrefs';
import { listBooksByFloorRange } from '../../data/books';
import { LEGACY_WELCOME_BOOK_TITLES, WELCOME_BOOK_TITLE } from '../../data/seed';
import { save as saveAppSettings } from '../../data/settings';
import type { Settings } from '../../data/types';
import { saveSoundSet } from '../../sound/soundSetPrefs';
import { saveLibraryPrefs, type LibraryPrefs } from '../bookshelf/libraryPrefs';
import { resolveTaste, type TasteAnswers, type TasteOutcome } from './tasteProfile';
import {
  closeTaste,
  hasChosenTaste,
  openTaste,
  rememberTasteChosen,
  setTasteAnswer,
  snapshotTasteAnswers,
} from './tasteStore';

/* ------------------------------- the sink -------------------------------- */

/** The five writers, plus the one lookup, this module needs. */
export interface TasteSink {
  saveLibraryPrefs(patch: Partial<LibraryPrefs>): Promise<unknown>;
  saveRoomDesign(patch: Partial<RoomDesign>): Promise<unknown>;
  saveBookBinding(bookId: string, preset: string): Promise<unknown>;
  saveSoundSet(id: string): Promise<unknown>;
  saveSettings(patch: Partial<Settings>): Promise<unknown>;
  /** The welcome book's id, or null when the library has not got one. */
  welcomeBookId(): Promise<string | null>;
}

/** Every title the welcome book has ever shipped under. */
const WELCOME_TITLES: readonly string[] = [
  WELCOME_BOOK_TITLE,
  ...LEGACY_WELCOME_BOOK_TITLES,
];

/**
 * Find the welcome book by title, across the WHOLE library rather than the open
 * case (`listBooksByFloorRange` with no bookcase id means the whole library —
 * see the note in CLAUDE.md; that is deliberate, and it is what is wanted here).
 *
 * By title because that is already this app's identity check for it —
 * `data/seed.ts` uses the same list to decide whether to seed a second one, and
 * the id is a uuid nobody can name. A reader who has renamed it is a reader who
 * has made it theirs, and dressing a book they renamed would be the wrong move
 * anyway: no match simply means the binding is not written, and every other
 * part of the library is still dressed.
 */
async function findWelcomeBookId(): Promise<string | null> {
  try {
    const books = await listBooksByFloorRange(-1, 999);
    const found = books.find((book) => WELCOME_TITLES.includes(book.title));
    return found?.id ?? null;
  } catch {
    return null;
  }
}

/** The real writers. */
export const liveTasteSink: TasteSink = {
  saveLibraryPrefs: (patch) => saveLibraryPrefs(patch),
  saveRoomDesign: (patch) => saveRoomDesign(patch),
  saveBookBinding: (bookId, preset) => saveBookBinding(bookId, preset),
  saveSoundSet: (id) => saveSoundSet(id),
  saveSettings: (patch) => saveAppSettings(patch),
  welcomeBookId: findWelcomeBookId,
};

/* -------------------------------- the write ------------------------------ */

/** What actually landed. Every field is reported so QA can assert on it. */
export interface TasteReport {
  outcome: TasteOutcome;
  /** The book the binding went on, or null when there was no welcome book. */
  boundBookId: string | null;
  /** Anything that threw, by name. Empty when the whole dressing landed. */
  failed: readonly string[];
}

/**
 * Dress the library from one outcome.
 *
 * Each write is awaited INDEPENDENTLY and its failure recorded rather than
 * thrown. This runs on the first screen a reader ever sees; a library that
 * ended up with its room and its sound but not its binding is still a library,
 * and a rejected promise here would be a blank overlay with a spinner on it.
 */
export async function applyTasteWith(
  outcome: TasteOutcome,
  sink: TasteSink,
): Promise<TasteReport> {
  const failed: string[] = [];
  const attempt = async (name: string, run: () => Promise<unknown>): Promise<void> => {
    try {
      await run();
    } catch {
      failed.push(name);
    }
  };

  const room = outcome.room;

  await Promise.all([
    // The colour half. `shelf`/`wall` go back to following the room and the
    // reader's own hexes are cleared — see the module docblock.
    attempt('colours', () =>
      sink.saveLibraryPrefs({
        theme: room.theme,
        shelf: null,
        wall: null,
        timberHex: null,
        wallHex: null,
      }),
    ),
    // The carpentry and the paper.
    attempt('room', () =>
      sink.saveRoomDesign({
        build: room.build,
        pattern: room.pattern,
        wallpaper: room.wallpaper,
      }),
    ),
    // The interface: `data-theme` and `data-ink` on <html>, which is what the
    // rail icons, the settings sheet and every panel take their colour from.
    attempt('interface', () =>
      sink.saveSettings({ theme: outcome.uiTheme, inkColor: outcome.ink }),
    ),
    attempt('sound', () => sink.saveSoundSet(outcome.soundSet)),
  ]);

  let boundBookId: string | null = null;
  try {
    boundBookId = await sink.welcomeBookId();
  } catch {
    boundBookId = null;
  }
  if (boundBookId !== null) {
    const bookId = boundBookId;
    await attempt('binding', () => sink.saveBookBinding(bookId, outcome.binding.id));
  }

  return { outcome, boundBookId, failed };
}

/**
 * Resolve the answers and dress the library. The one call the questionnaire
 * makes, and the one a host mounting it by hand should make.
 *
 * The "we asked, and it was answered" marker is written LAST and only here, so
 * a run that never reached the writes cannot leave the app thinking it did.
 */
export async function applyTaste(answers: TasteAnswers): Promise<TasteReport> {
  const report = await applyTasteWith(resolveTaste(answers), liveTasteSink);
  await rememberTasteChosen(answers);
  return report;
}

/* -------------------------------- QA bridge ------------------------------- */

/**
 * The bridge a probe should drive, handed out from the module that owns the
 * write path — the rule `world.ts` states for its own bridges. A probe's own
 * `import('/src/data/…')` can land on a second copy of a module on a dev server
 * that has served HMR updates, and a store written on that copy never reaches
 * the shelf; going through this one cannot.
 *
 * `apply` reports what it decided; the APPLIED state is still read back through
 * `__shelfDesign()` / `__libraryPrefs.current()` / `__nbSoundSets.get()`, never
 * from here.
 */
declare global {
  interface Window {
    __nbTaste?: {
      resolve: (answers: TasteAnswers) => TasteOutcome;
      apply: (answers: TasteAnswers) => Promise<TasteReport>;
      answers: () => TasteAnswers;
      open: () => void;
      close: () => void;
      chosen: () => boolean;
      /** Answer one question the way a card press does. */
      answer: (axis: string, value: string) => void;
    };
  }
}

if (typeof window !== 'undefined') {
  window.__nbTaste = {
    resolve: resolveTaste,
    apply: applyTaste,
    answers: snapshotTasteAnswers,
    open: openTaste,
    close: closeTaste,
    chosen: hasChosenTaste,
    answer: (axis, value) => {
      setTasteAnswer(axis as Parameters<typeof setTasteAnswer>[0], value);
    },
  };
}
